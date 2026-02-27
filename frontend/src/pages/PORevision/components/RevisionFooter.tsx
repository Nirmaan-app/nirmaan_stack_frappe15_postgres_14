import React from "react";
import { Button } from "@/components/ui/button";
import { ArrowRight, CheckCircle2 } from "lucide-react";

interface RevisionFooterProps {
  step: number;
  onCancel: () => void;
  onNext: () => void;
  onSubmit: () => void;
  loading: boolean;
  differenceAmount: number;
}

export const RevisionFooter: React.FC<RevisionFooterProps> = ({
  step,
  onCancel,
  onNext,
  onSubmit,
  loading,
  differenceAmount,
}) => {
  return (
    <div className="border-t pt-6 mt-8 flex flex-col gap-4">
      <p className="text-center text-[11px] font-medium text-gray-400">
        By submitting, you acknowledge that this revision cannot be modified for the next 7 days.
      </p>
      <div className="flex w-full justify-end gap-3">
        <Button variant="outline" onClick={onCancel} disabled={loading} className="px-8 font-bold border-gray-200">
          Cancel
        </Button>
        {step < 3 ? (
          <Button 
            className="bg-[#D94444] hover:bg-[#C13D3D] text-white gap-2 px-8 font-bold border-none shadow-none"
            onClick={onNext}
            disabled={loading || (step === 1 && differenceAmount === 0)}
          >
            {step === 1 ? "Go to Payment Rectification" : "Continue"} <ArrowRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button 
            className="bg-green-600 hover:bg-green-700 text-white gap-2 px-8 font-bold"
            onClick={onSubmit}
            disabled={loading}
          >
            {loading ? "Processing..." : "Submit Revision Request"} <CheckCircle2 className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
};
