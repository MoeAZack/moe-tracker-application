type PendingScoreboard = { id: string; capture?: null | { captureId: string; requestedRounds: number; missingRounds?: number } };

/**
 * Capture sessions split into the ones the review can read and the ones that
 * are missing requested rounds. A missing round cannot be read, so an
 * incomplete capture must never stand in front of a readable one.
 */
export function splitPendingCaptures<T extends PendingScoreboard>(pending: T[]) {
  const captures = pending.filter(item => item.capture);
  return {
    readable: captures.filter(item => !item.capture!.missingRounds),
    incomplete: captures.filter(item => !!item.capture!.missingRounds),
  };
}
