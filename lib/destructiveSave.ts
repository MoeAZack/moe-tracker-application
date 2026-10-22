/**
 * The explicit destructive flag. Code that means to empty matches, rounds or
 * player stats (deleting the last match, an explicit replacement with nothing,
 * a metrics reset, a season archive, a retention purge) sets it on the state
 * it is about to save. Without it, the store refuses a save that would take
 * any of those from some to none. It covers one save.
 */
export const DESTRUCTIVE_SAVE = Symbol.for('moetracker.destructive-save');

/** Not enumerable, so it never reaches stored JSON, clones or comparisons. */
export function markDestructiveSave<T extends object>(db: T) {
  Object.defineProperty(db, DESTRUCTIVE_SAVE, { value: true, enumerable: false, configurable: true, writable: true });
  return db;
}
