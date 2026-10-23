import React, { useState, useMemo, useEffect, useRef } from 'react';
import SourceChip from './SourceChip';
import RoundSheetEditor from './RoundSheetEditor';
import VetoEditor from './VetoEditor';
import MatchCoachBrief from './MatchCoachBrief';
import { roundFlag } from '../utils/roundFlag';
import { knownResult } from '../../lib/analyticsEvidence';
import { entrySource, matchSource } from '../../lib/statSource';
import { buildRoundEditorRows, savableRoundEditorRows } from '../../lib/roundEditor';
import { AppearanceType, Match, MatchRosterContext, MatchStatsUpdate, PlayerStats, Round, TrackerData, Veto } from '../types';
import { apiFetch } from '../utils/api';
import RosterContextSelector from './RosterContextSelector';
import { reconcileStatsForContext } from '../utils/lineupContext';
import { reconcileStatTotals } from '../../lib/entryEngine';
import { partitionScreenshotRows } from '../../lib/screenshotRosterDraft';
import { activeTryoutPhase, newWorkspaceMatchContext, resolvePhaseAlias } from '../utils/tryoutWorkspace';
import { buildOpponentHistory } from '../../lib/opponentHistory';
import DuplicateReviewPanel from './DuplicateReviewPanel';
import RecentlyDeletedMatches from './RecentlyDeletedMatches';
import { activeResourceNames } from '../../lib/resourceCatalog';
import { Swords, Plus, FileText, BarChart3, Save, Shuffle, Sparkles } from 'lucide-react';
import { confirmDialog, notify } from '../utils/appDialogs';
import { matchResult, matchScore, sideSplit } from '../utils/matchScore';

interface ComponentProps {
  data: TrackerData;
  theme: any;
  onSaveMatch: (match: any, statsUpdate: MatchStatsUpdate) => Promise<any>;
  onRemove: (sheet: string, id: string) => Promise<any>;
  onSaveRounds: (matchId: string, rows: any[]) => Promise<any>;
  onSaveVeto: (matchId: string, meta: any, actions: any[]) => Promise<any>;
  onRefreshDatabase?: () => Promise<void>;
  manualReplayDraft?: any | null;
  onManualReplayDraftConsumed?: () => void;
  reviewMatchId?: string | null;
  reviewRoundNo?: number | null;
  onReviewContextChange?: (matchId: string, roundNo?: number | null) => void;
  onDuplicateReview?: (matchId: string, decision: 'keep-both' | 'discard-this') => Promise<void>;
  /** Coach acceptance of one saved round's screenshot evidence. */
  onAcceptRoundEvidence?: (matchId: string, roundNo: number) => Promise<void>;
  /** Opens live logging, the round-by-round way to record a match. Left out where it is unavailable. */
  onRecordLive?: () => void;
}

/** A pistol result that was never recorded reads "Unknown", never a bare slash. */
export const pistolResultLabel = (value: unknown) => String(value ?? '').trim() || 'Unknown';
/** Won reads green, lost red, and an unrecorded result stays neutral. */
export const pistolResultClass = (value: unknown) => { const result = knownResult(value); return result === 'win' ? 'text-emerald-400' : result === 'loss' ? 'text-rose-400' : 'text-slate-400'; };

export default function MatchLogRounds({ data, theme, onSaveMatch, onRemove, onSaveRounds, onSaveVeto, onRefreshDatabase, manualReplayDraft, onManualReplayDraftConsumed, reviewMatchId, reviewRoundNo, onReviewContextChange, onDuplicateReview, onAcceptRoundEvidence, onRecordLive }: ComponentProps) {
  const isLight = data.settings.theme === 'daylight';
  
  // --- SUB TAB CONTROL ---
  const [activeTab, setActiveTab] = useState<'matches' | 'rounds' | 'vetos' | 'aiAnalysis'>('matches');

  // Selected Match for sub-actions
  const [selectedMatch, setSelectedMatch] = useState<Match | null>(null);

  // --- MODALS ---
  const [matchModalOpen, setMatchModalOpen] = useState(false);
  const matchDialogRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!matchModalOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = matchDialogRef.current;
    const focusable = () => Array.from(dialog?.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled])') || []) as HTMLElement[];
    focusable()[0]?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setMatchModalOpen(false); }
      if (event.key !== 'Tab') return;
      const items = focusable(), first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    dialog?.addEventListener('keydown', handleKey);
    return () => { dialog?.removeEventListener('keydown', handleKey); previous?.focus(); };
  }, [matchModalOpen]);
  const [editingMatch, setEditingMatch] = useState<Partial<Match> | null>(null);
  const [editingStats, setEditingStats] = useState<PlayerStats[]>([]);
  const [unmappedScreenshotRows, setUnmappedScreenshotRows] = useState<any[]>([]);
  const [creatingScreenshotPlayer, setCreatingScreenshotPlayer] = useState(false);
  const [screenshotMappingError, setScreenshotMappingError] = useState('');
  const [newAppearancePlayerId, setNewAppearancePlayerId] = useState('');

  // Modals for Round/Veto editors
  const [roundEditorOpen, setRoundEditorOpen] = useState(false);
  const [vetoEditorOpen, setVetoEditorOpen] = useState(false);

  // Rounds state
  const [activeRounds, setActiveRounds] = useState<Partial<Round>[]>([]);
  // Vetos state
  const [activeVetos, setActiveVetos] = useState<Partial<Veto>[]>([]);

  const matches = data.matches || [];
  const opponentHistory = useMemo(() => buildOpponentHistory(matches), [matches]);
  const repeatOpponents = opponentHistory.filter(opponent => opponent.games > 1);
  const playerStats = data.playerStats || [];
  const players = data.settings.players || [];
  const knownPlayers = data.rosterPlayers || [];
  const activeCoreIds = useMemo(() => new Set(
    (data.coreMemberships || []).filter(membership => !membership.endedAt).map(membership => membership.playerId),
  ), [data.coreMemberships]);
  const maps = activeResourceNames(data, 'map');
  const tryoutPhase = activeTryoutPhase(data);
  const participantIds = tryoutPhase ? new Set(tryoutPhase.candidatePlayerIds) : activeCoreIds;
  const defaultAppearance: AppearanceType = tryoutPhase ? 'tryout' : 'core';
  const agents = activeResourceNames(data, 'agent');
  const matchTypes = data.settings.matchTypes || [];
  const buyTypes = data.settings.buyTypes || ['Full', 'Half', 'Force', 'Bonus', 'Eco'];
  const winReasons = data.settings.winReasons || ['Elimination', 'Post-plant', 'Defuse', 'Retake', 'Time', 'Spike'];
  const sites = data.settings.sites || ['A', 'B', 'C'];
  const vetoActions = data.settings.vetoActions || ['ban', 'pick', 'decider'];

  // Select a match automatically when opening the view, once. After a delete
  // nothing is selected, so the Delete button never lands on the next match.
  const autoSelected = useRef(false);
  useEffect(() => {
    const requested = reviewMatchId ? matches.find(match => match.id === reviewMatchId) : null;
    if (requested && requested.id !== selectedMatch?.id) setSelectedMatch(requested);
    else if (matches.length > 0 && !selectedMatch && !autoSelected.current) setSelectedMatch(matches[0]);
    if (matches.length > 0) autoSelected.current = true;
  }, [matches, reviewMatchId, selectedMatch]);

  const statsForSelectedMatch = useMemo(() => {
    if (!selectedMatch) return [];
    return playerStats.filter((ps) => ps.matchId === selectedMatch.id);
  }, [playerStats, selectedMatch]);

  const roundsForSelectedMatch = useMemo(() => {
    if (!selectedMatch) return [];
    return (data.rounds || []).filter((r) => r.matchId === selectedMatch.id).sort((a, b) => a.roundNo - b.roundNo);
  }, [data.rounds, selectedMatch]);

  const vetosForSelectedMatch = useMemo(() => {
    if (!selectedMatch) return [];
    return (data.vetos || []).filter((v) => v.matchId === selectedMatch.id).sort((a, b) => a.seq - b.seq);
  }, [data.vetos, selectedMatch]);

  // --- MATCH MUTATIONS ---
  const handleOpenAddMatch = () => {
    setUnmappedScreenshotRows([]);
    const freshMatch: Partial<Match> = {
      id: '',
      date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date()),
      type: 'Scrim',
      opponent: '',
      map: maps[0] || 'Ascent',
      attW: null,
      attL: null,
      defW: null,
      defL: null,
      pistolAtt: '',
      pistolDef: '',
      ecoAtt: '',
      ecoDef: '',
      bonusAtt: '',
      bonusDef: '',
      vod: '',
      notes: '',
      source: 'manual',
      rosterContext: newWorkspaceMatchContext(data),
    };
    
    const freshStats = knownPlayers.filter(player => !player.retiredAt && participantIds.has(player.id)).map(player => ({
      id: '',
      matchId: '',
      player: player.displayName,
      playerId: player.id,
      displayNameSnapshot: player.displayName,
      appearanceType: defaultAppearance,
      agent: '',
      kAtt: null, kDef: null, dAtt: null, dDef: null, aAtt: null, aDef: null,
      kills: null, deaths: null, assists: null,
      acs: null, adr: null, hs: null, fk: null, fd: null, rating: null,
    }));

    setEditingMatch(freshMatch);
    setEditingStats(freshStats);
    setMatchModalOpen(true);
  };

  useEffect(() => {
    if (!manualReplayDraft) return;
    const draftRows = (manualReplayDraft.stats || []).map((row: any) => ({ ...row, matchedPlayerId: resolvePhaseAlias(data, row.extractedName || '') || row.matchedPlayerId }));
    const { resolved: importedByPlayer, unresolved } = partitionScreenshotRows(draftRows, participantIds);
    setUnmappedScreenshotRows(unresolved);
    const freshStats = knownPlayers.filter(player => !player.retiredAt && participantIds.has(player.id)).map(player => {
      const imported: any = importedByPlayer.get(player.id);
      return {
        id: '', matchId: '', player: player.displayName, playerId: player.id,
        displayNameSnapshot: player.displayName, appearanceType: defaultAppearance,
        agent: imported?.agent || '',
        kAtt: null, kDef: null, dAtt: null, dDef: null, aAtt: null, aDef: null,
        kills: imported?.kills ?? null, deaths: imported?.deaths ?? null, assists: imported?.assists ?? null,
        acs: imported?.acs ?? null, adr: imported?.adr ?? null, hs: imported?.hs ?? null,
        fk: imported?.fk ?? null, fd: imported?.fd ?? null, orbPoints: null, rating: null,
        sourceMetadata: manualReplayDraft.sourceMetadata,
      };
    });
    setEditingMatch({
      id: '', date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date()), type: 'Scrim', opponent: '',
      map: manualReplayDraft.match?.map || '',
      ourScore: manualReplayDraft.match?.ourScore ?? null,
      theirScore: manualReplayDraft.match?.theirScore ?? null,
      attW: null, attL: null, defW: null, defL: null,
      pistolAtt: '', pistolDef: '', ecoAtt: '', ecoDef: '', bonusAtt: '', bonusDef: '',
      vod: '', notes: 'Manual fallback from scoreboard crop; no replay evidence attached.',
      source: 'screenshot-manual-fallback', sourceMetadata: manualReplayDraft.sourceMetadata,
      rosterContext: newWorkspaceMatchContext(data),
    });
    setEditingStats(freshStats);
    setMatchModalOpen(true);
    onManualReplayDraftConsumed?.();
  }, [manualReplayDraft, onManualReplayDraftConsumed]);

  const handleOpenEditMatch = (m: Match) => {
    setEditingMatch({ ...m, rosterContext: m.rosterContext || { kind: 'unclassified' } });
    setUnmappedScreenshotRows([]);
    const existingStats = playerStats.filter(ps => ps.matchId === m.id);
    // Historical rows are never inferred from today's roster membership.
    setEditingStats(existingStats.map(stat => ({ ...stat })));
    setMatchModalOpen(true);
  };

  const changeRosterContext = (rosterContext: MatchRosterContext) => {
    if (!editingMatch) return;
    setEditingMatch({ ...editingMatch, rosterContext });
    setEditingStats(current => reconcileStatsForContext(current, rosterContext));
  };

  const addAppearance = () => {
    const player = knownPlayers.find(entry => entry.id === newAppearancePlayerId);
    if (!player || player.retiredAt || !editingMatch) return;
    const kind = editingMatch.rosterContext?.kind || 'unclassified';
    const appearanceType: AppearanceType = kind === 'tryout' ? 'tryout' : kind === 'mixed' ? 'standIn' : 'core';
    setEditingStats(current => [...current, {
      id: '', matchId: editingMatch.id || '', player: player.displayName,
      rowOperation: 'create',
      playerId: player.id, displayNameSnapshot: player.displayName, appearanceType,
      agent: agents[0] || 'Omen', kAtt: null, kDef: null, dAtt: null, dDef: null, aAtt: null, aDef: null,
      kills: null, deaths: null, assists: null, acs: null, adr: null, hs: null, fk: null, fd: null, rating: null,
    }]);
    setNewAppearancePlayerId('');
  };

  const handleSaveMatchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMatch || !editingMatch.opponent) return;
    if (unmappedScreenshotRows.length) { notify('Map or exclude the remaining screenshot rows before saving.'); return; }

    if (data.settings.confirmOnSave && !(await confirmDialog('Save this match data?', { confirmLabel: 'Save' }))) return;

    // Complete side splits are authoritative. Imported totals survive while a
    // coach has not yet supplied both sides.
    const finalizedStats = editingStats.map(st => reconcileStatTotals(st));

    // The form shows the final score, so saving it confirms a score read from the HUD.
    const res = await onSaveMatch({ ...editingMatch, scoreConfirmed: true }, { operation: 'replace', stats: finalizedStats });
    const savedMatch = res?.match || res;
    setMatchModalOpen(false);
    setEditingMatch(null);
    if (savedMatch?.id) {
      setSelectedMatch(savedMatch);
    }
  };

  const handleDeleteMatch = async (id: string) => {
    // Always confirmed, whatever the delete-confirmation setting says.
    if (!(await confirmDialog('Delete this match with its round log, player stats and veto? It moves to Recently deleted, where you can restore it.', { destructive: true, confirmLabel: 'Delete match' }))) return;
    await onRemove('Matches', id);
    setSelectedMatch(null);
  };

  // --- ROUND LOG MUTATIONS ---
  const handleOpenRoundEditor = () => {
    if (!selectedMatch) return;
    setActiveRounds(buildRoundEditorRows(selectedMatch, roundsForSelectedMatch) as Partial<Round>[]);
    setRoundEditorOpen(true);
  };

  const handleSaveRounds = async () => {
    if (!selectedMatch) return;
    // Discard only untouched generated placeholders. Persisted or annotated
    // rounds remain evidence even when their result is still unknown.
    const cleanRounds = savableRoundEditorRows(activeRounds as Record<string, unknown>[]) as Partial<Round>[];
    await onSaveRounds(selectedMatch.id, cleanRounds);
    setRoundEditorOpen(false);
  };

  // --- VETO LOG MUTATIONS ---
  const handleOpenVetoEditor = () => {
    if (!selectedMatch) return;
    const existing = vetosForSelectedMatch;
    const initialVetos: Partial<Veto>[] = [];
    const size = Math.max(existing.length, 7); // Usually 7 vetos maximum in best of 3/5
    
    for (let i = 1; i <= size; i++) {
      const v = existing.find(x => x.seq === i);
      if (v) {
        initialVetos.push({ ...v });
      } else {
        initialVetos.push({
          id: '',
          matchId: selectedMatch.id,
          date: selectedMatch.date,
          opponent: selectedMatch.opponent,
          seq: i,
          actor: 'us',
          action: 'ban',
          map: maps[0] || 'Ascent',
          result: ''
        });
      }
    }
    setActiveVetos(initialVetos);
    setVetoEditorOpen(true);
  };

  const handleSaveVetoSubmit = async () => {
    if (!selectedMatch) return;
    const cleanVetos = activeVetos.filter(v => v.map);
    await onSaveVeto(selectedMatch.id, selectedMatch, cleanVetos);
    setVetoEditorOpen(false);
  };

  return (
    <div className="space-y-6">
      {/* Top action controller row */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3">
        <div className="flex items-center gap-2">
          <Swords className={`w-5 h-5 ${theme.text}`} />
          <h3 className="font-black text-sm tracking-wide uppercase">Scrims & Matches Log</h3>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleOpenAddMatch}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded ${theme.primaryBg} text-white cursor-pointer hover:opacity-90 transition-opacity`}
          >
            <Plus className="w-4 h-4" /> Record match
          </button>
          {onRecordLive && (
            <button
              type="button"
              onClick={onRecordLive}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded border border-white/10 bg-white/5 text-white hover:bg-white/10"
            >
              <span className="h-2 w-2 rounded-full bg-[#ff4655]" aria-hidden="true" /> Record live, round by round
            </button>
          )}
        </div>
      </div>

      {repeatOpponents.length > 0 && <section className={`rounded-xl border p-4 ${isLight ? 'border-slate-200 bg-white' : 'border-white/10 bg-white/[0.03]'}`} aria-labelledby="repeat-opponents-title">
        <div className="flex flex-wrap items-end justify-between gap-2"><div><h4 id="repeat-opponents-title" className="text-xs font-black uppercase tracking-widest">Repeat opponent tracker</h4><p className="mt-1 text-xs text-gray-500">Teams with two or more recorded maps. Capitalization variants are combined.</p></div><span className="text-xs uppercase tracking-wider text-cyan-300">{repeatOpponents.length} recurring teams</span></div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{repeatOpponents.map(opponent => <article key={opponent.key} className="rounded-lg border border-white/10 bg-black/10 p-3"><div className="flex items-center justify-between gap-3"><strong>{opponent.name}</strong><span className="font-mono text-sm">{opponent.games} games</span></div><p className="mt-2 text-xs text-slate-400"><span className="text-emerald-300">{opponent.wins}W</span> · <span className="text-rose-300">{opponent.losses}L</span>{opponent.ties ? ` · ${opponent.ties}T` : ''} · {opponent.maps.join(', ') || 'Map unknown'}</p><p className="mt-1 text-xs text-slate-500">Last played {opponent.lastPlayed}</p></article>)}</div>
      </section>}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left Side: Match Records Column */}
        <div className="lg:col-span-1 space-y-2 max-h-[750px] overflow-y-auto pr-1">
          {matches
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
            .map((m) => {
              const score = matchScore(m); const result = matchResult(m);
              const won = result === 'WIN';
              const resultClass = result === 'WIN' ? 'text-emerald-400' : result === 'LOSS' ? 'text-rose-400' : 'text-gray-400';
              const isSelected = selectedMatch?.id === m.id;

              return (
                <button
                  key={m.id}
                  onClick={() => { setSelectedMatch(m); onReviewContextChange?.(m.id, null); }}
                  className={`w-full text-left p-3.5 rounded-xl border transition-all flex flex-col gap-2 relative ${
                    isSelected
                      ? isLight ? 'border-slate-800 bg-slate-100 ring-2 ring-slate-100' : 'border-white bg-white/10 ring-2 ring-white/10'
                      : isLight ? 'border-slate-200 bg-white hover:bg-slate-50' : 'border-white/5 bg-white/5 hover:bg-white/10'
                  }`}
                >
                  <div className="flex justify-between items-center w-full">
                    <span className="text-xs text-gray-500 font-mono">{m.date}</span>
                    <span className="flex items-center gap-1.5">
                      <SourceChip kind={matchSource(m, data.playerStats)} />
                      <span className={`px-2 py-0.5 rounded text-xs font-black uppercase font-mono ${
                        m.type === 'Official' ? 'bg-rose-500/10 text-rose-400' : 'bg-slate-500/10 text-slate-400'
                      }`}>
                        {m.type}
                      </span>
                    </span>
                  </div>

                  <div className="flex justify-between items-baseline">
                    <span className="font-black tracking-tight text-sm truncate max-w-[110px]">{m.opponent}</span>
                    {score ? <span className="text-sm font-black font-mono">
                      <span className={result === 'DRAW' ? 'text-gray-300' : won ? 'text-emerald-400' : 'text-rose-400'}>{score.ours}</span>
                      <span className="text-gray-500"> - </span>
                      <span className={result === 'DRAW' ? 'text-gray-300' : won ? 'text-rose-400' : 'text-emerald-400'}>{score.theirs}</span>
                    </span> : <span className="text-xs font-mono text-gray-500">Score pending</span>}
                  </div>

                  <div className="flex justify-between items-center text-xs font-mono text-gray-400">
                    <span>{m.map}</span>
                    {result && <span className={`px-1.5 py-0.5 rounded-sm ${resultClass} font-black text-xs`} title={m.scoreEvidence ? 'Score read from the in-game HUD with the left side counted as yours. Edit the match if the sides are reversed.' : undefined}>
                      {result}{m.scoreEvidence && <span className="ml-1 font-normal text-gray-500">· HUD, sides unconfirmed</span>}
                    </span>}
                  </div>
                </button>
              );
            })}
          {matches.length === 0 && (
            <div className="p-8 text-center text-gray-500 text-xs font-mono border border-dashed border-white/10 rounded-xl">
              No matches recorded.
            </div>
          )}
          <RecentlyDeletedMatches isLight={isLight} refreshKey={matches.map(match => match.id).join(',')} onRestored={() => onRefreshDatabase?.()} />
        </div>

        {/* Right Side: Active Selected Match details (Tabs, Tables, Logs) */}
        <div className="lg:col-span-3 space-y-6">
          {selectedMatch ? (
            <div className={`p-5 rounded-2xl border ${isLight ? 'bg-white border-slate-200 text-slate-800 shadow-sm' : 'bg-white/5 border-white/10'} space-y-5`}>
              {(() => {
                const current = (data.matches || []).find(item => item.id === selectedMatch.id);
                return current ? <DuplicateReviewPanel data={data} match={current} isLight={isLight} onDecide={onDuplicateReview && (async (matchId, decision) => { await onDuplicateReview(matchId, decision); if (decision === 'discard-this') setSelectedMatch(null); })} onOpenMatch={(matchId) => { const target = (data.matches || []).find(item => item.id === matchId); if (target) { setSelectedMatch(target); onReviewContextChange?.(target.id, null); } }} /> : null;
              })()}
              {/* Selected Match Card Header */}
              <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 border-b border-white/5 pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2.5 py-0.5 rounded text-xs font-black uppercase font-mono bg-white/5 ${theme.text}`}>
                      {selectedMatch.type}
                    </span>
                    <span className="text-xs text-gray-500 font-mono">{selectedMatch.date}</span>
                    <span className="px-2 py-0.5 rounded text-xs uppercase font-black bg-cyan-500/10 text-cyan-300">
                      {selectedMatch.rosterContext?.kind || 'unclassified'} lineup
                    </span>
                    <SourceChip kind={matchSource(selectedMatch, data.playerStats)} />
                  </div>
                  <h4 className="text-xl font-black mt-1">Vs. {selectedMatch.opponent} on <span className={theme.text}>{selectedMatch.map}</span></h4>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleOpenEditMatch(selectedMatch)}
                    className="px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded border border-white/10 text-xs font-bold font-mono transition-colors"
                  >
                    Edit match
                  </button>
                  <button
                    onClick={() => handleDeleteMatch(selectedMatch.id)}
                    className="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded border border-rose-500/20 text-xs font-bold font-mono transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>

              {/* Match Splittings Indicators Row */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-black/10 p-4 rounded-xl border border-white/5 text-center font-mono text-xs">
                <div>
                  <p className="text-xs text-gray-500 uppercase font-black tracking-widest mb-1">SCORE</p>
                  <p className="text-lg font-black text-white">{(() => { const score = matchScore(selectedMatch); return score ? `${score.ours} - ${score.theirs}` : 'Pending'; })()}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 uppercase font-black tracking-widest mb-1">ATT SPLIT</p>
                  <p className="text-lg font-black text-amber-500">{sideSplit(selectedMatch.attW, selectedMatch.attL)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 uppercase font-black tracking-widest mb-1">DEF SPLIT</p>
                  <p className="text-lg font-black text-cyan-500">{sideSplit(selectedMatch.defW, selectedMatch.defL)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 uppercase font-black tracking-widest mb-1">Pistol ATT/DEF</p>
                  <p className="text-lg font-black">{[selectedMatch.pistolAtt, selectedMatch.pistolDef].map((value, index) => <React.Fragment key={index}>{index > 0 && <span className="text-gray-600"> / </span>}<span className={pistolResultClass(value)}>{pistolResultLabel(value)}</span></React.Fragment>)}</p>
                </div>
              </div>

              {/* Tabs for details */}
              <div className="flex gap-2 border-b border-white/10 pb-2 flex-wrap">
                {[
                  { id: 'matches', label: 'Scoreboard', icon: BarChart3 },
                  { id: 'rounds', label: 'Round Log', icon: FileText },
                  { id: 'vetos', label: 'Veto', icon: Shuffle },
                  { id: 'aiAnalysis', label: 'AI Coach Brief', icon: Sparkles }
                ].map((tb) => {
                  const Icon = tb.icon;
                  return (
                    <button
                      key={tb.id}
                      onClick={() => setActiveTab(tb.id as any)}
                      className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold font-mono border-b-2 transition-all ${
                        activeTab === tb.id
                          ? 'border-[#ff4655] text-white'
                          : 'border-transparent text-gray-400 hover:text-white'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      {tb.label}
                    </button>
                  );
                })}
              </div>

              {/* TAB CONTENT: PLAYER MATCH STATS */}
              {activeTab === 'matches' && (
                <div className="overflow-hidden rounded-2xl border border-cyan-300/15 bg-gradient-to-br from-cyan-400/[0.07] via-slate-950/70 to-violet-500/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_18px_50px_rgba(2,8,23,0.28)]">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.18em] text-white">Match scoreboard</p>
                      <p className="mt-0.5 text-xs text-slate-400">Each row shows where its numbers came from.</p>
                    </div>
                    <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2.5 py-1 text-xs font-black uppercase tracking-widest text-cyan-200">{statsForSelectedMatch.length} players</span>
                  </div>
                  <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse font-mono text-xs">
                    <thead>
                      <tr className="border-b border-white/10 bg-white/[0.025] text-gray-500 uppercase font-bold">
                        <th className="py-2 px-2.5">Player</th>
                        <th className="py-2 px-2.5">Agent</th>
                        <th className="py-2 px-2.5 text-center">K / D / A</th>
                        <th className="py-2 px-2.5 text-center">First bloods</th>
                        <th className="py-2 px-2.5 text-center">First deaths</th>
                        <th className="py-2 px-2.5 text-center">Plants</th>
                        <th className="py-2 px-2.5 text-center">Defuses</th>
                        <th className="py-2 px-2.5 text-center">HS%</th>
                        <th className="py-2 px-2.5 text-center">Orbs</th>
                        <th className="py-2 px-2.5 text-center">ACS</th>
                        <th className="py-2 px-2.5 text-center">ADR</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {statsForSelectedMatch.map((ps) => {
                        return (
                          <tr key={ps.id} className="hover:bg-cyan-300/[0.055] transition-colors">
                            <td className="py-3 px-2.5 font-bold text-white text-xs"><span className="mr-2 inline-block h-5 w-0.5 rounded-full bg-cyan-300 align-middle shadow-[0_0_10px_rgba(103,232,249,0.8)]" />{ps.displayNameSnapshot || ps.player} <SourceChip kind={entrySource(ps)} /></td>
                            <td className="py-3 px-2.5 text-gray-400">{ps.agent}</td>
                            <td className="py-3 px-2.5 text-center font-black text-slate-100">{ps.kills ?? '-'} <span className="text-gray-600">/</span> {ps.deaths ?? '-'} <span className="text-gray-600">/</span> {ps.assists ?? '-'}</td>
                            <td className="py-3 px-2.5 text-center text-rose-300">{ps.fk ?? '-'}</td>
                            <td className="py-3 px-2.5 text-center text-amber-300">{ps.fd ?? ps.screenshotMetrics?.firstDeaths ?? '-'}</td>
                            <td className="py-3 px-2.5 text-center text-violet-300">{ps.plants ?? '-'}</td>
                            <td className="py-3 px-2.5 text-center text-emerald-300">{ps.defuses ?? '-'}</td>
                            <td className="py-3 px-2.5 text-center text-amber-500" title={ps.headshots !== null && ps.headshots !== undefined && ps.headshotEligibleKills !== null && ps.headshotEligibleKills !== undefined ? `${ps.headshots}/${ps.headshotEligibleKills} eligible weapon kills` : undefined}>{ps.hs !== null && ps.hs !== undefined ? `${ps.hs}%` : '-'}</td>
                            <td className="py-3 px-2.5 text-center text-cyan-400">{ps.orbPoints ?? '-'}</td>
                            <td className="py-3 px-2.5 text-center font-bold">{ps.acs ?? '-'}</td>
                            <td className="py-3 px-2.5 text-center">{ps.adr ?? '-'}</td>
                          </tr>
                        );
                      })}
                      {statsForSelectedMatch.length === 0 && (
                        <tr>
                          <td colSpan={11} className="py-8 text-center text-gray-500">
                            No player stats logged for this match. Use Edit match to record them.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                  </div>
                </div>
              )}

              {/* TAB CONTENT: ROUND LOG */}
              {activeTab === 'rounds' && (
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-gray-500 uppercase font-black font-mono">
                      Round Logs ({roundsForSelectedMatch.length} rounds)
                    </span>
                    <button
                      onClick={handleOpenRoundEditor}
                      className="px-2.5 py-1 text-xs font-black bg-white/5 border border-white/10 rounded hover:bg-white/10 font-mono"
                    >
                      Edit round sheets
                    </button>
                  </div>

                  <div className="overflow-x-auto max-h-[450px] overflow-y-auto">
                    <table className="w-full text-left border-collapse font-mono text-xs">
                      <thead>
                        <tr className="border-b border-white/5 text-gray-500 uppercase font-bold sticky top-0 bg-[#0f1923] z-10">
                          <th className="py-2 px-2.5">No.</th>
                          <th className="py-2 px-2.5">Side</th>
                          <th className="py-2 px-2.5">Buy</th>
                          <th className="py-2 px-2.5 text-center">Result</th>
                          <th className="py-2 px-2.5">First kill</th>
                          <th className="py-2 px-2.5">First death</th>
                          <th className="py-2 px-2.5">Clutch Scenario</th>
                          <th className="py-2 px-2.5">Discipline / Throws</th>
                          <th className="py-2 px-2.5">IGL Strategy Caller</th>
                          <th className="py-2 px-2.5 text-center">Plant</th>
                          <th className="py-2 px-2.5 text-center">Site</th>
                          <th className="py-2 px-2.5">Notes</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {roundsForSelectedMatch.map((r) => (
                          <tr key={r.id} className="hover:bg-white/5 transition-colors">
                            <td className={`py-2 px-2.5 font-bold ${reviewRoundNo === r.roundNo ? 'text-cyan-300' : 'text-gray-400'}`}><button type="button" onClick={() => onReviewContextChange?.(selectedMatch.id, r.roundNo)} className="min-h-8 min-w-8 rounded hover:bg-white/5">{r.roundNo}</button>{onAcceptRoundEvidence && (r as any).screenshotEvidence && (r as any).screenshotEvidence.reviewStatus !== 'confirmed' && <button type="button" onClick={() => void onAcceptRoundEvidence(selectedMatch.id, r.roundNo).catch(() => {})} className="mt-1 block rounded border border-cyan-300/30 px-1 py-0.5 text-xs font-semibold text-cyan-200">Accept evidence</button>}</td>
                            <td className={`py-2 px-2.5 font-bold ${r.side === 'Att' ? 'text-amber-500' : 'text-cyan-400'}`}>{r.side}</td>
                            <td className="py-2 px-2.5">
                              <span className="text-white font-medium">{r.buy}</span>
                              <span className="text-xs text-gray-500 block">vs {r.enemyBuy || 'Full'}</span>
                            </td>
                            <td className="py-2 px-2.5 text-center">
                              <span className={`px-1.5 py-0.5 rounded text-xs font-black ${
                                r.result === 'W' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                              }`}>
                                {r.result}
                              </span>
                            </td>
                            <td className="py-2 px-2.5 text-xs text-emerald-400">{r.firstKillBy ? <span className="font-bold">{r.firstKillBy}</span> : <span className="text-gray-600">—</span>}</td>
                            <td className="py-2 px-2.5 text-xs text-rose-400">{r.firstDeathBy ? <span className="font-bold">{r.firstDeathBy}</span> : <span className="text-gray-600">—</span>}</td>
                            <td className="py-2 px-2.5">
                              {r.clutchType ? (
                                <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${
                                  r.clutchResult === 'W' ? 'bg-amber-500/10 text-amber-400' : 'bg-gray-500/10 text-gray-400'
                                }`}>
                                  {r.clutchPlayer} in {r.clutchType} ({r.clutchResult === 'W' ? 'WON' : 'LOST'})
                                </span>
                              ) : (
                                <span className="text-gray-600 italic">-</span>
                              )}
                            </td>
                            <td className="py-2 px-2.5">
                              {roundFlag(r.isThrow) === true ? (
                                <span className="bg-rose-500/10 border border-rose-500/20 text-rose-400 p-1 px-2 rounded text-xs block font-bold" title={r.throwReason}>
                                  ⚠️ Choked: {r.thrownBy || 'Team'} ({r.throwReason || 'Advantage throw'})
                                </span>
                              ) : roundFlag(r.isThrow) === false ? (
                                <span className="text-emerald-500/80 font-bold text-xs">✓ Clean</span>
                              ) : (
                                <span className="text-gray-600 italic text-xs">—</span>
                              )}
                            </td>
                            <td className="py-2 px-2.5 font-bold">
                              <div className="flex flex-col gap-1">
                                {r.iglPlayer && r.iglPlayer !== 'None' ? (
                                  <span className="text-violet-400 text-xs flex items-center gap-1">
                                    <span>{r.iglPlayer} ({r.iglRole || 'Caller'})</span>
                                    {(r.midRoundIglChange === true || r.midRoundIglChange === 'TRUE') && (
                                      <span className="text-xs bg-white/5 border border-white/10 px-1 py-0.2 rounded text-white flex items-center gap-0.5" title="Mid-round strategy correction/change">
                                        🔄 Mid
                                      </span>
                                    )}
                                  </span>
                                ) : (
                                  <span className="text-gray-600 italic text-xs">-</span>
                                )}
                                {r.strategies && (
                                  <div className="flex flex-wrap gap-1 mt-1">
                                    {r.strategies.split(', ').map(st => (
                                      <span key={st} className="bg-violet-500/15 border border-violet-500/20 text-violet-300 text-xs px-1.5 py-0.5 rounded font-mono">
                                        🎯 {st}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </td>
                            <td className="py-2 px-2.5 text-center">{roundFlag(r.plant) === true ? 'Yes' : roundFlag(r.plant) === false ? 'No' : '—'}</td>
                            <td className="py-2 px-2.5 text-center font-bold">{r.site || '-'}</td>
                            <td className="py-2 px-2.5 text-gray-500 max-w-[150px] truncate" title={r.notes}>{r.notes || '-'}</td>
                          </tr>
                        ))}
                        {roundsForSelectedMatch.length === 0 && (
                          <tr>
                            <td colSpan={11} className="py-8 text-center text-gray-500">
                              No round sheets logged. Use the button above, or record the next match live, round by round.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB CONTENT: VETO LOG */}
              {activeTab === 'vetos' && (
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-gray-500 uppercase font-black font-mono">
                      Veto Draft Process ({vetosForSelectedMatch.length} steps)
                    </span>
                    <button
                      onClick={handleOpenVetoEditor}
                      className="px-2.5 py-1 text-xs font-black bg-white/5 border border-white/10 rounded hover:bg-white/10 font-mono"
                    >
                      Edit vetoes
                    </button>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse font-mono text-xs">
                      <thead>
                        <tr className="border-b border-white/5 text-gray-500 uppercase font-bold">
                          <th className="py-2 px-2.5">Seq</th>
                          <th className="py-2 px-2.5">Actor</th>
                          <th className="py-2 px-2.5">Action</th>
                          <th className="py-2 px-2.5">Map</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {vetosForSelectedMatch.map((v) => (
                          <tr key={v.id} className="hover:bg-white/5 transition-colors">
                            <td className="py-2 px-2.5 text-gray-400 font-bold">{v.seq}</td>
                            <td className={`py-2 px-2.5 font-bold ${v.actor === 'us' ? theme.text : 'text-gray-400'}`}>
                              {v.actor === 'us' ? 'US' : v.actor === 'them' ? 'OPPONENT' : 'DECIDER'}
                            </td>
                            <td className="py-2 px-2.5 uppercase font-black tracking-tighter">{v.action}</td>
                            <td className="py-2 px-2.5 font-bold text-white text-xs">{v.map}</td>
                          </tr>
                        ))}
                        {vetosForSelectedMatch.length === 0 && (
                          <tr>
                            <td colSpan={4} className="py-8 text-center text-gray-500">
                              No veto records logged. Use the editor to record the draft sequence!
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB CONTENT: AI COACH BRIEF & BROADCAST */}
              {activeTab === 'aiAnalysis' && (
                <MatchCoachBrief selectedMatch={selectedMatch} setSelectedMatch={setSelectedMatch} onRefreshDatabase={onRefreshDatabase} />
              )}
            </div>
          ) : (
            <div className="py-20 text-center text-gray-500 font-mono text-xs border border-dashed border-white/10 rounded-2xl">
              No match selected. Select a match on the left panel or record a new one.
            </div>
          )}
        </div>
      </div>

      {/* --- MATCH LOG MODAL --- */}
      {matchModalOpen && editingMatch && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 overflow-y-auto animate-fadeIn">
          <form ref={matchDialogRef} role="dialog" aria-modal="true" aria-label="Match details" onSubmit={handleSaveMatchSubmit} className={`w-full max-w-4xl p-6 rounded-2xl border ${isLight ? 'bg-white text-slate-800 border-slate-200' : 'bg-[#0f1923] text-white border-white/10'} space-y-6 max-h-[90vh] overflow-y-auto`}>
            <div className="flex justify-between items-center border-b border-white/10 pb-3">
              <h4 className="text-lg font-black tracking-tight uppercase">
                {editingMatch.id ? 'EDIT MATCH DATA' : 'RECORD SCRIM/MATCH'}
              </h4>
              <button
                type="button"
                aria-label="Close match details"
                onClick={() => setMatchModalOpen(false)}
                className="text-gray-400 hover:text-white font-bold"
              >
                ✕
              </button>
            </div>

            <RosterContextSelector
              data={data}
              value={editingMatch.rosterContext || { kind: 'unclassified' }}
              allowUnclassified={!!editingMatch.id}
              onChange={changeRosterContext}
            />

            {/* General details */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="space-y-1">
                <label className="text-xs uppercase font-black text-gray-400 font-mono">Date</label>
                <input
                  type="date"
                  aria-label="Match date"
                  required
                  value={editingMatch.date}
                  onChange={e => setEditingMatch({ ...editingMatch, date: e.target.value })}
                  className="w-full p-2 bg-black/20 rounded border border-white/10 text-xs font-mono text-white"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs uppercase font-black text-gray-400 font-mono">Match Type</label>
                <select
                  value={editingMatch.type}
                  aria-label="Match type"
                  onChange={e => setEditingMatch({ ...editingMatch, type: e.target.value })}
                  className="w-full p-2 bg-black/20 rounded border border-white/10 text-xs text-white"
                >
                  {matchTypes.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs uppercase font-black text-gray-400 font-mono">Opponent Team</label>
                <input
                  type="text"
                  list="match-log-opponents"
                  required
                  placeholder="Opponent name"
                  aria-label="Opponent team"
                  value={editingMatch.opponent}
                  onChange={e => setEditingMatch({ ...editingMatch, opponent: e.target.value })}
                  className="w-full p-2 bg-black/20 rounded border border-white/10 text-xs text-white"
                />
                <datalist id="match-log-opponents">{opponentHistory.map(opponent => <option key={opponent.key} value={opponent.name}>{opponent.games} recorded game{opponent.games === 1 ? '' : 's'}</option>)}</datalist>
              </div>

              <div className="space-y-1">
                <label className="text-xs uppercase font-black text-gray-400 font-mono">Opponent Category</label>
                <input type="text" maxLength={100} placeholder="Optional · academy, tier 2, mixed…" aria-label="Opponent category" value={editingMatch.opponentCategory || ''} onChange={e => setEditingMatch({ ...editingMatch, opponentCategory: e.target.value || undefined })} className="w-full p-2 bg-black/20 rounded border border-white/10 text-xs text-white" />
              </div>

              <div className="space-y-1">
                <label className="text-xs uppercase font-black text-gray-400 font-mono">Map Selected</label>
                <select
                  required
                  value={editingMatch.map}
                  aria-label="Map selected"
                  onChange={e => setEditingMatch({ ...editingMatch, map: e.target.value })}
                  className="w-full p-2 bg-black/20 rounded border border-white/10 text-xs text-white"
                >
                  <option value="" disabled>Choose map…</option>
                  {maps.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>

            {/* Score splits */}
            <div className="space-y-2 border-y border-white/5 py-4">
              <h5 className="text-xs uppercase font-black tracking-widest text-gray-400 font-mono">Round Splits & Results</h5>
              {editingMatch.sourceMetadata?.method === 'screenshot' && (
                <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3">
                  <p className="text-xs text-cyan-100">Screenshot-prefilled K/D/A is retained as OCR evidence. Fill the missing map and final score, then confirm which side was your team.</p>
                  <div className="mt-2 grid grid-cols-2 gap-3">
                    <label className="text-xs font-bold uppercase text-gray-400">Our final score<input required type="number" min={0} value={editingMatch.ourScore ?? ''} onChange={e => setEditingMatch({ ...editingMatch, ourScore: e.target.value === '' ? null : Number(e.target.value) })} className="mt-1 w-full rounded border border-white/10 bg-black/20 p-2 text-white" /></label>
                    <label className="text-xs font-bold uppercase text-gray-400">Their final score<input required type="number" min={0} value={editingMatch.theirScore ?? ''} onChange={e => setEditingMatch({ ...editingMatch, theirScore: e.target.value === '' ? null : Number(e.target.value) })} className="mt-1 w-full rounded border border-white/10 bg-black/20 p-2 text-white" /></label>
                  </div>
                  <label className="mt-3 flex items-start gap-2 text-xs text-slate-200"><input required type="checkbox" checked={editingMatch.reviewConfirmation?.alliedSideConfirmed === true} onChange={e => setEditingMatch({ ...editingMatch, reviewConfirmation: e.target.checked ? { alliedSideConfirmed: true } as any : undefined })} className="mt-0.5 h-4 w-4 accent-cyan-500" /><span>I confirmed which scoreboard side belongs to our team and reviewed the manually completed fields.</span></label>
                </div>
              )}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="space-y-1">
                  <label className="text-xs uppercase font-bold text-amber-500 font-mono">ATT Wins</label>
                  <input
                    type="number"
                    min={0}
                    value={editingMatch.attW ?? ''}
                    onChange={e => setEditingMatch({ ...editingMatch, attW: e.target.value === '' ? null : Number(e.target.value) })}
                    className="w-full p-2 bg-black/20 rounded border border-white/10 text-xs font-mono text-white"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs uppercase font-bold text-amber-500 font-mono">ATT Losses</label>
                  <input
                    type="number"
                    min={0}
                    value={editingMatch.attL ?? ''}
                    onChange={e => setEditingMatch({ ...editingMatch, attL: e.target.value === '' ? null : Number(e.target.value) })}
                    className="w-full p-2 bg-black/20 rounded border border-white/10 text-xs font-mono text-white"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs uppercase font-bold text-cyan-400 font-mono">DEF Wins</label>
                  <input
                    type="number"
                    min={0}
                    value={editingMatch.defW ?? ''}
                    onChange={e => setEditingMatch({ ...editingMatch, defW: e.target.value === '' ? null : Number(e.target.value) })}
                    className="w-full p-2 bg-black/20 rounded border border-white/10 text-xs font-mono text-white"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs uppercase font-bold text-cyan-400 font-mono">DEF Losses</label>
                  <input
                    type="number"
                    min={0}
                    value={editingMatch.defL ?? ''}
                    onChange={e => setEditingMatch({ ...editingMatch, defL: e.target.value === '' ? null : Number(e.target.value) })}
                    className="w-full p-2 bg-black/20 rounded border border-white/10 text-xs font-mono text-white"
                  />
                </div>
              </div>

              {/* Special Indicator Rows (Pistol, Eco, Bonus) */}
              <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 pt-2 text-xs font-mono">
                {['pistolAtt', 'pistolDef', 'ecoAtt', 'ecoDef', 'bonusAtt', 'bonusDef'].map((indKey) => (
                  <div key={indKey} className="space-y-1">
                    <span className="text-xs uppercase font-bold text-gray-500 block truncate">{indKey}</span>
                    <select
                      value={(editingMatch as any)[indKey]}
                      onChange={e => setEditingMatch({ ...editingMatch, [indKey]: e.target.value })}
                      className="w-full p-1.5 bg-black/25 text-white border border-white/10 rounded"
                    >
                      <option value="W">W (Won)</option>
                      <option value="L">L (Lost)</option>
                      <option value="">N/A</option>
                    </select>
                  </div>
                ))}
              </div>
            </div>

            {/* Player Performance inputs */}
            <div className="space-y-3">
              {unmappedScreenshotRows.length > 0 && <fieldset disabled={creatingScreenshotPlayer} className="rounded-xl border border-amber-400/30 p-3 space-y-3" aria-label="Unmapped screenshot rows">
                <h5 className="text-sm font-semibold">Review remaining screenshot players</h5>
                <p className="text-sm text-slate-300">Map teammates to a roster identity, create a new teammate, or exclude opponents. Correct OCR spelling before creating a player. New players are not automatically added to your core.</p>
                {screenshotMappingError && <p role="alert" className="text-sm text-rose-300">{screenshotMappingError}</p>}
                {unmappedScreenshotRows.map((row, index) => <div key={index} className="flex flex-wrap items-center gap-2">
                  <input aria-label={`Correct screenshot name ${index + 1}`} className="ui-field min-h-11 px-2" value={row.correctedName ?? row.extractedName ?? ''} onChange={event => setUnmappedScreenshotRows(old => old.map((item, i) => i === index ? { ...item, correctedName: event.target.value } : item))} />
                  <span className="text-sm">{row.kills ?? '—'}/{row.deaths ?? '—'}/{row.assists ?? '—'}</span>
                  <button type="button" disabled={creatingScreenshotPlayer || !(row.correctedName ?? row.extractedName ?? '').trim()} className="ui-button min-h-11 px-3" onClick={async () => {
                    setCreatingScreenshotPlayer(true); setScreenshotMappingError('');
                    try {
                      const response = await apiFetch('/api/roster/players', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: (row.correctedName ?? row.extractedName).trim() }) });
                      const player = await response.json(); if (!response.ok) throw new Error(player.error || 'Could not create player.');
                      setEditingStats(old => [...old, { id: '', matchId: '', player: player.displayName, playerId: player.id, displayNameSnapshot: player.displayName, appearanceType: 'standIn', agent: row.agent || '', kAtt: null, kDef: null, dAtt: null, dDef: null, aAtt: null, aDef: null, kills: row.kills, deaths: row.deaths, assists: row.assists, sourceMetadata: editingMatch.sourceMetadata }]);
                      setEditingMatch(old => old ? { ...old, rosterContext: { kind: 'mixed', tryoutBatchId: old.rosterContext?.tryoutBatchId } } : old);
                      setUnmappedScreenshotRows(old => old.filter((_, i) => i !== index));
                      await onRefreshDatabase();
                    } catch (error: any) { setScreenshotMappingError(error.message || 'Could not create player.'); }
                    finally { setCreatingScreenshotPlayer(false); }
                  }}>Create teammate</button>
                  <select aria-label={`Map screenshot player ${row.extractedName || index + 1}`} className="ui-field min-h-11 px-2" value="" onChange={event => {
                    const player = knownPlayers.find(item => item.id === event.target.value); if (!player) return;
                    const existing = editingStats.find(item => item.playerId === player.id);
                    if (existing && [existing.kills, existing.deaths, existing.assists].some(value => value !== null && value !== undefined)) { notify('This teammate already has scores. Remove their current match row before assigning another screenshot row.'); return; }
                    setEditingStats(old => [...old.filter(item => item.playerId !== player.id), { id: '', matchId: '', player: player.displayName, playerId: player.id, displayNameSnapshot: player.displayName, appearanceType: tryoutPhase?.candidatePlayerIds.includes(player.id) ? 'tryout' : activeCoreIds.has(player.id) ? 'core' : 'standIn', agent: row.agent || '', kAtt: null, kDef: null, dAtt: null, dDef: null, aAtt: null, aDef: null, kills: row.kills, deaths: row.deaths, assists: row.assists, sourceMetadata: editingMatch.sourceMetadata }]);
                    setEditingMatch(old => old ? { ...old, rosterContext: { kind: 'mixed', tryoutBatchId: old.rosterContext?.tryoutBatchId } } : old);
                    setUnmappedScreenshotRows(old => old.filter((_, i) => i !== index));
                  }}><option value="">Choose teammate…</option>{knownPlayers.filter(player => !player.retiredAt).map(player => <option key={player.id} value={player.id}>{player.displayName}</option>)}</select>
                  <button type="button" className="ui-button min-h-11 px-3" onClick={() => setUnmappedScreenshotRows(old => old.filter((_, i) => i !== index))}>Exclude opponent / unused row</button>
                </div>)}
              </fieldset>}
              <h5 className="text-xs uppercase font-black tracking-widest text-gray-400 font-mono border-b border-white/5 pb-1">
                Individual Performance Metrics
              </h5>
              {(editingMatch.rosterContext?.kind || 'unclassified') !== 'unclassified' && (
                <div className="flex gap-2">
                  <select value={newAppearancePlayerId} onChange={event => setNewAppearancePlayerId(event.target.value)} className="flex-1 p-2 bg-black/20 rounded border border-white/10 text-xs text-white">
                    <option value="">Add a known roster identity…</option>
                    {knownPlayers.filter(player => !player.retiredAt && !editingStats.some(stat => stat.playerId === player.id)).map(player => (
                      <option key={player.id} value={player.id}>{player.displayName}</option>
                    ))}
                  </select>
                  <button type="button" onClick={addAppearance} disabled={!newAppearancePlayerId} className="px-3 py-2 bg-cyan-600 rounded text-xs font-bold disabled:opacity-50">Add appearance</button>
                </div>
              )}
              <div className="space-y-3">
                {editingStats.map((st, sIdx) => (
                  <div key={sIdx} className="grid grid-cols-2 sm:grid-cols-11 gap-2 bg-black/10 p-3 rounded-lg border border-white/5 items-center font-mono text-xs text-white">
                    <div className="sm:col-span-2 space-y-1">
                      <div className="font-black text-xs truncate text-white">{st.displayNameSnapshot || st.player}</div>
                      <button type="button" className="min-h-9 text-xs text-rose-300" onClick={() => setEditingStats(old => old.filter((_, index) => index !== sIdx))}>Remove from this match</button>
                      {(editingMatch.rosterContext?.kind || 'unclassified') !== 'unclassified' && (
                        <>
                          <select
                            aria-label={`Roster identity for ${st.player}`}
                            value={st.playerId || ''}
                            onChange={event => {
                              const player = knownPlayers.find(entry => entry.id === event.target.value);
                              const updated = [...editingStats];
                              updated[sIdx] = { ...updated[sIdx], playerId: player?.id, player: player?.displayName || st.player, displayNameSnapshot: player?.displayName };
                              setEditingStats(updated);
                            }}
                            className="w-full p-1 bg-black text-white border border-white/10 rounded"
                          >
                            <option value="">Select identity…</option>
                            {knownPlayers.map(player => <option key={player.id} value={player.id}>{player.displayName}</option>)}
                          </select>
                          <select
                            value={st.appearanceType || ''}
                            required
                            onChange={event => {
                              const updated = [...editingStats];
                              updated[sIdx] = { ...updated[sIdx], appearanceType: event.target.value as AppearanceType };
                              setEditingStats(updated);
                            }}
                            className="w-full p-1 bg-black text-white border border-white/10 rounded"
                          >
                            <option value="" disabled>Choose appearance…</option>
                            <option value="core">Core</option>
                            <option value="tryout">Tryout</option>
                            <option value="standIn">Stand-in</option>
                          </select>
                        </>
                      )}
                    </div>
                    
                    {/* Agent select */}
                    <div className="sm:col-span-2">
                      <select
                        value={st.agent}
                        onChange={(e) => {
                          const updated = [...editingStats];
                          updated[sIdx].agent = e.target.value;
                          setEditingStats(updated);
                        }}
                        className="w-full p-1 bg-black text-white border border-white/10 rounded"
                      >
                        <option value="">Choose agent…</option>
                        {agents.map(a => <option key={a} value={a}>{a}</option>)}
                      </select>
                      <input type="text" maxLength={100} aria-label={`${st.displayNameSnapshot || st.player} role context`} placeholder="Role context (optional)" value={st.roleSnapshot || ''} onChange={event => { const updated=[...editingStats]; updated[sIdx]={...updated[sIdx],roleSnapshot:event.target.value||undefined}; setEditingStats(updated); }} className="mt-1 w-full p-1 bg-black text-white border border-white/10 rounded" />
                    </div>

                    {/* Numeric fields */}
                    {[
                      { label: 'Kills', key: 'kills' },
                      { label: 'Deaths', key: 'deaths' },
                      { label: 'Assists', key: 'assists' },
                      { label: 'ACS', key: 'acs' },
                      { label: 'ADR', key: 'adr' },
                      { label: 'HS%', key: 'hs' },
                      { label: 'ORBS', key: 'orbPoints' },
                      { label: 'FB', key: 'fk' },
                      { label: 'FD', key: 'fd' },
                      { label: 'PLANTS', key: 'plants' },
                      { label: 'DEFUSES', key: 'defuses' },
                      { label: 'ATT K', key: 'kAtt' },
                      { label: 'ATT D', key: 'dAtt' },
                      { label: 'DEF K', key: 'kDef' },
                      { label: 'DEF D', key: 'dDef' }
                    ].map((f) => (
                      <div key={f.key}>
                        <span className="text-xs text-gray-300 block">{f.label}</span>
                        <input
                          type="number"
                          aria-label={`${st.displayNameSnapshot || st.player} ${f.label}`}
                          min={0}
                          max={f.key === 'hs' ? 100 : undefined}
                          step={f.key === 'hs' ? 0.01 : 1}
                          value={(st as any)[f.key] ?? ''}
                          onChange={(e) => {
                            const updated = [...editingStats];
                            (updated[sIdx] as any)[f.key] = e.target.value === '' ? null : Number(e.target.value);
                            setEditingStats(updated);
                          }}
                          className="w-full p-1 bg-black/40 text-center border border-white/5 rounded text-white"
                        />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-4 flex justify-end gap-2 border-t border-white/10">
              <button
                type="button"
                onClick={() => setMatchModalOpen(false)}
                className="px-4 py-2 bg-slate-500/10 hover:bg-slate-500/20 text-xs font-bold rounded cursor-pointer text-gray-400 hover:text-white font-mono"
              >
                Cancel
              </button>
              <button
                type="submit"
                className={`px-4 py-2 ${theme.primaryBg} text-xs font-bold rounded cursor-pointer text-white font-mono`}
              >
                Save match details
              </button>
            </div>
          </form>
        </div>
      )}

      {/* --- ROUND LOG SHEET EDITOR --- */}
      {roundEditorOpen && selectedMatch && (
        <RoundSheetEditor selectedMatch={selectedMatch} activeRounds={activeRounds} setActiveRounds={setActiveRounds} setRoundEditorOpen={setRoundEditorOpen} handleSaveRounds={handleSaveRounds} data={data} players={players} buyTypes={buyTypes} winReasons={winReasons} sites={sites} isLight={isLight} theme={theme} />
      )}

      {/* --- VETO LOG EDITOR --- */}
      {vetoEditorOpen && selectedMatch && (
        <VetoEditor selectedMatch={selectedMatch} activeVetos={activeVetos} setActiveVetos={setActiveVetos} setVetoEditorOpen={setVetoEditorOpen} handleSaveVetoSubmit={handleSaveVetoSubmit} maps={maps} vetoActions={vetoActions} isLight={isLight} theme={theme} />
      )}

    </div>
  );
}
