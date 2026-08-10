// src/pages/outflow-import/outflowImportStatus.ts
//
// PURE MODULE -- no React, no fetching. The frontend mirror of
// `nirmaan_stack/services/outflow_import/status.py` (ADR-0010 F1).
//
// ⚠️ THE BACKEND IS THE AUTHORITY. Every status a row or batch actually carries is derived and
// PERSISTED server-side; this module never decides one. What it does is let the screen reason
// about a status it was handed -- group rows, tone a chip, count what is left -- without a round
// trip and without re-implementing policy.
//
// PARITY IS PINNED ON BOTH SIDES. `outflowImportStatus.test.ts` asserts the exact vocabulary
// below, and `services/outflow_import/test_status.py` asserts the same list in Python. Changing
// one without the other breaks a test rather than producing a status the other half has never
// heard of and silently renders as unstyled text.
//
// ⚠️ REWRITTEN AT THE v3 REVERSAL (owner, 2026-08-06). The import now PAYS what is already
// approved, on all three ledgers. `Reconciled`, `Amount mismatch`, `Reference mismatch` and
// `Control exception` are retired; `Mismatched` replaces the amount case. Rationale lives in the
// Python module's docstring -- it is the authority, and duplicating it here is how the two drift.
//
// ⚠️ `Unmatched` MERGED INTO `Mismatched` (owner, 2026-08-10) -- seven statuses became six. Same
// job to the reviewer either way: a transfer that did not line up. The CAUSE moved to the outcome
// note, which already said which case a row was.

export const ROW_PENDING_MATCH = "Pending match run";
export const ROW_MATCHED = "Matched";
export const ROW_MISMATCHED = "Mismatched";
export const ROW_SETTLED = "Settled";
export const ROW_SKIPPED = "Skipped";
export const ROW_ERROR = "Error";

export type RowStatus =
    | typeof ROW_PENDING_MATCH
    | typeof ROW_MATCHED
    | typeof ROW_MISMATCHED
    | typeof ROW_SETTLED
    | typeof ROW_SKIPPED
    | typeof ROW_ERROR;

/** Every status, in the order a reviewer should meet them. Mirrors status.py's ROW_STATUSES. */
export const ROW_STATUSES: RowStatus[] = [
    ROW_PENDING_MATCH,
    ROW_MATCHED,
    ROW_MISMATCHED,
    ROW_SETTLED,
    ROW_SKIPPED,
    ROW_ERROR,
];

/**
 * Needs no further action.
 *
 * ⚠️ NARROWER THAN v2, deliberately. A v2 finding was terminal because reporting it was the whole
 * job. v3 settles, so a row that found something and has not been confirmed is unfinished work.
 */
export const TERMINAL_ROW_STATUSES: ReadonlySet<string> = new Set([ROW_SETTLED, ROW_SKIPPED]);

/** Someone still owes this row a decision. Everything that is not terminal. */
export const OPEN_ROW_STATUSES: ReadonlySet<string> = new Set([
    ROW_PENDING_MATCH,
    ROW_MATCHED,
    ROW_MISMATCHED,
    ROW_ERROR,
]);

export const BATCH_DRAFT = "Draft";
export const BATCH_IN_REVIEW = "In Review";
export const BATCH_PARTIALLY_SETTLED = "Partially Settled";
export const BATCH_COMPLETED = "Completed";

export const BATCH_STATUSES: string[] = [
    BATCH_DRAFT,
    BATCH_IN_REVIEW,
    BATCH_PARTIALLY_SETTLED,
    BATCH_COMPLETED,
];

export const isTerminal = (status: string): boolean => TERMINAL_ROW_STATUSES.has(status);
export const isOpen = (status: string): boolean => OPEN_ROW_STATUSES.has(status);

/**
 * Batch status from its rows' statuses. Mirrors `status.derive_batch_status`.
 *
 * Used to preview what a pending action WOULD produce -- the persisted value still comes from the
 * server. The v2 `forceClosed` argument is gone with `Completed with exceptions`: closing a batch
 * records `closed_at` and no longer changes what the status says.
 */
export function deriveBatchStatus(rowStatuses: string[]): string {
    if (!rowStatuses.length) return BATCH_DRAFT;
    const open = rowStatuses.filter(isOpen);
    const terminal = rowStatuses.filter(isTerminal);
    if (!open.length) return BATCH_COMPLETED;
    if (terminal.length) return BATCH_PARTIALLY_SETTLED;
    return BATCH_IN_REVIEW;
}

export interface BatchCounters {
    total_rows: number;
    reviewed_rows: number;
    settled_rows: number;
    skipped_rows: number;
    error_rows: number;
}

/** Mirrors `status.derive_batch_counters`. Every key is a live field on Outflow Import Batch. */
export function deriveBatchCounters(rowStatuses: string[]): BatchCounters {
    return {
        total_rows: rowStatuses.length,
        reviewed_rows: rowStatuses.filter((s) => s !== ROW_PENDING_MATCH).length,
        settled_rows: rowStatuses.filter((s) => s === ROW_SETTLED).length,
        skipped_rows: rowStatuses.filter((s) => s === ROW_SKIPPED).length,
        error_rows: rowStatuses.filter((s) => s === ROW_ERROR).length,
    };
}

/**
 * Chip tone per status.
 *
 * Red belongs to `Error` alone -- the only status meaning the software failed rather than the data
 * disagreed. Amber is `Mismatched`, the finding that needs a person to look. `Matched` is emerald
 * because it is the good case: something settleable was found and one click finishes it.
 *
 * ⚠️ `Mismatched` KEEPS AMBER after absorbing `Unmatched` (which was blue). Amber is the "needs
 * you" tone in this screen, and the merged status is now the bulk of the work rather than the rare
 * exception -- so if either tone had to win, it is this one.
 */
export const ROW_STATUS_TONE: Record<string, string> = {
    [ROW_PENDING_MATCH]: "bg-gray-100 text-gray-700",
    [ROW_MATCHED]: "bg-emerald-50 text-emerald-700",
    [ROW_MISMATCHED]: "bg-amber-50 text-amber-700",
    [ROW_SETTLED]: "bg-indigo-50 text-indigo-700",
    [ROW_SKIPPED]: "bg-gray-100 text-gray-500",
    [ROW_ERROR]: "bg-red-50 text-red-700",
};

export const rowStatusTone = (status: string): string =>
    ROW_STATUS_TONE[status] || "bg-gray-100 text-gray-700";

// ⚠️ `ROW_FILTERS` IS DELETED. It was the chip strip of the PRE-V4 review screen, kept alive
// through V0-V3 so that screen stayed green while the vocabulary under it changed. V4 replaced the
// screen with the tabbed table and X3 deleted it outright, leaving these buckets with no caller --
// a second, older answer to "which rows belong together" sitting beside `_SCOPE_STATUSES`, and one
// more list to keep in step every time the vocabulary moves. It moved again at the 2026-08-10
// merge, which is what surfaced it.
