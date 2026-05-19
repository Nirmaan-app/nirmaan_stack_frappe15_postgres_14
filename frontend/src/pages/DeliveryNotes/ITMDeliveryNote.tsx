import React, { useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  useFrappeGetCall,
  useFrappeGetDocList,
  useFrappePostCall,
} from "frappe-react-sdk";
import { ArrowLeft, Pencil, Plus, Trash2 } from "lucide-react";
import { TailSpin } from "react-loader-spinner";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/use-toast";

import { useUserData } from "@/hooks/useUserData";
import { formatDate, isCreatedToday } from "@/utils/FormatDate";
import { decodeFrappeId } from "./constants";
import { ITMDeliveryMetadataBar } from "./components/ITMDeliveryMetadataBar";
import { useITMDeliveryEdit } from "./hooks/useITMDeliveryEdit";
import { useITMDeliveryDelete } from "./hooks/useITMDeliveryDelete";
import {
  SameDayDNWarningDialog,
  WarningDN,
} from "./components/SameDayDNWarningDialog";
import type { ITMDetailPayload } from "@/pages/InternalTransferMemos/hooks/useITM";
import type { DeliveryNote } from "@/types/NirmaanStack/DeliveryNotes";
import type { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers";

// --- Types ---

interface ItemRow {
  item_id: string;
  item_name: string;
  /** Make of this ITM row — needed to disambiguate two rows with same item_id. */
  make: string | null;
  unit: string;
  category?: string;
  transfer_quantity: number;
  total_received: number;
  new_qty: number;
  /** delivered_quantity per DN name → renders one cell per DN column. */
  dnQuantities: Record<string, number>;
}

// Composite key so two ITM rows with same item_id but different makes don't
// share an input slot or aggregation bucket. NULL/empty make → single bucket.
const rowKey = (itemId: string, make?: string | null) =>
  `${itemId}|${make ?? ""}`;

const today = () => new Date().toISOString().split("T")[0];

const DN_HUB_PATH = "/prs&milestones/delivery-notes?view=create";

// --- Component ---

const ITMDeliveryNote: React.FC = () => {
  const { itmId: encodedId } = useParams<{ itmId: string }>();
  const itmId = decodeFrappeId(encodedId ?? "");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const viewMode =
    searchParams.get("mode") === "create" ? "create" : "view";

  const userData = useUserData();
  const isProjectManager =
    userData?.role === "Nirmaan Project Manager Profile";
  // Delete button is Admin-only in the UI — mirrors the PO DN convention.
  const isAdmin =
    userData?.role === "Nirmaan Admin Profile" ||
    userData?.user_id === "Administrator";
  const hideTotalReceived = isProjectManager && viewMode === "create";

  // In "create" mode the input row is auto-open. In "view" it stays
  // closed until the user clicks "Add New Delivery Note" — same pattern
  // as the PO `DeliveryPivotTable`.
  const [showEdit, setShowEdit] = useState(viewMode === "create");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deliveryDate, setDeliveryDate] = useState(today);
  const [submitting, setSubmitting] = useState(false);

  // --- Data fetching ---
  const {
    data: itmData,
    isLoading: itmLoading,
    error: itmError,
  } = useFrappeGetCall<{ message: ITMDetailPayload }>(
    "nirmaan_stack.api.internal_transfers.get_itm.get_itm",
    itmId ? { name: itmId } : undefined,
    itmId ? undefined : null
  );

  const {
    data: dnsData,
    isLoading: dnsLoading,
    mutate: refetchDNs,
  } = useFrappeGetCall<{ message: DeliveryNote[] }>(
    "nirmaan_stack.api.delivery_notes.get_delivery_notes.get_delivery_notes_for_itm",
    itmId ? { itm_name: itmId } : undefined,
    itmId ? undefined : null
  );

  const { call: createDN } = useFrappePostCall(
    "nirmaan_stack.api.delivery_notes.create_itm_delivery_note.create_itm_delivery_note"
  );

  const { data: usersList } = useFrappeGetDocList<NirmaanUsers>(
    "Nirmaan Users",
    {
      fields: ["name", "full_name", "email"] as (
        | "name"
        | "full_name"
        | "email"
      )[],
      limit: 0,
    }
  );

  const userNameMap = useMemo(() => {
    const map = new Map<string, string>();
    usersList?.forEach((u) => {
      map.set(u.name, u.full_name);
      if (u.email) map.set(u.email, u.full_name);
    });
    return map;
  }, [usersList]);

  // Edit + Delete hooks — same role gate as PO DN (Admin/PMO/PL/Procurement
  // always; PM same-day + creator). Delete UI is gated separately on isAdmin.
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
    onDnRefetch: () => refetchDNs(),
  });

  const {
    isDeleting,
    deleteConfirmDialog,
    setDeleteConfirmDialog,
    dnToDelete,
    handleDeleteClick,
    handleConfirmDelete,
  } = useITMDeliveryDelete({
    onRefresh: () => refetchDNs(),
  });

  const payload = itmData?.message;
  const itm = payload?.itm;
  // Sort DNs oldest → newest so columns read left-to-right in chronological
  // order, matching the PO pivot's behaviour. Returns are ignored (ITM has
  // no `is_return` flow today).
  const dns = useMemo(() => {
    const list = (dnsData?.message || []).filter((dn) => dn.is_return !== 1);
    return [...list].sort((a, b) => {
      const aTs = new Date(a.delivery_date || a.creation || 0).getTime();
      const bTs = new Date(b.delivery_date || b.creation || 0).getTime();
      return aTs - bTs;
    });
  }, [dnsData]);

  // --- Derive item rows with received totals (keyed by item_id+make) ---
  const itemRows: ItemRow[] = useMemo(() => {
    if (!itm?.items) return [];

    const receivedByItem: Record<string, number> = {};
    const dnQtyByItem: Record<string, Record<string, number>> = {};
    for (const dn of dns) {
      for (const item of dn.items || []) {
        const k = rowKey(item.item_id, (item as any).make ?? null);
        const qty = item.delivered_quantity || 0;
        receivedByItem[k] = (receivedByItem[k] || 0) + qty;
        if (!dnQtyByItem[k]) dnQtyByItem[k] = {};
        dnQtyByItem[k][dn.name] = qty;
      }
    }

    return itm.items.map((item) => {
      const k = rowKey(item.item_id, item.make ?? null);
      return {
        item_id: item.item_id,
        item_name: item.item_name || item.item_id,
        make: item.make ?? null,
        unit: item.unit || "",
        category: item.category,
        transfer_quantity: item.transfer_quantity,
        total_received: receivedByItem[k] || 0,
        new_qty: quantities[k] || 0,
        dnQuantities: dnQtyByItem[k] || {},
      };
    });
  }, [itm, dns, quantities]);

  const hasValidInput = useMemo(
    () => itemRows.some((r) => r.new_qty > 0),
    [itemRows]
  );

  // Duplicate / same-day warning — mirrors PO's DeliveryPivotTable. Keys
  // are composite (`item_id|make`) because ITM aggregation is by (item_id, make).
  const sameDayDNs = useMemo(
    () => dns.filter((dn) => isCreatedToday(dn.creation)),
    [dns]
  );

  const duplicateDNs = useMemo(() => {
    const newSig: Record<string, number> = {};
    for (const r of itemRows) {
      if (r.new_qty > 0) {
        newSig[rowKey(r.item_id, r.make)] = r.new_qty;
      }
    }
    const newKeys = Object.keys(newSig);
    if (newKeys.length === 0) return [] as DeliveryNote[];

    return dns.filter((dn) => {
      if (dn.is_return) return false;
      const existingSig: Record<string, number> = {};
      for (const item of dn.items || []) {
        const qty = Number(item.delivered_quantity) || 0;
        if (qty <= 0) continue;
        existingSig[rowKey(item.item_id, (item as any).make ?? null)] = qty;
      }
      const existingKeys = Object.keys(existingSig);
      if (existingKeys.length !== newKeys.length) return false;
      return newKeys.every((k) => existingSig[k] === newSig[k]);
    });
  }, [dns, itemRows]);

  const warningDNs = useMemo<WarningDN[]>(() => {
    const sameDayNames = new Set(sameDayDNs.map((dn) => dn.name));
    const duplicateNames = new Set(duplicateDNs.map((dn) => dn.name));
    const seen = new Set<string>();
    const merged: WarningDN[] = [];
    for (const dn of [...sameDayDNs, ...duplicateDNs]) {
      if (seen.has(dn.name)) continue;
      seen.add(dn.name);
      const isSameDay = sameDayNames.has(dn.name);
      const isDuplicate = duplicateNames.has(dn.name);
      const reason: WarningDN["reason"] =
        isSameDay && isDuplicate ? "both" : isSameDay ? "same-day" : "duplicate";
      merged.push({ dn, reason });
    }
    return merged;
  }, [sameDayDNs, duplicateDNs]);

  const [warningOpen, setWarningOpen] = useState(false);

  // Lifecycle gate matching the PO page: only Dispatched / Partially Delivered
  // ITMs can have a DN added. The backend `create_itm_delivery_note` endpoint
  // enforces the same — we mirror it client-side so the action button never
  // appears when illegal.
  const canEdit = useMemo(() => {
    const status = itm?.status;
    return status === "Dispatched" || status === "Partially Delivered";
  }, [itm]);

  const pageTitle =
    viewMode === "create" && itm
      ? `New Delivery Note - ${itm.name}`
      : itm
        ? `Delivery History - ${itm.name}`
        : "Delivery Note";

  // --- Handlers ---

  const handleQtyChange = (key: string, value: string) => {
    const num = parseFloat(value);
    setQuantities((prev) => ({
      ...prev,
      [key]: isNaN(num) || num < 0 ? 0 : num,
    }));
  };

  const handleToggleEdit = () => {
    if (showEdit) {
      setQuantities({});
    }
    setShowEdit((p) => !p);
  };

  const handleConfirmSubmit = async () => {
    if (!hasValidInput || submitting) return;
    setSubmitting(true);

    const items = itemRows
      .filter((r) => r.new_qty > 0)
      .map((r) => ({
        item_id: r.item_id,
        make: r.make,
        delivered_quantity: r.new_qty,
      }));

    try {
      await createDN({
        itm_id: itmId,
        items: JSON.stringify(items),
        delivery_date: deliveryDate,
      });
      toast({
        title: "Delivery Note created",
        description: `Delivery Note created for ${itm?.name}`,
        variant: "success",
      });
      setQuantities({});
      setShowEdit(false);
      setConfirmOpen(false);
      refetchDNs();
      if (viewMode === "create") {
        navigate(DN_HUB_PATH);
      }
    } catch (e: any) {
      toast({
        title: "Failed to create Delivery Note",
        description: e?.message || "Something went wrong",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  // --- Render guards ---

  if (itmLoading || dnsLoading) {
    return (
      <div className="flex items-center justify-center h-[80vh]">
        <TailSpin height={50} width={50} color="red" />
        <span className="ml-2 text-gray-600">Loading Delivery Note...</span>
      </div>
    );
  }

  if (itmError || !itm) {
    return (
      <div className="p-6 space-y-4">
        <div className="text-center text-red-600 py-4">
          {(itmError as any)?.message || "Transfer Memo not found."}
        </div>
        <Button variant="outline" onClick={() => navigate(DN_HUB_PATH)}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to DN Hub
        </Button>
      </div>
    );
  }

  const dnCount = dns.length;

  return (
    <div className="container mx-auto px-4 py-4 max-w-6xl space-y-4">
      {/* Back + Title */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(DN_HUB_PATH)}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <h1 className="text-xl font-bold text-foreground">{pageTitle}</h1>
      </div>

      <ITMDeliveryMetadataBar
        itm={itm}
        sourceProjectName={payload?.source_project_name}
        targetProjectName={payload?.target_project_name}
        dnCount={dnCount}
        estimatedValue={itm.estimated_value ?? 0}
      />

      {viewMode === "create" && dnCount === 0 && (
        <div className="rounded-md border border-blue-200 bg-blue-50 dark:bg-blue-950/30 px-4 py-3 text-sm text-blue-700 dark:text-blue-300">
          No delivery updates recorded yet. Enter quantities below to create
          the delivery note.
        </div>
      )}

      <div className="border rounded-lg bg-card">
        {/* Action bar — matches PO's `DeliveryPivotTable` action layout.
            Three modes share the bar: create-new-DN, edit-existing-DN, idle. */}
        <div className="flex flex-col sm:flex-row items-end sm:items-center justify-end gap-2 px-4 py-3 border-b">
          {editingDnName ? (
            <>
              <Button
                size="sm"
                onClick={submitEdit}
                disabled={!hasEditChanges || isEditSubmitting}
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
          ) : canEdit && showEdit ? (
            <>
              <Button
                size="sm"
                onClick={() => {
                  // Gate behind duplicate / same-day warning — same UX as PO.
                  if (warningDNs.length > 0) {
                    setWarningOpen(true);
                  } else {
                    setConfirmOpen(true);
                  }
                }}
                disabled={!hasValidInput || submitting}
              >
                Update
              </Button>
              {viewMode !== "create" && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleToggleEdit}
                >
                  Cancel
                </Button>
              )}
            </>
          ) : (
            canEdit &&
            viewMode !== "create" && (
              <Button size="sm" variant="outline" onClick={handleToggleEdit}>
                <Plus className="h-4 w-4 mr-1" />
                Add New Delivery Note
              </Button>
            )
          )}
        </div>

        {/* Pivot-style table — one column per DN, optional New Entry column */}
        <div className="relative overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="text-xs font-medium uppercase tracking-wider text-muted-foreground min-w-[200px]">
                  Item
                </TableHead>
                <TableHead className="text-center text-xs font-medium uppercase tracking-wider text-muted-foreground w-[60px]">
                  Unit
                </TableHead>
                {!isProjectManager && (
                  <TableHead className="text-right text-xs font-medium uppercase tracking-wider text-muted-foreground w-[100px]">
                    Transfer Qty
                  </TableHead>
                )}
                {dns.map((dn, idx) => {
                  const updatedBy = dn.updated_by_user || dn.owner;
                  const displayName = updatedBy
                    ? userNameMap.get(updatedBy) ??
                      (updatedBy === "Administrator"
                        ? "Admin"
                        : updatedBy.split("@")[0])
                    : null;
                  const noteNo = (dn as any).note_no ?? idx + 1;
                  const dnCol = {
                    dnName: dn.name,
                    updatedBy,
                    creationDate: dn.creation,
                  };
                  const isEditingThis = editingDnName === dn.name;
                  // Match PO: pencil/trash stay visible while user types
                  // a new DN; only hide when another DN is being edited.
                  const showEditBtn = !editingDnName && canEditDn(dnCol);
                  const showDeleteBtn = !editingDnName && isAdmin;
                  return (
                    <TableHead
                      key={dn.name}
                      className={`text-right text-xs font-medium text-muted-foreground min-w-[100px] ${isEditingThis ? "bg-primary/5" : ""}`}
                    >
                      <div className="flex flex-col items-end gap-0.5 py-0.5">
                        <span className="uppercase tracking-wider font-semibold text-foreground/80">
                          DN-{noteNo}
                        </span>
                        <span className="text-[10px] font-normal border-b pb-0.5 border-primary/30">
                          {formatDate(dn.delivery_date)}
                        </span>
                        {displayName && (
                          <span className="text-[10px] text-muted-foreground">
                            by {displayName.split(" ")[0]}
                          </span>
                        )}
                        {(showEditBtn || showDeleteBtn) && (
                          <div className="flex items-center gap-1 mt-0.5">
                            {showEditBtn && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-5 w-5"
                                title="Edit this delivery note"
                                onClick={() => {
                                  const initial: Record<string, number> = {};
                                  for (const row of itemRows) {
                                    const qty = row.dnQuantities[dn.name];
                                    if (qty && qty > 0) {
                                      initial[rowKey(row.item_id, row.make)] = qty;
                                    }
                                  }
                                  initEdit(dnCol, initial);
                                }}
                              >
                                <Pencil className="h-3 w-3" />
                              </Button>
                            )}
                            {showDeleteBtn && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-5 w-5 text-destructive hover:text-destructive"
                                title="Delete this delivery note"
                                onClick={() => handleDeleteClick({ dnName: dn.name })}
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
                {showEdit && canEdit && !editingDnName && (
                  <TableHead className="text-center text-xs font-medium uppercase tracking-wider text-muted-foreground bg-primary/5 min-w-[80px]">
                    New Entry
                  </TableHead>
                )}
                {!hideTotalReceived && (
                  <TableHead className="text-right text-xs font-medium uppercase tracking-wider text-muted-foreground min-w-[100px]">
                    Total Received
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {itemRows.map((row) => {
                const k = rowKey(row.item_id, row.make);
                const remaining = row.transfer_quantity - row.total_received;
                return (
                  <TableRow key={k}>
                    <TableCell className="text-sm max-w-[260px]">
                      <div className="line-clamp-2 break-words">
                        <span className="font-medium">{row.item_name}</span>
                        {row.make && (
                          <span className="text-red-500 font-light">
                            {" "}- {row.make}
                          </span>
                        )}
                      </div>
                      {row.category && (
                        <span className="block text-xs text-muted-foreground">
                          {row.category}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-center text-sm text-muted-foreground">
                      {row.unit}
                    </TableCell>
                    {!isProjectManager && (
                      <TableCell className="text-right tabular-nums text-sm font-medium">
                        {row.transfer_quantity}
                      </TableCell>
                    )}
                    {dns.map((dn) => {
                      const qty = row.dnQuantities[dn.name] || 0;
                      const isEditingThis = editingDnName === dn.name;
                      // Only the items present on the DN being edited get an
                      // input; rows not on the DN render "--" so the user
                      // can see what's not part of this DN. Adding new rows
                      // to an existing DN isn't supported here (mirrors PO).
                      if (isEditingThis && qty > 0) {
                        const k = rowKey(row.item_id, row.make);
                        const inputVal = editedQuantities[k] ?? "";
                        return (
                          <TableCell
                            key={dn.name}
                            className="text-center bg-primary/5"
                          >
                            <Input
                              type="text"
                              inputMode="decimal"
                              value={inputVal}
                              onChange={(e) =>
                                handleEditQuantityChange(k, e.target.value)
                              }
                              className="w-[80px] mx-auto text-center"
                              placeholder="0"
                            />
                          </TableCell>
                        );
                      }
                      return (
                        <TableCell
                          key={dn.name}
                          className={`text-right tabular-nums text-sm ${isEditingThis ? "bg-primary/5" : ""}`}
                        >
                          {qty > 0 ? (
                            qty
                          ) : (
                            <span className="text-muted-foreground">--</span>
                          )}
                        </TableCell>
                      );
                    })}
                    {showEdit && canEdit && !editingDnName && (
                      <TableCell className="text-center bg-primary/5">
                        <Input
                          type="number"
                          min={0}
                          max={remaining > 0 ? remaining : 0}
                          step="any"
                          value={row.new_qty || ""}
                          onChange={(e) =>
                            handleQtyChange(k, e.target.value)
                          }
                          className="w-[100px] mx-auto text-center"
                          disabled={remaining <= 0}
                          placeholder="0"
                        />
                      </TableCell>
                    )}
                    {!hideTotalReceived && (
                      <TableCell className="text-right tabular-nums text-sm font-medium">
                        <span
                          className={
                            row.total_received >= row.transfer_quantity
                              ? "text-green-600 font-medium"
                              : row.total_received > 0
                                ? "text-orange-600 font-medium"
                                : "text-red-500"
                          }
                        >
                          {row.total_received}
                        </span>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Duplicate / same-day warning — parity with PO DeliveryPivotTable. */}
      <SameDayDNWarningDialog
        warningDNs={warningDNs}
        open={warningOpen}
        onCancel={() => setWarningOpen(false)}
        onContinue={() => {
          setWarningOpen(false);
          setConfirmOpen(true);
        }}
      />

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
              <TailSpin color="red" width={40} height={40} />
            ) : (
              <>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <Button
                  variant="destructive"
                  onClick={handleConfirmDelete}
                >
                  Delete
                </Button>
              </>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Submit confirmation dialog — date picker lives here, matching PO */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Delivery Update</AlertDialogTitle>
            <AlertDialogDescription>
              {itemRows.filter((r) => r.new_qty > 0).length} item(s) will be
              updated.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex gap-4 items-center w-full mt-2">
            <Label className="w-[40%]">
              Delivery Date: <sup className="text-sm text-red-600">*</sup>
            </Label>
            <Input
              type="date"
              value={deliveryDate}
              onChange={(e) => setDeliveryDate(e.target.value)}
              max={today()}
              onKeyDown={(e) => e.preventDefault()}
            />
          </div>
          <AlertDialogFooter>
            {submitting ? (
              <TailSpin color="red" width={40} height={40} />
            ) : (
              <>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <Button
                  onClick={handleConfirmSubmit}
                  disabled={!deliveryDate}
                >
                  Confirm Update
                </Button>
              </>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ITMDeliveryNote;