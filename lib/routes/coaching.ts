import type { Express, Request, Response } from 'express';
import type { CoachingAction, CoachingSignal } from '../../src/types';
import { buildAllPracticeBlockSummaries, coachingContextMatches, createCoachingAction, evaluateAction, generateReviewSignalDrafts, generateRoundReviewSignalDrafts, migrateLegacyActionChecks, normalizeDashboardView, reconcileReviewSignals, transitionSignal } from '../coachingWorkflow';
import { readDB, saveDB } from '../store';
import { buildEvidenceFusionReport, upsertEvidenceResolution, type EvidenceSource } from '../evidenceFusion';
import { recomputeAcceptedMatchAggregates } from '../aggregateVersioning';
import { buildCoachingGoal } from '../coachingGoalLink';

const actor = (req: Request) => String((req as any).user?.actorId || (req as any).user?.username || 'coach').slice(0, 120);
function requireCoach(req: Request, res: Response) { if ((req as any).user?.role === 'coach') return true; res.status(403).json({ error: 'Coach access is required.' }); return false; }
function text(value: unknown, max = 160) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }

export function refreshCoachingWorkflow(db: any, who = 'system', now = new Date().toISOString()) {
  const summaries = buildAllPracticeBlockSummaries(db, now);
  const deletedFingerprints = new Set<string>(db.settings?.deletedCoachingSignalFingerprints || []);
  const drafts = [...summaries.flatMap(summary => generateReviewSignalDrafts(summary, db.settings?.coachingThresholds)), ...generateRoundReviewSignalDrafts(db, summaries, now)].filter(draft => !deletedFingerprints.has(draft.fingerprint));
  db.coachingSignals = reconcileReviewSignals(db.coachingSignals || [], drafts, who);
  for (const signal of db.coachingSignals as CoachingSignal[]) {
    const related = (db.coachingActions || []).find((action: CoachingAction) => !['resolved', 'cancelled'].includes(action.state) && action.check?.signalType === signal.type && coachingContextMatches(action.check.context, signal.context) && action.sourceSignalId !== signal.id && Date.parse(action.createdAt) < Date.parse(signal.createdAt));
    if (related) signal.relatedActionId = related.id;
  }
  db.coachingActions = migrateLegacyActionChecks(db.coachingActions || [], db.coachingSignals, who, now, summaries).map((action: CoachingAction) => evaluateAction(action, summaries, db.coachingSignals, now));
  return { summaries, signals: db.coachingSignals, actions: db.coachingActions };
}

export function registerCoachingRoutes(app: Express) {
  app.post('/api/coaching/evidence-resolution', async (req, res) => {
    if (!requireCoach(req, res)) return;
    try {
      const matchId = text(req.body?.matchId, 160); const roundId = text(req.body?.roundId, 160); const field = text(req.body?.field, 80); const reason = text(req.body?.reason, 500); const selectedSource = req.body?.selectedSource as EvidenceSource;
      if (!matchId || !roundId || !field || !reason || !['coach', 'replay', 'screenshot', 'vod', 'manual'].includes(selectedSource)) return res.status(400).json({ error: 'Match, round, field, evidence source, and a reason are required.' });
      const db = await readDB(); const entity = (db.rounds || []).find((item: any) => item.id === roundId && item.matchId === matchId) || (db.playerStats || []).find((item: any) => item.id === roundId && item.matchId === matchId); if (!entity) return res.status(404).json({ error: 'Round or player evidence was not found.' });
      const current = buildEvidenceFusionReport(db, matchId, db.engineAdapters?.replay?.[matchId]); const fact = (current.rounds.find(item => item.roundId === roundId) || current.players.find(item => item.playerStatId === roundId))?.facts.find(item => item.field === field); const allowed = fact?.candidates.some(item => item.source === selectedSource && JSON.stringify(item.value) === JSON.stringify(req.body?.selectedValue)); if (!allowed) return res.status(409).json({ error: 'That evidence candidate is no longer current. Reload the match before resolving it.' });
      db.evidenceFusionResolutions ||= []; const resolution = upsertEvidenceResolution(db.evidenceFusionResolutions, { matchId, roundId, field, selectedSource, selectedValue: structuredClone(req.body?.selectedValue), reason }, actor(req));
      db.analyticsBuilds ||= {}; db.analyticsBuilds[matchId] = recomputeAcceptedMatchAggregates(db, matchId); refreshCoachingWorkflow(db, actor(req)); await saveDB(db); res.json({ resolution, build: db.analyticsBuilds[matchId] });
    } catch (error: any) { res.status(error.status || 500).json({ error: error.message }); }
  });

  app.get('/api/coaching', async (req, res) => {
    try {
      const db = await readDB(); const summaries = buildAllPracticeBlockSummaries(db);
      const playerId = (req as any).user?.playerId || null; const coach = (req as any).user?.role === 'coach';
      const actions = (db.coachingActions || []).filter((item: CoachingAction) => coach || (item.visibility === 'team' && (!item.ownerIds.length || item.ownerIds.includes(playerId))));
      res.json({ summaries, signals: coach ? db.coachingSignals || [] : [], actions, views: coach ? db.dashboardViews || [] : [] });
    } catch (error: any) { res.status(error.status || 500).json({ error: error.message }); }
  });

  app.post('/api/coaching/refresh', async (req, res) => {
    if (!requireCoach(req, res)) return;
    try { const db = await readDB(); const result = refreshCoachingWorkflow(db, actor(req)); await saveDB(db); res.json(result); }
    catch (error: any) { res.status(error.status || 500).json({ error: error.message }); }
  });

  app.post('/api/coaching/signals/:id/status', async (req, res) => {
    if (!requireCoach(req, res)) return;
    try {
      const allowed: CoachingSignal['status'][] = ['new', 'reviewing', 'accepted', 'dismissed', 'needs-evidence']; const status = req.body?.status as CoachingSignal['status'];
      if (!allowed.includes(status)) return res.status(400).json({ error: 'Unknown review status.' });
      const reason = text(req.body?.reason, 500); if (status === 'dismissed' && !reason) return res.status(400).json({ error: 'Dismissal requires a reason.' });
      const db = await readDB(); const index = (db.coachingSignals || []).findIndex((item: CoachingSignal) => item.id === req.params.id); if (index < 0) return res.status(404).json({ error: 'Review signal not found.' });
      db.coachingSignals[index] = transitionSignal(db.coachingSignals[index], status, actor(req), reason); await saveDB(db); res.json(db.coachingSignals[index]);
    } catch (error: any) { res.status(error.status || 500).json({ error: error.message }); }
  });

  app.post('/api/coaching/signals/:id/correct', async (req, res) => {
    if (!requireCoach(req, res)) return;
    try {
      const validTypes: CoachingSignal['type'][] = ['pistol-conversion', 'full-buy-loss', 'anti-eco-loss', 'low-buy-win', 'first-death-collapse', 'repeated-player-first-death', 'advantage-collapse', 'map-underperformance', 'evidence-health', 'failed-trade-spacing', 'economy-mismatch', 'post-plant-loss', 'first-death-review', 'utility-unused-review'];
      const reason = text(req.body?.reason, 500); const correctedType = req.body?.type as CoachingSignal['type']; if (!reason || !validTypes.includes(correctedType)) return res.status(400).json({ error: 'A valid classification and correction reason are required.' });
      const db = await readDB(); const index = (db.coachingSignals || []).findIndex((item: CoachingSignal) => item.id === req.params.id); if (index < 0) return res.status(404).json({ error: 'Review signal not found.' });
      const current: CoachingSignal = db.coachingSignals[index]; const correctedContext = { ...current.context, ...(req.body?.context && typeof req.body.context === 'object' ? req.body.context : {}) }; const now = new Date().toISOString();
      db.coachingSignals[index] = { ...current, type: correctedType, context: correctedContext, updatedAt: now, classificationCorrections: [...(current.classificationCorrections || []), { at: now, by: actor(req), reason, original: { type: current.type, context: structuredClone(current.context) }, corrected: { type: correctedType, context: structuredClone(correctedContext) } }] };
      await saveDB(db); res.json(db.coachingSignals[index]);
    } catch (error: any) { res.status(error.status || 500).json({ error: error.message }); }
  });

  app.delete('/api/coaching/signals/:id', async (req, res) => {
    if (!requireCoach(req, res)) return;
    try {
      const db = await readDB(); const index = (db.coachingSignals || []).findIndex((item: CoachingSignal) => item.id === req.params.id);
      if (index < 0) return res.status(404).json({ error: 'Review signal not found.' });
      const signal = db.coachingSignals[index] as CoachingSignal;
      if (signal.status !== 'dismissed') return res.status(409).json({ error: 'Dismiss the review item before deleting it.' });
      db.settings ||= {}; db.settings.deletedCoachingSignalFingerprints = [...new Set([...(db.settings.deletedCoachingSignalFingerprints || []), signal.fingerprint])].slice(-1000);
      db.coachingSignals.splice(index, 1); await saveDB(db); res.json({ deleted: true, id: signal.id });
    } catch (error: any) { res.status(error.status || 500).json({ error: error.message }); }
  });

  app.post('/api/coaching/actions', async (req, res) => {
    if (!requireCoach(req, res)) return;
    try {
      const db = await readDB(); const source = (db.coachingSignals || []).find((item: CoachingSignal) => item.id === req.body?.signalId); if (!source) return res.status(404).json({ error: 'Accepted source signal not found.' });
      const ownerIds = Array.isArray(req.body?.ownerIds) ? req.body.ownerIds.filter((id: unknown) => typeof id === 'string' && id.length <= 120) : [];
      const max = Math.max(1, Number(db.settings?.coachingThresholds?.maxActiveActionsPerPlayer || 5));
      const overloaded = ownerIds.find((id: string) => (db.coachingActions || []).filter((action: CoachingAction) => action.ownerIds.includes(id) && !['resolved', 'cancelled'].includes(action.state)).length >= max);
      if (overloaded) return res.status(409).json({ error: `This player already has ${max} active coaching actions.` });
      const action = createCoachingAction({ signal: source, title: text(req.body?.title, 160), kind: req.body?.kind || 'team-task', ownerIds, dueBlockId: text(req.body?.dueBlockId, 120) || undefined, dueDate: text(req.body?.dueDate, 20) || undefined, priority: ['high', 'normal', 'low'].includes(req.body?.priority) ? req.body.priority : 'normal', visibility: ['private', 'staff', 'team'].includes(req.body?.visibility) ? req.body.visibility : 'staff' }, actor(req));
      const goal = buildCoachingGoal({ signal: source, action, matches: db.matches || [], rounds: db.rounds || [], rosterPlayers: db.rosterPlayers || [] }); action.goalId = goal.id;
      db.coachingActions ||= []; db.coachingActions.push(action); db.goals ||= []; db.goals.push(goal); const index = db.coachingSignals.findIndex((item: CoachingSignal) => item.id === source.id); db.coachingSignals[index] = transitionSignal(source, 'converted-to-action', actor(req)); await saveDB(db); res.status(201).json({ action, goal, signal: db.coachingSignals[index] });
    } catch (error: any) { res.status(error.status || 500).json({ error: error.message }); }
  });

  app.post('/api/coaching/actions/:id/status', async (req, res) => {
    try {
      const db = await readDB(); const index = (db.coachingActions || []).findIndex((item: CoachingAction) => item.id === req.params.id); if (index < 0) return res.status(404).json({ error: 'Coaching action not found.' });
      const current: CoachingAction = db.coachingActions[index]; const role = (req as any).user?.role; const playerId = (req as any).user?.playerId;
      const allowed = ['planned', 'assigned', 'acknowledged', 'in-progress', 'review-next-block', 'resolved', 'cancelled'] as CoachingAction['state'][]; const state = req.body?.state as CoachingAction['state']; if (!allowed.includes(state)) return res.status(400).json({ error: 'Unknown action state.' });
      if (role !== 'coach' && (current.visibility !== 'team' || !playerId || !current.ownerIds.includes(playerId) || !['acknowledged', 'in-progress'].includes(state))) return res.status(403).json({ error: 'Players may acknowledge or start only their own team-visible actions.' });
      const now = new Date().toISOString(); db.coachingActions[index] = { ...current, state, updatedAt: now, audit: [...current.audit, { at: now, by: actor(req), from: current.state, to: state, ...(text(req.body?.reason, 500) ? { reason: text(req.body.reason, 500) } : {}) }] }; await saveDB(db); res.json(db.coachingActions[index]);
    } catch (error: any) { res.status(error.status || 500).json({ error: error.message }); }
  });

  app.post('/api/coaching/dashboard-view', async (req, res) => {
    if (!requireCoach(req, res)) return;
    try { const db = await readDB(); const owner = actor(req); const view = normalizeDashboardView(req.body, owner); db.dashboardViews ||= []; const index = db.dashboardViews.findIndex((item: any) => item.id === view.id && item.ownerId === owner); if (index >= 0) db.dashboardViews[index] = view; else db.dashboardViews.push(view); await saveDB(db); res.json(view); }
    catch (error: any) { res.status(error.status || 500).json({ error: error.message }); }
  });

  app.get('/api/coaching/blocks/:id/export', async (req, res) => {
    if (!requireCoach(req, res)) return;
    try { const db = await readDB(); const summary = buildAllPracticeBlockSummaries(db).find(item => item.blockId === req.params.id); if (!summary) return res.status(404).json({ error: 'Practice block not found.' }); res.setHeader('Content-Disposition', `attachment; filename="${summary.blockId.replace(/[^a-z0-9_-]/gi, '-')}.json"`); res.json(summary); }
    catch (error: any) { res.status(error.status || 500).json({ error: error.message }); }
  });
}
