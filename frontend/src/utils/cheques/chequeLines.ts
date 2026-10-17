import formatToIndianRupee from "@/utils/FormatPrice";
import { parseNumber } from "@/utils/parseNumber";
import { needsCEO, TIER_L2_ABOVE } from "@/utils/approvalTiers";
import { PAYMENT_STATUS } from "@/constants/paymentStatus";
import type { ChequeLineType } from "@/types/NirmaanStack/Cheques";

/**
 * The Add Cheque dialog's lines (spec #1407; #1482, spec #1477), pure so vitest covers them without React (F4).
 *
 * A Payment cheque's line names one of the Vendor's POs and one of its payments, or "No payment yet" with a
 * typed amount. The server (`services/cheques/rules.tracker_payment_cheque_problem`, `lines.py`) enforces
 * every line rule; these only shape what the dialog shows: the lines total, the picker's "not shown" footer,
 * the hint on a picked payment, the note on what saving does.
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
    /** The picked payment's status, for the dialog's note; never sent. */
    payment_status?: string;
    amount: number | string;
}

/** One of the Vendor's POs (`api/cheques/pickers.get_vendor_records`). */
export interface VendorRecord {
    doctype: "Procurement Orders";
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
}

/** What the payment picker hid, and why. */
export interface HiddenPayments {
    on_cheque: { payment: string; cheque: string; cheque_no: string; status: string }[];
    rejected: number;
    /** At a step other than the cheque's other payments'. */
    other_step: number;
    on_hold: number;
    /** Past approval, by status: Reconciliation Pending, Paid. */
    moved_on: Record<string, number>;
}

export interface EligiblePayments {
    payments: EligiblePayment[];
    /** The step the cheque's other lines' payments are at; null while they name none. */
    step: string | null;
    hidden: HiddenPayments;
}

/** The Cheque line arguments `save_cheque` takes. An Old-type expense line's expense goes in `payment_name`. */
export interface SaveLineArg {
    line_type: ChequeLineType;
    project?: string;
    record_doctype?: string;
    record_name?: string;
    payment_name?: string;
    /** None on a Secured PO/WO line: it pays nothing. */
    amount?: number;
}

export const LINE_TYPE = {
    PO_WO: "PO/WO Payment",
    PROJECT_EXPENSE: "Project Expense",
    NON_PROJECT_EXPENSE: "Non-project Expense",
    /** A Security Deposit cheque's line: a PO or Work Order it secures (#1486). */
    SECURED: "Secured PO/WO",
} as const satisfies Record<string, ChequeLineType>;

export const PO_DOCTYPE = "Procurement Orders";

/**
 * The boxes each line kind asks for (#1411). Mirrors `services/cheques/rules.LINE_NEEDS`. Expense kinds
 * appear only on Old-type cheques now.
 */
export const LINE_NEEDS: Record<ChequeLineType, { project: boolean; record: boolean; expense: boolean }> = {
    [LINE_TYPE.PO_WO]: { project: true, record: true, expense: false },
    [LINE_TYPE.PROJECT_EXPENSE]: { project: true, record: false, expense: true },
    [LINE_TYPE.NON_PROJECT_EXPENSE]: { project: false, record: false, expense: true },
    [LINE_TYPE.SECURED]: { project: true, record: true, expense: false },
};

/** Each kind as a recorded line's Type names it. */
export const LINE_LABELS: Record<ChequeLineType, string> = {
    [LINE_TYPE.PO_WO]: "PO or Work Order payment",
    [LINE_TYPE.PROJECT_EXPENSE]: "Project expense",
    [LINE_TYPE.NON_PROJECT_EXPENSE]: "Non-project expense",
    [LINE_TYPE.SECURED]: "Secured PO or Work Order",
};

/** A new PO line, nothing picked yet. */
export const emptyLine = (): ChequeLineDraft => ({
    line_type: LINE_TYPE.PO_WO,
    project: "",
    record_doctype: "",
    record_name: "",
    payment_name: "",
    amount: "",
});

/**
 * Whether the line is a PO line the dialog can edit. A Work Order or expense line recorded before spec #1477
 * is shown as it is: a cheque keeps one, but no new one is added.
 */
export const isPoLine = (line: Pick<ChequeLineDraft, "line_type" | "record_doctype">): boolean =>
    line.line_type === LINE_TYPE.PO_WO && (!line.record_doctype || line.record_doctype === PO_DOCTYPE);

/** The lines left once the Vendor changes: each PO line belongs to the old Vendor. */
export const withoutPoWoLines = (lines: ChequeLineDraft[]) => lines.filter((l) => l.line_type !== LINE_TYPE.PO_WO);

/** The payments the cheque's lines other than `index` hold: the picker offers their step, not them again. */
export const otherLinePayments = (lines: Pick<ChequeLineDraft, "payment_name">[], index: number): string[] =>
    lines.filter((l, i) => i !== index && l.payment_name).map((l) => l.payment_name);

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

/**
 * The payment picker's footer: "Not shown: 1 already on cheque 004530 (Pending), 1 Rejected, 2 Paid, 1 on
 * hold, 2 at another step (...)." `step` is the cheque's other payments' step, named in the last reason.
 */
export const hiddenPaymentsText = (hidden: HiddenPayments | undefined, step?: string | null): string => {
    if (!hidden) return "";
    const parts = [
        onChequeText(hidden.on_cheque),
        hidden.rejected ? `${hidden.rejected} Rejected` : "",
        ...Object.entries(hidden.moved_on ?? {}).map(([status, count]) => `${count} ${status}`),
        hidden.on_hold ? `${hidden.on_hold} on hold` : "",
        hidden.other_step
            ? `${hidden.other_step} at another step${step ? ` (this cheque's payments are ${step}; all must be at one step)` : ""}`
            : "",
    ].filter(Boolean);
    return parts.length ? `Not shown: ${parts.join(", ")}.` : "";
};

/** What saving the Cheque does to a picked payment (the blue hint on its line). */
export const conversionHint = (p: { status: string; mode_of_payment: string }): string => {
    const lead = p.mode_of_payment === "Cheque" ? "Goes on this cheque" : "Switches to Cheque";
    if (p.status === PAYMENT_STATUS.APPROVED) return `${lead} and moves to Reconciliation Pending on save.`;
    return `${lead}; approved together with the cheque's other payments.`;
};

const AWAITS_RECONCILIATION = "Once approved it becomes Issued and waits in Cheque Issued – Reconciliation Pending.";

/**
 * The note above Save: what the cheque's status will be (spec #1477). Pending until every line names its
 * payment; Issued on save when they are already Approved; otherwise Pending until they are approved, the
 * approval tier following the cheque amount. Undefined before a line is added.
 */
export const chequeSaveNote = (chequeAmount: number | string, lines: ChequeLineDraft[]): string | undefined => {
    if (lines.length === 0) return undefined;
    if (lines.some((l) => !l.payment_name)) {
        return "This cheque stays Pending until every line names its payment.";
    }
    const n = lines.length;
    const payments = `${n} payment${n > 1 ? "s" : ""}`;
    if (lines.every((l) => l.payment_status === PAYMENT_STATUS.APPROVED)) {
        return `Its ${payments} ${n > 1 ? "are" : "is"} already approved: ${n > 1 ? "they move" : "it moves"} to Reconciliation Pending and the cheque is Issued on save.`;
    }
    const together = n > 1 ? `Its ${payments} switch to Cheque and are approved together.` : `Its ${payments} switches to Cheque.`;
    const ceo = needsCEO(chequeAmount)
        ? ` The cheque total ${formatToIndianRupee(parseNumber(chequeAmount))} is over ₹${TIER_L2_ABOVE.toLocaleString("en-IN")}, so the CEO approves them too.`
        : "";
    return `This cheque is Pending. ${together}${ceo} ${AWAITS_RECONCILIATION}`;
};

/** The projects the Vendor has POs in, once each, by name. */
export const lineProjects = (records: VendorRecord[]) => {
    const byProject = new Map<string, string>();
    for (const r of records) if (r.project && !byProject.has(r.project)) byProject.set(r.project, r.project_name || r.project);
    return [...byProject]
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label));
};

/** The Vendor's POs in one project. */
export const recordsInProject = (records: VendorRecord[], project: string) =>
    project ? records.filter((r) => r.project === project) : [];

/** The lines as `save_cheque` takes them: only the boxes each kind asks for, a picked payment, and the amount. */
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
