import { rejectionReasonText } from "./rejectionReason";

/**
 * The reason under a Rejected payment's status, in small grey text (2026-11-12): the PO page's Transaction
 * Details and the WO page's payments table. Nothing for any other status or a reject with no reason saved.
 *
 * ONE LINE, WHOLE REASON IN A HOVER TOOLTIP (owner, 2026-11-12). A long reason wrapped down the narrow Status column
 * and made the row very tall, so it is cut to one line with "…". Hovering shows the whole reason in the browser's
 * tooltip, the same box the Reason column in the payments tables shows; the row never grows.
 */
export const RejectionReasonNote = ({ payment }: { payment?: { status?: string; rejection_reason?: string | null } | null }) => {
  const reason = rejectionReasonText(payment);
  if (!reason) return null;
  return (
    <span
      className="mt-0.5 block max-w-[220px] cursor-default truncate text-[11px] font-normal leading-snug text-muted-foreground"
      title={reason}
    >
      Reason: {reason}
    </span>
  );
};
