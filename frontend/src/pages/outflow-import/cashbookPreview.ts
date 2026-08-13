// src/pages/outflow-import/cashbookPreview.ts
//
// The Cashbook import's preview, as pure data. No React, no fetch, no DOM.
//
// ⚠️ THIS SCREEN IS READ-ONLY, AND THAT RAISES THE BAR RATHER THAN LOWERING IT (owner ruling Q2).
// Nothing here can be corrected before it is written, so the preview's only job is to make a wrong
// placement FINDABLE in about ten seconds. Every ordering decision below serves that and nothing
// else -- see `sortGroups`.

export const PROJECT_LEDGER = "Project Expenses";
export const NON_PROJECT_LEDGER = "Non Project Expenses";

export interface CashbookPreviewRow {
    row_number: number;
    transfer_id: string;
    amount: number;
    remarks: string;
    beneficiary_name: string;
    spent_by: string;
    expense_type: string | null;
    matched_keyword: string;
    is_fallback_type: boolean;
}

export interface CashbookPreviewGroup {
    ledger: string;
    key: string;
    label: string;
    count: number;
    value: number;
    rows: CashbookPreviewRow[];
}

export interface CashbookSkippedRow {
    row_number: number;
    transfer_id: string;
    amount: number;
    remarks: string;
    reason: string;
}

export interface CashbookPreviewResult {
    preview: true;
    source: string;
    original_filename: string;
    period_from: string | null;
    period_to: string | null;
    total_rows: number;
    creating: number;
    skipping: number;
    total_value: number;
    warnings: string[];
    groups: CashbookPreviewGroup[];
    skipped: CashbookSkippedRow[];
}

export interface CashbookConfirmResult {
    batch: string;
    creating: number;
    skipping: number;
}

export interface CashbookStatus {
    batch: string;
    created: number;
    failed: number;
    skipped: number;
    pending: number;
    running: boolean;
    batch_status: string | null;
}

export interface LedgerSection {
    ledger: string;
    title: string;
    groups: CashbookPreviewGroup[];
    count: number;
    value: number;
}

/**
 * The two blocks the tree renders, each with its own total.
 *
 * A ledger with nothing in it is OMITTED rather than shown at zero. An empty heading reads as a
 * category that failed to fill; a missing one reads as a statement that had none of that kind,
 * which is what actually happened.
 */
export const ledgerSections = (groups: CashbookPreviewGroup[]): LedgerSection[] =>
    [
        { ledger: PROJECT_LEDGER, title: "Project expenses" },
        { ledger: NON_PROJECT_LEDGER, title: "Non-project expenses" },
    ]
        .map(({ ledger, title }) => {
            const mine = sortGroups(groups.filter((group) => group.ledger === ledger));
            return {
                ledger,
                title,
                groups: mine,
                count: mine.reduce((total, group) => total + group.count, 0),
                value: mine.reduce((total, group) => total + group.value, 0),
            };
        })
        .filter((section) => section.groups.length > 0);

/**
 * Largest value first.
 *
 * ⚠️ NOT A PRESENTATION CHOICE. It is the whole safety argument for a read-only preview: sorted by
 * value, the one-row groups sink into a contiguous block at the bottom, and a project with one
 * small row is exactly the shape a wrong match takes. Measured on a real statement, both known bad
 * matches landed in the last seven lines of a fourteen-line list.
 *
 * The server already sorts this way; re-sorting here means the screen does not depend on that
 * staying true, and a label tie-break keeps the order stable rather than letting equal values
 * shuffle between renders.
 */
export const sortGroups = (groups: CashbookPreviewGroup[]): CashbookPreviewGroup[] =>
    [...groups].sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));

/** A group holding a single row -- worth marking, because that is what a bad match looks like. */
export const isLoneRow = (group: CashbookPreviewGroup): boolean => group.count === 1;

/**
 * How the expense type reads on a row.
 *
 * The fallback is named rather than left blank, because "we could not tell" is a real answer and
 * an empty cell is not. `matched_keyword` says which word chose a type, so a surprising one can be
 * traced back to the rule that caused it without opening anything.
 */
export const typeLabel = (row: CashbookPreviewRow): string => row.expense_type || "—";

export const typeHint = (row: CashbookPreviewRow): string => {
    if (row.is_fallback_type) return "No rule matched this remark";
    return row.matched_keyword ? `Matched “${row.matched_keyword}”` : "";
};

/** "Create 115 records" -- the same verb the completion message uses. */
export const createLabel = (count: number): string =>
    `Create ${count} ${count === 1 ? "record" : "records"}`;

/**
 * What the progress line says.
 *
 * ⚠️ IT REPORTS WHAT HAPPENED, NEVER THE POPULATION. A run that failed rows must say so on the
 * line that says it finished -- a "Created 115 records" beside three failures is the shape that
 * gets failures ignored.
 */
export const progressText = (status: CashbookStatus | null, creating: number): string => {
    if (!status) return `Creating ${creating}…`;
    const done = status.created + status.failed;
    if (status.running) return `Created ${status.created} of ${creating}…`;
    if (status.failed > 0) {
        return `Created ${status.created}. ${status.failed} could not be created — they are marked on the transactions screen.`;
    }
    return `Created ${done} ${done === 1 ? "record" : "records"}.`;
};

/** 0..1, for the bar. Never divides by zero, never exceeds 1. */
export const progressFraction = (status: CashbookStatus | null, creating: number): number => {
    if (!creating) return 1;
    if (!status) return 0;
    return Math.min(1, (status.created + status.failed) / creating);
};
