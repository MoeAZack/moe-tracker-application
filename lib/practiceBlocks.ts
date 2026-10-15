import type { Match, PracticeBlock } from '../src/types';
import { toCairoDateKey } from './coachAnalytics';

export const PRACTICE_BLOCK_SCHEMA = 'moetracker.practice-block/v1' as const;

export interface ResolvedPracticeBlock {
  id: string;
  name: string;
  matchIds: string[];
  source: 'explicit' | 'cairo-date-fallback';
  cairoDate: string | null;
}

function fallbackId(date: string) {
  return `cairo-date:${date}`;
}

export function resolvePracticeBlocksWithIssues(matches: readonly Match[], saved: readonly PracticeBlock[] = []) {
  const matchesById = new Map(matches.map(match => [match.id, match]));
  const claimed = new Set<string>();
  const issues: Array<{ code: 'overlap' | 'unknown-match' | 'invalid-date'; id: string }> = [];
  const explicit = saved.map(block => {
    const matchIds = [...new Set(block.matchIds)].filter(id => {
      if (!matchesById.has(id)) { issues.push({ code: 'unknown-match', id }); return false; }
      if (claimed.has(id)) { issues.push({ code: 'overlap', id }); return false; }
      return true;
    }).sort();
    matchIds.forEach(id => claimed.add(id));
    const dates = matchIds.map(id => toCairoDateKey(matchesById.get(id)!.date)).filter((date): date is string => !!date).sort();
    return { id: block.id, name: block.name, matchIds, source: 'explicit' as const, cairoDate: dates[0] || null };
  }).filter(block => block.matchIds.length > 0);
  const fallback = new Map<string, string[]>();
  for (const match of matches) {
    if (claimed.has(match.id)) continue;
    const date = toCairoDateKey(match.date);
    if (!date) { issues.push({ code: 'invalid-date', id: match.id }); continue; }
    fallback.set(date, [...(fallback.get(date) || []), match.id]);
  }
  const blocks = [...explicit, ...[...fallback.entries()].map(([date, matchIds]) => ({
    id: fallbackId(date), name: `Practice · ${date}`, matchIds: matchIds.sort(), source: 'cairo-date-fallback' as const, cairoDate: date,
  }))].sort((left, right) => (right.cairoDate || '').localeCompare(left.cairoDate || '') || left.id.localeCompare(right.id));
  return { blocks, issues, unassignedMatchIds: issues.filter(issue => issue.code === 'invalid-date').map(issue => issue.id) };
}

export function resolvePracticeBlocks(matches: readonly Match[], saved: readonly PracticeBlock[] = []) { return resolvePracticeBlocksWithIssues(matches, saved).blocks; }

function requiredName(value: string) {
  const name = value.trim();
  if (!name || name.length > 100) throw Object.assign(new Error('Block name must be 1–100 characters.'), { status: 400 });
  return name;
}

export function savePracticeBlock(db: any, input: { id?: string; name: string; matchIds: string[] }, actor: string, now = new Date().toISOString()) {
  db.practiceBlocks ||= [];
  const known = new Set((db.matches || []).map((match: any) => match.id));
  const requested = [...new Set(input.matchIds)];
  if (requested.some(id => !known.has(id))) throw Object.assign(new Error('Practice block contains an unknown match.'), { status: 400 });
  const matchIds = requested.sort();
  if (!matchIds.length) throw Object.assign(new Error('A practice block needs at least one existing match.'), { status: 400 });
  const collisions = db.practiceBlocks.filter((block: any) => block.id !== input.id).flatMap((block: any) => block.matchIds || []).filter((id: string) => matchIds.includes(id));
  if (collisions.length) throw Object.assign(new Error('A match can belong to only one explicit practice block.'), { status: 409 });
  const index = db.practiceBlocks.findIndex((block: any) => block.id === input.id);
  const current = index >= 0 ? db.practiceBlocks[index] : null;
  const block = {
    schema: PRACTICE_BLOCK_SCHEMA, id: current?.id || input.id || globalThis.crypto.randomUUID(), name: requiredName(input.name), matchIds,
    createdAt: current?.createdAt || now, createdBy: current?.createdBy || actor, updatedAt: now, updatedBy: actor,
  } satisfies PracticeBlock;
  if (index >= 0) db.practiceBlocks[index] = block; else db.practiceBlocks.push(block);
  return block;
}

export function splitPracticeBlock(db: any, input: { id: string; name: string; matchIds: string[]; remainingName?: string }, actor: string, now = new Date().toISOString()) {
  const before = structuredClone(db.practiceBlocks || []);
  try {
  const current = (db.practiceBlocks || []).find((block: any) => block.id === input.id);
  if (!current) throw Object.assign(new Error('Practice block not found.'), { status: 404 });
  requiredName(input.name); if (input.remainingName) requiredName(input.remainingName);
  const selected = [...new Set(input.matchIds)];
  if (selected.some(id => !current.matchIds.includes(id))) throw Object.assign(new Error('A split contains a match outside the source block.'), { status: 400 });
  if (!selected.length || selected.length === current.matchIds.length) throw Object.assign(new Error('A split must leave matches in both blocks.'), { status: 400 });
  current.name = requiredName(input.remainingName || current.name); current.matchIds = current.matchIds.filter((id: string) => !selected.includes(id)); current.updatedAt = now; current.updatedBy = actor;
  return { remaining: current, created: savePracticeBlock(db, { name: input.name, matchIds: selected }, actor, now) };
  } catch (error) { db.practiceBlocks = before; throw error; }
}

export function mergePracticeBlocks(db: any, input: { ids: string[]; name: string }, actor: string, now = new Date().toISOString()) {
  const before = structuredClone(db.practiceBlocks || []);
  try {
  const ids = [...new Set(input.ids)];
  if (ids.length < 2) throw Object.assign(new Error('Choose at least two blocks to merge.'), { status: 400 });
  requiredName(input.name);
  const blocks = ids.map(id => (db.practiceBlocks || []).find((block: any) => block.id === id));
  if (blocks.some(block => !block)) throw Object.assign(new Error('Practice block not found.'), { status: 404 });
  const retainedId = blocks[0].id; const matchIds = [...new Set(blocks.flatMap(block => block.matchIds))];
  const otherMatchIds = new Set((db.practiceBlocks || []).filter((block: any) => !ids.includes(block.id)).flatMap((block: any) => block.matchIds || []));
  if (matchIds.some(id => otherMatchIds.has(id))) throw Object.assign(new Error('Merged block would overlap another explicit block.'), { status: 409 });
  db.practiceBlocks = db.practiceBlocks.filter((block: any) => !ids.includes(block.id));
  return savePracticeBlock(db, { id: retainedId, name: input.name, matchIds }, actor, now);
  } catch (error) { db.practiceBlocks = before; throw error; }
}
