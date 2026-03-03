// src/components/dialogs/RequestPaymentDialog.tsx

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { TailSpin } from "react-loader-spinner";
import { Send } from "lucide-react";
import { PoPaymentTermRow } from "@/types/NirmaanStack/POPaymentTerms"; // Use the row type
import formatToIndianRupee from "@/utils/FormatPrice";
import { usePOLockCheck } from "@/pages/PORevision/data/usePORevisionQueries";

interface RequestPaymentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  term: PoPaymentTermRow | null;
  onConfirm: () => void;
  isLoading: boolean;
}

export const RequestPaymentDialog = ({
  isOpen,
  onClose,
  term,
  onConfirm,
  isLoading,
}: RequestPaymentDialogProps) => {
  const { data: lockData } = usePOLockCheck(term?.name);
  const isLocked = lockData?.is_locked || false;

  if (!isOpen || !term) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg bg-white p-6 rounded-lg shadow-xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-gray-800 text-center">
            Request Payment
          </DialogTitle>
        </DialogHeader>
        <div className="my-6">
          <div className="grid grid-cols-12 gap-x-4 px-3 py-2 bg-gray-50/50 text-xs font-semibold text-gray-500 uppercase">
            <div className="col-span-7">Term</div>
            <div className="col-span-2 text-right">Percentage</div>
            
            <div className="col-span-3 text-right">Amount</div>
          </div>
          <div className="grid grid-cols-12 gap-x-4 items-center px-3 py-4 border-b">
            <div className="col-span-7 flex items-center text-sm font-medium text-gray-800">
              • {term.label}
            </div>
            <div className="col-span-2 text-right text-sm text-gray-600">
              {Number(term.percentage).toFixed(2)}%
            </div>
             
            <div className="col-span-3 text-right text-sm font-semibold text-gray-800">
              {formatToIndianRupee(Number(term.amount))}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-4">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="bg-red-600 hover:bg-red-700 w-32"
            onClick={onConfirm}
            disabled={isLoading || isLocked}
          >
            {isLoading ? (
              <TailSpin color="white" height={20} width={20} />
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" /> Request
              </>
            )}
          </Button>
          {isLocked && (
            <p className="text-xs text-red-500 mt-1">PO is in Revision, cannot request payment.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};