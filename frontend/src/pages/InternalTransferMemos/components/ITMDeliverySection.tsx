import React, { useCallback, useMemo, useState } from "react";
import { useFrappeGetCall, useFrappeGetDocList, useFrappePostCall } from "frappe-react-sdk";
import { TailSpin } from "react-loader-spinner";
import { Check, Pencil, Plus, Trash2, TriangleAlert } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { useUserData } from "@/hooks/useUserData";
import { formatDate } from "@/utils/FormatDate";
import { cn } from "@/lib/utils";
import { useITMDeliveryEdit } from "@/pages/DeliveryNotes/hooks/useITMDeliveryEdit";
import { useITMDeliveryDelete } from "@/pages/DeliveryNotes/hooks/useITMDeliveryDelete";
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
  make?: string | null;
  unit?: string;
  delivered_quantity: number;
}

// Composite key so two ITM rows with same item_id but different makes don't
// share a state slot. NULL/empty make collapses to a single bucket.
const rowKey = (itemId: string, make?: string | null) =>
  `${itemId}|${make ?? ""}`;

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
 * Renders one column per DN (sorted oldest → newest), matching the standalone
 * ITM DN page. Returns (is_return=1) are filtered out; ITM Phase 1 doesn't
 * support return notes anyway.
 */
export const ITMDeliverySection: React.FC<ITMDeliverySectionProps> = ({
  itmName,
  itmStatus,
  items,
  onDNCreated,
}) => {
  const userData = useUserData();
  // Delete button mirrors PO DN convention — Admin role / Administrator user only.
  const isAdmin =
    userData?.role === "Nirmaan Admin Profile" ||
    userData?.user_id === "Administrator";

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

  // Edit + Delete hooks — same role gate as PO DN. Delete UI is Admin-only.
  const {
    editingDnName,
    editedQuantities,
    isEditSubmitting,
    initEdit,
    cancelEdit: cancelEditHook,
    handleEditQuantityChange,
    submitEdit,
    canEditDn,
    hasEditChanges,
  } = useITMDeliveryEdit({
    onDnRefetch: () => mutateDNs(),
    onSuccess: () => onDNCreated?.(),
  });

  const {
    isDeleting,
    deleteConfirmDialog,
    setDeleteConfirmDialog,
    dnToDelete,
    handleDeleteClick,
    handleConfirmDelete,
  } = useITMDeliveryDelete({
    onRefresh: () => mutateDNs(),
    onSuccess: () => onDNCreated?.(),
  });

  const dnList: DNRecord[] = dnData?.message ?? [];

  // Render one column per DN, sorted oldest → newest (matches the standalone
  // ITM DN page and PO `DeliveryPivotTable`). Returns are filtered out
  // (ITM Phase 1 has no return-note flow).
  const visibleDNs = useMemo(
    () =>
      [...dnList]
        .filter((dn) => !dn.is_return)
        .sort((a, b) => {
          const aTs = new Date(a.delivery_date || a.creation || 0).getTime();
          const bTs = new Date(b.delivery_date || b.creation || 0).getTime();
          return aTs - bTs;
        }),
    [dnList]
  );

  // Lifecycle gate: only Dispatched / Partially Delivered ITMs can have a
  // new DN added. Same rule as the standalone page; allows multiple DNs.
  const canCreateDN =
    itmStatus === "Dispatched" || itmStatus === "Partially Delivered";

  // dnQtyByDn[dnName][rowKey] = qty for that (DN, item+make) pair.
  const dnQtyByDn = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    for (const dn of visibleDNs) {
      const inner: Record<string, number> = {};
      for (const di of dn.items ?? []) {
        const k = rowKey(di.item_id, di.make);
        inner[k] = (inner[k] || 0) + (di.delivered_quantity || 0);
      }
      map[dn.name] = inner;
    }
    return map;
  }, [visibleDNs]);

  // Total received across all DNs, keyed by (item, make).
  const totalReceivedByItem = useMemo(() => {
    const map: Record<string, number> = {};
    for (const dn of visibleDNs) {
      for (const di of dn.items ?? []) {
        const k = rowKey(di.item_id, di.make);
        map[k] = (map[k] || 0) + (di.delivered_quantity || 0);
      }
    }
    return map;
  }, [visibleDNs]);

  const handleStartAdding = useCallback(() => {
    setNewEntries({});
    setIsAdding(true);
  }, []);

  const handleCancel = useCallback(() => {
    setNewEntries({});
    setIsAdding(false);
  }, []);

  const handleEntryChange = useCallback((key: string, value: string) => {
    const num = value === "" ? 0 : Number(value);
    setNewEntries((prev) => ({ ...prev, [key]: Number.isFinite(num) ? num : 0 }));
  }, []);

  const hasValidEntries = useMemo(
    () => Object.values(newEntries).some((v) => v > 0),
    [newEntries]
  );

  const handleUpdate = useCallback(async () => {
    if (!hasValidEntries) return;

    // Walk ITM items in order — for each row whose composite key has a
    // positive entry, record (item_id, make, qty). The composite-key state
    // shape can't be parsed back blindly because make may itself contain "|".
    const payload = items
      .map((it) => {
        const qty = newEntries[rowKey(it.item_id, it.make)];
        return qty && qty > 0
          ? { item_id: it.item_id, make: it.make ?? null, delivered_quantity: qty }
          : null;
      })
      .filter((x): x is { item_id: string; make: string | null; delivered_quantity: number } => x !== null);

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
  }, [hasValidEntries, newEntries, items, createDN, itmName, mutateDNs, onDNCreated]);

  if (dnLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <TailSpin visible height="28" width="28" color="#D03B45" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Action buttons */}
      <div className="flex items-center justify-end gap-2">
        {editingDnName ? (
          <>
            <Button
              size="sm"
              onClick={submitEdit}
              disabled={!hasEditChanges || isEditSubmitting}
              className="bg-red-600 hover:bg-red-700"
            >
              {isEditSubmitting ? "Updating..." : "Update"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={cancelEditHook}
              disabled={isEditSubmitting}
            >
              Cancel
            </Button>
          </>
        ) : isAdding ? (
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

              {/* One column per DN — sorted oldest first. */}
              {visibleDNs.map((dn, idx) => {
                const updatedBy = dn.updated_by_user || dn.owner;
                const displayName = updatedBy
                  ? userNameMap.get(updatedBy) ??
                    (updatedBy === "Administrator"
                      ? "Admin"
                      : updatedBy.split("@")[0])
                  : null;
                const noteNo = dn.note_no ?? idx + 1;
                const dnCol = {
                  dnName: dn.name,
                  updatedBy,
                  creationDate: dn.creation,
                };
                const isEditingThis = editingDnName === dn.name;
                return (
                  <TableHead
                    key={dn.name}
                    className={cn(
                      "text-right text-xs font-medium text-muted-foreground min-w-[100px]",
                      isEditingThis && "bg-primary/5"
                    )}
                  >
                    <div className="flex flex-col items-end gap-0.5 py-0.5">
                      <span className="uppercase tracking-wider font-semibold text-foreground/80">
                        DN-{noteNo}
                      </span>
                      <span className="text-[10px] font-normal border-b pb-0.5 border-primary/30">
                        {formatDate(dn.delivery_date || dn.creation)}
                      </span>
                      {displayName && (
                        <span
                          className="text-[10px] text-muted-foreground truncate max-w-[100px]"
                          title={displayName}
                        >
                          by {displayName.split(" ")[0]}
                        </span>
                      )}
                      {/* Match PO: keep pencil/trash visible during create
                          mode; only hide when this DN is being edited. */}
                      {!editingDnName && (
                        <div className="flex items-center gap-1 mt-0.5">
                          {canEditDn(dnCol) && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-5 w-5"
                              title="Edit this delivery note"
                              onClick={() => {
                                const initial: Record<string, number> = {};
                                for (const it of items) {
                                  const k = rowKey(it.item_id, it.make);
                                  const qty = dnQtyByDn[dn.name]?.[k];
                                  if (qty && qty > 0) initial[k] = qty;
                                }
                                initEdit(dnCol, initial);
                              }}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                          )}
                          {isAdmin && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-5 w-5 text-destructive hover:text-destructive"
                              title="Delete this delivery note"
                              onClick={() =>
                                handleDeleteClick({ dnName: dn.name })
                              }
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </TableHead>
                );
              })}

              {/* New entry column */}
              {isAdding && !editingDnName && (
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
              const k = rowKey(item.item_id, item.make);
              const totalReceived = totalReceivedByItem[k] || 0;
              const fullyDelivered = totalReceived >= item.transfer_quantity && totalReceived > 0;
              const overDelivered = totalReceived > item.transfer_quantity;

              return (
                <TableRow
                  key={k}
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

                  {/* One qty cell per DN. Becomes an input when THIS DN is
                      being edited (only for items already on the DN). */}
                  {visibleDNs.map((dn) => {
                    const qty = dnQtyByDn[dn.name]?.[k] || 0;
                    const isEditingThis = editingDnName === dn.name;
                    if (isEditingThis && qty > 0) {
                      return (
                        <TableCell
                          key={dn.name}
                          className="text-center bg-primary/5"
                        >
                          <Input
                            type="text"
                            inputMode="decimal"
                            value={editedQuantities[k] ?? ""}
                            onChange={(e) =>
                              handleEditQuantityChange(k, e.target.value)
                            }
                            className="h-8 w-20 text-center text-sm tabular-nums mx-auto"
                            placeholder="0"
                          />
                        </TableCell>
                      );
                    }
                    return (
                      <TableCell
                        key={dn.name}
                        className={cn(
                          "text-right tabular-nums text-sm",
                          isEditingThis && "bg-primary/5"
                        )}
                      >
                        {qty > 0 ? qty : <span className="text-muted-foreground">--</span>}
                      </TableCell>
                    );
                  })}

                  {/* New-entry input column */}
                  {isAdding && !editingDnName && (
                    <TableCell className="text-center bg-primary/5">
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        value={newEntries[k] || ""}
                        placeholder="0"
                        onChange={(e) =>
                          handleEntryChange(k, e.target.value)
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

      {/* Delete confirmation dialog — Admin-only action (button gated above). */}
      <AlertDialog
        open={deleteConfirmDialog}
        onOpenChange={setDeleteConfirmDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Delivery Note?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete{" "}
              <span className="font-semibold">{dnToDelete?.dnName}</span>.
              ITM received quantities, status, and (for warehouse-target ITMs)
              warehouse stock will be recalculated. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            {isDeleting ? (
              <TailSpin color="red" width={32} height={32} />
            ) : (
              <>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <Button variant="destructive" onClick={handleConfirmDelete}>
                  Delete
                </Button>
              </>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ITMDeliverySection;
