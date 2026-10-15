import crypto from 'crypto';
import type { Express, Request, Response } from 'express';
import * as schemas from '../../schemas';
import { readDB, saveDB } from '../store';
import { mergePracticeBlocks, savePracticeBlock, splitPracticeBlock } from '../practiceBlocks';
import { validate } from '../utils';

function coach(req: Request, res: Response) {
  if ((req as any).user?.role !== 'coach') { res.status(403).json({ error: 'Private tryout decisions require coach access.' }); return false; }
  return true;
}
const actor = (req: Request) => String((req as any).user?.actorId || (req as any).user?.username || 'coach');

export function registerComparisonRoutes(app: Express) {
  app.post('/api/practice-blocks/save', async (req, res) => {
    if (!coach(req, res)) return; const body = validate(schemas.practiceBlockSaveSchema, req.body, res); if (!body) return;
    try { const db = await readDB(); const block = savePracticeBlock(db, body, actor(req)); await saveDB(db); res.json(block); } catch (error: any) { res.status(error.status || 500).json({ error: error.message }); }
  });
  app.post('/api/practice-blocks/split', async (req, res) => {
    if (!coach(req, res)) return; const body = validate(schemas.practiceBlockSplitSchema, req.body, res); if (!body) return;
    try { const db = await readDB(); const result = splitPracticeBlock(db, body, actor(req)); await saveDB(db); res.json(result); } catch (error: any) { res.status(error.status || 500).json({ error: error.message }); }
  });
  app.post('/api/practice-blocks/merge', async (req, res) => {
    if (!coach(req, res)) return; const body = validate(schemas.practiceBlockMergeSchema, req.body, res); if (!body) return;
    try { const db = await readDB(); const result = mergePracticeBlocks(db, body, actor(req)); await saveDB(db); res.json(result); } catch (error: any) { res.status(error.status || 500).json({ error: error.message }); }
  });
  app.post('/api/tryout-decisions/notes', async (req, res) => {
    if (!coach(req, res)) return; const body = validate(schemas.tryoutDecisionNoteSchema, req.body, res); if (!body) return;
    try {
      const db = await readDB(); const player = (db.rosterPlayers || []).find((item: any) => item.id === body.playerId); if (!player) return res.status(404).json({ error: 'Roster identity not found.' });
      db.tryoutDecisionNotes ||= []; const index = db.tryoutDecisionNotes.findIndex((note: any) => note.id === body.id); const current = index >= 0 ? db.tryoutDecisionNotes[index] : null;
      if (current && current.playerId !== body.playerId) return res.status(409).json({ error: 'A decision note cannot be reassigned to another identity.' });
      const now = new Date().toISOString(); const note = { schema: 'moetracker.tryout-decision-note/v1', id: current?.id || crypto.randomUUID(), playerId: body.playerId, text: body.text, createdAt: current?.createdAt || now, createdBy: current?.createdBy || actor(req), updatedAt: now, updatedBy: actor(req), history: current ? [...(current.history || []), { text: current.text, changedAt: now, changedBy: actor(req) }] : [] };
      if (index >= 0) db.tryoutDecisionNotes[index] = note; else db.tryoutDecisionNotes.push(note); await saveDB(db); res.json(note);
    } catch (error: any) { res.status(error.status || 500).json({ error: error.message }); }
  });
  app.post('/api/tryout-decisions/notes/remove', async (req, res) => {
    if (!coach(req, res)) return; const body = validate(schemas.tryoutDecisionNoteRemoveSchema, req.body, res); if (!body) return;
    try { const db = await readDB(); const note = (db.tryoutDecisionNotes || []).find((item: any) => item.id === body.id); if (!note) return res.status(404).json({ error: 'Decision note not found.' }); if (!note.removedAt) { note.removedAt = new Date().toISOString(); note.removedBy = actor(req); await saveDB(db); } res.json({ removed: true }); } catch (error: any) { res.status(error.status || 500).json({ error: error.message }); }
  });
}
