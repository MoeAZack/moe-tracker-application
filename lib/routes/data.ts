import type { Express } from 'express';
import { readDB, saveDB } from '../store';
import { uid, validate } from '../utils';
import { postDiscordReport } from '../services';
import * as schemas from '../../schemas';
import { toPublicTrackerData, toWebsiteTrackerData } from '../publicData';
import { preserveExistingRosterContext, validateAndNormalizeLineup } from '../matchContext';
import { parseIdentitySnapshotCorrection, preserveIdentitySnapshot } from '../identitySnapshot';
import { applyImmutableEntryMetadata, applyScreenshotReviewConfirmation, reconcileStatTotals } from '../entryEngine';
import { materializeFirstDeathsFromRoundEvidence, materializeRoundOpeningsFromScreenshotEvidence, materializeRoundPlantsFromScreenshotEvidence } from '../scrimRoundAnalytics';
import { recomputeAcceptedMatchAggregates, withCurrentScreenshotMetrics } from '../aggregateVersioning';
import { attendancePolicy, attendanceStatus, attendanceSummary, attendanceWindow } from '../attendance';
import { refreshCoachingWorkflow } from './coaching';
import { purgeExpiredRosterPlayers } from '../roster';
import { applyScheduleEdit, normalizeScheduleRow, removeScheduleRows, repeatedHourlyScheduleRows } from '../schedule';
import { findExactRoundEvidenceDuplicate, findExactSourceDuplicate, purgeMatchGraph, isDuplicateQuarantined, purgeRemovedRoundReferences, refreshDuplicateQuarantine, stableRoundReplacement } from '../matchIntegrity';
import { autoLinkPracticeSession } from '../practiceSessionProgress';
import { buildCalibratedPlayerRatings } from '../calibratedPlayerRatings';

// Core data + match logging: full payload, reset, settings, generic upsert/remove,
// and match/round/veto saves. Protected routes (registered after the auth middleware).
export function registerDataRoutes(app: Express, options: { websiteSummaryOnly?: boolean } = {}) {
  const requireCoach = (req: any, res: any) => {
    if (req.user?.role === 'coach') return true;
    res.status(403).json({ error: 'Only the coach can manage team operations.' });
    return false;
  };
  const conflict = (message: string, details: Record<string, unknown>) => Object.assign(new Error(message), { status: 409, details });
  const sendError = (res: any, err: any) => res.status(err.status || 500).json({ error: err.message, ...(err.details || {}) });

  /** Validate a round replacement without mutating the database. */
  const planRoundReplacement = (db: any, matchId: string, rows: any[]) => {
    const existing = (db.rounds || []).filter((round: any) => round.matchId === matchId);
    const replacement = stableRoundReplacement(existing, rows || [], uid).map((round: any) => ({ ...round, matchId }));
    const duplicate = findExactRoundEvidenceDuplicate(db, matchId, replacement);
    if (duplicate) throw conflict('These exact confirmed round screenshots are already attached to another match. Nothing was saved.', { existingMatchId: duplicate.existingMatchId, evidenceFingerprint: duplicate.fingerprint });
    return replacement;
  };

  /** Apply a planned round replacement and refresh everything derived from it. */
  const applyRoundReplacement = (db: any, matchId: string, replacement: any[]) => {
    purgeRemovedRoundReferences(db, matchId, new Set(replacement.map((round: any) => round.id)));
    db.rounds = (db.rounds || []).filter((r: any) => r.matchId !== matchId);
    db.rounds.push(...replacement);
    materializeRoundOpeningsFromScreenshotEvidence(db, { matchId });
    materializeRoundPlantsFromScreenshotEvidence(db, { matchId });
    // Fill-only: coach-entered or scoreboard FD values are never replaced, and
    // only values this materializer derived earlier are refreshed. Runs before
    // the aggregate rebuild so the build sees the same FD the table shows.
    materializeFirstDeathsFromRoundEvidence(db, { matchId });
    const match = db.matches.find((item: any) => item.id === matchId) || null;
    db.analyticsBuilds ||= {};
    // Materialized summaries come only from the versioned accepted-source
    // adapter. The website receives aggregates, never raw screenshots.
    if (match) db.analyticsBuilds[matchId] = recomputeAcceptedMatchAggregates(db, matchId);
    return match;
  };

  const roundSaveResult = (db: any, matchId: string, replacement: any[], match: any) => {
    // Stored metrics that are not current read as unknown here as everywhere else.
    const matchStats = (withCurrentScreenshotMetrics(db).playerStats || []).filter((item: any) => item.matchId === matchId);
    const summarizedStats = matchStats.filter((item: any) => item.screenshotMetrics);
    return {
      matchId, rows: replacement, count: replacement.length,
      // The analytics upload intentionally contains only rows with derived
      // screenshot metrics. Return the complete scoreboard separately so a
      // partial OCR identity match can never shrink the visible/saved lineup.
      playerStats: matchStats,
      duplicateReview: match?.duplicateReview || null,
      screenshotSummary: match && !isDuplicateQuarantined(match) && (summarizedStats.length || match.screenshotEvidence?.scoreboardPlayers?.length === 10)
        ? { schemaVersion: 1, match, playerStats: summarizedStats, updatedAt: match.sourceMetadata?.capturedAt || new Date().toISOString() }
        : null,
    };
  };
  // GET tracker full payload
  app.get('/api/data', async (req, res) => {
    try {
      const db = await readDB();
      const retention = purgeExpiredRosterPlayers(db);
      if (retention.purged.length) await saveDB(db);
      const role = (req as any).user?.role === 'coach' ? 'coach' : 'player';
      const authenticatedPlayerId = (req as any).user?.playerId ?? null;
      res.json(options.websiteSummaryOnly ? toWebsiteTrackerData(db, role, authenticatedPlayerId) : toPublicTrackerData(db, role, authenticatedPlayerId));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/website-summary', async (req, res) => {
    try {
      const db = await readDB();
      const retention = purgeExpiredRosterPlayers(db);
      if (retention.purged.length) await saveDB(db);
      res.json(toWebsiteTrackerData(db, (req as any).user?.role === 'coach' ? 'coach' : 'player', (req as any).user?.playerId ?? null));
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
      db.attendanceCredits = [];
      db.goals = [];
      db.strats = [];
      db.coachingSignals = [];
      db.coachingActions = [];
      refreshCoachingWorkflow(db, (req as any).user?.username || 'Unknown coach');
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
      refreshCoachingWorkflow(db, (req as any).user?.username || 'Unknown coach');
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
      const { sheet } = body;
      if ((sheet === 'Schedule' || sheet === 'Goals') && !requireCoach(req, res)) return;
      let row: any = { ...body.row };
      const db = await readDB();
      let previousLinkedReviewEventId: string | undefined;
      
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

      if (sheet === 'Schedule') {
        const existing = row.id ? db.schedule.find((item: any) => item.id === row.id) : null;
        previousLinkedReviewEventId = existing?.linkedReviewEventId;
        const activeIds = new Set((db.rosterPlayers || []).filter((player: any) => !player.retiredAt).map((player: any) => player.id));
        row.requiredPlayerIds = [...new Set((Array.isArray(row.requiredPlayerIds) ? row.requiredPlayerIds : []).filter((id: unknown) => typeof id === 'string' && activeIds.has(id)))];
        row.allDay = Boolean(row.allDay);
        row.startTime = !row.allDay && typeof row.startTime === 'string' && /^\d{2}:\d{2}$/.test(row.startTime) ? row.startTime : '';
        row.durationMinutes = row.allDay ? undefined : Math.min(720, Math.max(15, Math.round(Number(row.durationMinutes) || 60)));
        row.attendanceEnabled = Boolean(!row.allDay && row.attendanceEnabled && row.startTime && row.requiredPlayerIds.length);
        row.source = existing?.source === 'pracc' ? 'pracc' : 'manual';
        row.attendanceCheckIns = Array.isArray(existing?.attendanceCheckIns) ? existing.attendanceCheckIns : [];
        row.attendanceAudit = Array.isArray(existing?.attendanceAudit) ? existing.attendanceAudit : [];
        row.linkedReviewEventId = typeof row.linkedReviewEventId === 'string' && row.linkedReviewEventId.trim() ? row.linkedReviewEventId.trim() : undefined;
        if (row.linkedReviewEventId) {
          const linked = db.schedule.find((item: any) => item.id === row.linkedReviewEventId); const pair = new Set([row.calendarKey, linked?.calendarKey]);
          if (!linked || linked.id === row.id || pair.size !== 2 || !pair.has('team-talk') || !pair.has('debrief')) return res.status(400).json({ error: 'Team Talk may only link to a distinct Debrief event.' });
        }
      }

      if (sheet === 'Goals') {
        row.matchId = typeof row.matchId === 'string' && row.matchId.trim() ? row.matchId.trim() : undefined;
        if (row.matchId && !(db.matches || []).some((match: any) => match.id === row.matchId)) return res.status(400).json({ error: 'Linked match was not found.' });
        row.ownerPlayerId = typeof row.ownerPlayerId === 'string' && row.ownerPlayerId.trim() ? row.ownerPlayerId.trim() : undefined;
        if (row.ownerPlayerId && !(db.rosterPlayers || []).some((player: any) => player.id === row.ownerPlayerId && !player.retiredAt)) return res.status(400).json({ error: 'Goal owner is not an active player.' });
        row.roundId = typeof row.roundId === 'string' && row.roundId.trim() ? row.roundId.trim() : undefined;
        if (row.roundId && !(db.rounds || []).some((round: any) => round.id === row.roundId && round.matchId === row.matchId)) return res.status(400).json({ error: 'Linked round does not belong to the selected match.' });
        row.evidenceClipId = typeof row.evidenceClipId === 'string' && row.evidenceClipId.trim() ? row.evidenceClipId.trim() : undefined;
        if (row.evidenceClipId && !(db.rounds || []).some((round: any) => round.id === row.roundId && round.reviewCockpit?.clips?.some((clip: any) => clip.id === row.evidenceClipId))) return res.status(400).json({ error: 'Linked evidence clip does not belong to the selected round.' });
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

      if (sheet === 'Schedule') {
        if (previousLinkedReviewEventId && previousLinkedReviewEventId !== row.linkedReviewEventId) {
          const previous = db.schedule.find((item: any) => item.id === previousLinkedReviewEventId); if (previous?.linkedReviewEventId === row.id) previous.linkedReviewEventId = undefined;
        }
        if (row.linkedReviewEventId) {
          const linked = db.schedule.find((item: any) => item.id === row.linkedReviewEventId); if (linked) linked.linkedReviewEventId = row.id;
        }
      }

      await saveDB(db);
      res.json(row);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Atomic schedule mutations keep repeated blocks, provider-owned fields and
  // attendance history coherent across month/day/detail views.
  app.post('/api/schedule/mutate', async (req, res) => {
    try {
      if (!requireCoach(req, res)) return;
      const body = validate(schemas.scheduleMutationSchema, req.body, res); if (!body) return;
      const db = await readDB(); db.schedule ||= [];
      if (body.action === 'delete') {
        const result = removeScheduleRows(db.schedule, body.id, body.scope);
        if (!result.removedIds.length) return res.status(404).json({ error: 'Schedule event was not found.' });
        const removed = new Set(result.removedIds); db.schedule = result.rows;
        for (const event of db.schedule) if (removed.has(event.linkedReviewEventId)) event.linkedReviewEventId = undefined;
        await saveDB(db); return res.json({ removedIds: result.removedIds, scope: body.scope });
      }
      const existing = body.row?.id ? db.schedule.find((item: any) => item.id === body.row.id) : null;
      if (body.row?.id && !existing) return res.status(404).json({ error: 'Schedule event was not found.' });
      const context = {
        activePlayerIds: new Set<string>((db.rosterPlayers || []).filter((player: any) => !player.retiredAt).map((player: any) => player.id)),
        calendarKeys: new Set<string>((db.settings?.calendars || []).map((calendar: any) => calendar.key).filter(Boolean)),
      };
      const normalized = normalizeScheduleRow(body.row, existing, context);
      if (normalized.linkedReviewEventId) {
        const linked = db.schedule.find((item: any) => item.id === normalized.linkedReviewEventId); const pair = new Set([normalized.calendarKey, linked?.calendarKey]);
        if (!linked || linked.id === normalized.id || pair.size !== 2 || !pair.has('team-talk') || !pair.has('debrief')) return res.status(400).json({ error: 'Team Talk may only link to a distinct Debrief event.' });
      }
      let saved: any[];
      if (!existing) {
        const seriesId = body.repeatCount > 1 ? uid() : '';
        saved = repeatedHourlyScheduleRows(normalized, body.repeatCount, seriesId).map(item => ({ ...item, id: uid() }));
        db.schedule.push(...saved);
      } else {
        const previousLink = existing.linkedReviewEventId; db.schedule = applyScheduleEdit(db.schedule, normalized, body.scope); saved = db.schedule.filter((item: any) => item.id === normalized.id || (body.scope === 'series' && normalized.repeatSeriesId && item.repeatSeriesId === normalized.repeatSeriesId));
        if (previousLink && previousLink !== normalized.linkedReviewEventId) { const previous = db.schedule.find((item: any) => item.id === previousLink); if (previous?.linkedReviewEventId === normalized.id) previous.linkedReviewEventId = undefined; }
      }
      if (normalized.linkedReviewEventId) { const linked = db.schedule.find((item: any) => item.id === normalized.linkedReviewEventId); if (linked) linked.linkedReviewEventId = saved.find(item => item.id === normalized.id)?.id || saved[0]?.id; }
      await saveDB(db); res.json({ rows: saved, scope: body.scope, created: !existing });
    } catch (err: any) { res.status(err?.status || 500).json({ error: err.message }); }
  });

  app.post('/api/attendance/check-in', async (req, res) => {
    try {
      const body = validate(schemas.attendanceCheckInSchema, req.body, res); if (!body) return;
      const user = (req as any).user;
      if (user?.role !== 'player' || !user.playerId) return res.status(403).json({ error: 'Check-in requires a player account linked to the roster.' });
      const db = await readDB();
      const schedule = (db.schedule || []).find((item: any) => item.id === body.scheduleId);
      if (!schedule) return res.status(404).json({ error: 'Schedule event was not found.' });
      if (!schedule.attendanceEnabled || !schedule.requiredPlayerIds?.includes(user.playerId)) return res.status(403).json({ error: 'You are not assigned to this attendance event.' });
      schedule.attendanceCheckIns ||= [];
      const existing = schedule.attendanceCheckIns.find((item: any) => item.playerId === user.playerId);
      if (existing) return res.json({ checkIn: existing, summary: attendanceSummary(db, user.playerId) });
      const now = new Date(); const policy = attendancePolicy(db.settings); const window = attendanceWindow(schedule, policy);
      if (now < window.opensAt) return res.status(409).json({ error: `Check-in opens ${policy.checkInOpenMinutes} minutes before the event.` });
      if (now > window.closesAt) return res.status(409).json({ error: 'The check-in window is closed. Ask the coach to correct the record.' });
      const status = attendanceStatus(schedule, user.playerId, now, policy) === 'late-window' ? 'late' : 'on-time';
      const checkIn = { id: uid(), playerId: user.playerId, checkedInAt: now.toISOString(), status };
      schedule.attendanceCheckIns.push(checkIn);
      schedule.attendanceAudit ||= []; schedule.attendanceAudit.push({ id: uid(), playerId: user.playerId, action: 'player-check-in', fromStatus: 'automatic', toStatus: status, createdAt: now.toISOString(), createdBy: user.username || user.playerId });
      await saveDB(db);
      res.status(201).json({ checkIn, summary: attendanceSummary(db, user.playerId, now) });
    } catch (err: any) { res.status(err?.status || 500).json({ error: err.message }); }
  });

  app.post('/api/attendance/green-credit', async (req, res) => {
    try {
      if (!requireCoach(req, res)) return;
      const body = validate(schemas.attendanceGreenCreditSchema, req.body, res); if (!body) return;
      const db = await readDB();
      if (!(db.rosterPlayers || []).some((player: any) => player.id === body.playerId && !player.retiredAt)) return res.status(404).json({ error: 'Active roster player was not found.' });
      db.attendanceCredits ||= [];
      const credit = { id: uid(), playerId: body.playerId, kind: 'green', reason: body.reason, createdAt: new Date().toISOString(), createdBy: (req as any).user.username || 'Coach' };
      db.attendanceCredits.push(credit); await saveDB(db);
      res.status(201).json({ credit, summary: attendanceSummary(db, body.playerId) });
    } catch (err: any) { res.status(err?.status || 500).json({ error: err.message }); }
  });

  app.post('/api/attendance/correct', async (req, res) => {
    try {
      if (!requireCoach(req, res)) return;
      const body = validate(schemas.attendanceCorrectionSchema, req.body, res); if (!body) return;
      const db = await readDB(); const schedule = (db.schedule || []).find((item: any) => item.id === body.scheduleId);
      if (!schedule) return res.status(404).json({ error: 'Schedule event was not found.' });
      if (!schedule.requiredPlayerIds?.includes(body.playerId)) return res.status(409).json({ error: 'The player is not assigned to this event.' });
      schedule.attendanceCheckIns ||= [];
      schedule.attendanceAudit ||= [];
      const existing = schedule.attendanceCheckIns.find((item: any) => item.playerId === body.playerId);
      const beforeStatus = existing?.status || 'automatic';
      const correctedAt = new Date().toISOString(); const correctedBy = (req as any).user.username || 'Coach';
      if (body.status === 'clear') schedule.attendanceCheckIns = schedule.attendanceCheckIns.filter((item: any) => item.playerId !== body.playerId);
      else {
        const corrected = { id: existing?.id || uid(), playerId: body.playerId, checkedInAt: existing?.checkedInAt || correctedAt, status: body.status, correctionReason: body.reason, correctedAt, correctedBy };
        if (existing) Object.assign(existing, corrected); else schedule.attendanceCheckIns.push(corrected);
      }
      schedule.attendanceAudit.push({ id: uid(), playerId: body.playerId, action: body.status === 'clear' ? 'coach-clear' : 'coach-correction', fromStatus: beforeStatus, toStatus: body.status === 'clear' ? 'automatic' : body.status, reason: body.reason, createdAt: correctedAt, createdBy: correctedBy });
      await saveDB(db); res.json({ scheduleId: schedule.id, summary: attendanceSummary(db, body.playerId) });
    } catch (err: any) { res.status(err?.status || 500).json({ error: err.message }); }
  });

  app.post('/api/attendance/green-credit/revoke', async (req, res) => {
    try {
      if (!requireCoach(req, res)) return;
      const body = validate(schemas.attendanceCreditRevokeSchema, req.body, res); if (!body) return;
      const db = await readDB(); const credit = (db.attendanceCredits || []).find((item: any) => item.id === body.creditId && !item.revokedAt);
      if (!credit) return res.status(404).json({ error: 'Active green credit was not found.' });
      credit.revokedAt = new Date().toISOString(); credit.revokedBy = (req as any).user.username || 'Coach'; credit.revokeReason = body.reason;
      await saveDB(db); res.json({ credit, summary: attendanceSummary(db, credit.playerId) });
    } catch (err: any) { res.status(err?.status || 500).json({ error: err.message }); }
  });

  // POST remove row
  app.post('/api/remove', async (req, res) => {
    try {
      const body = validate(schemas.removeSchema, req.body, res); if (!body) return;
      const { sheet, id } = body;
      if ((sheet === 'Schedule' || sheet === 'Goals' || sheet === 'Matches') && !requireCoach(req, res)) return;
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

      let matchPurge = null;
      if (sheet === 'Matches') {
        if (!(db.matches || []).some((match: any) => match.id === id)) return res.status(404).json({ error: 'Match was not found.' });
        matchPurge = purgeMatchGraph(db, id);
        // Deleting an original releases its quarantined copy in the same write.
        refreshDuplicateQuarantine(db);
      } else db[key] = db[key].filter((x: any) => x.id !== id);

      if (sheet === 'Schedule') for (const item of db.schedule || []) if (item.linkedReviewEventId === id) item.linkedReviewEventId = undefined;
      if (sheet === 'Goals') for (const action of db.coachingActions || []) if (action.goalId === id) action.goalId = undefined;

      if (sheet === 'Strats') {
        db.stratRuns = db.stratRuns.filter((sr: any) => sr.stratId !== id);
      }

      if (sheet === 'Matches') {
        db.calibratedPlayerRatings = buildCalibratedPlayerRatings(withCurrentScreenshotMetrics(db));
        refreshCoachingWorkflow(db, (req as any).user?.username || 'Unknown coach');
      }
      await saveDB(db);
      res.json({ success: true, ...(matchPurge ? { matchPurge } : {}) });
    } catch (err: any) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  // POST remove schedule (including mocked calendar handling)
  app.post('/api/remove-schedule', async (req, res) => {
    try {
      const { id } = req.body;
      const db = await readDB();
      db.schedule = db.schedule.filter((x: any) => x.id !== id);
      for (const item of db.schedule || []) if (item.linkedReviewEventId === id) item.linkedReviewEventId = undefined;
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
        const submittedStats = statsUpdate.stats;
        statsUpdate.stats = validateAndNormalizeLineup(db, match, submittedStats, existingStats)
          .map((stat: any, index: number) => {
            const correction = parseIdentitySnapshotCorrection(submittedStats[index]?.identityCorrection);
            const corrected = { ...stat };
            for (const field of correction?.fields || []) corrected[field] = submittedStats[index][field];
            return reconcileStatTotals(corrected);
          });

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
      // Duplicate review state is server-owned; a client copy can never clear a quarantine.
      delete match.duplicateReview;
      if (existingMatch?.duplicateReview) match.duplicateReview = existingMatch.duplicateReview;
      if (!match.id) match.id = uid();

      let savedStats: any[] | undefined;
      if (statsUpdate.operation === 'replace') {
        savedStats = statsUpdate.stats.map((stat: any) => {
          const submittedId = typeof stat.id === 'string' && stat.id.trim() ? stat.id : undefined;
          const existingStat = submittedId
            ? existingStats.find((entry: any) => entry.id === submittedId)
            : undefined;
          const correction = parseIdentitySnapshotCorrection(stat.identityCorrection);
          if (stat.identityCorrection && !correction) throw Object.assign(new Error('Identity correction requires named snapshot fields and a reason.'), { status: 400 });
          if (correction && !existingStat) throw Object.assign(new Error('Identity correction requires an existing accepted player appearance.'), { status: 400 });
          if (correction?.fields.some(field => !Object.prototype.hasOwnProperty.call(stat, field))) {
            throw Object.assign(new Error('Every named identity correction field requires an explicit value.'), { status: 400 });
          }
          if (correction?.fields.includes('playerId') && stat.playerId !== null) {
            const target = (db.rosterPlayers || []).find((player: any) => player.id === stat.playerId && !player.retiredAt);
            if (!target) throw Object.assign(new Error('Identity link corrections require an active roster identity or null.'), { status: 400 });
          }
          const { rowOperation: _rowOperation, identityCorrection: _identityCorrection, ...submittedStat } = stat;
          const cleanStat = preserveIdentitySnapshot(existingStat, submittedStat, correction);
          const withMetadata = applyImmutableEntryMetadata(
            existingStat,
            cleanStat,
            actor,
            timestamp,
            match.sourceMetadata,
          );
          const previousCorrectionCount = existingStat?.corrections?.length || 0;
          if (correction && withMetadata.corrections?.length > previousCorrectionCount) {
            withMetadata.corrections[withMetadata.corrections.length - 1].reason = correction.reason;
          }
          // A changed FD is a correction, so it is no longer owned by the round-evidence materializer.
          if (withMetadata.fdDerivedFrom && (!existingStat || withMetadata.fd !== existingStat.fd)) delete withMetadata.fdDerivedFrom;
          return { ...withMetadata, id: existingStat?.id || uid(), matchId: match.id };
        });
      }

      // All validation and metadata planning above is fail-closed. Mutate only now.
      const matchIndex = db.matches.findIndex((entry: any) => entry.id === match.id);
      // Only an exact immutable source blocks. Date/map/opponent/score/roster
      // agreement is never duplicate proof (H0); same-game re-captures are
      // quarantined for coach review below instead of rejected.
      const sourceDuplicate = matchIndex < 0 ? findExactSourceDuplicate(db, match) : null;
      if (sourceDuplicate) return res.status(409).json({ error: 'This exact source evidence is already attached to another match. Nothing was saved.', existingMatchId: sourceDuplicate.existingMatchId, sourceToken: sourceDuplicate.sourceToken });
      const plannedRounds = Array.isArray((body as any).rounds) ? planRoundReplacement(db, match.id, (body as any).rounds) : null;

      if (matchIndex >= 0) db.matches[matchIndex] = match;
      else db.matches.push(match);
      if (savedStats) {
        db.playerStats = db.playerStats.filter((stat: any) => stat.matchId !== match.id);
        db.playerStats.push(...savedStats);
      }
      if (plannedRounds) applyRoundReplacement(db, match.id, plannedRounds);
      refreshDuplicateQuarantine(db, timestamp);
      match = db.matches.find((entry: any) => entry.id === match.id);
      autoLinkPracticeSession(db, match.id, actor, timestamp);

      refreshCoachingWorkflow(db, actor);
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
          ? { operation: 'replace', stats: db.playerStats.filter((stat: any) => stat.matchId === match.id) }
          : { operation: 'preserve' },
        duplicateReview: match.duplicateReview || null,
        ...(plannedRounds ? { roundsUpdate: roundSaveResult(db, match.id, plannedRounds, match) } : {}),
      });
    } catch (err: any) {
      sendError(res, err);
    }
  });

  // POST save rounds for a match
  app.post('/api/save-rounds', async (req, res) => {
    try {
      const body = validate(schemas.saveRoundsSchema, req.body, res); if (!body) return;
      const { matchId, rows } = body as any;
      const db = await readDB();
      if (!(db.matches || []).some((item: any) => item.id === matchId)) return res.status(404).json({ error: 'Match was not found.' });
      const replacement = planRoundReplacement(db, matchId, rows || []);
      applyRoundReplacement(db, matchId, replacement);
      refreshDuplicateQuarantine(db);
      const match = db.matches.find((item: any) => item.id === matchId) || null;

      refreshCoachingWorkflow(db, (req as any).user?.username || 'Unknown coach');
      await saveDB(db);
      res.json(roundSaveResult(db, matchId, replacement, match));
    } catch (err: any) {
      sendError(res, err);
    }
  });

  // POST coach decision on a quarantined same-game duplicate.
  app.post('/api/match-duplicate-review', async (req, res) => {
    try {
      if (!requireCoach(req, res)) return;
      const body = validate(schemas.matchDuplicateReviewSchema, req.body, res); if (!body) return;
      const db = await readDB();
      const match = (db.matches || []).find((item: any) => item.id === body.matchId);
      if (!match) return res.status(404).json({ error: 'Match was not found.' });
      if (match.duplicateReview?.status !== 'quarantined') return res.status(409).json({ error: 'This match is not waiting on a duplicate review.' });
      const actor = (req as any).user?.username || 'Unknown coach';
      const timestamp = new Date().toISOString();
      let matchPurge = null;
      if (body.decision === 'discard-this') matchPurge = purgeMatchGraph(db, match.id);
      else match.duplicateReview = { ...match.duplicateReview, status: 'kept-distinct', resolvedAt: timestamp, resolvedBy: actor };
      refreshDuplicateQuarantine(db, timestamp);
      refreshCoachingWorkflow(db, actor);
      await saveDB(db);
      res.json({ success: true, decision: body.decision, duplicateReview: body.decision === 'keep-both' ? match.duplicateReview : null, matchPurge });
    } catch (err: any) {
      sendError(res, err);
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
