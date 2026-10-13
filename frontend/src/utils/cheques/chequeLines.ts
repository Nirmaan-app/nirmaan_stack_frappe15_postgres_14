import formatToIndianRupee from "@/utils/FormatPrice";
import { parseNumber } from "@/utils/parseNumber";
import { PAYMENT_STATUS } from "@/pages/ProjectPayments/approve-payments/constants";
import type { ChequeLineType } from "@/types/NirmaanStack/Cheques";

/**
 * The Add Cheque dialog's lines (spec #1407, #1410), pure so vitest covers them without React (F4).
 *
 * The server (`services/cheques/lines.py`) enforces every line rule; these only shape what the
 * dialog shows: the lines total, the picker's "not shown" footer, the hint on a picked payment.
 */

/** A soft warning only: lines may differ from the cheque by up to this much (rounding). */
export const LINES_GAP_TOLERANCE = 2;

/** One line as the form holds it. `payment_name` is "" for "No payment yet". */
export interface ChequeLineDraft {
    line_type: ChequeLineType;
    project: string;
    record_doctype: string;
    record_name: string;
    payment_name: string;
    amount: number | string;
}

/** One of the Vendor's POs or Work Orders (`api/cheques/pickers.get_vendor_records`). */
export interface VendorRecord {
    doctype: "Procurement Orders" | "Service Requests";
    name: string;
    project: string;
    project_name: string;
    status: string;
    total_amount: number;
}

/** A payment the picker offers (`api/cheques/pickers.get_eligible_payments`). */
export interface EligiblePayment {
    name: string;
    amount: number;
    status: string;
    mode_of_payment: string;
    on_hold: number;
}

/** What the payment picker hid, and why. */
export interface HiddenPayments {
    on_cheque: { payment: string; cheque: string; cheque_no: string; status: string }[];
    rejected: number;
}

export interface EligiblePayments {
    payments: EligiblePayment[];
    hidden: HiddenPayments;
}

/** The Cheque line arguments `save_cheque` takes. */
export interface SaveLineArg {
    line_type: ChequeLineType;
    project: string;
    record_doctype: string;
    record_name: string;
    payment_name?: string;
    amount: number;
}

export const EMPTY_PO_WO_LINE: ChequeLineDraft = {
    line_type: "PO/WO Payment",
    project: "",
    record_doctype: "",
    record_name: "",
    payment_name: "",
    amount: "",
};

/** "Lines total ₹X of ₹Y", and a soft warning when they differ by more than ₹2. Nothing for no lines. */
export const linesSummary = (chequeAmount: number | string, lines: ChequeLineDraft[]) => {
    const total = lines.reduce((sum, l) => sum + parseNumber(l.amount), 0);
    if (lines.length === 0) return { total, text: undefined, warning: undefined };
    const amount = parseNumber(chequeAmount);
    const gap = Math.round((amount - total) * 100) / 100;
    const text = `Lines total ${formatToIndianRupee(total)} of ${formatToIndianRupee(amount)}`;
    let warning: string | undefined;
    if (gap > LINES_GAP_TOLERANCE) warning = `The lines are ${formatToIndianRupee(gap)} short of the cheque amount.`;
    if (gap < -LINES_GAP_TOLERANCE) warning = `The lines are ${formatToIndianRupee(-gap)} more than the cheque amount.`;
    return { total, text, warning };
};

/** The payment picker's footer: "Not shown: 1 already on cheque 004530 (Issued), 1 Rejected." */
export const hiddenPaymentsText = (hidden: HiddenPayments | undefined): string => {
    if (!hidden) return "";
    const parts: string[] = [];
    const onCheque = hidden.on_cheque;
    if (onCheque.length) {
        const cheques = onCheque.map((c) => `${c.cheque_no} (${c.status})`);
        parts.push(`${onCheque.length} already on cheque${new Set(cheques).size > 1 ? "s" : ""} ${[...new Set(cheques)].join(", ")}`);
    }
    if (hidden.rejected) parts.push(`${hidden.rejected} Rejected`);
    return parts.length ? `Not shown: ${parts.join(", ")}.` : "";
};

/** What saving the Cheque does to a picked payment (the blue hint on its line). */
export const conversionHint = (p: Pick<EligiblePayment, "status" | "mode_of_payment" | "on_hold">): string => {
    const lead = p.mode_of_payment === "Cheque" ? "Goes on this cheque" : "Switches to Cheque";
    switch (p.status) {
        case PAYMENT_STATUS.APPROVED:
            return p.on_hold
                ? `${lead}; stays Approved while on hold and moves to Reconciliation Pending once released.`
                : `${lead} and moves to Reconciliation Pending now.`;
        case PAYMENT_STATUS.REQUESTED:
        case PAYMENT_STATUS.CEO_PENDING:
            return `${lead}; moves to Reconciliation Pending once approved.`;
        default:
            return `${lead}; stays ${p.status}.`;
    }
};

/** The projects the Vendor has POs or Work Orders in, once each, by name. */
export const lineProjects = (records: VendorRecord[]) => {
    const byProject = new Map<string, string>();
    for (const r of records) if (r.project && !byProject.has(r.project)) byProject.set(r.project, r.project_name || r.project);
    return [...byProject]
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label));
};

/** The Vendor's POs and Work Orders in one project. */
export const recordsInProject = (records: VendorRecord[], project: string) =>
    project ? records.filter((r) => r.project === project) : [];

/** The lines as `save_cheque` takes them: a picked payment, or the typed amount alone. */
export const saveLineArgs = (lines: ChequeLineDraft[]): SaveLineArg[] =>
    lines.map((l) => ({
        line_type: l.line_type,
        project: l.project,
        record_doctype: l.record_doctype,
        record_name: l.record_name,
        ...(l.payment_name ? { payment_name: l.payment_name } : {}),
        amount: parseNumber(l.amount),
    }));
