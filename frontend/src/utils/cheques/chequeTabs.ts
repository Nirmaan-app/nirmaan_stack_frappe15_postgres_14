import { CHEQUE_STATUS, CHEQUE_TYPE } from "@/types/NirmaanStack/Cheques";

/**
 * Which Cheques each Cheque Tracker tab lists (spec #1477, #1483), pure so vitest covers it (F4).
 *
 * Each tab is a list of filters, sent as is to `api/cheques/list_cheques.get_cheques`. `isInChequeTab` reads
 * the same filters, so the rows a tab fetches and the rule it states cannot drift apart. The Security
 * Deposits tab (#1486) adds its own entry here.
 *
 * The Issued tab lists the Payment cheques waiting for the bank. Their payments sit at Reconciliation Pending,
 * so Project Payments' Reconciliation Pending tab leaves them out (`RECONCILIATION_PENDING_LEAVES_OUT`): each
 * such payment is listed in exactly one of the two places.
 */

export const CHEQUE_TRACKER_TAB = {
    ALL: "all",
    ISSUED: "issued",
} as const;

export type ChequeTrackerTab = (typeof CHEQUE_TRACKER_TAB)[keyof typeof CHEQUE_TRACKER_TAB];

/** The fields a tab filters on, as `get_cheques` returns them. */
export interface ChequeTabRow {
    status: string;
    cheque_type: string;
}

/** One equality filter of `get_cheques`. */
export type ChequeTabFilter = [field: keyof ChequeTabRow, op: "=", value: string];

interface ChequeTabDef {
    value: ChequeTrackerTab;
    label: string;
    filters: ChequeTabFilter[];
}

/** The tabs, in strip order. */
export const CHEQUE_TRACKER_TABS: readonly ChequeTabDef[] = [
    { value: CHEQUE_TRACKER_TAB.ALL, label: "All Cheques", filters: [] },
    {
        value: CHEQUE_TRACKER_TAB.ISSUED,
        label: "Cheque Issued – Reconciliation Pending",
        filters: [
            ["status", "=", CHEQUE_STATUS.ISSUED],
            ["cheque_type", "=", CHEQUE_TYPE.PAYMENT],
        ],
    },
];

const defOf = (tab: ChequeTrackerTab): ChequeTabDef =>
    CHEQUE_TRACKER_TABS.find((t) => t.value === tab) ?? CHEQUE_TRACKER_TABS[0];

/** The filters a tab sends to the list endpoint. */
export const chequeTabFilters = (tab: ChequeTrackerTab): ChequeTabFilter[] => defOf(tab).filters;

/** Whether a Cheque belongs in a tab. */
export const isInChequeTab = (row: ChequeTabRow, tab: ChequeTrackerTab): boolean =>
    chequeTabFilters(tab).every(([field, , value]) => row[field] === value);

/** The tab a `?tab=` value names; All Cheques for a missing or unknown one. */
export const chequeTrackerTabOf = (param: string | null | undefined): ChequeTrackerTab =>
    CHEQUE_TRACKER_TABS.find((t) => t.value === param)?.value ?? CHEQUE_TRACKER_TAB.ALL;

/**
 * Whether a payment waits in the Cheque Tracker's Issued tab rather than in Project Payments' Reconciliation
 * Pending: it is on an Issued cheque. `cheque_status` is the approval queue's column (blank for an Online
 * payment or an expense).
 */
export const waitsInChequeTracker = (payment: { cheque_status?: string | null }): boolean =>
    payment.cheque_status === CHEQUE_STATUS.ISSUED;

/** The filter Project Payments' Reconciliation Pending tab adds, so it lists none of those payments. */
export const RECONCILIATION_PENDING_LEAVES_OUT: [string, string, string] = ["cheque_status", "!=", CHEQUE_STATUS.ISSUED];
