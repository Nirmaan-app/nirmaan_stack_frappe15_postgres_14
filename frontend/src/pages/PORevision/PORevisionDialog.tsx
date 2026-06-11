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
    chargeOptions,
  } = usePORevision(props);

  const handleNext = () => {
    if (step === 1) {
      // Validate: at least one item must have changed
      const hasChanges = revisionItems.some(item => item.item_type !== "Original");
      if (!hasChanges) {
        toast({ title: "No Changes Made", description: "Modify at least one item before submitting a revision.", variant: "destructive" });
        return;
      }

      // Aggregate every Step-1 problem into ONE toast — justification first,
      // then rates, then quantities — so the user sees all issues at once
      // instead of clearing them one toast at a time.
      const issues: { key: string; node: React.ReactNode }[] = [];

      if (!justification.trim()) {
        issues.push({ key: "justification", node: "Provide a revision justification." });
      }

      revisionItems
        .filter(item => item.item_type !== "Deleted" && (item.quote === undefined || item.quote <= 0))
        .forEach((item, i) => {
          issues.push({
            key: `rate-${item.name || i}`,
            node: <><span className="font-medium">{item.item_name || "Unknown"}</span> — rate must be greater than 0</>,
          });
        });

      revisionItems
        .filter(item => {
          if (item.item_type === "Deleted") return false;
          const minQty = (item.item_type !== "New" && item.received_quantity) ? item.received_quantity : 0;
          return (item.quantity === undefined || item.quantity <= 0 || item.quantity < minQty);
        })
        .forEach((item, i) => {
          const minQty = (item.item_type !== "New" && item.received_quantity) ? item.received_quantity : 0;
          const reason = minQty > 0
            ? `quantity cannot go below ${minQty} (already delivered)`
            : "quantity must be greater than 0";
          issues.push({
            key: `qty-${item.name || i}`,
            node: <><span className="font-medium">{item.item_name || "Unknown"}</span> — {reason}</>,
          });
        });

      if (issues.length > 0) {
        toast({
          title: issues.length > 1
            ? `Please fix ${issues.length} issues to continue`
            : "Please fix 1 issue to continue",
          description: (
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {issues.map(issue => (
                <li key={issue.key}>{issue.node}</li>
              ))}
            </ul>
          ),
          variant: "destructive",
        });
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
              chargeOptions={chargeOptions}
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
