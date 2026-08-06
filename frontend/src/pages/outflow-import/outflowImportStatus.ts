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
// `Control exception` are retired; `Mismatched` replaces the amount case and is about AMOUNTS
// ONLY. Rationale lives in the Python module's docstring -- it is the authority, and duplicating
// it here is how the two drift.

export const ROW_PENDING_MATCH = "Pending match run";
export const ROW_MATCHED = "Matched";
export const ROW_UNMATCHED = "Unmatched";
export const ROW_MISMATCHED = "Mismatched";
export const ROW_SETTLED = "Settled";
export const ROW_SKIPPED = "Skipped";
export const ROW_ERROR = "Error";

export type RowStatus =
    | typeof ROW_PENDING_MATCH
    | typeof ROW_MATCHED
    | typeof ROW_UNMATCHED
    | typeof ROW_MISMATCHED
    | typeof ROW_SETTLED
    | typeof ROW_SKIPPED
    | typeof ROW_ERROR;

/** Every status, in the order a reviewer should meet them. Mirrors status.py's ROW_STATUSES. */
export const ROW_STATUSES: RowStatus[] = [
    ROW_PENDING_MATCH,
    ROW_MATCHED,
    ROW_UNMATCHED,
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
    ROW_UNMATCHED,
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
 * disagreed. Amber is `Mismatched`, the one finding that needs a person to look. `Matched` is
 * emerald because it is the good case: something settleable was found and one click finishes it.
 */
export const ROW_STATUS_TONE: Record<string, string> = {
    [ROW_PENDING_MATCH]: "bg-gray-100 text-gray-700",
    [ROW_MATCHED]: "bg-emerald-50 text-emerald-700",
    [ROW_UNMATCHED]: "bg-blue-50 text-blue-700",
    [ROW_MISMATCHED]: "bg-amber-50 text-amber-700",
    [ROW_SETTLED]: "bg-indigo-50 text-indigo-700",
    [ROW_SKIPPED]: "bg-gray-100 text-gray-500",
    [ROW_ERROR]: "bg-red-50 text-red-700",
};

export const rowStatusTone = (status: string): string =>
    ROW_STATUS_TONE[status] || "bg-gray-100 text-gray-700";

/**
 * Filter buckets for the review screen's chip strip.
 *
 * ⚠️ INTERIM. V4 replaces this screen with a three-tab table carrying per-column facet filters, at
 * which point these buckets go. They are kept working through V0-V3 so the tree stays green and
 * the existing screen keeps functioning while the vocabulary underneath it changes.
 */
export const ROW_FILTERS: { id: string; label: string; match: (s: string) => boolean }[] = [
    { id: "all", label: "All", match: () => true },
    { id: "open", label: "Needs a decision", match: isOpen },
    { id: "matched", label: "Matched", match: (s) => s === ROW_MATCHED },
    { id: "mismatched", label: "Mismatched", match: (s) => s === ROW_MISMATCHED },
    { id: "settled", label: "Settled", match: (s) => s === ROW_SETTLED },
    { id: "skipped", label: "Skipped", match: (s) => s === ROW_SKIPPED },
];
