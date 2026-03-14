import React from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import { usePORevision } from "./hooks/usePORevision";
import { Step1ReviseItems } from "./components/Step1/Step1ReviseItems";
import { Step3Summary } from "./components/Step3/Step3Summary";
import { RevisionHeader } from "./components/RevisionHeader";
import { RevisionFooter } from "./components/RevisionFooter";
import { toast } from "@/components/ui/use-toast";

interface PORevisionDialogProps {
  open: boolean;
  onClose: () => void;
  po: ProcurementOrder;
  onSuccess?: (revisionName: string) => void;
}

export const PORevisionDialog: React.FC<PORevisionDialogProps> = (props) => {
  const { po, open, onClose } = props;

  const {
    revisionItems,
    justification,
    setJustification,
    loading,
    step,
    setStep,
    beforeSummary,
    afterSummary,
    difference,
    netImpact,
    handleAddItem,
    handleUpdateItem,
    handleRemoveItem,
    handleSave,
    itemOptions,
  } = usePORevision(props);

  const handleNext = () => {
    if (step === 1) {
      // Validate: at least one item must have changed
      const hasChanges = revisionItems.some(item => item.item_type !== "Original");
      if (!hasChanges) {
        toast({ title: "No Changes Made", description: "Modify at least one item before submitting a revision.", variant: "destructive" });
        return;
      }

      if (!justification.trim()) {
        toast({ title: "Justification Required", description: "Please provide a reason for this revision.", variant: "destructive" });
        return;
      }

      const invalidRateItem = revisionItems.find(item => item.item_type !== "Deleted" && (item.quote === undefined || item.quote <= 0));
      if (invalidRateItem) {
        toast({ title: "Invalid Rate", description: `Rate must be greater than 0 for item: ${invalidRateItem.item_name || "Unknown"}`, variant: "destructive" });
        return;
      }

      const invalidQtyItem = revisionItems.find(item => {
        if (item.item_type === "Deleted") return false;
        const minQty = (item.item_type !== "New" && item.received_quantity) ? item.received_quantity : 0;
        return (item.quantity === undefined || item.quantity <= 0 || item.quantity < minQty);
      });

      if (invalidQtyItem) {
        const minQty = (invalidQtyItem.item_type !== "New" && invalidQtyItem.received_quantity) ? invalidQtyItem.received_quantity : 0;
        if (minQty > 0) {
          toast({ title: "Invalid Quantity", description: `Quantity cannot go below ${minQty} (already delivered) for item: ${invalidQtyItem.item_name || "Unknown"}`, variant: "destructive" });
        } else {
          toast({ title: "Invalid Quantity", description: `Quantity must be greater than 0 for item: ${invalidQtyItem.item_name || "Unknown"}`, variant: "destructive" });
        }
        return;
      }

      setStep(2);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-7xl max-h-[95vh] overflow-y-auto p-6">
        <RevisionHeader
          step={step}
          setStep={setStep}
          poName={po.name}
          vendorName={po.vendor_name}
          projectName={po.project_name}
        />

        <div className="space-y-4">
          {step === 1 && (
            <Step1ReviseItems
              revisionItems={revisionItems}
              justification={justification}
              setJustification={setJustification}
              handleAddItem={handleAddItem}
              handleUpdateItem={handleUpdateItem}
              handleRemoveItem={handleRemoveItem}
              beforeSummary={beforeSummary}
              afterSummary={afterSummary}
              difference={difference}
              netImpact={netImpact}
              itemOptions={itemOptions}
              isCustom={!!po.custom}
              poTotalAmount={po.total_amount || 0}
              poAmountPaid={po.amount_paid || 0}
              poAmountDelivered={po.po_amount_delivered || 0}
            />
          )}

          {step === 2 && (
            <Step3Summary
              revisionItems={revisionItems}
              justification={justification}
              difference={difference}
              po={po}
              beforeSummary={beforeSummary}
              afterSummary={afterSummary}
              netImpact={netImpact}
            />
          )}
        </div>

        <RevisionFooter
          step={step}
          onCancel={onClose}
          onNext={handleNext}
          onSubmit={handleSave}
          loading={loading}
        />
      </DialogContent>
    </Dialog>
  );
};
