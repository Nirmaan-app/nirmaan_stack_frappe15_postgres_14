import React from "react";
import { DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft } from "lucide-react";

interface RevisionHeaderProps {
  step: number;
  setStep: (step: number) => void;
  differenceAmount: number;
  poName: string;
}

export const RevisionHeader: React.FC<RevisionHeaderProps> = ({
  step,
  setStep,
  differenceAmount,
  poName,
}) => {
  const getTitle = () => {
    if (step === 1) return "Revise Purchase Order";
    if (step === 2) return differenceAmount < 0 ? "PO Refund Adjustment" : "PO Payment Rectification";
    return "Revision Summary & Confirmation";
  };

  return (
    <DialogHeader className="mb-6">
      <div className="flex items-center justify-between border-b border-gray-100 pb-4">
        <div className="flex items-center gap-4">
          {step > 1 && (
            <button 
              onClick={() => setStep(step - 1)} 
              className="flex items-center gap-1 text-[13px] text-[#2563EB] hover:underline font-medium border-r pr-4 border-gray-200"
            >
              <ArrowLeft className="h-4 w-4" /> Go to Revise Po
            </button>
          )}
          <DialogTitle className="text-lg font-bold text-gray-700">
            {getTitle()}
          </DialogTitle>
        </div>
        
        <div className="flex flex-col items-end gap-2">
          {/* Progress indicators or close button handled by DialogContent */}
        </div>
      </div>
    </DialogHeader>
  );
};
