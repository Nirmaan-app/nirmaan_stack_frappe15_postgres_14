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
import { Plus, RotateCcw } from "lucide-react";
import { TailSpin } from "react-loader-spinner";
import { useDeliveryPivotData } from "../../hooks/useDeliveryPivotData";
import { useDeliverySubmit } from "../../hooks/useDeliverySubmit";
import { useReturnSubmit } from "../../hooks/useReturnSubmit";
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
  viewMode = "full",
  canReturn = false,
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
  const returnHook = useReturnSubmit({
    poId: po.name,
    poItems: po.items,
    onSuccess: onPoMutate,
    onDnRefetch,
  });

  // In "view-only" mode, override canEdit to false
  const effectiveCanEdit = viewMode === "view-only" ? false : canEdit;
  // In "create" mode, auto-open the new entry form
  const [showEdit, setShowEdit] = useState(viewMode === "create");
  const [showReturn, setShowReturn] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(false);
  const [editConfirmDialog, setEditConfirmDialog] = useState(false);
  const [returnConfirmDialog, setReturnConfirmDialog] = useState(false);

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

  const handleToggleReturn = useCallback(() => {
    if (showReturn) {
      returnHook.resetForm();
    }
    editHook.cancelEdit();
    setShowEdit(false);
    submitHook.resetForm();
    setShowReturn((prev) => !prev);
  }, [showReturn, returnHook.resetForm, editHook.cancelEdit, submitHook.resetForm]);

  const handleConfirmReturn = useCallback(async () => {
    await returnHook.handleSubmit();
    setShowReturn(false);
    setReturnConfirmDialog(false);
  }, [returnHook.handleSubmit]);

  return (
    <div className={isEmbedded ? "" : "border rounded-lg bg-card"}>
      {/* Action bar for create mode */}
      {effectiveCanEdit && !editHook.editingDnName && (
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
              {viewMode !== "create" && (
                <Button size="sm" variant="ghost" onClick={handleToggleEdit}>
                  Cancel
                </Button>
              )}
            </>
          ) : showReturn ? (
            <>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => setReturnConfirmDialog(true)}
                disabled={!returnHook.hasChanges}
              >
                Submit Return
              </Button>
              <Button size="sm" variant="ghost" onClick={handleToggleReturn}>
                Cancel
              </Button>
            </>
          ) : (
            viewMode !== "create" && (
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={handleToggleEdit}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add New Delivery Note
                </Button>
                {canReturn && dnRecords.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-red-600 border-red-200 hover:bg-red-50 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-950/30"
                    onClick={handleToggleReturn}
                  >
                    <RotateCcw className="h-4 w-4 mr-1" />
                    Return Items
                  </Button>
                )}
              </div>
            )
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

      {/* Scrollable table for all screen sizes */}
      <div className="relative overflow-x-auto">
        <Table>
          <PivotTableHeader
            pivotData={pivotData}
            showEdit={showEdit && effectiveCanEdit}
            onDownloadDN={downloadDN}
            isProjectManager={isProjectManager}
            editingDnName={editHook.editingDnName}
            canEditDn={editHook.canEditDn}
            onEditDn={handleStartEdit}
            viewMode={viewMode}
            showReturn={showReturn && !editHook.editingDnName}
          />
          <PivotTableBody
            pivotData={pivotData}
            showEdit={showEdit && effectiveCanEdit}
            submitHook={submitHook}
            isProjectManager={isProjectManager}
            editingDnName={editHook.editingDnName}
            editedQuantities={editHook.editedQuantities}
            onEditQuantityChange={editHook.handleEditQuantityChange}
            viewMode={viewMode}
            showReturn={showReturn && !editHook.editingDnName}
            returnHook={returnHook}
          />
        </Table>
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

      {/* Return confirmation dialog */}
      <AlertDialog open={returnConfirmDialog} onOpenChange={setReturnConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Return</AlertDialogTitle>
            <AlertDialogDescription>
              {Object.values(returnHook.returnQuantities).filter(v => parseFloat(v) > 0).length} item(s) will be returned to vendor.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex gap-4 items-center w-full mt-2">
            <Label className="w-[40%]">
              Return Date: <sup className="text-sm text-red-600">*</sup>
            </Label>
            <Input
              type="date"
              value={returnHook.returnDate}
              onChange={(e) => returnHook.setReturnDate(e.target.value)}
              max={new Date().toISOString().split("T")[0]}
              onKeyDown={(e) => e.preventDefault()}
            />
          </div>
          <AlertDialogFooter>
            {returnHook.isSubmitting ? (
              <TailSpin color="red" width={40} height={40} />
            ) : (
              <>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <Button
                  variant="destructive"
                  onClick={handleConfirmReturn}
                  disabled={!returnHook.returnDate}
                >
                  Confirm Return
                </Button>
              </>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
