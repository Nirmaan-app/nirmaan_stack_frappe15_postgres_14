import React from "react";
import { Lock } from "lucide-react";

import { CEO_HOLD_AUTHORIZED_USER } from "@/constants/ceoHold";

interface SelectionBlockedNoticeProps {
  /** Rows on the CURRENT page whose project is on CEO Hold — their checkbox is disabled. */
  heldRowsOnPage: number;
  /** True once the bulk cap is reached — every unticked checkbox is disabled. */
  capReached: boolean;
  cap: number;
}

/**
 * Says WHY a checkbox is disabled, in one slim yellow strip above the approval table.
 *
 * A disabled checkbox with no reason reads as a bug. Each segment renders only while its
 * reason actually applies, and the strip renders nothing when neither does.
 *
 * The red swatch is the SAME fill as a CEO-Hold row (`CEO_HOLD_ROW_CLASSES`), so the
 * strip doubles as the legend for the red rows below it.
 *
 * ⚠️ The held count is PER PAGE, and says so: selection only ever spans the current
 * page, so that is the number that explains the checkboxes on screen.
 */
export const SelectionBlockedNotice: React.FC<SelectionBlockedNoticeProps> = ({
  heldRowsOnPage,
  capReached,
  cap,
}) => {
  if (heldRowsOnPage === 0 && !capReached) return null;

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-yellow-400 bg-yellow-50 px-3 py-1.5 text-xs text-yellow-800 dark:border-yellow-700 dark:bg-yellow-950/30 dark:text-yellow-300"
    >
      <span className="inline-flex items-center gap-1.5 font-semibold">
        <Lock className="h-3.5 w-3.5" aria-hidden />
        Can't select
      </span>

      {heldRowsOnPage > 0 && (
        <span className="inline-flex items-center gap-1.5">
          <span
            className="h-3 w-3 shrink-0 rounded-sm bg-red-100 ring-1 ring-inset ring-red-300 dark:bg-red-950/50 dark:ring-red-800"
            aria-hidden
          />
          <span>
            <span className="font-semibold">
              {heldRowsOnPage} row{heldRowsOnPage > 1 ? "s" : ""}
            </span>{" "}
            on CEO Hold · contact{" "}
            <span className="font-semibold">{CEO_HOLD_AUTHORIZED_USER}</span> to resolve this
          </span>
        </span>
      )}

      {heldRowsOnPage > 0 && capReached && (
        <span className="hidden h-3.5 w-px bg-yellow-300 sm:block dark:bg-yellow-800" aria-hidden />
      )}

      {capReached && (
        <span>
          <span className="font-semibold">{cap} max</span> · action these, then select the rest
        </span>
      )}
    </div>
  );
};
