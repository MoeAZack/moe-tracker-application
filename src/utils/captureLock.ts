// The background capture loop and the scrim import modal both read desktop
// captures in this window. A capture held by one is skipped by the other, so
// the same game is never extracted twice or saved by both.
const held = new Map<string, 'automatic' | 'review'>();

export function holdCapture(id: string, holder: 'automatic' | 'review'): boolean {
  const current = held.get(id);
  if (current && current !== holder) return false;
  held.set(id, holder); return true;
}

export function releaseCapture(id: string, holder: 'automatic' | 'review') {
  if (held.get(id) === holder) held.delete(id);
}

export function captureHolder(id: string) { return held.get(id) || null; }
