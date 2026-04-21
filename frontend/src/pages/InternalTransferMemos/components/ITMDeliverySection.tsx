import React, { useCallback, useMemo, useState } from "react";
import { useFrappeGetCall, useFrappeGetDocList, useFrappePostCall } from "frappe-react-sdk";
import { TailSpin } from "react-loader-spinner";
import { Check, Download, Plus, TriangleAlert } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/use-toast";
import { formatDate } from "@/utils/FormatDate";
import { cn } from "@/lib/utils";
import type { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers";
import type { InternalTransferMemoItem } from "@/types/NirmaanStack/InternalTransferMemo";

interface ITMDeliverySectionProps {
  itmName: string;
  itmStatus: string;
  targetProject: string;
  items: InternalTransferMemoItem[];
  onDNCreated?: () => void;
}

interface DNItem {
  item_id: string;
  item_name?: string;
  unit?: string;
  delivered_quantity: number;
}

interface DNRecord {
  name: string;
  note_no: number;
  delivery_date: string;
  creation: string;
  owner: string;
  updated_by_user?: string;
  is_return: number;
  items: DNItem[];
}

const USERS_PARAMS = { fields: ["name", "full_name", "email"] as ("name" | "full_name" | "email")[], limit: 0 };

/**
 * ITM Delivery Notes section — PO-style pivot table.
 *
 * Shows: ITEM | UNIT | ORDERED | DN (date, user) | NEW ENTRY | TOTAL RECEIVED
 * Only one DN allowed per ITM. Download DN button on right side.
 */
export const ITMDeliverySection: React.FC<ITMDeliverySectionProps> = ({
  itmName,
  itmStatus,
  items,
  onDNCreated,
}) => {
  const [isAdding, setIsAdding] = useState(false);
  const [newEntries, setNewEntries] = useState<Record<string, number>>({});

  const {
    data: dnData,
    isLoading: dnLoading,
    mutate: mutateDNs,
  } = useFrappeGetCall<{ message: DNRecord[] }>(
    "nirmaan_stack.api.delivery_notes.get_delivery_notes.get_delivery_notes_for_itm",
    { itm_name: itmName },
    itmName ? undefined : null
  );

  const { call: createDN, loading: isSubmitting } = useFrappePostCall(
    "nirmaan_stack.api.delivery_notes.create_itm_delivery_note.create_itm_delivery_note"
  );

  const { data: usersList } = useFrappeGetDocList<NirmaanUsers>(
    "Nirmaan Users",
    USERS_PARAMS
  );

  const userNameMap = useMemo(() => {
    const map = new Map<string, string>();
    usersList?.forEach((u) => {
      map.set(u.name, u.full_name);
      if (u.email) map.set(u.email, u.full_name);
    });
    return map;
  }, [usersList]);

  const dnList: DNRecord[] = dnData?.message ?? [];
  const existingDN = dnList.length > 0 ? dnList[0] : null;

  const canCreateDN =
    (itmStatus === "Dispatched" || itmStatus === "Partially Delivered") &&
    !existingDN;

  // Build per-item quantity map from existing DN
  const dnQtyByItem = useMemo(() => {
    const map: Record<string, number> = {};
    if (!existingDN) return map;
    for (const di of existingDN.items ?? []) {
      map[di.item_id] = (map[di.item_id] || 0) + (di.delivered_quantity || 0);
    }
    return map;
  }, [existingDN]);

  // Total received across all DNs
  const totalReceivedByItem = useMemo(() => {
    const map: Record<string, number> = {};
    for (const dn of dnList) {
      if (dn.is_return) continue;
      for (const di of dn.items ?? []) {
        map[di.item_id] = (map[di.item_id] || 0) + (di.delivered_quantity || 0);
      }
    }
    return map;
  }, [dnList]);

  const handleStartAdding = useCallback(() => {
    setNewEntries({});
    setIsAdding(true);
  }, []);

  const handleCancel = useCallback(() => {
    setNewEntries({});
    setIsAdding(false);
  }, []);

  const handleEntryChange = useCallback((itemId: string, value: string) => {
    const num = value === "" ? 0 : Number(value);
    setNewEntries((prev) => ({ ...prev, [itemId]: Number.isFinite(num) ? num : 0 }));
  }, []);

  const hasValidEntries = useMemo(
    () => Object.values(newEntries).some((v) => v > 0),
    [newEntries]
  );

  const handleUpdate = useCallback(async () => {
    if (!hasValidEntries) return;

    const payload = Object.entries(newEntries)
      .filter(([, qty]) => qty > 0)
      .map(([item_id, delivered_quantity]) => ({ item_id, delivered_quantity }));

    try {
      await createDN({
        itm_id: itmName,
        items: JSON.stringify(payload),
      });
      toast({
        title: "Delivery note created",
        description: `${payload.length} item${payload.length !== 1 ? "s" : ""} recorded.`,
        variant: "success",
      });
      setIsAdding(false);
      setNewEntries({});
      mutateDNs();
      onDNCreated?.();
    } catch (e: any) {
      toast({
        title: "Failed to create delivery note",
        description: e?.message ?? "Something went wrong.",
        variant: "destructive",
      });
    }
  }, [hasValidEntries, newEntries, createDN, itmName, mutateDNs, onDNCreated]);

  const handleDownloadDN = useCallback(async () => {
    if (!existingDN) return;
    try {
      toast({ title: "Generating PDF", description: "Downloading delivery note..." });

      const printUrl = `/api/method/frappe.utils.print_format.download_pdf?doctype=Delivery%20Notes&name=${encodeURIComponent(existingDN.name)}&no_letterhead=0`;
      const response = await fetch(printUrl);
      if (!response.ok) throw new Error("Failed to generate PDF");

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `${existingDN.name}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      toast({ title: "Success", description: "Delivery note downloaded." });
    } catch {
      toast({
        title: "Error",
        description: "Failed to download delivery note.",
        variant: "destructive",
      });
    }
  }, [existingDN]);

  if (dnLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <TailSpin visible height="28" width="28" color="#D03B45" />
      </div>
    );
  }

  const dnUpdatedBy = existingDN?.updated_by_user || existingDN?.owner;
  const dnUserName = dnUpdatedBy
    ? userNameMap.get(dnUpdatedBy) ?? (dnUpdatedBy === "Administrator" ? "Admin" : dnUpdatedBy.split("@")[0])
    : undefined;

  return (
    <div className="space-y-3">
      {/* Action buttons */}
      <div className="flex items-center justify-end gap-2">
        {isAdding ? (
          <>
            <Button
              size="sm"
              onClick={handleUpdate}
              disabled={!hasValidEntries || isSubmitting}
              className="bg-red-600 hover:bg-red-700"
            >
              {isSubmitting ? "Updating..." : "Update"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleCancel}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
          </>
        ) : (
          <>
            {/* {existingDN && (
              <Button size="sm" className="bg-red-600 hover:bg-red-700" onClick={handleDownloadDN}>
                <Download className="h-3.5 w-3.5 mr-1.5" />
                Download DN
              </Button>
            )} */}
            {canCreateDN && (
              <Button size="sm" onClick={handleStartAdding}>
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Add New Delivery Note
              </Button>
            )}
          </>
        )}
      </div>

      {/* Pivot table */}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="text-xs font-medium uppercase tracking-wider text-muted-foreground min-w-[180px]">
                Item
              </TableHead>
              <TableHead className="text-center text-xs font-medium uppercase tracking-wider text-muted-foreground w-[60px]">
                Unit
              </TableHead>
              <TableHead className="text-right text-xs font-medium uppercase tracking-wider text-muted-foreground w-[80px]">
                Ordered
              </TableHead>

              {/* Existing DN column — hidden when editing */}
              {existingDN && (
                <TableHead className="text-right text-xs font-medium text-muted-foreground min-w-[100px]">
                  <div className="flex flex-col items-end gap-0.5 py-0.5">
                    <span className="uppercase tracking-wider font-semibold text-foreground/80">
                      DN
                    </span>
                    <span className="text-[10px] font-normal border-b pb-0.5 border-primary/30">
                      {formatDate(existingDN.delivery_date || existingDN.creation)}
                    </span>
                    {dnUserName && (
                      <span className="text-[10px] text-muted-foreground truncate max-w-[100px]" title={dnUserName}>
                        by {dnUserName.split(" ")[0]}
                      </span>
                    )}
                  </div>
                </TableHead>
              )}

              {/* New entry column */}
              {isAdding && (
                <TableHead className="text-center text-xs font-medium uppercase tracking-wider text-muted-foreground bg-primary/5 min-w-[80px]">
                  New Entry
                </TableHead>
              )}

              {/* Total received */}
              <TableHead className="text-right text-xs font-medium uppercase tracking-wider text-muted-foreground min-w-[90px]">
                Total Received
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => {
              const dnQty = dnQtyByItem[item.item_id] || 0;
              const totalReceived = totalReceivedByItem[item.item_id] || 0;
              const fullyDelivered = totalReceived >= item.transfer_quantity && totalReceived > 0;
              const overDelivered = totalReceived > item.transfer_quantity;

              return (
                <TableRow
                  key={item.item_id}
                  className={cn(
                    fullyDelivered && !overDelivered && "bg-green-50/40",
                    overDelivered && "bg-amber-50/40"
                  )}
                >
                  <TableCell className="text-sm">
                    <span>{item.item_name ?? item.item_id}</span>
                    {item.make && (
                      <span className="text-xs text-blue-600 ml-1.5">
                        - {item.make}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-center text-sm text-muted-foreground">
                    {item.unit ?? "--"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm font-medium">
                    {item.transfer_quantity}
                  </TableCell>

                  {/* Existing DN qty — hidden when editing */}
                  {existingDN && (
                    <TableCell className="text-right tabular-nums text-sm">
                      {dnQty > 0 ? dnQty : <span className="text-muted-foreground">--</span>}
                    </TableCell>
                  )}

                  {/* Input column (add or edit) */}
                  {isAdding && (
                    <TableCell className="text-center bg-primary/5">
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        value={newEntries[item.item_id] || ""}
                        placeholder="0"
                        onChange={(e) =>
                          handleEntryChange(item.item_id, e.target.value)
                        }
                        disabled={isSubmitting}
                        className="h-8 w-20 text-center text-sm tabular-nums mx-auto"
                      />
                    </TableCell>
                  )}

                  {/* Total received */}
                  <TableCell className="text-right tabular-nums text-sm font-medium">
                    <span className="inline-flex items-center gap-1">
                      {totalReceived}
                      {fullyDelivered && !overDelivered && (
                        <Check className="h-3.5 w-3.5 text-green-600" />
                      )}
                      {overDelivered && (
                        <TriangleAlert className="h-3.5 w-3.5 text-amber-600" />
                      )}
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export default ITMDeliverySection;
