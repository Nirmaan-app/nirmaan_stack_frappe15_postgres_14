import React, { useCallback, useMemo, useState } from "react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { TailSpin } from "react-loader-spinner";
import { Download, Plus } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/use-toast";
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
  is_return: number;
  items: DNItem[];
}

/**
 * Inline Delivery Notes section — mirrors the PO delivery notes pattern.
 *
 * Shows a table with: ITEM | UNIT | ORDERED | [NEW ENTRY when adding] | TOTAL RECEIVED
 * "+ Add New Delivery Note" adds a new entry column with inline inputs.
 * "Update" submits the new DN without navigating away.
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

  const dnList: DNRecord[] = dnData?.message ?? [];

  const canCreateDN =
    itmStatus === "Dispatched" || itmStatus === "Partially Delivered";

  // All ITM items are approved by definition
  const approvedItems = items;

  // Aggregate total received per item from all DNs
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

  if (dnLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <TailSpin visible height="28" width="28" color="#D03B45" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            {dnList.length} Updates
          </Badge>
        </div>
        <div className="flex items-center gap-2">

          {canCreateDN && !isAdding && (
            <Button size="sm" onClick={handleStartAdding}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Add New Delivery Note
            </Button>
          )}
          {isAdding && (
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
          )}
        </div>
      </div>

      {/* Items table */}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead className="text-[11px] uppercase tracking-wide font-semibold">
                Item
              </TableHead>
              <TableHead className="text-[11px] uppercase tracking-wide font-semibold w-20">
                Unit
              </TableHead>
              <TableHead className="text-[11px] uppercase tracking-wide font-semibold w-28 text-right">
                Ordered
              </TableHead>
              {isAdding && (
                <TableHead className="text-[11px] uppercase tracking-wide font-semibold w-32 text-center bg-red-50">
                  New Entry
                </TableHead>
              )}
              <TableHead className="text-[11px] uppercase tracking-wide font-semibold w-36 text-right">
                Total Received
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {approvedItems.map((item) => {
              const totalReceived = totalReceivedByItem[item.item_id] || 0;
              return (
                <TableRow key={item.item_id}>
                  <TableCell className="text-sm">
                    <span>{item.item_name ?? item.item_id}</span>
                    {item.make && (
                      <span className="text-xs text-blue-600 ml-1.5">
                        - {item.make}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {item.unit ?? "--"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm font-medium">
                    {item.transfer_quantity}
                  </TableCell>
                  {isAdding && (
                    <TableCell className="text-center bg-red-50/50">
                      <Input
                        type="number"
                        min={0}
                        max={item.transfer_quantity - totalReceived}
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
                  <TableCell className="text-right tabular-nums text-sm font-medium">
                    <span
                      className={
                        totalReceived >= item.transfer_quantity
                          ? "text-green-600"
                          : totalReceived > 0
                            ? "text-orange-600"
                            : "text-red-500"
                      }
                    >
                      {totalReceived}
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
