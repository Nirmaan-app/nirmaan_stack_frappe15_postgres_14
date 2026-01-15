
import React, { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface RejectTDSModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (remarks: string) => void;
  loading?: boolean;
}

export const RejectTDSModal: React.FC<RejectTDSModalProps> = ({
  open,
  onOpenChange,
  onConfirm,
  loading = false,
}) => {
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState("");

  const handleConfirm = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!remarks.trim()) {
      setError("Remarks are mandatory for rejection.");
      return;
    }
    setError("");
    onConfirm(remarks);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reject TDS Request</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to reject this request? This action cannot be undone.
            Please provide a reason for rejection.
          </AlertDialogDescription>
        </AlertDialogHeader>
        
        <div className="grid w-full gap-1.5 py-4">
          <Label htmlFor="remarks" className="text-red-500 font-medium">
            Rejection Remarks *
          </Label>
          <Textarea 
            id="remarks" 
            placeholder="Enter reason for rejection..." 
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            className={error ? "border-red-500" : ""}
          />
          {error && <span className="text-sm text-red-500">{error}</span>}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
          <AlertDialogAction 
            onClick={handleConfirm} 
            disabled={loading}
            className="bg-red-600 hover:bg-red-700"
          >
            {loading ? "Rejecting..." : "Confirm Reject"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
