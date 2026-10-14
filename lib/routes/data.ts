import type { Express } from 'express';
import { readDB, saveDB } from '../store';
import { uid, validate } from '../utils';
import { postDiscordReport } from '../services';
import * as schemas from '../../schemas';
import { toPublicTrackerData, toWebsiteTrackerData } from '../publicData';
import { preserveExistingRosterContext, validateAndNormalizeLineup } from '../matchContext';
import { applyImmutableEntryMetadata, applyScreenshotReviewConfirmation, reconcileStatTotals } from '../entryEngine';
import { buildPlayerScreenshotMetrics } from '../scrimRoundAnalytics';

// Core data + match logging: full payload, reset, settings, generic upsert/remove,
// and match/round/veto saves. Protected routes (registered after the auth middleware).
export function registerDataRoutes(app: Express, options: { websiteSummaryOnly?: boolean } = {}) {
  // GET tracker full payload
  app.get('/api/data', async (req, res) => {
    try {
      const db = await readDB();
      const role = (req as any).user?.role === 'coach' ? 'coach' : 'player';
      res.json(options.websiteSummaryOnly ? toWebsiteTrackerData(db, role) : toPublicTrackerData(db, role));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/website-summary', async (req, res) => {
    try {
      const db = await readDB();
      res.json(toWebsiteTrackerData(db, (req as any).user?.role === 'coach' ? 'coach' : 'player'));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST reset all metrics and logs
  app.post('/api/reset-metrics', async (req, res) => {
    try {
      const db = await readDB();
      db.matches = [];
      db.playerStats = [];
      db.soloq = [];
      db.rounds = [];
      db.vetos = [];
      db.stratRuns = [];
      db.schedule = [];
      db.goals = [];
      db.strats = [];
      await saveDB(db);
      res.json({ success: true, message: 'All database metrics and logs have been reset.' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST save settings
  app.post('/api/settings', async (req, res) => {
    try {
      const body = validate(schemas.settingsSchema, req.body, res); if (!body) return;
      const db = await readDB();
      // Merge rather than replace so a partial payload can never wipe existing settings.
      db.settings = { ...db.settings, ...body };
      await saveDB(db);
      res.json(db.settings);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST generic non-match upsert. Matches must use /api/save-match so metric
  // validation and immutable provenance cannot be bypassed.
  app.post('/api/upsert', async (req, res) => {
    try {
      const body = validate(schemas.upsertSchema, req.body, res); if (!body) return;
      const { sheet, row } = body;
      const db = await readDB();
      
      const key = {
        Schedule: 'schedule',
        Goals: 'goals',
        SoloQ: 'soloq',
        Strats: 'strats',
        StratRuns: 'stratRuns'
      }[sheet as string];

      if (!key || !db[key]) {
        return res.status(400).json({ error: `Invalid sheet identifier: ${sheet}` });
      }

      if (!row.id) {
        row.id = uid();
        db[key].push(row);
      } else {
        const idx = db[key].findIndex((x: any) => x.id === row.id);
        if (idx >= 0) {
          db[key][idx] = row;
        } else {
          db[key].push(row);
        }
      }

      await saveDB(db);
      res.json(row);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST remove row
  app.post('/api/remove', async (req, res) => {
    try {
      const body = validate(schemas.removeSchema, req.body, res); if (!body) return;
      const { sheet, id } = body;
      const db = await readDB();

      const key = {
        Schedule: 'schedule',
        Goals: 'goals',
        Matches: 'matches',
        SoloQ: 'soloq',
        Strats: 'strats',
        StratRuns: 'stratRuns'
      }[sheet as string];

      if (!key || !db[key]) {
        return res.status(400).json({ error: `Invalid sheet: ${sheet}` });
      }

      db[key] = db[key].filter((x: any) => x.id !== id);

      // Cascading deletes
      if (sheet === 'Matches') {
        db.playerStats = db.playerStats.filter((p: any) => p.matchId !== id);
        db.rounds = db.rounds.filter((r: any) => r.matchId !== id);
        db.vetos = db.vetos.filter((v: any) => v.matchId !== id);
        db.stratRuns = db.stratRuns.filter((sr: any) => sr.matchId !== id);
      }
      if (sheet === 'Strats') {
        db.stratRuns = db.stratRuns.filter((sr: any) => sr.stratId !== id);
      }

      await saveDB(db);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST remove schedule (including mocked calendar handling)
  app.post('/api/remove-schedule', async (req, res) => {
    try {
      const { id } = req.body;
      const db = await readDB();
      db.schedule = db.schedule.filter((x: any) => x.id !== id);
      await saveDB(db);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST save match. PlayerStats are preserved unless the caller explicitly
  // requests a complete replacement; an omitted update can never erase stats.
  app.post('/api/save-match', async (req, res) => {
    try {
      const body = validate(schemas.saveMatchSchema, req.body, res); if (!body) return;
      let { match } = body as any;
      const statsUpdate = (body as any).statsUpdate || { operation: 'preserve' };
      const db = await readDB();
      const timestamp = new Date().toISOString();
      const actor = (req as any).user?.username || 'Unknown coach';

      const isNewMatch = !match.id;
      const existingMatch = match.id ? db.matches.find((entry: any) => entry.id === match.id) : undefined;
      const createsMatch = !existingMatch;
      const existingStats = existingMatch
        ? db.playerStats.filter((stat: any) => stat.matchId === existingMatch.id)
        : [];
      if (statsUpdate.operation === 'preserve') preserveExistingRosterContext(existingMatch, match);
      if (statsUpdate.operation === 'replace') {
        const mismatchedStat = statsUpdate.stats.find((stat: any) => {
          if (stat.matchId === undefined || stat.matchId === '') return false;
          return !match.id || stat.matchId !== match.id;
        });
        if (mismatchedStat) {
          return res.status(400).json({ error: 'Every replacement stat must use the saved match ID.' });
        }
        statsUpdate.stats = validateAndNormalizeLineup(db, match, statsUpdate.stats)
          .map((stat: any) => reconcileStatTotals(stat));

        const existingById = new Map(existingStats.map((stat: any) => [stat.id, stat]));
        const seenIds = new Set<string>();
        for (const stat of statsUpdate.stats) {
          const submittedId = typeof stat.id === 'string' && stat.id.trim() ? stat.id : undefined;
          if (submittedId) {
            if (seenIds.has(submittedId)) {
              return res.status(400).json({ error: 'Replacement statistics contain a duplicate row ID. Nothing was saved.' });
            }
            seenIds.add(submittedId);
            if (createsMatch || !existingById.has(submittedId) || stat.rowOperation === 'create') {
              return res.status(400).json({ error: 'Replacement statistics contain a stale or unknown row ID. Nothing was saved.' });
            }
          } else if (!createsMatch && stat.rowOperation !== 'create') {
            return res.status(400).json({ error: 'A new statistic on an existing match requires rowOperation "create". Nothing was saved.' });
          }
        }
      }

      match = applyImmutableEntryMetadata(existingMatch, match, actor, timestamp);
      match = applyScreenshotReviewConfirmation(existingMatch, match, actor, timestamp);
      if (!match.id) match.id = uid();

      let savedStats: any[] | undefined;
      if (statsUpdate.operation === 'replace') {
        savedStats = statsUpdate.stats.map((stat: any) => {
          const submittedId = typeof stat.id === 'string' && stat.id.trim() ? stat.id : undefined;
          const existingStat = submittedId
            ? existingStats.find((entry: any) => entry.id === submittedId)
            : undefined;
          const { rowOperation: _rowOperation, ...cleanStat } = stat;
          const withMetadata = applyImmutableEntryMetadata(
            existingStat,
            cleanStat,
            actor,
            timestamp,
            match.sourceMetadata,
          );
          return { ...withMetadata, id: existingStat?.id || uid(), matchId: match.id };
        });
      }

      // All validation and metadata planning above is fail-closed. Mutate only now.
      const matchIndex = db.matches.findIndex((entry: any) => entry.id === match.id);
      if (matchIndex >= 0) db.matches[matchIndex] = match;
      else db.matches.push(match);
      if (savedStats) {
        db.playerStats = db.playerStats.filter((stat: any) => stat.matchId !== match.id);
        db.playerStats.push(...savedStats);
      }

      await saveDB(db);

      // Best-effort auto-post to Discord for newly logged matches only (avoids spam on edits;
      // never blocks or fails the save).
      if (isNewMatch && process.env.DISCORD_WEBHOOK_URL) {
        postDiscordReport(db, match.id).catch((e: any) => console.warn('Auto Discord post failed:', e.message));
      }

      // Echo the applied operation so the client mirrors the same preserve/replace
      // behavior without needing a full database refresh.
      res.json({
        match,
        statsUpdate: statsUpdate.operation === 'replace'
          ? { operation: 'replace', stats: savedStats }
          : { operation: 'preserve' },
      });
    } catch (err: any) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  // POST save rounds for a match
  app.post('/api/save-rounds', async (req, res) => {
    try {
      const body = validate(schemas.saveRoundsSchema, req.body, res); if (!body) return;
      const { matchId, rows } = body as any;
      const db = await readDB();

      db.rounds = db.rounds.filter((r: any) => r.matchId !== matchId);
      (rows || []).forEach((r: any) => {
        r.id = uid();
        r.matchId = matchId;
        db.rounds.push(r);
      });

      // Materialize accepted screenshot summaries onto each match/player row. The
      // website receives these small aggregates, never the raw round screenshots.
      const derived = buildPlayerScreenshotMetrics(db.rounds.filter((round: any) => round.matchId === matchId));
      const byIdentity = new Map(derived.map(metric => [metric.identity, metric]));
      db.playerStats = db.playerStats.map((stat: any) => {
        if (stat.matchId !== matchId) return stat;
        const displayName = stat.displayNameSnapshot || stat.player || '';
        const identity = stat.playerId || `name:${String(displayName).trim().toLocaleLowerCase()}`;
        const metric = byIdentity.get(identity);
        const { screenshotMetrics: _old, ...clean } = stat;
        if (!metric) return clean;
        const { identity: _identity, displayName: _displayName, ...screenshotMetrics } = metric;
        return { ...clean, screenshotMetrics };
      });

      await saveDB(db);
      const match = db.matches.find((item: any) => item.id === matchId) || null;
      const matchStats = db.playerStats.filter((item: any) => item.matchId === matchId);
      const summarizedStats = matchStats.filter((item: any) => item.screenshotMetrics);
      res.json({
        matchId, rows: rows || [], count: (rows || []).length,
        // The analytics upload intentionally contains only rows with derived
        // screenshot metrics. Return the complete scoreboard separately so a
        // partial OCR identity match can never shrink the visible/saved lineup.
        playerStats: matchStats,
        screenshotSummary: match && summarizedStats.length ? { schemaVersion: 1, match, playerStats: summarizedStats, updatedAt: new Date().toISOString() } : null,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST save veto for a match
  app.post('/api/save-veto', async (req, res) => {
    try {
      const body = validate(schemas.saveVetoSchema, req.body, res); if (!body) return;
      const { matchId, meta, actions } = body as any;
      const db = await readDB();

      db.vetos = db.vetos.filter((v: any) => v.matchId !== matchId);
      (actions || []).forEach((a: any, i: number) => {
        a.id = uid();
        a.matchId = matchId;
        a.date = meta.date;
        a.opponent = meta.opponent;
        a.seq = i + 1;
        db.vetos.push(a);
      });

      await saveDB(db);
      res.json({ matchId, vetos: actions || [], count: (actions || []).length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
