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

export const ROW_PENDING = "Pending";
export const ROW_RECONCILED = "Reconciled";
export const ROW_AMOUNT_MISMATCH = "Amount mismatch";
export const ROW_REFERENCE_MISMATCH = "Reference mismatch";
export const ROW_CONTROL_EXCEPTION = "Control exception";
export const ROW_UNMATCHED = "Unmatched";
export const ROW_SETTLED = "Settled";
export const ROW_SKIPPED = "Skipped";
export const ROW_ERROR = "Error";

export type RowStatus =
    | typeof ROW_PENDING
    | typeof ROW_RECONCILED
    | typeof ROW_AMOUNT_MISMATCH
    | typeof ROW_REFERENCE_MISMATCH
    | typeof ROW_CONTROL_EXCEPTION
    | typeof ROW_UNMATCHED
    | typeof ROW_SETTLED
    | typeof ROW_SKIPPED
    | typeof ROW_ERROR;

/** Every status, in the order a reviewer should meet them. Mirrors status.py's vocabulary. */
export const ROW_STATUSES: RowStatus[] = [
    ROW_PENDING,
    ROW_RECONCILED,
    ROW_AMOUNT_MISMATCH,
    ROW_REFERENCE_MISMATCH,
    ROW_CONTROL_EXCEPTION,
    ROW_UNMATCHED,
    ROW_SETTLED,
    ROW_SKIPPED,
    ROW_ERROR,
];

/** Needs no further action. A read-only FINDING is terminal -- reporting it was the whole job. */
export const TERMINAL_ROW_STATUSES: ReadonlySet<string> = new Set([
    ROW_RECONCILED,
    ROW_AMOUNT_MISMATCH,
    ROW_REFERENCE_MISMATCH,
    ROW_CONTROL_EXCEPTION,
    ROW_SETTLED,
    ROW_SKIPPED,
]);

/** Someone still owes this row a decision. */
export const OPEN_ROW_STATUSES: ReadonlySet<string> = new Set([
    ROW_PENDING,
    ROW_UNMATCHED,
    ROW_ERROR,
]);

/** Reported findings -- the reconciliation report's subject. */
export const EXCEPTION_ROW_STATUSES: ReadonlySet<string> = new Set([
    ROW_AMOUNT_MISMATCH,
    ROW_REFERENCE_MISMATCH,
    ROW_CONTROL_EXCEPTION,
]);

export const BATCH_DRAFT = "Draft";
export const BATCH_IN_REVIEW = "In Review";
export const BATCH_PARTIALLY_SETTLED = "Partially Settled";
export const BATCH_COMPLETED = "Completed";
export const BATCH_COMPLETED_WITH_EXCEPTIONS = "Completed with exceptions";

export const isTerminal = (status: string): boolean => TERMINAL_ROW_STATUSES.has(status);
export const isOpen = (status: string): boolean => OPEN_ROW_STATUSES.has(status);
export const isException = (status: string): boolean => EXCEPTION_ROW_STATUSES.has(status);

/**
 * Batch status from its rows' statuses. Mirrors `status.derive_batch_status`.
 *
 * Used to preview what a pending action WOULD produce -- the persisted value still comes from the
 * server.
 */
export function deriveBatchStatus(rowStatuses: string[], forceClosed = false): string {
    if (!rowStatuses.length) return BATCH_DRAFT;
    const open = rowStatuses.filter(isOpen);
    const terminal = rowStatuses.filter(isTerminal);
    if (!open.length) return BATCH_COMPLETED;
    if (forceClosed) return BATCH_COMPLETED_WITH_EXCEPTIONS;
    if (terminal.length) return BATCH_PARTIALLY_SETTLED;
    return BATCH_IN_REVIEW;
}

export interface BatchCounters {
    total_rows: number;
    reviewed_rows: number;
    reconciled_rows: number;
    settled_rows: number;
    skipped_rows: number;
    exception_rows: number;
    error_rows: number;
}

/** Mirrors `status.derive_batch_counters`. */
export function deriveBatchCounters(rowStatuses: string[]): BatchCounters {
    return {
        total_rows: rowStatuses.length,
        reviewed_rows: rowStatuses.filter((s) => s !== ROW_PENDING).length,
        reconciled_rows: rowStatuses.filter((s) => s === ROW_RECONCILED).length,
        settled_rows: rowStatuses.filter((s) => s === ROW_SETTLED).length,
        skipped_rows: rowStatuses.filter((s) => s === ROW_SKIPPED).length,
        exception_rows: rowStatuses.filter(isException).length,
        error_rows: rowStatuses.filter((s) => s === ROW_ERROR).length,
    };
}

/**
 * Chip tone per status.
 *
 * The three exception states share ONE amber tone deliberately. They are different findings but
 * the same call to action -- a person has to look -- and giving each its own colour would imply a
 * severity ranking the design does not have. Red belongs to `Error` alone, which is the only
 * status meaning the software failed rather than the data disagreed.
 */
export const ROW_STATUS_TONE: Record<string, string> = {
    [ROW_PENDING]: "bg-gray-100 text-gray-700",
    [ROW_RECONCILED]: "bg-emerald-50 text-emerald-700",
    [ROW_AMOUNT_MISMATCH]: "bg-amber-50 text-amber-700",
    [ROW_REFERENCE_MISMATCH]: "bg-amber-50 text-amber-700",
    [ROW_CONTROL_EXCEPTION]: "bg-amber-50 text-amber-700",
    [ROW_UNMATCHED]: "bg-blue-50 text-blue-700",
    [ROW_SETTLED]: "bg-indigo-50 text-indigo-700",
    [ROW_SKIPPED]: "bg-gray-100 text-gray-500",
    [ROW_ERROR]: "bg-red-50 text-red-700",
};

export const rowStatusTone = (status: string): string =>
    ROW_STATUS_TONE[status] || "bg-gray-100 text-gray-700";

/** Filter buckets for the review screen's chip strip. */
export const ROW_FILTERS: { id: string; label: string; match: (s: string) => boolean }[] = [
    { id: "all", label: "All", match: () => true },
    { id: "open", label: "Needs a decision", match: isOpen },
    { id: "exceptions", label: "Exceptions", match: isException },
    { id: "reconciled", label: "Reconciled", match: (s) => s === ROW_RECONCILED },
    { id: "skipped", label: "Skipped", match: (s) => s === ROW_SKIPPED },
];
