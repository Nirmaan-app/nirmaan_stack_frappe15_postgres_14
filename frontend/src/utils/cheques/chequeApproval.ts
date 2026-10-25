import { PAYMENT_STATUS } from "@/constants/paymentStatus";
import { CHEQUE_STATUS } from "@/types/NirmaanStack/Cheques";
import { TIER_L2_ABOVE } from "@/utils/approvalTiers";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

/**
 * Approving or rejecting a Payment cheque's payments together (#1480, #1481, spec #1477): one cheque, one
 * decision. Pure, so vitest covers what the approval dialog shows without React (F4). The server
 * (`services/cheques/decide.py`) decides; these only shape the dialog.
 */

export const CHEQUE_APPROVAL_API = "nirmaan_stack.api.payments.cheque_approval.get_cheque_approval";
export const APPROVE_CHEQUE_API = "nirmaan_stack.api.payments.cheque_approval.approve_cheque_payments";
export const REJECT_CHEQUE_API = "nirmaan_stack.api.payments.cheque_approval.reject_cheque_payments";

/** Which approval the dialog is for: L1 ("lead") or the CEO. */
export type ChequeApprovalStage = "lead" | "ceo";

/** One Cheque line as `get_cheque_approval` sends it. `payment` is null on a "No payment yet" line. */
export interface ChequeApprovalLine {
    payment: string | null;
    record: string | null;
    project: string | null;
    project_name: string | null;
    amount: number;
    status: string | null;
}

/** The cheque a payment is on, as `get_cheque_approval` sends it. `problem` is null when it can be approved. */
export interface ChequeApproval {
    cheque: string;
    cheque_no: string;
    bank: string;
    status: string;
    amount: number;
    vendor: string | null;
    vendor_name: string | null;
    /** Where an L1 approval lands every payment: from the CHEQUE amount, not each payment's. */
    status_after_l1: string;
    problem: string | null;
    lines: ChequeApprovalLine[];
}

/**
 * Is this queue row approved through its cheque? A Project Payment on an Approval Pending cheque is: approving it
 * approves every payment on that cheque. An Online payment, an expense, or a payment on no Approval Pending cheque
 * is approved alone, as before.
 */
export const approvesThroughCheque = (
    row?: { doctype?: string | null; cheque?: string | null; cheque_status?: string | null } | null
): boolean =>
    !!row &&
    (!row.doctype || row.doctype === "Project Payments") &&
    !!row.cheque &&
    row.cheque_status === CHEQUE_STATUS.PENDING;

export interface ChequeApprovalRow extends ChequeApprovalLine {
    key: string;
    /** The payment the dialog was opened on: highlighted. */
    isOpened: boolean;
    paymentLabel: string;
    statusLabel: string;
}

/** The dialog's table: every line of the cheque, in line order. */
export const chequeApprovalRows = (approval: ChequeApproval, openedPayment?: string | null): ChequeApprovalRow[] =>
    approval.lines.map((line, i) => ({
        ...line,
        key: `${i}-${line.payment ?? "none"}`,
        isOpened: !!line.payment && line.payment === openedPayment,
        paymentLabel: line.payment ?? "No payment yet",
        statusLabel: line.status ?? "—",
    }));

const paymentCount = (approval: ChequeApproval) => approval.lines.filter((l) => l.payment).length;

/** "with 2 other payments", beside the cheque chip in the dialog's header; "" for a one-line cheque. */
export const otherPaymentsText = (approval: ChequeApproval): string => {
    const others = approval.lines.length - 1;
    if (others <= 0) return "";
    return `with ${others} other payment${others === 1 ? "" : "s"}`;
};

/** The one approve button: "Approve all 3 · ₹68,400"; "Approve · ₹20,000" for a one-payment cheque. */
export const approveAllLabel = (approval: ChequeApproval): string => {
    const n = paymentCount(approval);
    const total = formatToRoundedIndianRupee(approval.amount);
    return n > 1 ? `Approve all ${n} · ${total}` : `Approve · ${total}`;
};

/**
 * The note telling L1 that the cheque goes on to the CEO (C3): its total is over the CEO line although each
 * payment may be under it. Null when L1 finishes the approval, and at the CEO's own step.
 */
export const ceoNote = (approval: ChequeApproval, stage: ChequeApprovalStage): string | null => {
    if (stage !== "lead" || approval.status_after_l1 !== PAYMENT_STATUS.CEO_PENDING) return null;
    const n = paymentCount(approval);
    const eachUnder = approval.lines.every((l) => l.amount <= TIER_L2_ABOVE);
    const line = formatToRoundedIndianRupee(TIER_L2_ABOVE);
    return (
        `The cheque total ${formatToRoundedIndianRupee(approval.amount)} is over ${line}, so all ${n} payments go to ` +
        `CEO Pending after your approval${eachUnder ? `, even though each one is under ${line}` : ""}.`
    );
};

/** The reject dialog's title: "Reject 3 payments and cancel cheque 000751". */
export const rejectTitle = (approval: ChequeApproval): string => {
    const n = paymentCount(approval);
    return n > 1
        ? `Reject ${n} payments and cancel cheque ${approval.cheque_no}`
        : `Reject payment and cancel cheque ${approval.cheque_no}`;
};

/** The one reject button: "Reject 3 and cancel cheque"; "Reject and cancel cheque" for a one-payment cheque. */
export const rejectAllLabel = (approval: ChequeApproval): string => {
    const n = paymentCount(approval);
    return n > 1 ? `Reject ${n} and cancel cheque` : "Reject and cancel cheque";
};

/** What rejecting does, in the reject dialog's warning (story 30). */
export const rejectNote = (approval: ChequeApproval): string => {
    const n = paymentCount(approval);
    const who = n > 1 ? `All ${n} become` : "The payment becomes";
    return (
        `${who} Rejected and cheque ${approval.cheque_no} becomes Cancelled. The cheque keeps its lines and ` +
        "history. To pay the vendor later, raise new payment requests."
    );
};
