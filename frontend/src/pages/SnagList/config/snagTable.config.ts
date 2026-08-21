/**
 * Snag List — table wiring constants (doctype, fetched fields, search fields,
 * endpoint names, status presentation).
 *
 * Kept separate from `snagColumns.tsx` so the non-JSX half stays importable by
 * hooks and tests. The wire SHAPES live in `../types.ts` — never redeclare one
 * here (ADR-0010 F2).
 */


import { SearchFieldOption } from "@/components/data-table/new-data-table";
import { urlStateManager } from "@/utils/urlStateManager";
import { ProjectSnag, SnagStatus } from "../types";
import { decodeFiltersFromUrl, encodeFiltersForUrl } from "@/hooks/useServerDataTable";

export const SNAG_DOCTYPE = "Project Snag";
export const SNAG_BATCH_DOCTYPE = "Project Snag Batch";

/**
 * Row shape the table renders.
 *
 * It is now a plain ALIAS of the shared contract. It previously carried one extra
 * field — `batch_display_name`, pulled with Frappe's dotted link-fetch — which
 * existed only to label the Batch COLUMN. Revision 2 removed that column (the Batch
 * FILTER survives, see `snagColumns.tsx`), so the link-fetch and the local extension
 * went with it: the JOIN it cost on every page load bought nothing.
 *
 * The alias is kept rather than collapsed so the ~15 call sites keep naming the ROW
 * (a display concern) rather than the DOCUMENT, which is what makes re-widening it a
 * one-line change if a display-only field is ever needed again.
 */
export type SnagListRow = ProjectSnag;

/**
 * Fields requested from the list API.
 *
 * `remark` (SINGULAR — ADR-0018) is the ONE free-text field: it arrives holding the
 * imported text and is overwritten by whoever next changes the Snag's status. The
 * old `comments` field NO LONGER EXISTS in the database — a stale entry here is a
 * hard 500, not a blank column.
 */
export const SNAG_FIELDS_TO_FETCH: string[] = [
  "name",
  "project",
  "batch",
  "area",
  "category",
  "description",
  "status",
  "remark",
  "source_row",
  "status_changed_by",
  "status_changed_on",
  "creation",
  "modified",
];

/** Search is on the description first — that is what a walk-through is looked up by. */
export const SNAG_SEARCHABLE_FIELDS: SearchFieldOption[] = [
  {
    value: "description",
    label: "Description",
    placeholder: "Search snag descriptions...",
    default: true,
  },
  { value: "area", label: "Area", placeholder: "Search by Area / Location..." },
  { value: "category", label: "Category", placeholder: "Search by Category..." },
];

export const SNAG_DEFAULT_SORT = "creation asc";

/**
 * Column ids that may legitimately appear in `columnFilters`.
 *
 * `batch` is here even though there is no Batch COLUMN any more: a hidden
 * filter-host column carries the id so the Batch filter keeps writing
 * `["batch", "in", [...]]` (see `snagColumns.tsx`).
 */
export const SNAG_FILTERABLE_COLUMN_IDS: readonly string[] = [
  "area",
  "category",
  "status",
  "batch",
];

const isKnownSearchField = (value: string | null): boolean =>
  !!value && SNAG_SEARCHABLE_FIELDS.some((f) => f.value === value);

/**
 * Drop URL-persisted table state that names something this screen no longer has.
 *
 * `useServerDataTable`'s `urlSyncKey` persists the selected SEARCH FIELD and the
 * column FILTERS into the query string, and a bookmark outlives a schema change.
 * Two concrete hazards Revision 2 created:
 *
 *  - `..._searchBy=comments` — the field was DELETED from the doctype. The hook
 *    would send it as `current_search_fields`, and the backend would fail on a
 *    column that no longer exists. A hard error, not a degraded search.
 *  - `..._filters=<base64>` naming a column id this table does not define — it
 *    would still be converted into a server filter (the converter reads the
 *    filter's `id`, never the column list), so it would narrow the table
 *    INVISIBLY, with no funnel anywhere to clear it, while also suppressing the
 *    empty state via `hasActiveNarrowing`.
 *
 * Called ONCE per mount, BEFORE `useServerDataTable` reads the URL — the hook
 * initialises its state from these params in a `useState` initialiser, so a fix
 * applied afterwards would arrive one fetch too late.
 *
 * Returns nothing: the URL is the state, and the hook is the only reader.
 */
export function sanitizePersistedSnagTableState(urlSyncKey: string): void {
  const searchByKey = `${urlSyncKey}_searchBy`;
  const searchBy = urlStateManager.getParam(searchByKey);
  if (searchBy !== null && !isKnownSearchField(searchBy)) {
    // Null (not the default value) — the hook then falls back to whichever field
    // is marked `default`, so the fallback stays defined in ONE place.
    urlStateManager.updateParam(searchByKey, null);
    urlStateManager.updateParam(`${urlSyncKey}_q`, null);
  }

  const filtersKey = `${urlSyncKey}_filters`;
  const encoded = urlStateManager.getParam(filtersKey);
  if (!encoded) return;

  // Decode/encode through the hook that OWNS this format -- never a local base64 + parse here.
  // `decodeFiltersFromUrl` returns [] for anything undecodable or malformed, which is the same
  // problem as an unknown column: a filter nobody can see or clear. Both end in the param
  // being cleared.
  const parsed = decodeFiltersFromUrl(encoded);
  if (!parsed.length) {
    urlStateManager.updateParam(filtersKey, null);
    return;
  }
  const kept = parsed.filter((f) =>
    SNAG_FILTERABLE_COLUMN_IDS.includes(String(f.id))
  );
  if (kept.length === parsed.length) return;
  urlStateManager.updateParam(filtersKey, encodeFiltersForUrl(kept));
}

/** Whitelisted endpoints this tab calls. One place, so a rename is one edit. */
export const SNAG_ENDPOINTS = {
  stats: "nirmaan_stack.api.snags.tracking.get_snag_stats",
  updateStatus: "nirmaan_stack.api.snags.tracking.update_snag_status",
  bulkUpdateStatus: "nirmaan_stack.api.snags.tracking.bulk_update_snag_status",
  addManualSnag: "nirmaan_stack.api.snags.tracking.add_manual_snag",
  batchDeletePreview: "nirmaan_stack.api.snags.tracking.get_batch_delete_preview",
  deleteBatch: "nirmaan_stack.api.snags.tracking.delete_batch",
} as const;

/** Badge styling per status. Mirrors the app's amber/sky/green/grey vocabulary. */
export const SNAG_STATUS_BADGE_STYLES: Record<SnagStatus, string> = {
  Pending: "bg-amber-100 text-amber-700 border-amber-200",
  WIP: "bg-sky-100 text-sky-700 border-sky-200",
  Completed: "bg-green-100 text-green-700 border-green-200",
  "Not Applicable": "bg-gray-100 text-gray-600 border-gray-200",
};

/**
 * The one status that takes NO remark (owner decision Q2a, ADR-0018).
 *
 * The status-change dialog shows no remark box for it and the client sends no
 * `remark` key at all — the server REFUSES a remark (even `""`) alongside this
 * status, so sending one would turn a routine disposal into an error toast.
 */
export const SNAG_NO_REMARK_STATUS: SnagStatus = "Not Applicable";
