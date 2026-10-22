// Small play/pause/seek handles for the synced multi-POV review, one per video.
//
// YouTube is driven through the embed's postMessage protocol, so the app loads
// no YouTube script: the only thing allowed in is the youtube-nocookie.com
// frame itself. Local files play in a <video> from a blob: URL that never
// leaves this window.

export interface PovPlayer {
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  setMuted(muted: boolean): void;
  /** Current video time in seconds, or null until the video has reported one. */
  time(): number | null;
  dispose(): void;
}

export const YOUTUBE_EMBED_ORIGIN = 'https://www.youtube-nocookie.com';

export function youtubeEmbedUrl(videoId: string, startSeconds: number, origin: string) {
  const params = new URLSearchParams({ enablejsapi: '1', origin, playsinline: '1', rel: '0', start: String(Math.max(0, Math.floor(startSeconds))) });
  return `${YOUTUBE_EMBED_ORIGIN}/embed/${encodeURIComponent(videoId)}?${params}`;
}

type FrameLike = { contentWindow: { postMessage(message: string, targetOrigin: string): void } | null };
type MessageSource = { addEventListener(type: 'message', listener: (event: MessageEvent) => void): void; removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void };

const PLAYING = 1;

export function youtubePlayer(frame: FrameLike, source: MessageSource = window, now: () => number = () => Date.now()): PovPlayer & { listen(): void } {
  let reportedTime: number | null = null; let reportedAt = 0; let playing = false;
  const send = (payload: Record<string, unknown>) => frame.contentWindow?.postMessage(JSON.stringify({ ...payload, id: 1, channel: 'widget' }), YOUTUBE_EMBED_ORIGIN);
  const command = (func: string, args: unknown[] = []) => send({ event: 'command', func, args });
  const onMessage = (event: MessageEvent) => {
    // Only this frame's own messages; any other window can post to us too.
    if (event.origin !== YOUTUBE_EMBED_ORIGIN || event.source !== frame.contentWindow || typeof event.data !== 'string') return;
    let data: any;
    try { data = JSON.parse(event.data); } catch { return; }
    const info = data?.info;
    if ((data?.event === 'infoDelivery' || data?.event === 'initialDelivery') && info && typeof info === 'object') {
      if (typeof info.currentTime === 'number' && Number.isFinite(info.currentTime)) { reportedTime = info.currentTime; reportedAt = now(); }
      if (typeof info.playerState === 'number') playing = info.playerState === PLAYING;
    } else if (data?.event === 'onStateChange' && typeof info === 'number') playing = info === PLAYING;
  };
  source.addEventListener('message', onMessage);
  return {
    // Ask the embed to start reporting time and state; call once the frame has loaded.
    listen: () => send({ event: 'listening' }),
    play: () => command('playVideo'),
    pause: () => command('pauseVideo'),
    seek: seconds => { command('seekTo', [Math.max(0, seconds), true]); reportedTime = Math.max(0, seconds); reportedAt = now(); },
    setMuted: muted => command(muted ? 'mute' : 'unMute'),
    // The embed reports a few times a second; between reports, count forward while playing.
    time: () => (reportedTime === null ? null : reportedTime + (playing ? (now() - reportedAt) / 1000 : 0)),
    dispose: () => source.removeEventListener('message', onMessage),
  };
}

type VideoLike = { play(): Promise<void> | void; pause(): void; currentTime: number; muted: boolean; readyState: number };

export function videoElementPlayer(video: VideoLike): PovPlayer {
  return {
    play: () => { void Promise.resolve(video.play()).catch(() => null); },
    pause: () => video.pause(),
    seek: seconds => { video.currentTime = Math.max(0, seconds); },
    setMuted: muted => { video.muted = muted; },
    time: () => (video.readyState >= 1 ? video.currentTime : null),
    dispose: () => {},
  };
}
