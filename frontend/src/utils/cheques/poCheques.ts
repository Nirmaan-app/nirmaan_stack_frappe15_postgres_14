import { CHEQUE_TYPE, type ChequeType } from "@/types/NirmaanStack/Cheques";

import { WO_DOCTYPE, type LineOfRecord } from "./chequeDeposit";

/**
 * The PO page's "Cheques issued for this PO" card (#1521, spec #1514, stories 20-23), and the same card on a Work
 * Order page (ADR-0035 Amendment C), pure so vitest covers it without React (F4). The card lists, through the
 * Cheque Tracker's list (`api/cheques/list_cheques.get_cheques`), the Payment cheques with a line on the PO and
 * the Security Deposit cheques that secure the PO or Work Order.
 */

/**
 * The card's words for the page it sits on. A Work Order is paid Online, never by cheque, so its card only ever
 * lists the Security Deposit cheques that secure it (ADR-0035 Amendment C).
 */
export const chequesCardCopy = (doctype: string) =>
    doctype === WO_DOCTYPE
        ? {
            title: "Security Deposits for this WO",
            subtitle: "Work Orders are paid online, so only Security Deposit cheques appear here: cheques handed to its vendor as a guarantee.",
            empty: "No Security Deposit cheque secures this WO.",
            onlyThis: "Only this WO",
        }
        : {
            title: "Cheques issued for this PO",
            subtitle: "Payment cheques that pay this PO, and Security Deposit cheques handed to its vendor as a guarantee.",
            empty: "No cheque has been issued for this PO.",
            onlyThis: "Only this PO",
        };

/** The list filters for the card: every cheque, of either type, whose lines name `po` (or a Work Order). */
export const poChequesFilters = (po: string): [string, "=", string][] => [["record_name", "=", po]];

/** What a row needs to say how much of it is for the PO (`record_amount`: its lines' total on that PO). */
interface PoChequeAmountRow {
    cheque_type: ChequeType;
    amount: number;
    record_amount?: number | null;
}

const paise = (v: number) => Math.round(v * 100);

/**
 * The row's amount: what a Payment cheque pays for this PO, and the whole cheque (`whole`, shown smaller) only
 * when it also pays something else (story 23). A deposit pays nothing on the PO it secures, so it shows whole.
 */
export const poChequeAmount = (row: PoChequeAmountRow): { forPo: number; whole: number | null } => {
    if (row.cheque_type === CHEQUE_TYPE.SECURITY_DEPOSIT || row.record_amount == null) {
        return { forPo: row.amount, whole: null };
    }
    return { forPo: row.record_amount, whole: paise(row.record_amount) === paise(row.amount) ? null : row.amount };
};

/** The other POs the cheque's lines name beside `po`, once each, in line order. */
export const alsoFor = (lines: LineOfRecord[], po: string): string[] => [
    ...new Set(lines.flatMap((l) => (l.record_name && l.record_name !== po ? [l.record_name] : []))),
];
