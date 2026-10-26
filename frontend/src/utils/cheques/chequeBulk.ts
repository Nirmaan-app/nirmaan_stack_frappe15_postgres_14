import { PAYMENT_STATUS } from "@/constants/paymentStatus";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { parseNumber } from "@/utils/parseNumber";

import {
    approvesThroughCheque,
    type ChequeApproval,
    type ChequeApprovalLine,
    type ChequeApprovalStage,
} from "./chequeApproval";

/**
 * Bulk approve and reject decide a Payment cheque as one (#1481, spec #1477): ticking one payment on a
 * Approval Pending cheque ticks its siblings, and the bulk dialog shows each cheque as one locked group with every
 * payment on it, ticked or not. Pure, so vitest covers it without React. The server
 * (`api/payments/bulk_actions`, `services/cheques/decide.py`) decides the whole cheque whatever was ticked.
 */

export const CHEQUE_GROUPS_API = "nirmaan_stack.api.payments.cheque_approval.get_cheque_groups";

/** The bulk action: approve or reject. */
export type ChequeBulkAction = "approve" | "reject";

/** The fields a queue row needs to say which cheque, if any, it is decided with. */
export interface ChequeSelectableRow {
    name: string;
    doctype?: string | null;
    cheque?: string | null;
    cheque_status?: string | null;
}

/** The cheque a queue row is decided with, or null for a row decided alone. */
export const chequeKeyOf = (row?: ChequeSelectableRow | null): string | null =>
    row && approvesThroughCheque(row) ? row.cheque ?? null : null;

/**
 * A selection change with each cheque's payments moved as one: ticking one ticks every row of the same
 * cheque on the page, and unticking one unticks them all. `rows` are the table's rows (`id` and the
 * queue row); selection state is keyed by row id, as TanStack keeps it.
 */
export const withChequeSiblings = (
    prev: Record<string, boolean>,
    next: Record<string, boolean>,
    rows: ReadonlyArray<{ id: string; original: ChequeSelectableRow }>,
): Record<string, boolean> => {
    const byCheque = new Map<string, string[]>();
    for (const row of rows) {
        const key = chequeKeyOf(row.original);
        if (key) byCheque.set(key, [...(byCheque.get(key) ?? []), row.id]);
    }
    const out: Record<string, boolean> = { ...next };
    for (const ids of byCheque.values()) {
        if (ids.length < 2) continue;
        const flipped = ids.find((id) => !!prev[id] !== !!next[id]);
        if (flipped === undefined) continue;
        const on = !!next[flipped];
        for (const id of ids) {
            if (on) out[id] = true;
            else delete out[id];
        }
    }
    return out;
};

/** One payment line of a cheque group in the bulk dialog. */
export interface BulkChequeLine extends ChequeApprovalLine {
    key: string;
    /** Ticked on the page; false for a sibling the cheque brings with it ("With its cheque"). */
    ticked: boolean;
}

export interface BulkChequeGroup {
    approval: ChequeApproval;
    lines: BulkChequeLine[];
    /** How many payments the group decides: every line that names one. */
    count: number;
}

/**
 * Splits a bulk selection into the cheque groups it decides and the rows decided alone. A row on a cheque
 * whose group is not loaded yet stays with the rows decided alone until it is.
 */
export const bulkChequeGroups = <R extends ChequeSelectableRow>(
    rows: readonly R[],
    approvals: readonly ChequeApproval[],
): { groups: BulkChequeGroup[]; others: R[] } => {
    const loaded = new Map(approvals.map((a) => [a.cheque, a]));
    const ticked = new Set(rows.map((r) => r.name));
    const others: R[] = [];
    const order: string[] = [];
    for (const row of rows) {
        const key = chequeKeyOf(row);
        if (key && loaded.has(key)) {
            if (!order.includes(key)) order.push(key);
        } else {
            others.push(row);
        }
    }
    const groups = order.map((key) => {
        const approval = loaded.get(key)!;
        const lines = approval.lines.map((line, i) => ({
            ...line,
            key: `${key}-${i}`,
            ticked: !!line.payment && ticked.has(line.payment),
        }));
        return { approval, lines, count: lines.filter((l) => l.payment).length };
    });
    return { groups, others };
};

/** What a bulk run decides: the rows decided alone plus every payment of every cheque group, and their sum. */
export const bulkDecisionTotals = (
    groups: readonly BulkChequeGroup[],
    others: readonly { amount?: number | string | null }[],
): { count: number; amount: number } => ({
    count: others.length + groups.reduce((n, g) => n + g.count, 0),
    amount:
        others.reduce((sum, r) => sum + parseNumber(r.amount), 0) +
        groups.reduce((sum, g) => sum + g.lines.reduce((s, l) => s + (l.payment ? l.amount : 0), 0), 0),
});

/**
 * The line under a cheque group's chip: what the bulk action does to the cheque.
 * "3 payments are approved together. Cheque total ₹68,400: goes on to the CEO."
 */
export const chequeGroupNote = (
    group: BulkChequeGroup,
    action: ChequeBulkAction,
    stage: ChequeApprovalStage,
): string => {
    const n = group.count;
    const payments = n === 1 ? "1 payment is" : `${n} payments are`;
    if (action === "reject") {
        return `${payments} rejected together and cheque ${group.approval.cheque_no} is cancelled.`;
    }
    const total = formatToRoundedIndianRupee(group.approval.amount);
    const toCeo = stage === "lead" && group.approval.status_after_l1 === PAYMENT_STATUS.CEO_PENDING;
    return `${payments} approved together. Cheque total ${total}${toCeo ? ": goes on to the CEO." : "."}`;
};

/** Why a cheque group will fail an approve, or null. A reject is never held back. */
export const chequeGroupProblem = (group: BulkChequeGroup, action: ChequeBulkAction): string | null =>
    action === "approve" ? group.approval.problem : null;
