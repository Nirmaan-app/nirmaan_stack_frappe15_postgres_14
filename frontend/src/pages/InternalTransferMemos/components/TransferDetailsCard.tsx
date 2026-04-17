import React from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ArrowRight } from "lucide-react";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import type { InternalTransferMemo } from "@/types/NirmaanStack/InternalTransferMemo";
import { ITMStatusBadge } from "./ITMStatusBadge";

interface TransferDetailsCardProps {
  itm: InternalTransferMemo;
  sourceProjectName: string | null;
  targetProjectName: string | null;
  createdByFullName: string | null;
}

/**
 * Label/value pair — compact stat cell matching Image #4.
 */
const StatCell: React.FC<{ label: string; children: React.ReactNode; className?: string }> = ({
  label,
  children,
  className,
}) => (
  <div className={className}>
    <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
      {label}
    </div>
    <div className="text-sm font-semibold text-foreground mt-1">{children}</div>
  </div>
);

/**
 * Top "Transfer Details" card per Image #4.
 *
 * Row 1 (grid, responsive): TRANSFER ID | FROM → TO | STATUS | EST VALUE
 * Row 2 (after hr):          Created On | Created By | Total Items | Total Quantity
 *
 * On mobile we collapse row 1 into a 2-col grid so nothing overflows.
 */
export const TransferDetailsCard: React.FC<TransferDetailsCardProps> = ({
  itm,
  sourceProjectName,
  targetProjectName,
  createdByFullName,
}) => {
  return (
    <Card>
      <CardHeader className="pb-3">
        <h3 className="text-red-600 text-lg font-semibold">Transfer Details</h3>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Row 1: ID / FROM → TO / STATUS / EST VALUE */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 items-start">
          <StatCell label="Transfer ID">#{itm.name}</StatCell>

          <div className="flex items-center gap-3 min-w-0">
            <StatCell label="From" className="min-w-0 flex-1">
              <span className="truncate block" title={sourceProjectName ?? itm.source_project}>
                {sourceProjectName ?? itm.source_project}
              </span>
            </StatCell>
            <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0 mt-4" />
            <StatCell label="To" className="min-w-0 flex-1">
              <span className="truncate block" title={targetProjectName ?? itm.target_project}>
                {targetProjectName ?? itm.target_project}
              </span>
            </StatCell>
          </div>

          <StatCell label="Status">
            <ITMStatusBadge status={itm.status} />
          </StatCell>

          <StatCell label="Est Value">
            {itm.estimated_value != null
              ? formatToRoundedIndianRupee(itm.estimated_value)
              : "--"}
          </StatCell>
        </div>

        <hr className="border-border" />

        {/* Row 2: Created On / Created By / Total Items / Total Quantity */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-muted-foreground">Created On: </span>
            <span className="font-medium">
              {itm.creation ? formatDate(itm.creation) : "--"}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Created By: </span>
            <span
              className="font-medium"
              title={itm.requested_by ?? undefined}
            >
              {createdByFullName ?? itm.requested_by ?? "--"}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Total Items: </span>
            <span className="font-medium">{itm.total_items ?? itm.items?.length ?? 0}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Total Quantity: </span>
            <span className="font-medium">{itm.total_quantity ?? "--"}</span>
          </div>
        </div>

        {/* Transfer Request link (if available) */}
        {itm.transfer_request && (
          <>
            <hr className="border-border" />
            <div className="text-sm">
              <span className="text-muted-foreground">Request ID: </span>
              <span className="font-medium font-mono text-sm">
                {itm.transfer_request}
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default TransferDetailsCard;
