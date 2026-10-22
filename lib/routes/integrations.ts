import type { Express } from 'express';
import { readDB, saveDB } from '../store';
import { buildScheduleIcs } from '../calendarExport';
import { fetchPraccCalendar, reconcilePraccSchedule, validatePraccCalendarUrl } from '../praccCalendar';

// Integrations: secret status, the schedule calendar export and the PRACC
// calendar feed. All protected routes (registered after the auth middleware).
export function registerIntegrationRoutes(app: Express) {
  const requireCoach = (req: any, res: any) => {
    if (req.user?.role === 'coach') return true;
    res.status(403).json({ error: 'Only a coach can configure the PRACC calendar.' });
    return false;
  };

  const praccStatus = (settings: any) => ({
    configured: Boolean(settings?.praccCalendarUrl),
    url: settings?.praccCalendarUrl || '',
    lastAttemptAt: settings?.praccCalendarLastAttemptAt || null,
    lastSyncedAt: settings?.praccCalendarLastSyncedAt || null,
    lastError: settings?.praccCalendarLastError || null,
  });

  // One sync at a time per process: concurrent clicks share the same run
  // instead of racing to write duplicate schedule rows.
  let praccSyncInFlight: Promise<any> | null = null;
  const syncPraccCalendar = (configureUrl: string | null, force = false) => {
    if (praccSyncInFlight && !configureUrl) return praccSyncInFlight;
    // A new feed URL waits for the running sync and then syncs itself.
    const run = (praccSyncInFlight || Promise.resolve()).catch(() => {}).then(() => runPraccSync(configureUrl, force)).finally(() => { if (praccSyncInFlight === run) praccSyncInFlight = null; });
    praccSyncInFlight = run; return run;
  };
  const runPraccSync = async (configureUrl: string | null, force: boolean) => {
    const before = await readDB();
    const url = configureUrl || before.settings?.praccCalendarUrl;
    if (!url) return { skipped: true, reason: 'not-configured', ...praccStatus(before.settings) };
    const lastAttempt = Date.parse(before.settings.praccCalendarLastAttemptAt || '');
    if (!force && Number.isFinite(lastAttempt) && Date.now() - lastAttempt < 10 * 60_000) return { skipped: true, reason: 'recently-checked', ...praccStatus(before.settings) };
    const attemptedAt = new Date().toISOString();
    let events: Awaited<ReturnType<typeof fetchPraccCalendar>> | null = null; let failure: any = null;
    try { events = await fetchPraccCalendar(url); } catch (error) { failure = error; }
    // The feed download can be slow, so the result is applied to a fresh read
    // and written once, success or failure.
    const db = await readDB();
    db.settings.praccCalendarUrl = url; db.settings.praccCalendarLastAttemptAt = attemptedAt;
    if (failure || !events) {
      db.settings.praccCalendarLastError = failure?.message || 'PRACC calendar sync failed.';
      await saveDB(db);
      throw Object.assign(failure instanceof Error ? failure : new Error(db.settings.praccCalendarLastError), { status: failure?.status || 502, pracc: praccStatus(db.settings) });
    }
    const result = reconcilePraccSchedule(db.schedule || [], events, url);
    db.schedule = result.schedule;
    db.settings.praccCalendarLastSyncedAt = new Date().toISOString();
    db.settings.praccCalendarLastError = '';
    await saveDB(db);
    return { ...result, skipped: false, ...praccStatus(db.settings) };
  };

  // GET secret status
  app.get('/api/secret-status', async (req, res) => {
    try {
      const db = await readDB();
      res.json({
        ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY || !!db.secrets.ANTHROPIC_API_KEY,
        DISCORD_WEBHOOK_URL: !!process.env.DISCORD_WEBHOOK_URL
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET integration status for the UI health panel
  app.get('/api/integrations-status', async (req, res) => {
    try {
      const db = await readDB();
      const has = (v: any) => !!v;
      res.json({
        gemini: { configured: has(process.env.GEMINI_API_KEY), note: 'Optional cloud AI: AI coach brief, playbook generator and the manual cloud screenshot reader (needs active billing). Capture OCR runs locally without it.' },
        discord: { configured: has(process.env.DISCORD_WEBHOOK_URL), note: 'Automatic match report broadcasts' },
        pracc: { configured: has(db.settings?.praccCalendarUrl), note: db.settings?.praccCalendarLastError || (db.settings?.praccCalendarUrl ? 'Connected to Schedule & Goals' : 'Add the private .ics feed in Settings → Attendance Rules') }
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Provider-neutral export works without OAuth and can be subscribed/imported
  // by any calendar application.
  app.get('/api/calendar.ics', async (_req, res) => {
    try {
      const db = await readDB();
      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="moe-tracker-schedule.ics"');
      res.send(buildScheduleIcs(db.schedule || []));
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/pracc/calendar', async (req, res) => {
    try { if (!requireCoach(req, res)) return; const db = await readDB(); res.json(praccStatus(db.settings)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post('/api/pracc/calendar/configure', async (req, res) => {
    try {
      if (!requireCoach(req, res)) return;
      const url = validatePraccCalendarUrl(req.body?.url);
      const result = await syncPraccCalendar(url, true);
      res.json(result);
    } catch (err: any) { res.status(err?.status || 500).json({ error: err.message, ...(err?.pracc || {}) }); }
  });

  app.post('/api/pracc/calendar/sync', async (req, res) => {
    try { if (!requireCoach(req, res)) return; res.json(await syncPraccCalendar(null, req.body?.force === true)); }
    catch (err: any) { res.status(err?.status || 500).json({ error: err.message, ...(err?.pracc || {}) }); }
  });

  app.post('/api/pracc/calendar/disconnect', async (req, res) => {
    try {
      if (!requireCoach(req, res)) return;
      const db = await readDB();
      delete db.settings.praccCalendarUrl; delete db.settings.praccCalendarLastAttemptAt; delete db.settings.praccCalendarLastSyncedAt; delete db.settings.praccCalendarLastError;
      await saveDB(db); res.json(praccStatus(db.settings));
    } catch (err: any) { res.status(err?.status || 500).json({ error: err.message }); }
  });
}
