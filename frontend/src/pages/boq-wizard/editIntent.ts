/**
 * editIntent -- "take the draft lock first, then write" (S4b, owner ruling R33, ADR-0035).
 *
 * The review page takes the draft lock with its own call on the first edit (SheetReviewPage's
 * ensureLockAcquired), and every write endpoint takes the same lock again on the server. Most
 * edits put a human pause between the two: the lock call goes out when a dialog opens and the
 * save follows later. An action that fires both in the same instant -- Revert -- makes two
 * requests write the one lock row at once, and the database refuses the second ("There was an
 * error." on the first click after a page load). Waiting for the page's call to settle removes
 * the overlap; the server's own acquire stays the authority.
 *
 * Pure: no React, no fetch.
 */

/** The page's edit-intent call: returns nothing, or a promise that settles when the lock call
 *  has answered. */
export type EditIntent = (() => void | Promise<unknown>) | undefined;

/**
 * Run `write` only after the page's lock call has settled. A lock call that FAILS does not stop
 * the write: the server decides, and its refusal carries the sentence the screen shows.
 */
export async function afterEditIntent<T>(intent: EditIntent, write: () => Promise<T>): Promise<T> {
  try {
    await intent?.();
  } catch {
    // The page handles its own lock failure (the takeover banner); the write still asks the server.
  }
  return write();
}
