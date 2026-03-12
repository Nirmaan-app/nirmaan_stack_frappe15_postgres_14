import React from "react";
import { DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft } from "lucide-react";

interface RevisionHeaderProps {
  step: number;
  setStep: (step: number) => void;
  differenceAmount: number;
  poName: string;
  vendorName?: string;
  projectName?: string;
}

export const RevisionHeader: React.FC<RevisionHeaderProps> = ({
  step,
  setStep,
  differenceAmount,
  poName,
  vendorName,
  projectName,
}) => {
  const getTitle = () => {
    if (step === 1) return "Revise Purchase Order";
    if (step === 2) return differenceAmount < 0 ? "PO Refund Adjustment" : "PO Payment Rectification";
    return "Revision Summary & Confirmation";
  };

  return (
    <DialogHeader className="mb-2">
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
          <div className="flex flex-col gap-1.5">
            <DialogTitle className="text-lg font-bold text-gray-900 leading-none">
              {getTitle()}
            </DialogTitle>
            <div className="flex items-center gap-x-3 text-[11px] font-medium text-gray-500 whitespace-nowrap overflow-hidden">
                <span className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded-md font-bold text-[10px]">#{poName}</span>
                {projectName && (
                  <div className="flex items-center gap-1">
                    <span className="text-gray-400 font-bold uppercase tracking-tight text-[9px]">Project:</span>
                    <span className="text-gray-700 truncate max-w-[200px]">{projectName}</span>
                  </div>
                )}
                {vendorName && (
                  <div className="flex items-center gap-1 border-l pl-3 border-gray-100">
                    <span className="text-gray-400 font-bold uppercase tracking-tight text-[9px]">Vendor:</span>
                    <span className="text-gray-700 truncate max-w-[200px]">{vendorName}</span>
                  </div>
                )}
            </div>
          </div>
        </div>
        
        <div className="flex flex-col items-end gap-2 text-right">
          {/* Progress indicators can be placed here if needed */}
        </div>
      </div>
    </DialogHeader>
  );
};
