import { PAYMENT_STATUS } from "@/constants/paymentStatus";

import { DIALOG_ACTION_TYPES, DialogActionType } from "./constants";

/**
 * Whether the approve dialog's Reject needs a typed reason (2026-11-12: every reject does). A cheque's reject
 * (#1481) and an expense's (#1497) already did; a PO / WO payment's now does too, saved to `rejection_reason`.
 * An Approve never does.
 */
export const rejectNeedsReason = (type: DialogActionType): boolean => type === DIALOG_ACTION_TYPES.REJECT;

/**
 * Which reason box the dialog draws on a Reject: the cheque block's own, the expense's, or the payment's.
 * None while the cheque is still loading (the cheque block takes over once it lands), and none on an Approve.
 */
export const rejectReasonBox = (
  type: DialogActionType,
  { isExpense, onCheque, chequeLoading }: { isExpense: boolean; onCheque: boolean; chequeLoading: boolean },
): "cheque" | "expense" | "payment" | null => {
  if (type !== DIALOG_ACTION_TYPES.REJECT) return null;
  if (onCheque) return "cheque";
  if (isExpense) return "expense";
  if (chequeLoading) return null;
  return "payment";
};

/** The fields a single PO / WO payment reject saves with its status: the trimmed reason. Nothing on an approve,
 *  so an approval never writes over a reason. */
export const rejectionFields = (newStatus: string, reason?: string): { rejection_reason?: string } =>
  newStatus === PAYMENT_STATUS.REJECTED ? { rejection_reason: (reason ?? "").trim() } : {};
