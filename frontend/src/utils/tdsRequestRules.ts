/**
 * Project TDS (Technical Data Sheet) request rules: what a `Project TDS Item List` row asks for,
 * what state its catalogue datasheet is in, and the status TDS History shows. Vocabulary:
 * `GLOSSARY.md` § Technical Data Sheets. The approval screen and TDS History read these; nothing
 * else re-derives them.
 *
 * Request Type is derived, never stored, and is only meaningful while a row waits for approval.
 */

/** Project-only id prefix of a Project Custom Item. Pinned to the backend by a parity test. */
export const PROJECT_CUSTOM_ID_PREFIX = "PCUS-";

/** Stored `tds_status` values. Pinned to `submit.py` by a parity test. */
export const STORED_STATUS = {
  pending: "Pending",
  /** A New Make: approval will add a Repository Entry. */
  newMake: "New",
  approved: "Approved",
  rejected: "Rejected",
} as const;

export type RequestType = "From Repository" | "New Make" | "Project Custom";
export const REQUEST_TYPES: RequestType[] = ["From Repository", "New Make", "Project Custom"];

export type ItemStatus = "Verified" | "Not Verified" | "--";
export const ITEM_STATUSES: ItemStatus[] = ["Verified", "Not Verified", "--"];

export type HistoryStatus = "Pending" | "Approved" | "Rejected";
export const HISTORY_STATUSES: HistoryStatus[] = ["Pending", "Approved", "Rejected"];

/** The fields of a Project TDS row the rules read. */
export interface TdsRequestRow {
  tds_item_id?: string | null;
  tds_status?: string | null;
}

/** The fields of the matching `TDS Repository` entry the rules read. */
export interface RepositoryEntryState {
  status?: string | null;
}

/**
 * - a `PCUS-` id → Project Custom
 * - status New with a TDS Item id → New Make
 * - otherwise → From Repository
 */
export function requestTypeOf(row: TdsRequestRow): RequestType {
  const itemId = row.tds_item_id ?? "";
  if (itemId.startsWith(PROJECT_CUSTOM_ID_PREFIX)) return "Project Custom";
  if (row.tds_status === STORED_STATUS.newMake && itemId) return "New Make";
  return "From Repository";
}

/**
 * Key of the Repository Entry a row matches: TDS Item + make, both exact. The backend finds the
 * entry the same way (`approve.py` `_find_entry`, `submit.py` picks), so a make differing only in
 * case or spaces is no match here either, and the screen never promises an entry approval won't find.
 * Build the lookup map with this, then pass the found entry (or undefined) to `itemStatusOf`.
 */
export function repositoryEntryKey(tdsItem?: string | null, make?: string | null): string {
  return `${tdsItem ?? ""}|${make ?? ""}`;
}

/**
 * The catalogue datasheet's state, from the matching Repository Entry (`undefined` = none):
 * - Project Custom → `--`
 * - New Make → the entry's status, otherwise Not Verified
 * - From Repository → the entry's status, otherwise `--`
 */
export function itemStatusOf(row: TdsRequestRow, entry: RepositoryEntryState | undefined): ItemStatus {
  const type = requestTypeOf(row);
  if (type === "Project Custom") return "--";
  if (entry) return entry.status === "Verified" ? "Verified" : "Not Verified";
  return type === "New Make" ? "Not Verified" : "--";
}

/** A New Make whose Repository Entry already exists: approval will ask which datasheet to keep. */
export function entryAddedSinceRequest(row: TdsRequestRow, entry: RepositoryEntryState | undefined): boolean {
  return requestTypeOf(row) === "New Make" && !!entry;
}

/**
 * The status TDS History shows. New reads Pending. A blank status also reads Pending, as it always
 * has, though the Pending filter (`storedStatusesFor`) cannot match it: every send writes a status
 * (`submit.py`), and no stored row is blank.
 */
export function historyStatusOf(status?: string | null): HistoryStatus {
  if (status === STORED_STATUS.approved || status === STORED_STATUS.rejected) return status;
  return "Pending";
}

/**
 * The stored `tds_status` values a History Status filter selection matches. Pending includes New.
 * The table's filter state holds these stored values, so the list fetch, the export and the other
 * facets' cross-filter all match New rows without knowing about this rule.
 */
export function storedStatusesFor(selected: string[]): string[] {
  return selected.flatMap(s =>
    s === STORED_STATUS.pending ? [STORED_STATUS.pending, STORED_STATUS.newMake] : [s]
  );
}

/** The shown statuses a stored-status filter value stands for, once each: the inverse of `storedStatusesFor`. */
export function historyStatusesIn(filterValue: unknown): HistoryStatus[] {
  if (!Array.isArray(filterValue)) return [];
  return [...new Set(filterValue.map(v => historyStatusOf(String(v))))];
}
