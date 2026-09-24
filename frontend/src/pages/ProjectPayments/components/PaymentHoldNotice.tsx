import React from "react";
import { CirclePause } from "lucide-react";

/**
 * Row fill for a held payment on "Payment need to paid" (owner, 2026-09-22). Orange, so it never
 * reads as a CEO Hold row (`CEO_HOLD_ROW_CLASSES`, red) on the same table.
 */
export const PAYMENT_HOLD_ROW_CLASSES =
  "bg-orange-50 hover:bg-orange-100 dark:bg-orange-950/30 dark:hover:bg-orange-950/50";

interface PaymentHoldNoticeProps {
  /** Held rows on the CURRENT page — their checkbox is disabled. */
  heldRowsOnPage: number;
}

/**
 * Says why a held row has no checkbox and no Mark as Paid, in one slim strip above the table.
 * A disabled checkbox with no reason reads as a bug. The swatch is the held row's own fill, so
 * the strip doubles as the legend for the orange rows below it.
 *
 * The count is PER PAGE, and says so: selection only ever spans the current page.
 */
export const PaymentHoldNotice: React.FC<PaymentHoldNoticeProps> = ({ heldRowsOnPage }) => {
  if (heldRowsOnPage === 0) return null;

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-orange-300 bg-orange-50 px-3 py-1.5 text-xs text-orange-800 dark:border-orange-800 dark:bg-orange-950/30 dark:text-orange-300"
    >
      <span className="inline-flex items-center gap-1.5 font-semibold">
        <CirclePause className="h-3.5 w-3.5" aria-hidden />
        On hold
      </span>
      <span
        className="h-3 w-3 shrink-0 rounded-sm bg-orange-100 ring-1 ring-inset ring-orange-300 dark:bg-orange-950/50 dark:ring-orange-800"
        aria-hidden
      />
      <span>
        <span className="font-semibold">
          {heldRowsOnPage} row{heldRowsOnPage > 1 ? "s" : ""}
        </span>{" "}
        on this page {heldRowsOnPage > 1 ? "are" : "is"} held from payment · release the hold to
        mark {heldRowsOnPage > 1 ? "them" : "it"} as paid or select {heldRowsOnPage > 1 ? "them" : "it"}
      </span>
    </div>
  );
};
