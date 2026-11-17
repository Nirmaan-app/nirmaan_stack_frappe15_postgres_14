import { useState } from "react";
import { MessageSquareText } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { rejectionReasonText } from "./rejectionReason";

/** Props for {@link RejectionReasonNote}. */
interface RejectionReasonNoteProps {
  payment?: { status?: string; rejection_reason?: string | null } | null;
}

/**
 * A Rejected payment's reason, as a small red message icon beside its status: the PO page's Transaction Details
 * and the WO page's payments table. Nothing for any other status or a reject with no reason saved.
 *
 * ICON, NOT TEXT (owner, 2026-11-17). The "Reason: …" line under the badge widened the Status column; the icon
 * keeps the cell one badge wide. Hovering the icon opens the whole reason in a popover and leaving closes it; a
 * click pins it open (so it also works without a mouse) until a second click or a click outside.
 */
export const RejectionReasonNote = ({ payment }: RejectionReasonNoteProps) => {
  const reason = rejectionReasonText(payment);
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  if (!reason) return null;
  return (
    <Popover
      open={hovered || pinned}
      onOpenChange={(open) => {
        if (!open) {
          setPinned(false);
          setHovered(false);
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Show rejection reason"
          className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded align-middle text-red-500 hover:text-red-700 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-400"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onClick={(e) => {
            // Our own toggle, not Radix's: a hover has already opened it, so Radix's would close it.
            e.preventDefault();
            setPinned((p) => !p);
          }}
        >
          <MessageSquareText className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="center" className="w-auto max-w-xs p-2 text-xs">
        <p className="mb-0.5 font-semibold text-red-600">Rejection reason</p>
        <p className="whitespace-normal break-words text-foreground">{reason}</p>
      </PopoverContent>
    </Popover>
  );
};
