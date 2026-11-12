import { PAYMENT_STATUS } from "@/constants/paymentStatus";

/**
 * A Rejected payment's saved reason, trimmed; null for any other status, or a reject with none saved.
 *
 * ⚠️ THE ONE READER OF `rejection_reason` FOR DISPLAY. The PO / WO page note, the queue's Reason column and its CSV
 * all go through it, so they agree: a payment brought back from Rejected keeps the old text in the field, and no
 * screen shows it once the status has moved on.
 */
export const rejectionReasonText = (
  payment?: { status?: string; rejection_reason?: string | null } | null,
): string | null => {
  if (payment?.status !== PAYMENT_STATUS.REJECTED) return null;
  const reason = (payment.rejection_reason ?? "").trim();
  return reason || null;
};
