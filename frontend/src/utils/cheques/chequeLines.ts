import formatToIndianRupee from "@/utils/FormatPrice";
import { parseNumber } from "@/utils/parseNumber";
import { PAYMENT_STATUS } from "@/pages/ProjectPayments/approve-payments/constants";
import type { ChequeLineType } from "@/types/NirmaanStack/Cheques";

/**
 * The Add Cheque dialog's lines (spec #1407, #1410, #1411), pure so vitest covers them without React (F4).
 *
 * The server (`services/cheques/lines.py`) enforces every line rule; these only shape what the
 * dialog shows: the "Add line" menu and the boxes each kind asks for, the lines total, the pickers'
 * "not shown" footers, the hint on a picked payment.
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

/** An expense the expense picker offers (`api/cheques/pickers.get_eligible_expenses`, #1411). */
export interface EligibleExpense {
    name: string;
    amount: number;
    status: string;
    type: string | null;
    description: string | null;
    payment_date: string | null;
}

/** What the expense picker hid: expenses already on a Cheque that is not Cancelled. */
export interface HiddenExpenses {
    on_cheque: HiddenPayments["on_cheque"];
}

export interface EligibleExpenses {
    expenses: EligibleExpense[];
    hidden: HiddenExpenses;
}

/** The Cheque line arguments `save_cheque` takes. An expense line's expense goes in `payment_name`. */
export interface SaveLineArg {
    line_type: ChequeLineType;
    project?: string;
    record_doctype?: string;
    record_name?: string;
    payment_name?: string;
    amount: number;
}

export const LINE_TYPE = {
    PO_WO: "PO/WO Payment",
    PROJECT_EXPENSE: "Project Expense",
    NON_PROJECT_EXPENSE: "Non-project Expense",
} as const satisfies Record<string, ChequeLineType>;

/**
 * The boxes each line kind asks for (#1411). Mirrors `services/cheques/rules.LINE_NEEDS`. A PO/WO
 * line's payment is optional; an expense line's expense is required.
 */
export const LINE_NEEDS: Record<ChequeLineType, { project: boolean; record: boolean; expense: boolean }> = {
    [LINE_TYPE.PO_WO]: { project: true, record: true, expense: false },
    [LINE_TYPE.PROJECT_EXPENSE]: { project: true, record: false, expense: true },
    [LINE_TYPE.NON_PROJECT_EXPENSE]: { project: false, record: false, expense: true },
};

/** Each kind as the "Add line" menu and the Type column name it, and an expense kind's expense. */
export const LINE_LABELS: Record<ChequeLineType, string> = {
    [LINE_TYPE.PO_WO]: "PO or Work Order payment",
    [LINE_TYPE.PROJECT_EXPENSE]: "Project expense",
    [LINE_TYPE.NON_PROJECT_EXPENSE]: "Non-project expense",
};
export const EXPENSE_LABELS: Record<ChequeLineType, string> = {
    [LINE_TYPE.PO_WO]: "",
    [LINE_TYPE.PROJECT_EXPENSE]: "Project Expense",
    [LINE_TYPE.NON_PROJECT_EXPENSE]: "Non-Project Expense",
};

/** The dialog's note under the lines: linking an expense records it on the cheque, nothing more. */
export const EXPENSE_NOTE = "Linking an expense does not change it: the cheque only records which expenses it paid.";

export const emptyLine = (type: ChequeLineType): ChequeLineDraft => ({
    line_type: type,
    project: "",
    record_doctype: "",
    record_name: "",
    payment_name: "",
    amount: "",
});

/**
 * The "Add line" menu: the three kinds, each with why it is disabled, if it is. A cheque with a typed
 * payee takes expense lines only; a Vendor cheque offers PO/WO lines once its Vendor is picked.
 */
export const addLineOptions = ({ vendorPayee, vendor }: { vendorPayee: boolean; vendor?: string }) =>
    (Object.values(LINE_TYPE) as ChequeLineType[]).map((type) => {
        let disabledReason: string | undefined;
        if (type === LINE_TYPE.PO_WO && !vendorPayee) {
            disabledReason = "A PO or Work Order payment needs a cheque made out to a Vendor.";
        } else if (type === LINE_TYPE.PO_WO && !vendor) {
            disabledReason = "Pick the Vendor first: its POs and Work Orders are offered.";
        }
        return { type, label: LINE_LABELS[type], disabledReason };
    });

/** The lines left once the payee changes: PO/WO lines belong to the old Vendor, expense lines to anyone. */
export const withoutPoWoLines = (lines: ChequeLineDraft[]) => lines.filter((l) => l.line_type !== LINE_TYPE.PO_WO);

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

/** "2 already on cheque 004530 (Issued)", or "" when none was. */
const onChequeText = (onCheque: HiddenPayments["on_cheque"]): string => {
    if (!onCheque.length) return "";
    const cheques = [...new Set(onCheque.map((c) => `${c.cheque_no} (${c.status})`))];
    return `${onCheque.length} already on cheque${cheques.length > 1 ? "s" : ""} ${cheques.join(", ")}`;
};

/** The payment picker's footer: "Not shown: 1 already on cheque 004530 (Issued), 1 Rejected." */
export const hiddenPaymentsText = (hidden: HiddenPayments | undefined): string => {
    if (!hidden) return "";
    const parts = [onChequeText(hidden.on_cheque), hidden.rejected ? `${hidden.rejected} Rejected` : ""].filter(Boolean);
    return parts.length ? `Not shown: ${parts.join(", ")}.` : "";
};

/** The expense picker's footer: "Not shown: 2 already on cheque 004530 (Issued)." */
export const hiddenExpensesText = (hidden: HiddenExpenses | undefined): string => {
    const text = hidden ? onChequeText(hidden.on_cheque) : "";
    return text ? `Not shown: ${text}.` : "";
};

/** An expense in the picker: "NPE-1 · ₹6,000.00 · Electricity · Office power, Sept". */
export const expenseLabel = (e: EligibleExpense): string =>
    [e.name, formatToIndianRupee(e.amount), e.type, e.description?.trim()].filter(Boolean).join(" · ");

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

/** The lines as `save_cheque` takes them: only the boxes each kind asks for, a picked payment or
 * expense, and the amount. */
export const saveLineArgs = (lines: ChequeLineDraft[]): SaveLineArg[] =>
    lines.map((l) => {
        const needs = LINE_NEEDS[l.line_type];
        return {
            line_type: l.line_type,
            ...(needs.project ? { project: l.project } : {}),
            ...(needs.record ? { record_doctype: l.record_doctype, record_name: l.record_name } : {}),
            ...(l.payment_name ? { payment_name: l.payment_name } : {}),
            amount: parseNumber(l.amount),
        };
    });
