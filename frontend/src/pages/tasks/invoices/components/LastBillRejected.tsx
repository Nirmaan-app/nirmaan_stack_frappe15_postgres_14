/**
 * The line a spend back in Pending Invoices Upload shows when its latest bill was rejected in Pending Approval
 * (#1644): "Last bill rejected: <reason>", so whoever attaches the next bill knows what was wrong.
 */
import React from "react";

import { lastBillRejectedText } from "../utils/expenseBillApprovalView";

export const LastBillRejected: React.FC<{ reason?: string | null }> = ({ reason }) => {
    const text = lastBillRejectedText(reason);
    return text ? <div className="text-xs text-destructive whitespace-normal" data-testid="last-bill-rejected">{text}</div> : null;
};
