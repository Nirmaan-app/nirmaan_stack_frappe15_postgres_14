// src/pages/outflow-import/cashbookPreview.ts
//
// The Cashbook import's preview, as pure data. No React, no fetch, no DOM.
//
// ⚠️ THIS SCREEN IS READ-ONLY, AND THAT RAISES THE BAR RATHER THAN LOWERING IT (owner ruling Q2).
// Nothing here can be corrected before it is written, so the preview's only job is to make a wrong
// placement FINDABLE in about ten seconds. Every ordering decision below serves that and nothing
// else -- see `sortGroups`.

import type { CollectPaymentLine } from "./cashbookCollect";

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
    /** #1594: who paid or was paid, and the statement's Type. Absent from a server that predates it. */
    beneficiary_name?: string;
    row_kind?: string;
}

/** #1594: a Paired wallet refund -- the refund and the spend it gives back in full. Both lines are skipped. */
export interface CashbookRefundPair {
    refund: CashbookSkippedRow;
    spend: CashbookSkippedRow;
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
    /** ADR-0031, the Cashfree preview's keys with the same meanings: exact repeats NOT saved. */
    duplicate_rows: number;
    /** The lines this import will save -- a status-changed repeat included. */
    new_rows: number;
    duplicate_message: string;
    /** Nothing new at all: the confirm must not be offered. */
    refused: boolean;
    /** 90% or more already imported: offered anyway, with the message. */
    warn: boolean;
    duplicate_of_batch: string | null;
    /** #1591: the spends to create, by their bills. Absent from a server that predates it. */
    invoices?: InvoiceCounts;
    /** #1595: the Collect payments left open for a person to decide. Absent from a server that predates it. */
    collect_payments?: CollectPaymentLine[];
    /** #1594: the Paired wallet refunds; their lines are not in `skipped`. */
    pairs?: CashbookRefundPair[];
    /** #1594: the lines that stay open on the main table (unpaired wallet refunds, wallet credits). */
    open_lines?: CashbookSkippedRow[];
    opening?: number;
    /** #1593: existing Expenses that get a bill from a repeat line (itself not saved). */
    late_bills?: CashbookLateBill[];
    /** #1596: lines an earlier import skipped as own balances that this statement re-opens in place. */
    reopened?: CashbookReopenedLine[];
}

/**
 * #1596: a line an earlier import skipped as "own balances" that this statement re-opens in place, in the import
 * that holds it. It is also listed under what it becomes (a Collect payment, an open line, a pair).
 */
export interface CashbookReopenedLine extends CashbookSkippedRow {
    earlier_batch: string;
    becomes: "open" | "paired";
}

/** #1593: a repeat line bringing a bill for an existing Expense that still waits for one. */
export interface CashbookLateBill {
    row_number: number;
    transfer_id: string;
    amount: number;
    remarks: string;
    expense_doctype: string;
    expense: string;
    /** How many bill links the line carries: 2 or more are merged into one PDF. */
    bills: number;
}

export interface InvoiceCounts {
    /** One bill: it becomes the invoice as it is. */
    one_file: number;
    /** 2 to 4 bills: merged into one PDF. */
    merged: number;
    /** No bill: the Expense waits for an invoice. */
    waiting: number;
}

/** A spend whose bills the job could not copy onto its Expense, and the server's sentence saying why. */
export interface BillNotCopied {
    transfer_id: string;
    expense: string | null;
    reason: string;
}

export interface CashbookConfirmResult {
    batch: string;
    creating: number;
    skipping: number;
    /** How many already-imported lines the import left out (ADR-0031). */
    repeats_not_saved: number;
    /** #1593: how many existing Expenses the job gives a bill. Absent from a server that predates it. */
    late_bills?: number;
    /** #1596: how many earlier lines this import re-opened. */
    reopened?: number;
}

export interface CashbookStatus {
    batch: string;
    created: number;
    failed: number;
    skipped: number;
    pending: number;
    /** Bills the job has still to copy: open Collect payments' and late bills (code review S1, S2). Absent from a
     * server that predates it. */
    bills_waiting?: number;
    /** The batch's job is queued or running (the queue's answer, not the pending count; #1589). */
    running: boolean;
    /** Lines or bill copies still wait and no job is queued or running: the job stopped part-way, Resume finishes it. */
    stopped: boolean;
    batch_status: string | null;
    /** #1591: created spends whose bills were not copied. Absent from a server that predates it. */
    bills_not_copied?: BillNotCopied[];
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

export interface DuplicateNotice {
    tone: "refused" | "warn" | "info";
    text: string;
}

/**
 * What the preview says about lines that are already imported, or `null` when there are none
 * (ADR-0031). Those lines will not be saved at all, and the reader has to know that before clicking.
 *
 * ⚠️ THE SERVER'S SENTENCE, NOT A SECOND ONE WRITTEN HERE. `duplicate_message` is the same
 * `assess_duplicates` wording the Cashfree preview shows and names the earlier import; the count is
 * only a fallback for a server that predates it.
 *
 * ⚠️ REFUSED IS NOT A LOUDER WARN. A refusal means there is nothing to save and the confirm is not
 * offered; a warning keeps the confirm (owner ruling Q2) and only says how little is new.
 */
export const duplicateNotice = (preview: {
    duplicate_rows?: number;
    duplicate_message?: string;
    refused?: boolean;
    warn?: boolean;
}): DuplicateNotice | null => {
    const count = preview.duplicate_rows ?? 0;
    if (count <= 0) return null;
    const text = preview.duplicate_message || `${count} already imported — will not be saved`;
    if (preview.refused) return { tone: "refused", text };
    return { tone: preview.warn ? "warn" : "info", text };
};

/**
 * Whether Create is offered (#1593, #1596): the file creates something, brings a bill for an existing Expense, or
 * re-opens an earlier wrong skip, and was not refused. A refusal is said by name so the button never depends on the
 * facts staying in step.
 */
export const canConfirm = (preview: {
    creating?: number;
    refused?: boolean;
    late_bills?: readonly CashbookLateBill[];
    reopened?: readonly CashbookReopenedLine[];
}): boolean =>
    !preview.refused &&
    ((preview.creating ?? 0) > 0 || (preview.late_bills?.length ?? 0) > 0 || (preview.reopened?.length ?? 0) > 0);

/**
 * The confirm button: "Create 115 records"; "Add 2 bills" for a file whose only work is late bills (#1593);
 * "Re-open 3 lines" for one whose only work is re-opening earlier wrong skips (#1596).
 */
export const confirmLabel = (preview: {
    creating?: number;
    late_bills?: readonly CashbookLateBill[];
    reopened?: readonly CashbookReopenedLine[];
}): string => {
    const creating = preview.creating ?? 0;
    const late = preview.late_bills?.length ?? 0;
    const reopened = preview.reopened?.length ?? 0;
    if (creating > 0) return createLabel(creating);
    if (late > 0) return `Add ${late} ${late === 1 ? "bill" : "bills"}`;
    if (reopened > 0) return `Re-open ${reopened} ${reopened === 1 ? "line" : "lines"}`;
    return createLabel(creating);
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
    const stopped = stoppedText(status);
    if (stopped) return stopped;
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

export const CASHBOOK_STATUS_METHOD = "nirmaan_stack.api.outflow_import.cashbook.get_cashbook_status";
export const CASHBOOK_RESUME_METHOD = "nirmaan_stack.api.outflow_import.cashbook.resume_cashbook_import";

/**
 * Resume is offered when the job stopped part-way: lines still wait and no job is queued or running (#1589).
 * The server's `stopped` decides it; the server asks every rule again on the press.
 */
export const showsResume = (status: CashbookStatus | null | undefined): boolean => Boolean(status?.stopped);

/**
 * "Stopped: N lines still waiting" for a job that stopped part-way, with ", M bills still to copy" when it also left
 * bill copies (or that alone when no line waits); null while it runs or once it is done.
 */
export const stoppedText = (status: CashbookStatus | null | undefined): string | null => {
    if (!status?.stopped) return null;
    const bills = status.bills_waiting ?? 0;
    const parts = [
        status.pending > 0 || bills === 0 ? `${status.pending} ${status.pending === 1 ? "line" : "lines"} still waiting` : null,
        bills > 0 ? `${bills} ${bills === 1 ? "bill" : "bills"} still to copy` : null,
    ].filter(Boolean);
    return `Stopped: ${parts.join(", ")}`;
};

const count = (n: number): string => n.toLocaleString("en-IN");

/**
 * What Review says about the bills before Create (#1591), or null when there is nothing to say:
 * "1,305 spends: 1,243 with 1 file, 62 with 2–4 files (merged), 886 will wait for an invoice".
 */
export const invoiceCountsText = (preview: {
    creating: number;
    invoices?: InvoiceCounts;
}): string | null => {
    const invoices = preview.invoices;
    if (!invoices || preview.creating <= 0) return null;
    const spends = `${count(preview.creating)} ${preview.creating === 1 ? "spend" : "spends"}`;
    return (
        `${spends}: ${count(invoices.one_file)} with 1 file, ` +
        `${count(invoices.merged)} with 2–4 files (merged), ` +
        `${count(invoices.waiting)} will wait for an invoice`
    );
};

/** One bill not copied as the import summary lists it: the Txn Id and its Expense, or an open Collect payment's line,
 * which has none (#1595). The server's reason follows it. */
export const billNotCopiedLabel = (line: BillNotCopied): string =>
    `${line.transfer_id} (${line.expense ? line.expense : "open Collect payment"})`;

/**
 * The heading over the spends whose bills the job could not copy (#1591), or null while it runs or when
 * every bill was copied. The lines under it are the server's, one per spend.
 */
export const billsNotCopiedHeading = (status: CashbookStatus | null | undefined): string | null => {
    const lines = status?.bills_not_copied ?? [];
    if (!status || status.running || lines.length === 0) return null;
    // Code review R6: an open Collect payment's line has no Expense (`expense` blank); it stays open to decide.
    const collect = lines.filter((line) => !line.expense).length;
    if (collect === 0) {
        return lines.length === 1
            ? "1 spend's bills were not copied. Its Expense waits for an invoice:"
            : `${count(lines.length)} spends' bills were not copied. Their Expenses wait for an invoice:`;
    }
    if (collect === lines.length) {
        return lines.length === 1
            ? "1 Collect payment's bills were not copied. It stays open on the main table for Create expense or Skip by hand:"
            : `${count(lines.length)} Collect payments' bills were not copied. They stay open on the main table for Create expense or Skip by hand:`;
    }
    return `${count(lines.length)} bills were not copied. Each Expense waits for an invoice; each Collect payment stays open on the main table:`;
};

/**
 * The heading over the Paired wallet refunds on Review (#1594), or null when there are none:
 * "2 paired wallet refunds: each refund gives back a whole spend, so neither line is recorded".
 */
export const pairsHeading = (pairs: readonly CashbookRefundPair[] | undefined): string | null => {
    const n = pairs?.length ?? 0;
    if (n === 0) return null;
    return n === 1
        ? "1 paired wallet refund: the refund gives back the whole spend, so neither line is recorded"
        : `${count(n)} paired wallet refunds: each refund gives back a whole spend, so neither line is recorded`;
};

/**
 * The heading over the lines that stay open (#1594), or null when there are none. They are decided on the
 * main table, with the choices a card credit has.
 */
export const openLinesHeading = (lines: readonly CashbookSkippedRow[] | undefined): string | null => {
    const n = lines?.length ?? 0;
    if (n === 0) return null;
    return n === 1
        ? "1 line will stay open for someone to decide on the transactions screen"
        : `${count(n)} lines will stay open for someone to decide on the transactions screen`;
};

/** How a pair's spend reads beside its refund: "Collect Payment OBO…3 · Testshop Collect Three". */
export const pairSpendLabel = (pair: CashbookRefundPair): string =>
    [`${pair.spend.row_kind || "Spend"} ${pair.spend.transfer_id}`, pair.spend.beneficiary_name || pair.spend.remarks]
        .filter(Boolean)
        .join(" · ");

/**
 * The heading over the existing Expenses that get a late bill (#1593), or null when there are none. The line
 * itself is an exact repeat and is not saved again; only its bills go on.
 */
export const lateBillsHeading = (lines: readonly CashbookLateBill[] | undefined): string | null => {
    const n = lines?.length ?? 0;
    if (n === 0) return null;
    return n === 1
        ? "1 existing Expense will get its bill. Its line is already imported and is not saved again"
        : `${count(n)} existing Expenses will get their bills. Their lines are already imported and are not saved again`;
};

/** How one late bill reads: "NPE-0042 · OBO… · Pay to merchant" (the bill count when there is no remark). */
export const lateBillLabel = (line: CashbookLateBill): string =>
    [line.expense, line.transfer_id, line.remarks || (line.bills > 1 ? `${line.bills} bills, merged` : "")]
        .filter(Boolean)
        .join(" · ");

/** The progress screen's line about the late bills (#1593), or null when there were none. */
export const lateBillsDoneText = (n: number, running: boolean): string | null => {
    if (n <= 0) return null;
    const expenses = `${count(n)} existing ${n === 1 ? "Expense" : "Expenses"}`;
    if (running) return `Adding bills to ${expenses}…`;
    return `${n === 1 ? "Bill" : "Bills"} added to ${expenses}, unless someone had already attached an invoice or marked it No invoice.`;
};

/**
 * The heading over the lines this statement re-opens (#1596), or null when there are none. Earlier imports skipped
 * them as moving money between our own balances; they come back under the new rules, in the import that holds them.
 */
export const reopenedHeading = (lines: readonly CashbookReopenedLine[] | undefined): string | null => {
    const n = lines?.length ?? 0;
    if (n === 0) return null;
    return n === 1
        ? "1 line an earlier import skipped as own balances will be re-opened under the new rules"
        : `${count(n)} lines earlier imports skipped as own balances will be re-opened under the new rules`;
};

/** How one re-opened line reads: "Wallet Credit PTM6 · in OFI-26-00237 · stays open". */
export const reopenedLabel = (line: CashbookReopenedLine): string =>
    [
        `${line.row_kind || "Line"} ${line.transfer_id}`,
        `in ${line.earlier_batch}`,
        line.becomes === "paired" ? "paired wallet refund" : "stays open",
    ].join(" · ");
