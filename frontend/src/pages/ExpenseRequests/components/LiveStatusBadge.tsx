// src/pages/ExpenseRequests/components/LiveStatusBadge.tsx
//
// A request's status pill. The label is the server's (`standing.live_status`): the Expense's own
// status once it exists, so it reads "Waiting for Admin", "CEO Pending", "Reconciliation Pending"
// and the rest, not only the request's four.

import React from "react";

import { cn } from "@/lib/utils";

const BADGE: Record<string, string> = {
    "Pending Approval": "bg-amber-100 text-amber-800",
    "Waiting for Admin": "bg-amber-100 text-amber-800",
    "CEO Pending": "bg-violet-100 text-violet-800",
    Approved: "bg-emerald-100 text-emerald-800",
    "Reconciliation Pending": "bg-cyan-100 text-cyan-800",
    Paid: "bg-sky-100 text-sky-800",
    Rejected: "bg-red-100 text-red-800",
};

export const LiveStatusBadge: React.FC<{ status: string; className?: string }> = ({ status, className }) => (
    <span className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        BADGE[status] || "bg-gray-100 text-gray-700",
        className,
    )}>
        {status}
    </span>
);

export default LiveStatusBadge;
