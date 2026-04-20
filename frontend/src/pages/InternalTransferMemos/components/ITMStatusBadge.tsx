import React from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ITMStatus } from "@/types/NirmaanStack/InternalTransferMemo";

/**
 * Minimal ITM status pill — shared across list, detail, and future tabs.
 *
 * This is the "detail-page fallback" implementation. Task 8 in the Phase 1 plan
 * owns the consolidated version (with its own file under
 * `components/ITMStatusBadge.tsx`). When Task 8 lands its richer version, it
 * should keep the exact same public API (single `status` prop) so the detail
 * page pick up the update without further changes here.
 */
interface ITMStatusBadgeProps {
  status: ITMStatus | string;
  className?: string;
}

const STATUS_STYLES: Record<string, string> = {
  // ITR statuses
  Pending: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20",
  Completed: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20",
  // ITM statuses
  Approved: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20",
  Rejected: "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/20",
  Dispatched: "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-600/20",
  "Partially Delivered":
    "bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-600/20",
  Delivered: "bg-green-100 text-green-800 ring-1 ring-inset ring-green-600/20",
};

export const ITMStatusBadge: React.FC<ITMStatusBadgeProps> = ({
  status,
  className,
}) => {
  const styles =
    STATUS_STYLES[status] ??
    "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-400/20";

  return (
    <Badge
      variant="outline"
      className={cn("border-0 font-medium whitespace-nowrap", styles, className)}
    >
      {status}
    </Badge>
  );
};

export default ITMStatusBadge;
