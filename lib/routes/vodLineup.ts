import type { Express } from 'express';
import { readDB, saveDB } from '../store';
import { uid, validate } from '../utils';
import * as schemas from '../../schemas';
import { refreshCoachingWorkflow } from './coaching';
import { normalizeDrawing } from '../frameDrawing';

const author = (req: any) => ({ name: req.user?.username || 'Unknown', role: req.user?.role || 'player' });

// Private coach VOD review (timestamped insights + coach replies) and shared
// Lineup Library comments. Player access to VOD content/writes is denied upstream.
export function registerVodLineupRoutes(app: Express) {
  // POST create/update a VOD review (coach)
  app.post('/api/vod/save', async (req, res) => {
    try {
      const parsed = validate(schemas.vodSaveSchema, req.body, res); if (!parsed) return;
      const review = parsed.review as any;
      if (!review.vodUrl) return res.status(400).json({ error: 'A VOD URL is required.' });
      const db = await readDB();
      if (!db.vodReviews) db.vodReviews = [];
      if (!review.id) {
        review.id = uid();
        review.createdAt = new Date().toISOString();
        review.notes = [];
        db.vodReviews.unshift(review);
      } else {
        const idx = db.vodReviews.findIndex((v: any) => v.id === review.id);
        if (idx >= 0) db.vodReviews[idx] = { ...db.vodReviews[idx], ...review };
        else { review.notes = review.notes || []; db.vodReviews.unshift(review); }
      }
      await saveDB(db);
      res.json(db.vodReviews);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // POST remove a VOD review (coach)
  app.post('/api/vod/remove', async (req, res) => {
    try {
      const { id } = req.body;
      const db = await readDB();
      db.vodReviews = (db.vodReviews || []).filter((v: any) => v.id !== id);
      await saveDB(db);
      res.json(db.vodReviews);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // POST add a timestamped insight to a review (coach)
  app.post('/api/vod/note', async (req, res) => {
    try {
      const body = validate(schemas.vodNoteSchema, req.body, res); if (!body) return;
      const { reviewId, seconds, timeLabel, roundNo, text } = body;
      // A drawing over the frame is optional; a malformed one is refused rather than saved half-empty.
      const drawing = body.drawing === undefined ? null : normalizeDrawing(body.drawing);
      if (body.drawing !== undefined && !drawing) return res.status(400).json({ error: 'The drawing is empty or not readable.' });
      const db = await readDB();
      const review = (db.vodReviews || []).find((v: any) => v.id === reviewId);
      if (!review) return res.status(404).json({ error: 'VOD review not found.' });
      if (!review.notes) review.notes = [];
      review.notes.push({
        id: uid(), seconds: Number(seconds) || 0, timeLabel: timeLabel || '0:00', ...(roundNo ? { roundNo } : {}),
        text, ...(drawing ? { drawing } : {}), ...author(req), createdAt: new Date().toISOString(), replies: []
      });
      review.notes.sort((a: any, b: any) => (a.seconds || 0) - (b.seconds || 0));
      await saveDB(db);
      res.json(db.vodReviews);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // POST remove a note from a review (coach)
  app.post('/api/vod/note/remove', async (req, res) => {
    try {
      const { reviewId, noteId } = req.body;
      const db = await readDB();
      const review = (db.vodReviews || []).find((v: any) => v.id === reviewId);
      if (review) review.notes = (review.notes || []).filter((n: any) => n.id !== noteId);
      await saveDB(db);
      res.json(db.vodReviews);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // POST reply to a private insight (coach only)
  app.post('/api/vod/reply', async (req, res) => {
    try {
      const body = validate(schemas.vodReplySchema, req.body, res); if (!body) return;
      const { reviewId, noteId, text } = body;
      const db = await readDB();
      const review = (db.vodReviews || []).find((v: any) => v.id === reviewId);
      const note = review?.notes?.find((n: any) => n.id === noteId);
      if (!note) return res.status(404).json({ error: 'Insight not found.' });
      if (!note.replies) note.replies = [];
      note.replies.push({ id: uid(), text, ...author(req), createdAt: new Date().toISOString() });
      await saveDB(db);
      res.json(db.vodReviews);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Persist coach decisions on the canonical round so every review surface sees
  // the same note, classifications and locally generated clip references.
  app.post('/api/vod/round-review', async (req, res) => {
    try {
      if ((req as any).user?.role !== 'coach') return res.status(403).json({ error: 'Coach access is required.' });
      const body = validate(schemas.vodRoundReviewSchema, req.body, res); if (!body) return;
      const db = await readDB();
      const round = (db.rounds || []).find((item: any) => item.matchId === body.matchId && item.roundNo === body.roundNo);
      if (!round) return res.status(404).json({ error: 'Round not found.' });
      const now = new Date().toISOString(); const by = author(req).name;
      round.reviewCockpit ||= { classifications: [], clips: [], updatedAt: now };
      if (body.note !== undefined) round.reviewCockpit.note = body.note.trim();
      if (body.classification) {
        round.reviewCockpit.classifications ||= [];
        const index = round.reviewCockpit.classifications.findIndex((item: any) => item.type === body.classification!.type && String(item.player || '') === String(body.classification!.player || ''));
        const decision = { ...body.classification, updatedAt: now, updatedBy: by };
        if (index >= 0) round.reviewCockpit.classifications[index] = decision; else round.reviewCockpit.classifications.push(decision);
        round.reviewCockpit.classificationHistory ||= [];
        round.reviewCockpit.classificationHistory.push({ ...body.classification, at: now, by });
      }
      if (body.factCorrection) {
        const { field, reason } = body.factCorrection;
        let value = body.factCorrection.value.trim();
        if (field === 'result') value = value.toUpperCase();
        if (field === 'side') value = value.toLocaleLowerCase('en') === 'att' ? 'Att' : value.toLocaleLowerCase('en') === 'def' ? 'Def' : value;
        if (field === 'plant') value = value.toUpperCase();
        if ((field === 'side' || field === 'result') && !value) return res.status(400).json({ error: `${field === 'side' ? 'Side' : 'Result'} cannot be empty.` });
        if (field === 'result' && !['W', 'L'].includes(value)) return res.status(400).json({ error: 'Result must be W or L.' });
        if (field === 'side' && !['Att', 'Def'].includes(value)) return res.status(400).json({ error: 'Side must be Att or Def.' });
        if (field === 'plant' && value && !['TRUE', 'FALSE'].includes(value)) return res.status(400).json({ error: 'Spike planted must be TRUE, FALSE, or blank.' });
        const previousValue = round[field] === undefined || round[field] === null || String(round[field]).trim() === '' ? null : String(round[field]);
        if (value) round[field] = value; else delete round[field];
        round.reviewCockpit.factCorrections ||= [];
        round.reviewCockpit.factCorrections.push({ field, previousValue, value: value || null, reason, at: now, by });
      }
      if (body.clips?.length) {
        round.reviewCockpit.clips ||= [];
        for (const clip of body.clips) if (!round.reviewCockpit.clips.some((item: any) => item.id === clip.id)) round.reviewCockpit.clips.push({ ...clip, createdAt: now });
      }
      round.reviewCockpit.updatedAt = now;
      refreshCoachingWorkflow(db, by, now);
      await saveDB(db); res.json(round);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // POST create/update a lineup (coach)
  app.post('/api/lineup/save', async (req, res) => {
    try {
      const parsed = validate(schemas.lineupSaveSchema, req.body, res); if (!parsed) return;
      const lineup = parsed.lineup as any;
      if (!lineup.title) return res.status(400).json({ error: 'A lineup title is required.' });
      const db = await readDB();
      if (!db.lineups) db.lineups = [];
      if (!lineup.id) {
        lineup.id = uid();
        lineup.createdAt = new Date().toISOString();
        lineup.comments = [];
        db.lineups.unshift(lineup);
      } else {
        const idx = db.lineups.findIndex((l: any) => l.id === lineup.id);
        if (idx >= 0) db.lineups[idx] = { ...db.lineups[idx], ...lineup };
        else { lineup.comments = lineup.comments || []; db.lineups.unshift(lineup); }
      }
      await saveDB(db);
      res.json(db.lineups);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // POST remove a lineup (coach)
  app.post('/api/lineup/remove', async (req, res) => {
    try {
      const { id } = req.body;
      const db = await readDB();
      db.lineups = (db.lineups || []).filter((l: any) => l.id !== id);
      await saveDB(db);
      res.json(db.lineups);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // POST comment on a lineup (coach OR player)
  app.post('/api/lineup/comment', async (req, res) => {
    try {
      const body = validate(schemas.lineupCommentSchema, req.body, res); if (!body) return;
      const { lineupId, text } = body;
      const db = await readDB();
      const lineup = (db.lineups || []).find((l: any) => l.id === lineupId);
      if (!lineup) return res.status(404).json({ error: 'Lineup not found.' });
      if (!lineup.comments) lineup.comments = [];
      lineup.comments.push({ id: uid(), text, ...author(req), createdAt: new Date().toISOString() });
      await saveDB(db);
      res.json(db.lineups);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });
}
