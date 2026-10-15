import { useEffect, useRef } from 'react';
import type { TrackerData } from '../types';
import { apiFetch } from '../utils/api';
import { reportDesktopDiagnostic } from '../utils/desktopDiagnostics';
import { extractScoreboardLocally } from '../utils/localScoreboard';

const RETRY_AFTER_MS = 5 * 60 * 1000;

/** Always-mounted desktop worker; it does not depend on which page is open. */
export default function DesktopReplayAutomation({ data, role, onProcessed }: { data: TrackerData; role: string | null; onProcessed: () => void | Promise<void> }) {
  const busy = useRef(false);
  const attempted = useRef(new Map<string, number>());

  useEffect(() => {
    if (role !== 'coach' || !window.moeDesktop) return;
    let active = true;
    const processNext = async () => {
      if (!active || busy.current) return;
      busy.current = true;
      try {
        const pending = (await window.moeDesktop!.listScoreboards()).find(item => Date.now() - (attempted.current.get(item.id) || 0) >= RETRY_AFTER_MS);
        if (!pending) return;
        attempted.current.set(pending.id, Date.now());
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
      } finally { busy.current = false; }
    };
    const initial = window.setTimeout(() => void processNext(), 1_000);
    const interval = window.setInterval(() => void processNext(), 5_000);
    return () => { active = false; window.clearTimeout(initial); window.clearInterval(interval); };
  }, [data.rosterPlayers, role, onProcessed]);
  return null;
}
