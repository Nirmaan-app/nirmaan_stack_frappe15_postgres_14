import React from "react";

import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { ApprovalQueueRow } from "../config/approvalsTable.config";
import { countLabel, selectionTotal, summarizeSelection } from "../bulkSelectionSummary";

/**
 * `Req. Amt : ₹X (N)` — what the ticked rows add up to. Shared by the approval tabs'
 * bulk bar and the "Payment need to paid" tab, so both read the same total the same way.
 */
export const SelectionTotalPill: React.FC<{ rows: readonly ApprovalQueueRow[] }> = ({ rows }) => {
  const total = selectionTotal(rows);
  return (
    <div
      className="flex h-8 items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 text-sm"
      title={`${countLabel(summarizeSelection(rows))} selected · Total Req. Amount ${formatToRoundedIndianRupee(total)}`}
    >
      <span className="text-muted-foreground">Req. Amt :</span>
      <span className="font-bold tabular-nums text-foreground">{formatToRoundedIndianRupee(total)}</span>
      <span className="font-semibold text-foreground tabular-nums">({rows.length})</span>
    </div>
  );
};
