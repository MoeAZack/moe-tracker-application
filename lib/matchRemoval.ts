import crypto from 'crypto';
import { purgeMatchGraph, type MatchPurgeReport } from './matchIntegrity';

type MutableTracker = Record<string, any>;

/** Collections whose rows belong to one match and come back with it on restore. */
const OWNED_COLLECTIONS = ['playerStats', 'rounds', 'vetos', 'stratRuns', 'vodSubmissions', 'evidenceFusionResolutions'] as const;
const OWNED_TREES = ['engineAdapters', 'replayIntake'] as const;

/** Several removals within this window count as one burst and get a recovery backup. */
export const REMOVAL_BURST_WINDOW_MS = 10 * 60 * 1000;

export type OwnedNode = { tree: string; path: string[]; inArray: boolean; value: any };

/**
 * A removed match, kept whole so it can be restored. `graph` is shaped like a
 * small workspace (matches, rounds, playerStats and so on), so the store keeps
 * its evidence out of the active index the same way it does for a season archive.
 */
export type RemovedMatchEntry = {
  id: string;
  matchId: string;
  removedAt: string;
  removedBy: string;
  route: 'remove' | 'duplicate-discard';
  /** Recovery backup taken just before this removal, if one was. */
  backupId?: string;
  summary: { date?: string; map?: string; opponent?: string; score?: string; rounds: number; playerStats: number };
  purge: MatchPurgeReport;
  graph?: Record<string, any>;
  restoredAt?: string;
  restoredBy?: string;
};

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const ownsMatch = (value: any, matchId: string) => !!value && typeof value === 'object' && !Array.isArray(value)
  && [value.matchId, value.linkedMatchId, value.requestedMatchId, value.targetMatchId].some(id => text(id) === matchId);

/** The same records `purgeMatchGraph` removes from the adapter and intake trees, with where they lived. */
function collectOwnedNodes(tree: string, value: any, matchId: string, path: string[] = [], out: OwnedNode[] = []) {
  if (!value || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (ownsMatch(item, matchId)) out.push({ tree, path, inArray: true, value: structuredClone(item) });
      else collectOwnedNodes(tree, item, matchId, path, out);
    }
    return out;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === matchId || ownsMatch(child, matchId)) out.push({ tree, path: [...path, key], inArray: false, value: structuredClone(child) });
    else collectOwnedNodes(tree, child, matchId, [...path, key], out);
  }
  return out;
}

export function snapshotMatchGraph(db: MutableTracker, matchId: string) {
  const owns = (row: any) => row?.matchId === matchId || row?.linkedMatchId === matchId || row?.requestedMatchId === matchId;
  const graph: Record<string, any> = { matches: (db.matches || []).filter((row: any) => row.id === matchId).map((row: any) => structuredClone(row)) };
  for (const key of OWNED_COLLECTIONS) graph[key] = (db[key] || []).filter(owns).map((row: any) => structuredClone(row));
  graph.analyticsBuilds = db.analyticsBuilds && Object.prototype.hasOwnProperty.call(db.analyticsBuilds, matchId) ? { [matchId]: structuredClone(db.analyticsBuilds[matchId]) } : {};
  graph.ownedNodes = OWNED_TREES.flatMap(tree => collectOwnedNodes(tree, db[tree], matchId));
  return graph;
}

/** Removals still waiting in "Recently deleted" (not restored). */
export function pendingRemovals(db: MutableTracker): RemovedMatchEntry[] {
  return (Array.isArray(db.removedMatches) ? db.removedMatches : []).filter((entry: any) => !entry.restoredAt);
}

/**
 * A recovery backup is taken before a removal that leaves no matches, and once
 * per burst of removals, so repeated deletes can always be walked back in one restore.
 */
export function removalNeedsBackup(db: MutableTracker, matchId: string, now = Date.now()): 'last-match' | 'burst' | null {
  const remaining = (db.matches || []).filter((match: any) => match.id !== matchId).length;
  if (remaining === 0) return 'last-match';
  const recent = (Array.isArray(db.removedMatches) ? db.removedMatches : []).filter((entry: any) => now - Date.parse(entry.removedAt) < REMOVAL_BURST_WINDOW_MS);
  if (recent.length >= 1 && !recent.some((entry: any) => entry.backupId)) return 'burst';
  return null;
}

/**
 * Remove a match from the active workspace and keep it, whole, in
 * `removedMatches`. Nothing is lost: the coach can restore it from "Recently deleted".
 */
export function quarantineMatch(db: MutableTracker, matchId: string, options: { actor: string; route: RemovedMatchEntry['route']; now?: string; backupId?: string }) {
  const match = (db.matches || []).find((row: any) => row.id === matchId);
  if (!match) throw Object.assign(new Error('Match was not found.'), { status: 404 });
  const graph = snapshotMatchGraph(db, matchId);
  const purge = purgeMatchGraph(db, matchId);
  const entry: RemovedMatchEntry = {
    id: crypto.randomUUID(), matchId, removedAt: options.now || new Date().toISOString(), removedBy: options.actor, route: options.route,
    ...(options.backupId ? { backupId: options.backupId } : {}),
    summary: {
      ...(text(match.date) ? { date: text(match.date) } : {}), ...(text(match.map) ? { map: text(match.map) } : {}),
      ...(text(match.opponent) ? { opponent: text(match.opponent) } : {}),
      ...(Number.isFinite(match.ourScore) && Number.isFinite(match.theirScore) ? { score: `${match.ourScore}-${match.theirScore}` } : {}),
      rounds: graph.rounds.length, playerStats: graph.playerStats.length,
    },
    purge, graph,
  };
  if (!Array.isArray(db.removedMatches)) db.removedMatches = [];
  db.removedMatches.push(entry);
  return entry;
}

function setAtPath(root: MutableTracker, tree: string, path: string[], value: any, inArray: boolean) {
  if (!root[tree] || typeof root[tree] !== 'object') root[tree] = {};
  let cursor = root[tree];
  for (const key of path.slice(0, -1)) {
    if (!cursor[key] || typeof cursor[key] !== 'object') cursor[key] = {};
    cursor = cursor[key];
  }
  if (inArray) {
    const key = path[path.length - 1];
    if (key === undefined) return; // A top-level array tree is not a shape these trees use.
    if (!Array.isArray(cursor[key])) cursor[key] = [];
    cursor[key].push(value);
  } else cursor[path[path.length - 1]] = value;
}

/** Put a removed match back exactly as it was kept. Links detached from goals and reviews stay detached. */
export function restoreRemovedMatch(db: MutableTracker, entryId: string, options: { actor: string; now?: string }) {
  const entry = (Array.isArray(db.removedMatches) ? db.removedMatches : []).find((item: any) => item.id === entryId);
  if (!entry) throw Object.assign(new Error('That deleted match was not found.'), { status: 404 });
  if (entry.restoredAt) throw Object.assign(new Error('That match was already restored.'), { status: 409 });
  if (!entry.graph || !Array.isArray(entry.graph.matches) || entry.graph.matches.length !== 1) throw Object.assign(new Error('That deleted match has no stored copy to restore.'), { status: 409 });
  if ((db.matches || []).some((match: any) => match.id === entry.matchId)) throw Object.assign(new Error('A match with the same id is already in the workspace.'), { status: 409 });
  const graph = entry.graph;
  db.matches = [...(db.matches || []), ...graph.matches];
  for (const key of OWNED_COLLECTIONS) {
    const existing = new Set((db[key] || []).map((row: any) => row.id));
    db[key] = [...(db[key] || []), ...(graph[key] || []).filter((row: any) => !existing.has(row.id))];
  }
  for (const [id, build] of Object.entries(graph.analyticsBuilds || {})) { if (!db.analyticsBuilds || typeof db.analyticsBuilds !== 'object') db.analyticsBuilds = {}; db.analyticsBuilds[id] = build; }
  for (const node of graph.ownedNodes || []) setAtPath(db, node.tree, node.path, node.value, node.inArray);
  entry.restoredAt = options.now || new Date().toISOString(); entry.restoredBy = options.actor;
  // The restored rows are live again; the kept copy is no longer needed.
  delete entry.graph;
  return entry;
}

/** What "Recently deleted" shows: the summary, never the kept evidence. */
export function removedMatchSummaries(db: MutableTracker) {
  return pendingRemovals(db).map(({ graph: _graph, purge, ...entry }) => ({ ...entry, removed: purge?.removed || {} }))
    .sort((left, right) => right.removedAt.localeCompare(left.removedAt));
}
