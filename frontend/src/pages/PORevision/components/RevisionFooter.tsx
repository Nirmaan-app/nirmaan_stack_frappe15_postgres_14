import React from "react";
import { Button } from "@/components/ui/button";
import { ArrowRight, CheckCircle2 } from "lucide-react";

interface RevisionFooterProps {
  step: number;
  onCancel: () => void;
  onNext: () => void;
  onSubmit: () => void;
  loading: boolean;
}

export const RevisionFooter: React.FC<RevisionFooterProps> = ({
  step,
  onCancel,
  onNext,
  onSubmit,
  loading,
}) => {
  return (
    <div className="border-t border-gray-200 pt-4 mt-4 flex items-center justify-between">
      <p className="text-[10px] text-gray-400">
        Revision locks the PO for 7 days after submission.
      </p>
      <div className="flex items-center gap-2">
        <Button variant="outline" onClick={onCancel} disabled={loading} className="px-6 text-xs font-medium border-gray-200">
          Cancel
        </Button>
        {step === 1 ? (
          <Button
            className="bg-primary hover:bg-primary/90 text-white gap-1.5 px-6 text-xs font-medium"
            onClick={onNext}
            disabled={loading}
          >
            Review Summary <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        ) : (
          <Button
            className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 px-6 text-xs font-medium"
            onClick={onSubmit}
            disabled={loading}
          >
            {loading ? "Processing..." : "Submit Revision"} <CheckCircle2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
};
