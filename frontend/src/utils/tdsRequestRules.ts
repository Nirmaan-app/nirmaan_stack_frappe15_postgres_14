/**
 * Project TDS (Technical Data Sheet) request rules: what a `Project TDS Item List` row asks for,
 * what state its catalogue datasheet is in, and the status TDS History shows. Vocabulary:
 * `GLOSSARY.md` § Technical Data Sheets. The approval screen, TDS History and the New Request cart
 * read these; nothing else re-derives them.
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

/** A Project Custom Item's row, at any status: its id carries the project-only prefix. */
export function isProjectCustomId(tdsItemId?: string | null): boolean {
  return (tdsItemId ?? "").startsWith(PROJECT_CUSTOM_ID_PREFIX);
}

/**
 * - a `PCUS-` id → Project Custom
 * - status New → New Make
 * - otherwise → From Repository
 *
 * A legacy New row with no TDS Item id (a "brand-new shared item" request from before #1377) is New
 * Make too: the server sends every New row down the New Make path, refuses it until an Admin edits it
 * into a New Make or a Project Custom item, and `isEditableRequest` opens that edit. Calling it From
 * Repository would promise a plain pick that approval can never make.
 */
export function requestTypeOf(row: TdsRequestRow): RequestType {
  if (isProjectCustomId(row.tds_item_id)) return "Project Custom";
  if (row.tds_status === STORED_STATUS.newMake) return "New Make";
  return "From Repository";
}

/**
 * A waiting request an Admin edits in the request edit dialog, where it can switch between New Make
 * and Project Custom: status New (with or without a TDS Item id), or a Project Custom row still
 * Pending. Every other Pending row is From Repository and keeps the "Edit TDS Item" dialog, which
 * saves through `edit_tds_pick`. The server edits exactly these rows as requests (`edit_request.py`
 * `_is_waiting_request`, pinned by a parity test).
 */
export function isEditableRequest(row: TdsRequestRow): boolean {
  return (
    row.tds_status === STORED_STATUS.newMake ||
    (row.tds_status === STORED_STATUS.pending && isProjectCustomId(row.tds_item_id))
  );
}

/** The fields of a New Request cart row (not yet sent, so no id or status) the rules read. */
export interface TdsCartRow {
  is_new_request?: boolean;
  is_project_custom?: boolean;
}

/** What a cart row will ask for once sent: a pick is From Repository, a Request New row is New Make or Project Custom. */
export function cartRequestTypeOf(row: TdsCartRow): RequestType {
  if (row.is_project_custom) return "Project Custom";
  return row.is_new_request ? "New Make" : "From Repository";
}

/**
 * Project Custom identity on a project: the name, trimmed and ignoring case, + the trimmed make. The
 * server folds the name the same way (`submit.py` `_name_key`, pinned by the parity test), so the
 * cart refuses exactly the duplicates the send would.
 */
export function customItemKey(name?: string | null, make?: string | null): string {
  return `${foldItemName(name)}|${(make ?? "").trim()}`;
}

/** The fields of a stored project row a resubmit matches on. */
export interface TdsProjectRow extends TdsRequestRow {
  tds_item_name?: string | null;
  tds_make?: string | null;
}

/** The fields of a cart row a resubmit matches on. */
export interface TdsResubmitCandidate extends TdsCartRow {
  tds_item_id?: string | null;
  tds_item_name?: string | null;
  make?: string | null;
}

/**
 * The project's Rejected row that a cart row would replace on send, if any. Request Type is not
 * known once a row is rejected, so a pick or New Make matches on TDS Item + make, and a Project
 * Custom row on name (ignoring case) + make, whatever `PCUS-` id the rejected row holds. The server
 * checks the replacement the same way (`submit.py` `_check_replacements`).
 */
export function rejectedRowFor<T extends TdsProjectRow>(
  rows: readonly T[] | undefined,
  candidate: TdsResubmitCandidate
): T | undefined {
  return (rows ?? []).find(row => row.tds_status === STORED_STATUS.rejected && sameItemMake(row, candidate));
}

/**
 * The project's live row for the same item + make as a candidate, if any: one the server refuses a
 * duplicate of (`submit.py` `_refuse_duplicates`, pinned by the parity test). Every row but a
 * Rejected one is live: Pending, New, Approved, and a legacy blank status. Matches as `rejectedRowFor`.
 */
export function liveRowFor<T extends TdsProjectRow>(
  rows: readonly T[] | undefined,
  candidate: TdsResubmitCandidate
): T | undefined {
  return (rows ?? []).find(row => row.tds_status !== STORED_STATUS.rejected && sameItemMake(row, candidate));
}

/**
 * The project's *Rejected by Client* row for the same item + make as a candidate, if any. Such a row
 * stays live (its `tds_status` is Approved), so the make can't be picked again, but another make of
 * the item can. The server's duplicate refusal names this case (`submit.py` `_refuse_duplicates`,
 * pinned by the parity test). Matches as `rejectedRowFor`.
 */
export function clientRejectedRowFor<T extends TdsProjectRow & ClientStatusRow>(
  rows: readonly T[] | undefined,
  candidate: TdsResubmitCandidate
): T | undefined {
  return (rows ?? []).find(
    row =>
      row.tds_status !== STORED_STATUS.rejected &&
      row.client_status === CLIENT_STATUS.rejected &&
      sameItemMake(row, candidate)
  );
}

function sameItemMake(row: TdsProjectRow, candidate: TdsResubmitCandidate): boolean {
  if (candidate.is_project_custom) {
    return (
      isProjectCustomId(row.tds_item_id) &&
      customItemKey(row.tds_item_name, row.tds_make) === customItemKey(candidate.tds_item_name, candidate.make)
    );
  }
  return row.tds_item_id === candidate.tds_item_id && row.tds_make === candidate.make;
}

/** An item name folded for comparison: trimmed, ignoring case (`submit.py` `_name_key`). */
export function foldItemName(name?: string | null): string {
  return (name ?? "").trim().toLowerCase();
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
 * A New Make whose Repository Entry already exists: which datasheet approval keeps. Pinned to
 * `approve.py` by a parity test.
 * - `repository`: keep the entry's sheet; the project row switches to it.
 * - `request`: the sheet sent with the request becomes the entry's sheet from now on.
 */
export const DATASHEET_CHOICE = {
  repository: "repository",
  request: "request",
} as const;
export type DatasheetChoice = (typeof DATASHEET_CHOICE)[keyof typeof DATASHEET_CHOICE];

/**
 * The file name a stored datasheet URL names, for display: the `file_name` query value of a
 * cloud-storage URL, else the last path segment. Blank for no URL.
 */
export function datasheetFileName(url?: string | null): string {
  if (!url) return "";
  const [path, query = ""] = url.split("?");
  const named = new URLSearchParams(query).get("file_name");
  if (named) return named;
  return decodeURIComponent(path.split("/").pop() ?? "");
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
 * The words a user sees for each History status. Approved reads "Approved by Admin" so it is never
 * mistaken for the client's decision (Client Status, ADR-0025 Amendment B). Filter state and stored
 * values keep the short `HistoryStatus`; only what is shown or exported goes through this. The
 * Handover print reads the same words from `api/tds/status_label.py`, pinned by a parity test.
 */
export const HISTORY_STATUS_LABEL: Record<HistoryStatus, string> = {
  Pending: "Pending",
  Approved: "Approved by Admin",
  Rejected: "Rejected",
};

/** What a row's stored `tds_status` reads as on screen and in exports. */
export function historyStatusLabel(status?: string | null): string {
  return HISTORY_STATUS_LABEL[historyStatusOf(status)];
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

// ── Client Status (ADR-0025 Amendment B) ────────────────────────────────────────────────────────
// The client's answer on an Admin-approved row, stored beside `tds_status` (which stays Approved).
// Written only by `api/tds/client_status.set_client_status`.

/** Stored `client_status` values; blank means the client has not answered. Pinned to `client_status.py`. */
export const CLIENT_STATUS = {
  approved: "Approved by Client",
  rejected: "Rejected by Client",
} as const;
export type ClientStatus = (typeof CLIENT_STATUS)[keyof typeof CLIENT_STATUS];

/** The `action` argument of `set_client_status`. Pinned to `client_status.py`. */
export const CLIENT_STATUS_ACTION = {
  markApproved: "mark_approved",
  markRejected: "mark_rejected",
  clear: "clear",
} as const;
export type ClientStatusAction = (typeof CLIENT_STATUS_ACTION)[keyof typeof CLIENT_STATUS_ACTION];

/** The fields of a Project TDS row the Client Status rules read. */
export interface ClientStatusRow extends TdsRequestRow {
  client_status?: string | null;
}

/** The TDS History page's tabs. Every row sits in exactly one (`historyTabOf`). */
export type HistoryTab = "history" | "approvedByClient" | "rejectedByClient";
export const HISTORY_TABS: readonly { value: HistoryTab; label: string }[] = [
  { value: "history", label: "TDS History" },
  { value: "approvedByClient", label: CLIENT_STATUS.approved },
  { value: "rejectedByClient", label: CLIENT_STATUS.rejected },
];

/** The tab a row belongs to: its Client Status's tab, or TDS History while the client has not answered. */
export function historyTabOf(row: ClientStatusRow): HistoryTab {
  if (row.client_status === CLIENT_STATUS.approved) return "approvedByClient";
  if (row.client_status === CLIENT_STATUS.rejected) return "rejectedByClient";
  return "history";
}

/**
 * The list filter that selects exactly one tab's rows on the server, the same rows `historyTabOf`
 * puts there. `is not set` matches NULL and blank, so rows from before Client Status existed land in
 * TDS History.
 */
export function historyTabFilters(tab: HistoryTab): [string, string, string][] {
  if (tab === "approvedByClient") return [["client_status", "=", CLIENT_STATUS.approved]];
  if (tab === "rejectedByClient") return [["client_status", "=", CLIENT_STATUS.rejected]];
  return [["client_status", "is", "not set"]];
}

/**
 * A row that can take a Client Status: an Admin-approved one, answered or not (an answered row can
 * be switched). Pending, New and Rejected rows can't; the server refuses them the same way.
 */
export function isClientStatusMarkable(row: ClientStatusRow): boolean {
  return row.tds_status === STORED_STATUS.approved;
}

/**
 * The Client Status actions a tab's toolbar offers for ticked rows.
 * - `canMark`: Admin or PMO Executive (the server's `MARK_PROFILES`)
 * - `canClear`: Admin only; no tab offers Clear yet
 * Today only TDS History offers the two marks; the client tabs gain the switch and Clear next.
 */
export function clientStatusActionsFor(
  tab: HistoryTab,
  rights: { canMark: boolean; canClear: boolean }
): ClientStatusAction[] {
  if (!rights.canMark) return [];
  if (tab === "history") return [CLIENT_STATUS_ACTION.markApproved, CLIENT_STATUS_ACTION.markRejected];
  return [];
}
