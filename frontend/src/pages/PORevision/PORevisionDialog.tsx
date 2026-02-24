import React from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import { usePORevision } from "./hooks/usePORevision";
import { Step1ReviseItems } from "./components/Step1/Step1ReviseItems";
import { Step2PositiveFlow } from "./components/Step2/Step2PositiveFlow";
import { Step2NegativeFlow } from "./components/Step2/Step2NegativeFlow";
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
    paymentTerms,
    setPaymentTerms,
    refundAdjustments,
    setRefundAdjustments,
    adjustmentMethod,
    setAdjustmentMethod,
    beforeSummary,
    afterSummary,
    difference,
    netImpact,
    totalAdjustmentAllocated,
    invoices,
    adjCandidatePOs,
    handleAddItem,
    handleUpdateItem,
    handleRemoveItem,
    handleSave,
    itemOptions,
  } = usePORevision(props);

  const handleNext = () => {
    if (step === 1) {
        if (!justification.trim()) {
            toast({ title: "Justification Required", description: "Please provide a reason for this revision.", variant: "destructive" });
            return;
        }
        setStep(2);
    } else if (step === 2) {
        if (difference.inclGst > 0) {
            const totalAllocated = paymentTerms.reduce((s,t) => s+t.amount, 0);
            if (Math.abs(totalAllocated - Math.abs(difference.inclGst)) > 1) {
                toast({ title: "Allocation Mismatch", description: "Please allocate the full difference amount to payment terms.", variant: "destructive" });
                return;
            }
        } else if (difference.inclGst < 0 && adjustmentMethod === "Another PO") {
             if (Math.abs(Math.abs(difference.inclGst) - totalAdjustmentAllocated) > 1) {
                toast({ title: "Allocation Mismatch", description: "Please allocate the full refund amount to target POs.", variant: "destructive" });
                return;
             }
        }
        setStep(3);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-7xl max-h-[95vh] overflow-y-auto p-6">
        <RevisionHeader 
          step={step} 
          setStep={setStep} 
          differenceAmount={difference.inclGst} 
          poName={po.name} 
        />

        <div className="space-y-8">
            {step === 1 && (
                <Step1ReviseItems 
                    revisionItems={revisionItems}
                    invoices={invoices}
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
                />
            )}

            {step === 2 && (
                difference.inclGst > 0 ? (
                    <Step2PositiveFlow 
                        paymentTerms={paymentTerms}
                        setPaymentTerms={setPaymentTerms}
                        difference={difference}
                        poName={po.name}
                    />
                ) : (
                    <Step2NegativeFlow 
                        adjustmentMethod={adjustmentMethod}
                        setAdjustmentMethod={setAdjustmentMethod}
                        refundAdjustments={refundAdjustments}
                        setRefundAdjustments={setRefundAdjustments}
                        difference={difference}
                        totalAdjustmentAllocated={totalAdjustmentAllocated}
                        adjCandidatePOs={adjCandidatePOs}
                        poName={po.name}
                    />
                )
            )}

            {step === 3 && (
                <Step3Summary 
                    revisionItems={revisionItems}
                    justification={justification}
                    difference={difference}
                    paymentTerms={paymentTerms}
                    refundAdjustments={refundAdjustments}
                    adjustmentMethod={adjustmentMethod}
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
          differenceAmount={difference.inclGst}
        />
      </DialogContent>
    </Dialog>
  );
};
