/**
 * Where the TDS Repository item page sends the user when they leave it on their own (after deleting
 * the item). The repository table keeps its view (tab, page, page size, sort, search, filters) in its
 * URL, so going back in history restores that view; jumping to the bare path would throw it away.
 */

/** The route the TDS Repository table lives on. */
export const TDS_REPOSITORY_PATH = "/tds-repository";

/** React Router's `location.key` for the first page of a browser session (a typed URL, a link, a refresh). */
const FIRST_ENTRY_KEY = "default";

/** Go back one history entry, or go to a path. */
export type TdsItemExit = { kind: "back" } | { kind: "path"; path: string };

/**
 * After an item is deleted: back in history when the user reached the item page from inside the app,
 * otherwise the plain repository page, since there is no in-app entry to return to.
 */
export function whereAfterTdsItemDelete(locationKey: string): TdsItemExit {
  return locationKey === FIRST_ENTRY_KEY
    ? { kind: "path", path: TDS_REPOSITORY_PATH }
    : { kind: "back" };
}
