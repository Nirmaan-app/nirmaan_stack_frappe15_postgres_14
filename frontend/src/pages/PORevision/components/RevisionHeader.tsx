import React from "react";
import { DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft } from "lucide-react";

interface RevisionHeaderProps {
  step: number;
  setStep: (step: number) => void;
  poName: string;
  vendorName?: string;
  projectName?: string;
}

export const RevisionHeader: React.FC<RevisionHeaderProps> = ({
  step,
  setStep,
  poName,
  vendorName,
  projectName,
}) => {
  return (
    <DialogHeader className="mb-1">
      <div className="flex items-center justify-between border-b border-gray-200 pb-3">
        <div className="flex items-center gap-3">
          {step > 1 && (
            <button
              onClick={() => setStep(step - 1)}
              className="flex items-center gap-1 text-xs text-primary hover:underline font-medium border-r pr-3 border-gray-200"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </button>
          )}
          <div className="flex flex-col gap-1">
            <DialogTitle className="text-base font-semibold text-gray-900 leading-none">
              {step === 1 ? "Revise Purchase Order" : "Review & Confirm"}
            </DialogTitle>
            <div className="flex items-center gap-2 text-[11px] text-gray-500">
              <span className="bg-primary/10 text-primary px-1.5 py-0.5 rounded font-semibold text-[10px]">
                {poName}
              </span>
              {projectName && (
                <>
                  <span className="text-gray-300">|</span>
                  <span className="truncate max-w-[200px]">{projectName}</span>
                </>
              )}
              {vendorName && (
                <>
                  <span className="text-gray-300">|</span>
                  <span className="truncate max-w-[200px]">{vendorName}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-1.5">
          <div className={`h-1.5 w-8 rounded-full ${step >= 1 ? "bg-primary" : "bg-gray-200"}`} />
          <div className={`h-1.5 w-8 rounded-full ${step >= 2 ? "bg-primary" : "bg-gray-200"}`} />
        </div>
      </div>
    </DialogHeader>
  );
};
