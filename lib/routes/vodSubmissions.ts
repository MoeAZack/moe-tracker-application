import type { Express } from 'express';
import type { VodSubmission } from '../../src/types';
import * as schemas from '../../schemas';
import { readDB, saveDB } from '../store';
import { uid, validate } from '../utils';
import { integrateVodSubmission } from '../vodSubmissions';

export function registerVodSubmissionRoutes(app: Express) {
  app.get('/api/vod-submissions', async (req, res) => {
    try {
      const db = await readDB(); const user = (req as any).user || {};
      const submissions = (db.vodSubmissions || []).filter((item: VodSubmission) => user.role === 'coach' || item.submittedByPlayerId === user.playerId);
      res.json({ submissions });
    } catch (error: any) { res.status(error.status || 500).json({ error: error.message }); }
  });

  app.post('/api/vod-submissions', async (req, res) => {
    try {
      const body = validate(schemas.vodSubmissionSchema, req.body, res); if (!body) return;
      const user = (req as any).user || {};
      const coachTeamEvidence = user.role === 'coach' && body.coachTeamEvidence === true;
      const playerId = coachTeamEvidence ? null : (user.role === 'coach' ? body.playerId : user.playerId);
      if (!playerId && !coachTeamEvidence) return res.status(400).json({ error: 'This account must be linked to a roster player before submitting VOD evidence.' });
      const db = await readDB(); const rosterPlayer = playerId ? (db.rosterPlayers || []).find((player: any) => player.id === playerId && !player.retiredAt) : null;
      if (playerId && !rosterPlayer) return res.status(409).json({ error: 'The submitting roster identity is inactive or missing.' });
      const metric = (value: unknown) => typeof value === 'number' ? value : null;
      const submission = integrateVodSubmission(db, {
        vodUrl: body.vodUrl, imageSha256: body.imageSha256, ...(body.matchId ? { matchId: body.matchId } : {}), playerId,
        date: body.date, map: body.map || null, opponent: body.opponent || null, ourScore: metric(body.ourScore), theirScore: metric(body.theirScore),
        players: body.players.map(row => ({ observedName: row.observedName, agent: row.agent || null, kills: metric(row.kills), deaths: metric(row.deaths), assists: metric(row.assists), acs: metric(row.acs), adr: metric(row.adr), hs: metric(row.hs), fk: metric(row.fk), fd: metric(row.fd), plants: metric(row.plants), defuses: metric(row.defuses), trades: metric(row.trades) })),
        timelineEvidence: body.timelineEvidence || null,
      }, rosterPlayer?.displayName || 'Coach team VOD', { submissionId: uid(), matchId: uid(), statId: uid, reviewId: uid() });
      await saveDB(db);
      res.status(201).json({ submission });
    } catch (error: any) { res.status(error.status || 500).json({ error: error.message }); }
  });
}
