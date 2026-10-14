import React, { useEffect, useRef, useState } from 'react';
import { EntrySourceMetadata, MatchStatsUpdate, TrackerData } from '../types';
import { apiFetch } from '../utils/api';
import { Sparkles, Upload, X, Loader2, CheckCircle, Image as ImageIcon } from 'lucide-react';
import { canCommitScreenshotReview, matchExtractedRosterName } from '../../lib/entryEngine';
import { reportDesktopDiagnostic } from '../utils/desktopDiagnostics';
import { createBrowserLocalTesseractAdapter, createValorantEndScreenProfile, createValorantRoundSummaryProfile, extractLocalScoreboardDraft } from '../../lib/localOcrEngine';
import { parseLocalRoundRecognitions } from '../../lib/localRoundOcrEngine';
import { classifyValorantRoundEvents } from '../../lib/localRoundEventClassifier';
import { canonicalScoreboardName, cleanCaptureDisplayName, cleanCaptureMap, inferAlliedScoreboardNames, normalizeCaptureName, scoreFromCompleteRounds } from '../../lib/scrimCaptureImport';
import { classifyAverageLoadout, classifyTeamEquipment } from '../../lib/scrimRoundAnalytics';
import { classifyValorantScoreboardAgents } from '../../lib/localAgentClassifier';

interface Props {
  data: TrackerData;
  theme: any;
  onSaveMatch: (match: any, statsUpdate: MatchStatsUpdate) => Promise<any>;
  onSaveRounds: (matchId: string, rows: any[]) => Promise<void>;
  onClose: () => void;
}

const toB64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('Could not read the image.'));
    r.readAsDataURL(file);
  });

const num = (v: any) => (v === null || v === undefined || v === '' ? undefined : Number(v));

const imageFromBase64 = async (base64: string, mediaType: string) => {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || !base64.length) throw new Error('The captured image payload is invalid.');
  const image = new Image();
  image.src = `data:${mediaType};base64,${base64}`;
  await image.decode();
  return image;
};

export default function ScrimImport({ data, theme, onSaveMatch, onSaveRounds, onClose }: Props) {
  const roster = data.settings?.players || [];
  const agents = data.settings?.agents || [];
  const [scoreboard, setScoreboard] = useState<File | null>(null);
  const [timeline, setTimeline] = useState<File | null>(null);
  const [step, setStep] = useState<'upload' | 'processing' | 'review'>('upload');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [captureProgress, setCaptureProgress] = useState('');
  const [pendingCaptureId, setPendingCaptureId] = useState<string | null>(null);

  // Editable review model
  const [meta, setMeta] = useState({ opponent: '', type: 'Scrim', date: new Date().toISOString().slice(0, 10), map: '', ourScore: null as number | null, theirScore: null as number | null, firstHalf: 'Att' as 'Att' | 'Def' });
  const [players, setPlayers] = useState<any[]>([]);
  const [rounds, setRounds] = useState<any[]>([]);
  const [sourceMetadata, setSourceMetadata] = useState<EntrySourceMetadata | undefined>();
  const [alliedSideConfirmed, setAlliedSideConfirmed] = useState(false);
  const autoLoadStarted = useRef(false);
  const roundsComplete = rounds.every(round => round.result === 'W' || round.result === 'L');

  const sideForRound = (roundNo: number, firstHalf: 'Att' | 'Def') => {
    const opp = firstHalf === 'Att' ? 'Def' : 'Att';
    if (roundNo <= 12) return firstHalf;
    if (roundNo <= 24) return opp;
    return roundNo % 2 === 1 ? firstHalf : opp; // OT alternates
  };

  const runImport = async () => {
    if (!scoreboard) return;
    setStep('processing');
    setError(null);
    try {
      const body: any = { scoreboard: { base64: await toB64(scoreboard), mediaType: scoreboard.type || 'image/png' } };
      if (timeline) body.timeline = { base64: await toB64(timeline), mediaType: timeline.type || 'image/png' };
      const res = await apiFetch('/api/import-scrim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || json.details || 'Import failed.');

      setMeta((m) => ({
        ...m,
        map: json.match?.map || '',
        ourScore: json.match?.ourScore ?? null,
        theirScore: json.match?.theirScore ?? null,
      }));
      // Keep only players matched to our roster by default; coach can adjust.
      setPlayers((json.stats || []).map((p: any) => ({ ...p, include: !!p.matchedPlayerName })));
      setRounds(json.rounds || []);
      setSourceMetadata(json.sourceMetadata);
      setAlliedSideConfirmed(false);
      setStep('review');
    } catch (err: any) {
      const code = await reportDesktopDiagnostic('scrim-import-extraction', err);
      setError(`${err.message || 'Import failed.'}${code ? ` Error code: ${code}` : ''}`);
      setStep('upload');
    }
  };

  const loadLatestCapture = async () => {
    if (!window.moeDesktop) return;
    setStep('processing'); setError(null); setCaptureProgress('Finding the latest complete capture…');
    let adapter: Awaited<ReturnType<typeof createBrowserLocalTesseractAdapter>> | null = null;
    try {
      const available = (await window.moeDesktop.listScoreboards()).filter(item => item.capture);
      const record = available.at(-1);
      if (!record) throw new Error('No complete capture session is waiting. Run the one-button capture after a match, then try again.');
      const session = await window.moeDesktop.readCaptureSession(record.id);
      const scoreboardCapture = session.captures.find(item => item.kind === 'scoreboard');
      if (!scoreboardCapture) throw new Error('The capture session has no scoreboard image.');
      const rosterPlayers: Array<{ id?: string; displayName: string }> = data.rosterPlayers?.length
        ? data.rosterPlayers.map(player => ({ id: player.id, displayName: player.displayName }))
        : roster.map(displayName => ({ displayName }));
      adapter = await createBrowserLocalTesseractAdapter();
      setCaptureProgress('Reading the final scoreboard locally…');
      const scoreboardImage = await imageFromBase64(scoreboardCapture.base64, scoreboardCapture.mediaType);
      const scoreboardProfile = createValorantEndScreenProfile(scoreboardImage.naturalWidth, scoreboardImage.naturalHeight);
      const draft = await extractLocalScoreboardDraft(adapter, scoreboardImage, scoreboardProfile.dimensions, { capturedAt: new Date().toISOString(), rosterPlayers }, scoreboardProfile);
      setCaptureProgress('Identifying agent portraits locally…');
      const detectedAgents = await classifyValorantScoreboardAgents(scoreboardImage).catch(() => Array<string | null>(10).fill(null));
      draft.stats = draft.stats.map((player, index) => ({ ...player, agent: detectedAgents[index] || player.agent }));
      const roundCaptures = session.captures.filter(item => item.kind === 'round' && Number.isInteger(item.round)).sort((a, b) => Number(a.round) - Number(b.round));
      const extractedRounds = [];
      for (let index = 0; index < roundCaptures.length; index += 1) {
        const capture = roundCaptures[index];
        setCaptureProgress(`Reading round ${capture.round} locally · ${index + 1} of ${roundCaptures.length}`);
        const image = await imageFromBase64(capture.base64, capture.mediaType);
        const profile = createValorantRoundSummaryProfile(image.naturalWidth, image.naturalHeight);
        const parsed = parseLocalRoundRecognitions(await adapter.recognize(image, profile), capture.name);
        const eventPlayers = parsed.evidence.players.map(player => {
          const canonical = canonicalScoreboardName(player.displayName, draft.stats);
          const scoreboardPlayer = draft.stats.find(candidate => normalizeCaptureName(candidate.extractedName) === normalizeCaptureName(canonical));
          return { ...player, agent: scoreboardPlayer?.agent || null };
        });
        // Tesseract can occasionally miss the bottom scoreboard name while
        // the portrait is still perfectly visible. Restore that tenth row
        // from the final scoreboard so event/FK/FD matching stays automatic.
        if (eventPlayers.length >= 8 && eventPlayers.length < 10) {
          const present = new Set(eventPlayers.map(player => normalizeCaptureName(canonicalScoreboardName(player.displayName, draft.stats))));
          const missing = draft.stats.filter(player => !present.has(normalizeCaptureName(player.extractedName)));
          const ours = eventPlayers.filter(player => player.team === 'ours').length;
          const theirs = eventPlayers.filter(player => player.team === 'theirs').length;
          const shortTeam = ours === 5 && theirs < 5 ? 'theirs' : theirs === 5 && ours < 5 ? 'ours' : null;
          if (shortTeam && missing.length === 10 - eventPlayers.length) for (const player of missing) eventPlayers.push({
            displayName: player.extractedName,
            team: shortTeam,
            agent: player.agent || null,
          });
        }
        const eventClassification = await classifyValorantRoundEvents(image, eventPlayers);
        parsed.evidence.events = eventClassification.events;
        parsed.evidence.eventsComplete = eventClassification.complete;
        if (!eventClassification.complete) parsed.issues = [...new Set([...parsed.issues, 'event-log'])];
        parsed.evidence.players = parsed.evidence.players.map(player => {
          if (player.team !== 'ours') return player;
          const matched = matchExtractedRosterName(player.displayName, rosterPlayers);
          return { ...player, playerId: matched.rosterMatch.status === 'matched' ? matched.matchedPlayerId : null };
        });
        extractedRounds.push({ roundNo: capture.round!, result: parsed.result || '', winBy: '', screenshotEvidence: parsed.evidence, extractionIssues: parsed.issues });
      }
      const completeScore = scoreFromCompleteRounds(extractedRounds);
      setMeta(current => ({ ...current, map: cleanCaptureMap(draft.match.map), ourScore: completeScore?.ourScore ?? draft.match.ourScore, theirScore: completeScore?.theirScore ?? draft.match.theirScore }));
      const alliedNames = inferAlliedScoreboardNames(draft.stats, extractedRounds);
      const resolvedPlayers = draft.stats.map(player => ({
        ...player,
        extractedName: cleanCaptureDisplayName(player.extractedName),
        include: player.rosterMatch.status === 'matched' || alliedNames.has(normalizeCaptureName(player.extractedName)),
      }));
      // Stabilize OCR variants across all round images so economy/weapon
      // summaries attach to the same five match-stat rows.
      for (const round of extractedRounds) {
        const identities = new Map<string, string>();
        round.screenshotEvidence.players = round.screenshotEvidence.players.map(player => {
          const originalIdentity = player.playerId || `name:${player.displayName.trim().toLocaleLowerCase()}`;
          const displayName = canonicalScoreboardName(player.displayName, resolvedPlayers);
          const matched = matchExtractedRosterName(displayName, rosterPlayers);
          const playerId = matched.rosterMatch.status === 'matched' && matched.matchedPlayerId
            ? matched.matchedPlayerId
            : `name:${normalizeCaptureName(displayName)}`;
          identities.set(originalIdentity, playerId);
          return { ...player, displayName, playerId };
        });
        round.screenshotEvidence.events = (round.screenshotEvidence.events || []).map(event => ({
          ...event,
          killerPlayerId: event.killerPlayerId ? identities.get(event.killerPlayerId) || event.killerPlayerId : null,
          victimPlayerId: event.victimPlayerId ? identities.get(event.victimPlayerId) || event.victimPlayerId : null,
        }));
      }
      const firstDeaths = new Map<string, number>();
      for (const round of extractedRounds) {
        const first = round.screenshotEvidence.events?.[0];
        if (first?.victimTeam === 'ours' && first.victimPlayerId) firstDeaths.set(first.victimPlayerId, (firstDeaths.get(first.victimPlayerId) || 0) + 1);
      }
      for (const player of resolvedPlayers) {
        const matched = matchExtractedRosterName(player.extractedName, rosterPlayers);
        const identity = matched.rosterMatch.status === 'matched' && matched.matchedPlayerId ? matched.matchedPlayerId : `name:${normalizeCaptureName(player.extractedName)}`;
        player.fd = firstDeaths.get(identity) || 0;
      }
      setPlayers(resolvedPlayers);
      setRounds(extractedRounds);
      setSourceMetadata(draft.sourceMetadata);
      setPendingCaptureId(record.id);
      setAlliedSideConfirmed(false);
      setStep('review');
    } catch (err: any) {
      const code = await reportDesktopDiagnostic('capture-session-extraction', err);
      setError(`${err.message || 'The capture session could not be read.'}${code ? ` Error code: ${code}` : ''}`);
      setStep('upload');
    } finally {
      await adapter?.terminate().catch(() => {});
      setCaptureProgress('');
    }
  };

  // Opening Scrim Auto-Import from a pending-capture card begins local OCR
  // immediately; the coach is taken straight to the populated review.
  useEffect(() => {
    if (!window.moeDesktop || autoLoadStarted.current) return;
    autoLoadStarted.current = true;
    void loadLatestCapture();
  // loadLatestCapture intentionally runs once for this modal instance.
  }, []);

  const save = async () => {
    if (!canCommitScreenshotReview(meta, alliedSideConfirmed)) {
      setError('Complete the opponent, map, and score, then explicitly confirm the allied side to save.');
      return;
    }
    if (!roundsComplete) {
      setError('Review every uncertain round and choose Win or Loss before saving.');
      return;
    }
    setSaving(true);
    try {
      const hasRounds = rounds.length > 0;
      let attW = 0, attL = 0, defW = 0, defL = 0;
      if (hasRounds) {
        rounds.forEach((r) => {
          const side = sideForRound(r.roundNo, meta.firstHalf);
          if (r.result === 'W') { side === 'Att' ? attW++ : defW++; }
          if (r.result === 'L') { side === 'Att' ? attL++ : defL++; }
        });
      }

      const roundResult = (roundNo: number) => rounds.find(round => round.roundNo === roundNo)?.result || '';
      const specialBySide = (roundNo: number) => {
        const result = roundResult(roundNo); if (result !== 'W' && result !== 'L') return {};
        return sideForRound(roundNo, meta.firstHalf) === 'Att' ? { att: result } : { def: result };
      };
      const pistolOne = specialBySide(1); const pistolTwo = specialBySide(13);
      const bonusOne = roundResult(1) === 'W' && roundResult(2) === 'W' ? specialBySide(3) : {};
      const bonusTwo = roundResult(13) === 'W' && roundResult(14) === 'W' ? specialBySide(15) : {};

      const match = {
        date: meta.date, type: meta.type, opponent: meta.opponent, map: meta.map,
        attW: hasRounds ? attW : null, attL: hasRounds ? attL : null,
        defW: hasRounds ? defW : null, defL: hasRounds ? defL : null,
        ourScore: meta.ourScore, theirScore: meta.theirScore,
        pistolAtt: (pistolOne as any).att || (pistolTwo as any).att || '', pistolDef: (pistolOne as any).def || (pistolTwo as any).def || '',
        bonusAtt: (bonusOne as any).att || (bonusTwo as any).att || '', bonusDef: (bonusOne as any).def || (bonusTwo as any).def || '',
        notes: hasRounds ? 'Screenshot draft confirmed after round review.' : 'Screenshot draft confirmed; attack/defense split is unknown.',
        source: 'scrim-import', sourceMetadata,
        reviewConfirmation: { alliedSideConfirmed: true },
        screenshotEvidence: {
          schemaVersion: 1,
          captureId: pendingCaptureId,
          scoreboardPlayers: players.map(p => ({ name: p.extractedName, agent: p.agent || null, kills: num(p.kills) ?? null, deaths: num(p.deaths) ?? null, assists: num(p.assists) ?? null, fk: num(p.fk) ?? null, plants: num(p.plants) ?? null, defuses: num(p.defuses) ?? null, allied: !!p.include })),
        },
      };

      const stats = players
        .filter((p) => p.include && (p.matchedPlayerName || p.extractedName))
        .map((p) => ({
          player: p.matchedPlayerName || p.extractedName, agent: p.agent || '',
          kAtt: null, kDef: null, dAtt: null, dDef: null, aAtt: null, aDef: null,
          kills: num(p.kills) ?? null, deaths: num(p.deaths) ?? null, assists: num(p.assists) ?? null,
          acs: num(p.acs) ?? null, adr: num(p.adr) ?? null, hs: num(p.hs) ?? null,
          fk: num(p.fk) ?? null, fd: num(p.fd) ?? null,
          plants: num(p.plants) ?? null, defuses: num(p.defuses) ?? null, sourceMetadata,
        }));

      const result = await onSaveMatch(match, { operation: 'replace', stats });
      const saved = result?.match || result;
      if (saved?.id && hasRounds) {
        const economyLabel = (value: unknown, evidence: any, team: 'ours' | 'theirs') => {
          const equipment = classifyTeamEquipment(evidence?.players || [], team);
          const label = equipment !== 'unknown' ? equipment : classifyAverageLoadout(value);
          return label === 'unknown' ? '' : label[0].toUpperCase() + label.slice(1);
        };
        const roundRows = rounds.map((r) => ({ roundNo: r.roundNo, side: sideForRound(r.roundNo, meta.firstHalf), result: r.result, winBy: r.winBy || '', buy: economyLabel(r.screenshotEvidence?.ourAverageLoadout, r.screenshotEvidence, 'ours'), enemyBuy: economyLabel(r.screenshotEvidence?.enemyAverageLoadout, r.screenshotEvidence, 'theirs'), ...(r.screenshotEvidence ? { screenshotEvidence: { ...r.screenshotEvidence, reviewStatus: 'confirmed' } } : {}) }));
        await onSaveRounds(saved.id, roundRows);
      }
      if (pendingCaptureId && window.moeDesktop) await window.moeDesktop.completeScoreboard(pendingCaptureId);
      onClose();
    } catch (err: any) {
      const code = await reportDesktopDiagnostic('scrim-import-save', err);
      setError(`${err.message || 'Save failed.'}${code ? ` Error code: ${code}` : ''}`);
    } finally {
      setSaving(false);
    }
  };

  const fileRow = (label: string, file: File | null, set: (f: File | null) => void, required?: boolean) => (
    <label className={`flex items-center gap-3 p-3 rounded-lg border border-dashed cursor-pointer transition ${file ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-white/15 hover:border-white/30'}`}>
      {file ? <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0" /> : <ImageIcon className="w-5 h-5 text-gray-500 shrink-0" />}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold">{label} {required && <span className="text-[#ff4655]">*</span>}</div>
        <div className="text-[11px] text-gray-500 font-mono truncate">{file ? file.name : 'Click to choose an image'}</div>
      </div>
      <input type="file" accept="image/*" className="hidden" onChange={(e) => set(e.target.files?.[0] || null)} />
    </label>
  );

  return (
    <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className={`w-full max-w-3xl p-6 rounded-2xl border ${theme.border} ${theme.bg} space-y-5 max-h-[92vh] overflow-y-auto`}>
        <div className="flex justify-between items-center border-b border-white/5 pb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-[#ff4655]" />
            <h4 className="text-lg font-black tracking-tight uppercase">Scrim Auto-Import</h4>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white cursor-pointer"><X className="w-5 h-5" /></button>
        </div>

        {error && <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">{error}</div>}

        {step === 'upload' && (
          <div className="space-y-4">
            {window.moeDesktop && <button type="button" onClick={() => void loadLatestCapture()} className="ui-button ui-button-primary min-h-12 w-full justify-center px-4 text-sm"><Sparkles className="h-4 w-4" />Load latest one-button capture</button>}
            <p className="text-xs text-gray-400 leading-relaxed">Moe Tracker reads captured screenshots locally on this PC. Every detected player, score, and round stays a draft until you review and confirm it.</p>
            {fileRow('Scoreboard screenshot', scoreboard, setScoreboard, true)}
            {fileRow('Round timeline screenshot (optional)', timeline, setTimeline)}
            <button onClick={runImport} disabled={!scoreboard} className="w-full py-3 bg-[#ff4655] hover:bg-[#ff5e6a] disabled:opacity-40 text-white font-bold text-xs uppercase tracking-widest rounded-lg flex items-center justify-center gap-2 cursor-pointer">
              <Upload className="w-4 h-4" /> Read selected screenshots
            </button>
          </div>
        )}

        {step === 'processing' && (
          <div className="py-16 flex flex-col items-center gap-3 text-gray-400">
            <Loader2 className="w-8 h-8 animate-spin text-[#ff4655]" />
            <span className="text-sm font-mono">{captureProgress || 'Reading screenshots…'}</span>
          </div>
        )}

        {step === 'review' && (
          <div className="space-y-5">
            {/* Match header */}
            <div className="grid sm:grid-cols-3 gap-3">
              <input value={meta.opponent} onChange={(e) => setMeta({ ...meta, opponent: e.target.value })} placeholder="Opponent" className="bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none" />
              <input value={meta.map} onChange={(e) => setMeta({ ...meta, map: e.target.value })} placeholder="Map" className="bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none" />
              <input type="date" value={meta.date} onChange={(e) => setMeta({ ...meta, date: e.target.value })} className="bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none" />
              <select value={meta.type} onChange={(e) => setMeta({ ...meta, type: e.target.value })} className="bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none">
                {(data.settings?.matchTypes || ['Scrim', 'Official', 'Tournament']).map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <div className="flex items-center gap-2 text-sm">
                <input type="number" value={meta.ourScore ?? ''} onChange={(e) => setMeta({ ...meta, ourScore: e.target.value === '' ? null : Number(e.target.value) })} className="w-16 bg-black/20 border border-white/10 rounded-lg px-2 py-2 text-center outline-none" />
                <span className="text-gray-500">–</span>
                <input type="number" value={meta.theirScore ?? ''} onChange={(e) => setMeta({ ...meta, theirScore: e.target.value === '' ? null : Number(e.target.value) })} className="w-16 bg-black/20 border border-white/10 rounded-lg px-2 py-2 text-center outline-none" />
              </div>
              <select value={meta.firstHalf} onChange={(e) => setMeta({ ...meta, firstHalf: e.target.value as 'Att' | 'Def' })} className="bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none" title="Which side we started on (first 12 rounds)">
                <option value="Att">Started Attack</option>
                <option value="Def">Started Defense</option>
              </select>
            </div>

            {/* Players */}
            <div>
              <div className="text-[10px] uppercase font-bold tracking-widest text-gray-500 mb-2">Detected players (our inferred five are saved)</div>
              <div className="space-y-1.5 max-h-52 overflow-y-auto">
                {players.map((p, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs bg-white/[0.03] rounded-lg px-2.5 py-1.5">
                    <input type="checkbox" checked={!!p.include} onChange={(e) => setPlayers(players.map((x, j) => j === i ? { ...x, include: e.target.checked } : x))} />
                    <span className="w-24 truncate font-mono text-gray-400">{p.extractedName}</span>
                    <select value={p.matchedPlayerName || ''} onChange={(e) => setPlayers(players.map((x, j) => j === i ? { ...x, matchedPlayerName: e.target.value, include: !!e.target.value } : x))} className="bg-black/20 border border-white/10 rounded px-1.5 py-1 outline-none">
                      <option value="">— unmapped —</option>
                      {roster.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <select aria-label={`Agent for ${p.extractedName}`} value={p.agent || ''} onChange={(e) => setPlayers(players.map((x, j) => j === i ? { ...x, agent: e.target.value || null } : x))} className="max-w-28 bg-black/20 border border-white/10 rounded px-1.5 py-1 outline-none">
                      <option value="">Agent unknown</option>
                      {agents.map((agent) => <option key={agent} value={agent}>{agent}</option>)}
                    </select>
                    <span className="text-gray-500 font-mono ml-auto">{p.agent} · {p.kills}/{p.deaths}/{p.assists}{p.acs ? ` · ${p.acs} ACS` : ''}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Rounds summary */}
            <div className="text-xs text-gray-400 font-mono">
              {rounds.length > 0
                ? `${rounds.length} rounds detected · ${rounds.filter(round => round.extractionIssues?.length).length} need extra attention — attack/defense split will be computed from the "${meta.firstHalf === 'Att' ? 'Started Attack' : 'Started Defense'}" setting.`
                : 'No round timeline provided — total score will be logged on the attack columns (edit later in Match Log).'}
            </div>

            {rounds.length > 0 && <div>
              <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-gray-500">Round review</div>
              <div className="grid max-h-48 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3 md:grid-cols-4">
                {rounds.map((round, index) => <div key={round.roundNo} className={`rounded-lg border p-2 ${round.extractionIssues?.length ? 'border-amber-400/30 bg-amber-400/[0.05]' : 'border-white/10 bg-white/[0.03]'}`}>
                  <div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold">Round {round.roundNo}</span><span className="text-[9px] uppercase text-gray-500">{round.screenshotEvidence?.confidence || 'manual'}</span></div>
                  <div className="mt-2 grid grid-cols-2 gap-1"><button type="button" onClick={() => setRounds(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, result: 'W' } : item))} className={`min-h-9 rounded border text-xs font-semibold ${round.result === 'W' ? 'border-emerald-300/50 bg-emerald-300/15 text-emerald-200' : 'border-white/10 text-gray-400'}`}>Win</button><button type="button" onClick={() => setRounds(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, result: 'L' } : item))} className={`min-h-9 rounded border text-xs font-semibold ${round.result === 'L' ? 'border-rose-300/50 bg-rose-300/15 text-rose-200' : 'border-white/10 text-gray-400'}`}>Loss</button></div>
                  {round.extractionIssues?.length > 0 && <p className="mt-1 truncate text-[9px] text-amber-200" title={round.extractionIssues.join(', ')}>Check: {round.extractionIssues.join(', ')}</p>}
                </div>)}
              </div>
            </div>}

            <label className="flex items-start gap-2 text-xs text-gray-300">
              <input type="checkbox" checked={alliedSideConfirmed} onChange={(e) => setAlliedSideConfirmed(e.target.checked)} />
              <span>I confirm which scoreboard side belongs to our team and have reviewed the opponent, map, and score.</span>
            </label>

            <div className="flex gap-2">
              <button onClick={() => setStep('upload')} className="px-4 py-2.5 border border-white/10 text-gray-300 text-xs font-bold uppercase tracking-widest rounded-lg cursor-pointer">Back</button>
              <button onClick={save} disabled={saving || !roundsComplete || !canCommitScreenshotReview(meta, alliedSideConfirmed)} className="flex-1 py-2.5 bg-[#ff4655] hover:bg-[#ff5e6a] disabled:opacity-40 text-white font-bold text-xs uppercase tracking-widest rounded-lg flex items-center justify-center gap-2 cursor-pointer">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />} Save Scrim
              </button>
            </div>
            {!canCommitScreenshotReview(meta, alliedSideConfirmed) && <p className="text-[11px] text-amber-400/80 text-center">Complete the opponent, map, and score, then explicitly confirm the allied side to save.</p>}
            {!roundsComplete && <p className="text-[11px] text-amber-400/80 text-center">Choose Win or Loss for every uncertain round before saving.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
