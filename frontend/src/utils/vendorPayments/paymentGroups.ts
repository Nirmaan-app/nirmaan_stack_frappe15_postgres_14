import { differenceInCalendarDays, parseISO } from "date-fns";

import { PAYMENT_STATUS } from "@/constants/paymentStatus";
import { PAYMENT_MODE_CHEQUE } from "@/pages/ProjectPayments/paymentMode";
import { parseNumber } from "@/utils/parseNumber";

/**
 * The Vendor page's Payments tab splits a vendor's Project Payments into three sub-tabs. Each payment sits in
 * exactly one. The rules are pure, so vitest covers them (F4):
 *
 * - **Paid**: status Paid, online or by a cheque the bank has cleared.
 * - **Cheque Issued**: a cheque payment at Reconciliation Pending. The cheques service issues a Payment cheque in
 *   the same write that moves its last payment to Reconciliation Pending (`services/cheques/status.py`), so this
 *   is a cheque handed to the vendor and not yet cleared. A cheque payment still at Approved has no issued cheque
 *   yet and stays in Other statuses. The Payments page splits them the same way: its Reconciliation Pending tab
 *   leaves out payments whose cheque is Issued (`chequeTabs.RECONCILIATION_PENDING_LEAVES_OUT`).
 * - **Other statuses**: everything else (Requested, CEO Pending, Approved, an online Reconciliation Pending,
 *   Rejected).
 *
 * `paymentGroupOf` states the rule for one row; `vendorPaymentGroupFilters` sends the same rule to the list
 * endpoint, so what a tab fetches and what the rule says cannot drift apart.
 */

export const VENDOR_PAYMENT_GROUP = {
    PAID: "paid",
    CHEQUE_ISSUED: "cheque_issued",
    OTHERS: "others",
} as const;

export type VendorPaymentGroup = (typeof VENDOR_PAYMENT_GROUP)[keyof typeof VENDOR_PAYMENT_GROUP];

/** The sub-tabs in the order they are shown. Paid opens first. */
export const VENDOR_PAYMENT_GROUPS: readonly VendorPaymentGroup[] = [
    VENDOR_PAYMENT_GROUP.PAID,
    VENDOR_PAYMENT_GROUP.CHEQUE_ISSUED,
    VENDOR_PAYMENT_GROUP.OTHERS,
];

export const DEFAULT_VENDOR_PAYMENT_GROUP: VendorPaymentGroup = VENDOR_PAYMENT_GROUP.PAID;

/** Each sub-tab's label and the one-line rule shown under the tab bar. */
export const VENDOR_PAYMENT_GROUP_TEXT: Record<VendorPaymentGroup, { label: string; rule: string }> = {
    [VENDOR_PAYMENT_GROUP.PAID]: { label: "Paid", rule: "Bank confirmed: online, or cheque cleared" },
    [VENDOR_PAYMENT_GROUP.CHEQUE_ISSUED]: { label: "Cheque Pending", rule: "Handed to the vendor, not cleared yet" },
    [VENDOR_PAYMENT_GROUP.OTHERS]: {
        label: "Other Pending Payments",
        rule: "Requested, CEO Pending, Approved, Reconciliation Pending, Rejected",
    },
};

/** Is this URL value one of the sub-tabs? (`useUrlPill`'s guard.) */
export const isVendorPaymentGroup = (value: string): value is VendorPaymentGroup =>
    VENDOR_PAYMENT_GROUPS.some((g) => g === value);

/** A sub-tab from a URL value; anything unknown opens Paid. */
export const parseVendorPaymentGroup = (value: string | null | undefined): VendorPaymentGroup =>
    value && isVendorPaymentGroup(value) ? value : DEFAULT_VENDOR_PAYMENT_GROUP;

/** The fields the grouping reads from a payment. */
export interface PaymentGroupFacts {
    status?: string | null;
    mode_of_payment?: string | null;
}

/** A cheque handed to the vendor and not yet cleared by the bank. */
export const isChequeIssuedPayment = (p: PaymentGroupFacts): boolean =>
    p.mode_of_payment === PAYMENT_MODE_CHEQUE && p.status === PAYMENT_STATUS.RECONCILIATION_PENDING;

/** The one sub-tab a payment belongs to. */
export const paymentGroupOf = (p: PaymentGroupFacts): VendorPaymentGroup => {
    if (p.status === PAYMENT_STATUS.PAID) return VENDOR_PAYMENT_GROUP.PAID;
    if (isChequeIssuedPayment(p)) return VENDOR_PAYMENT_GROUP.CHEQUE_ISSUED;
    return VENDOR_PAYMENT_GROUP.OTHERS;
};

/**
 * One filter of the list endpoint (`api/data-table.get_list_with_count_enhanced`), limited to the operators the tabs
 * send, so it is also a `frappe-react-sdk` list filter.
 */
export type PaymentListFilter =
    | [field: string, op: "=" | "!=", value: string]
    | [field: string, op: "not in", value: string[]];

/** The filters that find the Cheque Issued payments, before the vendor filter. */
export const CHEQUE_ISSUED_FILTERS: PaymentListFilter[] = [
    ["mode_of_payment", "=", PAYMENT_MODE_CHEQUE],
    ["status", "=", PAYMENT_STATUS.RECONCILIATION_PENDING],
];

/**
 * The list filters for one sub-tab of one vendor.
 *
 * The list endpoint joins filters with AND only, so Other statuses ("not Paid, and not Cheque Issued") cannot be
 * written as one OR. It leaves out the vendor's Cheque Issued payments by name instead: `chequeIssuedNames` is that
 * list, fetched with `CHEQUE_ISSUED_FILTERS`. A vendor has only the few cheques the bank has not cleared yet, so
 * the list stays short.
 */
export const vendorPaymentGroupFilters = (
    group: VendorPaymentGroup,
    vendorId: string,
    chequeIssuedNames: readonly string[] = [],
): PaymentListFilter[] => {
    const base: PaymentListFilter[] = [["vendor", "=", vendorId]];
    switch (group) {
        case VENDOR_PAYMENT_GROUP.PAID:
            return [...base, ["status", "=", PAYMENT_STATUS.PAID]];
        case VENDOR_PAYMENT_GROUP.CHEQUE_ISSUED:
            return [...base, ...CHEQUE_ISSUED_FILTERS];
        case VENDOR_PAYMENT_GROUP.OTHERS:
            return [
                ...base,
                ["status", "!=", PAYMENT_STATUS.PAID],
                ...(chequeIssuedNames.length ? [["name", "not in", [...chequeIssuedNames]] as PaymentListFilter] : []),
            ];
    }
};

/** One row of the vendor's payments counted by status and mode (a grouped `get_list`). */
export interface PaymentGroupCountRow {
    status?: string | null;
    mode_of_payment?: string | null;
    count?: number | string | null;
    amount?: number | string | null;
}

/** The figures shown for each sub-tab. */
export interface VendorPaymentSummary {
    paid: { count: number; amount: number; onlineCount: number; chequeCount: number };
    chequeIssued: { count: number; amount: number };
    /** `amount` leaves out Rejected payments: they will never be paid. */
    others: { count: number; amount: number; rejectedCount: number; rejectedAmount: number };
}

/** Adds up the grouped counts into each sub-tab's count and ₹ total. */
export const summarisePaymentGroups = (rows: readonly PaymentGroupCountRow[]): VendorPaymentSummary => {
    const summary: VendorPaymentSummary = {
        paid: { count: 0, amount: 0, onlineCount: 0, chequeCount: 0 },
        chequeIssued: { count: 0, amount: 0 },
        others: { count: 0, amount: 0, rejectedCount: 0, rejectedAmount: 0 },
    };
    for (const row of rows) {
        const count = parseNumber(row.count ?? 0);
        const amount = parseNumber(row.amount ?? 0);
        switch (paymentGroupOf(row)) {
            case VENDOR_PAYMENT_GROUP.PAID:
                summary.paid.count += count;
                summary.paid.amount += amount;
                if (row.mode_of_payment === PAYMENT_MODE_CHEQUE) summary.paid.chequeCount += count;
                else summary.paid.onlineCount += count;
                break;
            case VENDOR_PAYMENT_GROUP.CHEQUE_ISSUED:
                summary.chequeIssued.count += count;
                summary.chequeIssued.amount += amount;
                break;
            case VENDOR_PAYMENT_GROUP.OTHERS:
                summary.others.count += count;
                if (row.status === PAYMENT_STATUS.REJECTED) {
                    summary.others.rejectedCount += count;
                    summary.others.rejectedAmount += amount;
                } else {
                    summary.others.amount += amount;
                }
                break;
        }
    }
    return summary;
};

/** The count shown on a sub-tab. */
export const groupCount = (summary: VendorPaymentSummary, group: VendorPaymentGroup): number => {
    switch (group) {
        case VENDOR_PAYMENT_GROUP.PAID:
            return summary.paid.count;
        case VENDOR_PAYMENT_GROUP.CHEQUE_ISSUED:
            return summary.chequeIssued.count;
        case VENDOR_PAYMENT_GROUP.OTHERS:
            return summary.others.count;
    }
};

/**
 * The day a cheque payment's cheque was issued, as far as the payment knows: the later of its L1 and CEO approval
 * dates. The cheque itself is issued on its payments' last approval, so on a cheque covering several payments this
 * can be a day or two before the Cheque's own issue date. Blank when the payment carries neither date.
 */
export const chequeIssuedOn = (p: { approval_date?: string | null; ceo_approval_date?: string | null }): string => {
    const dates = [p.approval_date, p.ceo_approval_date].filter((d): d is string => !!d).map((d) => d.slice(0, 10));
    const sorted = dates.sort();
    return sorted[sorted.length - 1] ?? "";
};

/** "Issued today", "1 day, not cleared yet", "11 days, not cleared yet"; blank when the date is unknown. */
export const chequeWaitingText = (issuedOn: string, today: Date): string => {
    if (!issuedOn) return "";
    const days = Math.max(0, differenceInCalendarDays(today, parseISO(issuedOn)));
    if (days === 0) return "Issued today";
    return `${days} ${days === 1 ? "day" : "days"}, not cleared yet`;
};
