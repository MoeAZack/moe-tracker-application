import { useEffect, useRef } from 'react';
import type { MatchStatsUpdate, TrackerData } from '../types';
import { apiFetch } from '../utils/api';
import { reportDesktopDiagnostic } from '../utils/desktopDiagnostics';
import { extractScoreboardLocally } from '../utils/localScoreboard';
import { createBrowserLocalTesseractAdapter } from '../../lib/localOcrEngine';
import { extractCaptureSession, type CaptureImage } from '../../lib/captureSessionPipeline';
import { buildAutomaticCaptureImport } from '../../lib/automaticCaptureImport';
import { getCachedRecognitions, putCachedRecognitions, sha256Base64 } from '../utils/ocrRecognitionCache';
import { getOcrEngineSetting } from '../utils/ocrEngineSetting';
import { mergeScoreboardFallback, shouldRequestCloudFallback } from '../../lib/ocrAutonomy';
import { OCR_LEARNING_VERSION, rosterWithLearnedAliases } from '../../lib/ocrLearning';
import { getOcrLearningState, recordOcrSessionOutcome } from '../utils/ocrLearningStore';
import { captureRosterFromIdentity } from '../../lib/identityResolver';
import { captureHolder, holdCapture, releaseCapture } from '../utils/captureLock';

const RETRY_AFTER_MS = 5 * 60 * 1000;

/** Always-mounted desktop worker; it does not depend on which page is open. */
const imageFromCapture = async (capture: CaptureImage) => {
  const image = new Image(); image.src = `data:${capture.mediaType};base64,${capture.base64}`; await image.decode(); return image;
};

export default function DesktopReplayAutomation({ data, role, onProcessed, onSaveMatch }: {
  data: TrackerData;
  role: string | null;
  onProcessed: () => void | Promise<void>;
  onSaveMatch: (match: any, statsUpdate: MatchStatsUpdate, rounds?: any[]) => Promise<any>;
}) {
  const busy = useRef(false);
  const attempted = useRef(new Map<string, number>());

  useEffect(() => {
    if (role !== 'coach' || !window.moeDesktop) return;
    let active = true;
    const processNext = async () => {
      if (!active || busy.current) return;
      busy.current = true;
      let heldCapture: string | null = null;
      try {
        // A capture the coach has open in the scrim import modal is theirs until they save or close it.
        // A capture missing rounds cannot be read; it waits for the coach to set it aside.
        const pending = (await window.moeDesktop!.listScoreboards()).find(item => !item.capture?.missingRounds && Date.now() - (attempted.current.get(item.id) || 0) >= RETRY_AFTER_MS && captureHolder(item.id) !== 'review');
        if (!pending) return;
        if (pending.capture && !holdCapture(pending.id, 'automatic')) return;
        heldCapture = pending.capture ? pending.id : null;
        attempted.current.set(pending.id, Date.now());
        if (pending.capture) {
          const session = await window.moeDesktop!.readCaptureSession(pending.id);
          const adapter = await createBrowserLocalTesseractAdapter({ engine: getOcrEngineSetting() });
          try {
            const hashes = new Map<string, Promise<string>>();
            // Same identities as the replay path: coach corrections and accepted names count here too.
            const baseRoster = captureRosterFromIdentity(data);
            const learning = await getOcrLearningState(baseRoster);
            const rosterPlayers = rosterWithLearnedAliases(baseRoster, learning.aliases);
            let cacheHits = 0; let cacheMisses = 0;
            let extracted = await extractCaptureSession({
              captures: session.captures,
              rosterPlayers,
              knownMaps: data.settings?.maps || [],
              correctionModel: learning.model,
              adapter,
              loadImage: imageFromCapture,
              recognize: async (capture, image, profile) => {
                const identity = `${capture.kind}:${capture.round || 0}:${capture.name || ''}`;
                const hash = await (hashes.get(identity) || (() => { const value = sha256Base64(capture.base64); hashes.set(identity, value); return value; })());
                const cached = await getCachedRecognitions(hash, profile, adapter.engine);
                if (cached) { cacheHits += 1; return cached; }
                cacheMisses += 1;
                const recognitions = await adapter.recognize(image, profile);
                await putCachedRecognitions(hash, profile, recognitions, adapter.engine);
                return recognitions;
              },
            });
            let automatic = buildAutomaticCaptureImport(extracted, data, session.captureId, pending.modifiedAt);
            const fallbackMode = data.settings.ai?.ocrFallback || 'local-only';
            if (!automatic.payload && shouldRequestCloudFallback(fallbackMode, 2, automatic.decision.reasons.length)) {
              const scoreboard = session.captures.find(item => item.kind === 'scoreboard');
              if (scoreboard) {
                const response = await apiFetch('/api/import-screenshot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base64: scoreboard.base64, mediaType: scoreboard.mediaType }) });
                const fallback = await response.json().catch(() => ({}));
                if (response.ok) {
                  extracted = mergeScoreboardFallback(extracted, fallback, data.settings?.maps || []);
                  automatic = buildAutomaticCaptureImport(extracted, data, session.captureId, pending.modifiedAt);
                }
              }
            }
            const diagnostics: any = extracted.captureDiagnostics || {};
            await recordOcrSessionOutcome({
              id: `${session.captureId || pending.id}:${Date.now()}`,
              captureId: session.captureId,
              recordedAt: new Date().toISOString(),
              automatic: !!automatic.payload,
              reasons: automatic.decision.reasons,
              layout: diagnostics.layout || extracted.scoreboardLayout || 'unknown',
              resolution: diagnostics.resolution || 'unknown',
              roundCount: extracted.rounds?.length || 0,
              confirmedRounds: diagnostics.confirmedRounds || 0,
              cacheHits,
              cacheMisses,
              modelVersion: OCR_LEARNING_VERSION,
            });
            if (automatic.payload) {
              // One server write: a rejected round set leaves no half-saved match behind.
              const savedResult = await onSaveMatch(automatic.payload.match, { operation: 'replace', stats: automatic.payload.stats }, automatic.payload.roundRows);
              const saved = savedResult?.match || savedResult;
              if (!saved?.id) throw new Error('The automatic capture was extracted but the match did not return a saved identity.');
              await window.moeDesktop!.completeScoreboard(pending.id);
              attempted.current.delete(pending.id);
              await onProcessed();
              return;
            }
            // Keep the raw capture available for exception review, but do not
            // burn CPU every five minutes. It is reconsidered after restart or
            // after a one-day backoff, while cached OCR makes that retry cheap.
            attempted.current.set(pending.id, Date.now() + 23 * 60 * 60 * 1000);
            throw new Error(`Capture needs exception review: ${automatic.decision.reasons.join(', ')}`);
          } finally { await adapter.terminate().catch(() => {}); }
        }
        const loaded = await window.moeDesktop!.readScoreboard(pending.id);
        const file = new File([new Uint8Array(loaded.bytes)], loaded.name, { type: loaded.mediaType, lastModified: Date.parse(pending.modifiedAt) });
        const rosterPlayers = (data.rosterPlayers || []).filter(player => !player.retiredAt).map(player => ({ id: player.id, displayName: player.displayName }));
        const { imageSha256, draft } = await extractScoreboardLocally(file, rosterPlayers);
        const status = await window.moeDesktop!.getStatus();
        const extraction = {
          map: draft.match.map, ourScore: draft.match.ourScore, theirScore: draft.match.theirScore, confident: false,
          players: draft.stats.map(stat => ({ name: stat.extractedName, agent: stat.agent, kills: stat.kills, deaths: stat.deaths, assists: stat.assists,
            acs: stat.acs, adr: stat.adr, hs: stat.hs, fk: stat.fk, fd: stat.fd, plants: stat.plants, defuses: stat.defuses })),
        };
        const response = await apiFetch('/api/replay-intake/screenshots/local', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId: status.deviceId, imageSha256, capturedAt: draft.sourceMetadata.capturedAt, extraction }) });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'Automatic scoreboard processing failed.');
        await window.moeDesktop!.completeScoreboard(pending.id);
        attempted.current.delete(pending.id);
        await onProcessed();
      } catch (error) {
        await reportDesktopDiagnostic('automatic-scoreboard-processing', error);
      } finally { if (heldCapture) releaseCapture(heldCapture, 'automatic'); busy.current = false; }
    };
    const initial = window.setTimeout(() => void processNext(), 1_000);
    const interval = window.setInterval(() => void processNext(), 5_000);
    return () => { active = false; window.clearTimeout(initial); window.clearInterval(interval); };
  }, [data, role, onProcessed, onSaveMatch]);
  return null;
}
