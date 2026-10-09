import { useCallback, useMemo, useState } from "react";
import { CirclePlus } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { useUserData } from "@/hooks/useUserData";
import { useUsersList } from "@/pages/ProcurementRequests/ApproveNewPR/hooks/useUsersList";
import { canManageMTC } from "@/constants/roles";
import { getFrappeError } from "@/utils/frappeErrors";
import { coverableLines, isPoOpenForMTC } from "@/utils/mtc";
import type { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import type { MaterialTestCertificate } from "@/types/NirmaanStack/MaterialTestCertificate";

import { MTCTable } from "./MTCTable";
import { UploadMTCDialog } from "./UploadMTCDialog";
import { useMTCsForPO } from "../hooks/useMTCs";
import { useMTCMutations } from "../hooks/useMTCMutations";

interface MTCCardProps {
  po: ProcurementOrder;
  className?: string;
}

type DialogState =
  | { open: false }
  | { open: true; mode: "create" }
  | { open: true; mode: "edit"; existing: MaterialTestCertificate };

/**
 * "Material Test Certificates" -- the third card in the PO page's PO Attachments section.
 *
 * Shown to everyone who sees the DC & MIR card, on Billable POs only (owner rulings Q6/Q35).
 * Upload / Edit / Delete: Procurement, PMO, Admin, on any PO that is not Merged, Cancelled or
 * Inactive (owner ruling Q39). The server enforces both; this decides what renders.
 */
export const MTCCard = ({ po, className }: MTCCardProps) => {
  const { toast } = useToast();
  const { role, user_id } = useUserData();
  const { data: usersList } = useUsersList();
  const { mtcs, isLoading, mutate } = useMTCsForPO(po?.name);
  const { remove } = useMTCMutations(po?.name ?? "");
  const [dialog, setDialog] = useState<DialogState>({ open: false });
  const [deletingName, setDeletingName] = useState<string | null>(null);

  const getUserName = useCallback(
    (id?: string) => {
      if (!id) return "--";
      if (id === "Administrator") return "Administrator";
      return usersList?.find((u) => u.name === id)?.full_name || id;
    },
    [usersList]
  );

  const list = mtcs ?? [];
  const isOpen = isPoOpenForMTC(po?.billing_status, po?.status);
  const canManage = canManageMTC(role, user_id);
  const canChange = canManage && isOpen;
  const freeLines = useMemo(() => coverableLines(po?.items, mtcs), [po?.items, mtcs]);
  const poDisplayName = po?.name ? `PO-${po.name.split("/")[1]}` : "";

  const handleDelete = async (mtc: MaterialTestCertificate) => {
    setDeletingName(mtc.name);
    try {
      await remove(mtc.name);
      toast({ title: "Certificate deleted", description: `Removed from ${poDisplayName}.`, variant: "success" });
    } catch (error) {
      toast({ title: "Could not delete the certificate", description: getFrappeError(error), variant: "destructive" });
    } finally {
      setDeletingName(null);
      mutate();
    }
  };

  if (po?.billing_status !== "Billable") return null;

  const allCovered = freeLines.length === 0;

  return (
    <Card className={cn("rounded-md shadow-sm border border-gray-200 overflow-hidden", className)}>
      <CardHeader className="border-b border-gray-200">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <p className="text-lg font-semibold text-red-600">Material Test Certificates</p>
            <Badge variant="secondary" className="text-sm">
              {list.length}
            </Badge>
          </div>
          {canChange && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0}>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-primary border-primary hover:bg-primary/5"
                      onClick={() => setDialog({ open: true, mode: "create" })}
                      disabled={allCovered || isLoading}
                    >
                      <CirclePlus className="h-4 w-4 mr-1" aria-hidden="true" />
                      Upload MTC
                    </Button>
                  </span>
                </TooltipTrigger>
                {allCovered && !isLoading && (
                  <TooltipContent>All billable items have an MTC</TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <MTCTable
            mtcs={list}
            getUserName={getUserName}
            poItems={po.items}
            canChange={canChange}
            onEdit={(existing) => setDialog({ open: true, mode: "edit", existing })}
            onDelete={handleDelete}
            deletingName={deletingName}
            isLoading={isLoading}
            emptyText={
              isOpen
                ? "No Material Test Certificates yet."
                : `MTCs can't be added to a ${po.status} PO.`
            }
          />
        </div>
      </CardContent>

      {canChange && (
        <UploadMTCDialog
          open={dialog.open}
          onOpenChange={(open) => !open && setDialog({ open: false })}
          mode={dialog.open ? dialog.mode : "create"}
          existing={dialog.open && dialog.mode === "edit" ? dialog.existing : undefined}
          poName={po.name}
          poDisplayName={poDisplayName}
          vendorName={po.vendor_name}
          poItems={po.items}
          mtcs={list}
          onRefresh={() => mutate()}
        />
      )}
    </Card>
  );
};
