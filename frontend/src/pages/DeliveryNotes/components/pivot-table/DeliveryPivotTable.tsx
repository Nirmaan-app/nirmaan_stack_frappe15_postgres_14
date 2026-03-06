import { useState, useCallback } from "react";
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
import { Table } from "@/components/ui/table";
import { Plus } from "lucide-react";
import { TailSpin } from "react-loader-spinner";
import { useDeliveryPivotData } from "../../hooks/useDeliveryPivotData";
import { useDeliverySubmit } from "../../hooks/useDeliverySubmit";
import { useDeliveryEdit } from "../../hooks/useDeliveryEdit";
import { useDownloadDN } from "../../hooks/useDownloadDN";
import { PivotTableHeader } from "./PivotTableHeader";
import { PivotTableBody } from "./PivotTableBody";
import { DeliveryPivotTableProps, DNColumn } from "./types";

export function DeliveryPivotTable({
  po,
  dnRecords,
  onPoMutate,
  onDnRefetch,
  canEdit,
  isEmbedded = false,
  isProjectManager = false,
}: DeliveryPivotTableProps) {
  const pivotData = useDeliveryPivotData(po, dnRecords);
  const submitHook = useDeliverySubmit({
    po,
    onSuccess: onPoMutate,
    onDnRefetch,
  });
  const editHook = useDeliveryEdit({
    onSuccess: onPoMutate,
    onDnRefetch,
  });
  const { downloadDN } = useDownloadDN(po.name);

  const [showEdit, setShowEdit] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(false);
  const [editConfirmDialog, setEditConfirmDialog] = useState(false);

  // Toggle create mode — cancel edit mode if active
  const handleToggleEdit = useCallback(() => {
    if (showEdit) {
      submitHook.resetForm();
    }
    editHook.cancelEdit();
    setShowEdit((prev) => !prev);
  }, [showEdit, submitHook.resetForm, editHook.cancelEdit]);

  // Start editing an existing DN — close create mode if active
  const handleStartEdit = useCallback(
    (col: DNColumn) => {
      setShowEdit(false);
      submitHook.resetForm();
      editHook.initEdit(col, pivotData.rows);
    },
    [editHook.initEdit, pivotData.rows, submitHook.resetForm]
  );

  const handleConfirmSubmit = useCallback(async () => {
    await submitHook.handleSubmit();
    setShowEdit(false);
    setConfirmDialog(false);
  }, [submitHook.handleSubmit]);

  const handleConfirmEdit = useCallback(async () => {
    await editHook.submitEdit();
    setEditConfirmDialog(false);
  }, [editHook.submitEdit]);

  return (
    <div className={isEmbedded ? "" : "border rounded-lg bg-card"}>
      {/* Action bar for create mode */}
      {canEdit && !editHook.editingDnName && (
        <div
          className={`flex items-center justify-end gap-2 ${
            isEmbedded ? "pb-3" : "px-4 py-3 border-b"
          }`}
        >
          {showEdit ? (
            <>
              <Button
                size="sm"
                onClick={() => setConfirmDialog(true)}
                disabled={!submitHook.hasChanges}
              >
                Update
              </Button>
              <Button size="sm" variant="ghost" onClick={handleToggleEdit}>
                Cancel
              </Button>
            </>
          ) : (
            <Button size="sm" variant="outline" onClick={handleToggleEdit}>
              <Plus className="h-4 w-4 mr-1" />
              Add New Delivery Note
            </Button>
          )}
        </div>
      )}

      {/* Action bar for edit mode */}
      {editHook.editingDnName && (
        <div
          className={`flex items-center justify-end gap-2 ${
            isEmbedded ? "pb-3" : "px-4 py-3 border-b"
          }`}
        >
          <span className="text-sm text-muted-foreground mr-auto">
            Editing {editHook.editingDnName}
          </span>
          <Button
            size="sm"
            onClick={() => setEditConfirmDialog(true)}
            disabled={!editHook.hasEditChanges}
          >
            Save Changes
          </Button>
          <Button size="sm" variant="ghost" onClick={editHook.cancelEdit}>
            Cancel
          </Button>
        </div>
      )}

      {/* Desktop: Scrollable table */}
      <div className="hidden sm:block overflow-x-auto">
        <Table>
          <PivotTableHeader
            pivotData={pivotData}
            showEdit={showEdit && canEdit}
            onDownloadDN={downloadDN}
            isProjectManager={isProjectManager}
            editingDnName={editHook.editingDnName}
            canEditDn={editHook.canEditDn}
            onEditDn={handleStartEdit}
          />
          <PivotTableBody
            pivotData={pivotData}
            showEdit={showEdit && canEdit}
            submitHook={submitHook}
            isProjectManager={isProjectManager}
            editingDnName={editHook.editingDnName}
            editedQuantities={editHook.editedQuantities}
            onEditQuantityChange={editHook.handleEditQuantityChange}
          />
        </Table>
      </div>

      {/* Mobile: Stacked card view */}
      <div className="block sm:hidden">
        {pivotData.rows.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            No items found
          </div>
        ) : (
          <div className="divide-y">
            {pivotData.rows.map((row) => (
              <div key={row.itemId} className="p-3 space-y-2">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-medium text-sm">{row.itemName}</p>
                    <p className="text-xs text-muted-foreground">{row.unit}</p>
                  </div>
                  <div className="text-right">
                    {!isProjectManager && (
                      <p className="text-xs text-muted-foreground">
                        Ordered: {row.orderedQty}
                      </p>
                    )}
                    <p className="text-sm font-medium">
                      Received: {row.totalReceived}
                    </p>
                  </div>
                </div>
                {/* DN deliveries */}
                {pivotData.dnColumns.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {pivotData.dnColumns.map((col) => {
                      const qty = row.dnQuantities[col.dnName];
                      if (qty == null) return null;
                      return (
                        <span
                          key={col.dnName}
                          className="text-xs bg-muted px-1.5 py-0.5 rounded"
                        >
                          DN-{col.noteNo}: {qty}
                        </span>
                      );
                    })}
                  </div>
                )}
                {/* Edit input for mobile (create mode) */}
                {showEdit &&
                  canEdit &&
                  !editHook.editingDnName &&
                  !row.isFullyDelivered && (
                    <div className="pt-1">
                      <Input
                        type="number"
                        className="h-8 text-sm"
                        placeholder="New qty"
                        value={
                          submitHook.newlyDeliveredQuantities[row.itemId] || ""
                        }
                        onChange={(e) =>
                          submitHook.handleNewlyDeliveredChange(
                            row.itemId,
                            e.target.value,
                            row.remainingQty
                          )
                        }
                        min={0}
                        max={row.remainingQty}
                        disabled={row.isFullyDelivered}
                      />
                    </div>
                  )}
                {/* Edit input for mobile (edit existing DN mode) */}
                {editHook.editingDnName && (
                  <div className="pt-1">
                    <Label className="text-xs text-muted-foreground mb-1 block">
                      Edit qty (DN-
                      {pivotData.dnColumns.find(
                        (c) => c.dnName === editHook.editingDnName
                      )?.noteNo}
                      )
                    </Label>
                    <Input
                      type="number"
                      className="h-8 text-sm"
                      placeholder="0"
                      value={
                        editHook.editedQuantities[row.itemItemId] ?? ""
                      }
                      onChange={(e) => {
                        const currentDnQty =
                          row.dnQuantities[editHook.editingDnName!] ?? 0;
                        editHook.handleEditQuantityChange(
                          row.itemItemId,
                          e.target.value,
                          row.remainingQty + currentDnQty
                        );
                      }}
                      min={0}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create confirmation dialog */}
      <AlertDialog open={confirmDialog} onOpenChange={setConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Delivery Update</AlertDialogTitle>
            <AlertDialogDescription>
              {
                Object.values(submitHook.newlyDeliveredQuantities).filter(
                  (v) => parseFloat(v) > 0
                ).length
              }{" "}
              item(s) will be updated
              {submitHook.selectedAttachment &&
                " and a delivery challan will be attached"}
              .
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex gap-4 items-center w-full mt-2">
            <Label className="w-[40%]">
              Delivery Date: <sup className="text-sm text-red-600">*</sup>
            </Label>
            <Input
              type="date"
              value={submitHook.deliveryDate}
              onChange={(e) => submitHook.setDeliveryDate(e.target.value)}
              max={new Date().toISOString().split("T")[0]}
              onKeyDown={(e) => e.preventDefault()}
            />
          </div>
          <AlertDialogFooter>
            {submitHook.isSubmitting ? (
              <TailSpin color="red" width={40} height={40} />
            ) : (
              <>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <Button
                  onClick={handleConfirmSubmit}
                  disabled={!submitHook.deliveryDate}
                >
                  Confirm Update
                </Button>
              </>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit confirmation dialog */}
      <AlertDialog
        open={editConfirmDialog}
        onOpenChange={setEditConfirmDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Edit</AlertDialogTitle>
            <AlertDialogDescription>
              Update quantities for this delivery note? PO totals will be
              recalculated automatically.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            {editHook.isEditSubmitting ? (
              <TailSpin color="red" width={40} height={40} />
            ) : (
              <>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <Button onClick={handleConfirmEdit}>Confirm</Button>
              </>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
