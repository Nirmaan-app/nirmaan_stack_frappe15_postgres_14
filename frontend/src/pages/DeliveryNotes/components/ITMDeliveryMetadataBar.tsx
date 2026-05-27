import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  ArrowRight,
  CalendarCheck,
  CalendarClock,
  ClipboardList,
  FolderOpen,
  Package,
} from "lucide-react";
import { formatDate } from "@/utils/FormatDate";
import type { InternalTransferMemo } from "@/types/NirmaanStack/InternalTransferMemo";

/**
 * Compact two-row metadata bar for the ITM Delivery Note page.
 * Mirrors `PivotTableMetadataBar` (used by the PO Delivery Note page) so
 * both flows share the same visual rhythm — just swaps PO-specific bits
 * (vendor / PR link) for ITM-specific bits (source project → target project).
 */
interface ITMDeliveryMetadataBarProps {
  itm: InternalTransferMemo;
  sourceProjectName?: string | null;
  targetProjectName?: string | null;
  dnCount: number;
}

const STATUS_BADGE_VARIANT: Record<
  string,
  "default" | "secondary" | "destructive" | "outline" | "green" | "orange"
> = {
  Approved: "secondary",
  Dispatched: "orange",
  "Partially Delivered": "orange",
  Delivered: "green",
};

export function ITMDeliveryMetadataBar({
  itm,
  sourceProjectName,
  targetProjectName,
  dnCount,
}: ITMDeliveryMetadataBarProps) {
  const navigate = useNavigate();

  const sourceLabel =
    itm.source_type === "Warehouse"
      ? "Warehouse"
      : sourceProjectName || itm.source_project || "—";
  const targetLabel =
    itm.target_type === "Warehouse"
      ? "Warehouse"
      : targetProjectName || itm.target_project || "—";

  const badgeVariant =
    STATUS_BADGE_VARIANT[itm.status] || STATUS_BADGE_VARIANT["default"];

  return (
    <div className="border rounded-lg p-3 bg-card space-y-2">
      {/* Primary row */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
        <div className="flex items-center gap-1.5">
          <Package className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span
            className="font-medium text-primary cursor-pointer hover:underline"
            onClick={() => navigate(`/internal-transfer-memos/${itm.name}`)}
          >
            {itm.name}
          </span>
        </div>

        <Separator orientation="vertical" className="h-4 hidden sm:block" />

        <div className="flex items-center gap-1.5 min-w-0">
          <FolderOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-muted-foreground truncate" title={sourceLabel}>
            {sourceLabel}
          </span>
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <FolderOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-muted-foreground truncate" title={targetLabel}>
            {targetLabel}
          </span>
        </div>

        <Badge variant={badgeVariant}>{itm.status}</Badge>
      </div>

      {/* Secondary row */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
        {itm.dispatched_on && (
          <div className="flex items-center gap-1">
            <CalendarClock className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden sm:inline">Dispatched:</span>
            <span>{formatDate(itm.dispatched_on)}</span>
          </div>
        )}

        {itm.latest_delivery_date && (
          <>
            <Separator
              orientation="vertical"
              className="h-3.5 hidden sm:block"
            />
            <div className="flex items-center gap-1">
              <CalendarCheck className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden sm:inline">Latest DN:</span>
              <span>{formatDate(itm.latest_delivery_date)}</span>
            </div>
          </>
        )}

        <Separator orientation="vertical" className="h-3.5 hidden sm:block" />

        <div className="flex items-center gap-1">
          <ClipboardList className="h-3.5 w-3.5 shrink-0" />
          <span>
            {dnCount}
            <span className="hidden sm:inline">
              {" "}
              delivery note{dnCount !== 1 ? "s" : ""}
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
