/**
 * The line a spend back in Pending Invoices Upload shows when its latest bill was rejected in Pending Approval
 * (#1644): "Last bill rejected: <reason>", so whoever attaches the next bill knows what was wrong.
 */
import React from "react";

import { lastBillRejectedText } from "../utils/expenseBillApprovalView";

interface LastBillRejectedProps {
    /** The latest bill's rejection reason; nothing shows without one. */
    reason?: string | null;
}

export const LastBillRejected: React.FC<LastBillRejectedProps> = ({ reason }) => {
    const text = lastBillRejectedText(reason);
    return text ? <div className="text-xs text-destructive whitespace-normal" data-testid="last-bill-rejected">{text}</div> : null;
};
