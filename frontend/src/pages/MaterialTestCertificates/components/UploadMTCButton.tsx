import { useMemo, useState } from "react";
import { CirclePlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useUserData } from "@/hooks/useUserData";
import { canManageMTC } from "@/constants/roles";
import { coverableLines, isPoOpenForMTC } from "@/utils/mtc";
import type { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";

import { UploadMTCDialog } from "./UploadMTCDialog";
import { useMTCsForPO } from "../hooks/useMTCs";

const LABEL = "Upload Test Certificate";

interface UploadMTCButtonProps {
  po: ProcurementOrder;
  /** The PO summary's action row: icon only below `sm`, label in a tooltip. */
  compact?: boolean;
}

/**
 * "Upload Test Certificate" plus its create dialog. Used in the MTC card header and in the
 * PO summary's action row, so both follow one rule: managing profiles only, on a PO that
 * `isPoOpenForMTC` allows; disabled once every billable line has an MTC.
 */
export const UploadMTCButton = ({ po, compact = false }: UploadMTCButtonProps) => {
  const { role, user_id } = useUserData();
  const { mtcs, isLoading, mutate } = useMTCsForPO(po?.name);
  const [open, setOpen] = useState(false);
  const freeLines = useMemo(() => coverableLines(po?.items, mtcs), [po?.items, mtcs]);

  if (!canManageMTC(role, user_id) || !isPoOpenForMTC(po?.billing_status, po?.status)) return null;

  const allCovered = freeLines.length === 0;
  const tooltip = allCovered && !isLoading ? "All billable items have an MTC" : compact ? LABEL : null;

  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0} className="shrink-0">
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  "text-primary border-primary hover:bg-primary/5",
                  compact && "h-8 px-2.5 shrink-0"
                )}
                onClick={() => setOpen(true)}
                disabled={allCovered || isLoading}
              >
                <CirclePlus className={compact ? "h-3.5 w-3.5 sm:mr-1.5" : "h-4 w-4 mr-1"} aria-hidden="true" />
                <span className={compact ? "hidden sm:inline text-xs" : undefined}>{LABEL}</span>
              </Button>
            </span>
          </TooltipTrigger>
          {tooltip && (
            <TooltipContent className={allCovered || !compact ? "" : "sm:hidden"}>{tooltip}</TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>

      <UploadMTCDialog
        open={open}
        onOpenChange={setOpen}
        mode="create"
        poName={po.name}
        poDisplayName={po.name ? `PO-${po.name.split("/")[1]}` : ""}
        vendorName={po.vendor_name}
        poItems={po.items}
        mtcs={mtcs ?? []}
        onRefresh={() => mutate()}
      />
    </>
  );
};
