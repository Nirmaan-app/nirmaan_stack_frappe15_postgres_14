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
import { useDuplicateChequeOf } from "@/components/cheques/useExistingCheque";
import { RequestPayToAccount } from "@/components/payees/RequestPayToAccount";
import { useVendorPayeeGate } from "@/components/payees/vendorPayeeAccount";
import { PaymentModeFields } from "@/pages/ProjectPayments/components/PaymentModeFields";
import {
  isPaymentModeComplete,
  paymentModeArgs,
  PaymentModeArgs,
} from "@/pages/ProjectPayments/paymentMode";
import { useEarlyCreditCheque } from "@/pages/ProjectPayments/hooks/useEarlyCreditCheque";

interface RequestPaymentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  term: PoPaymentTermRow | null;
  onConfirm: (mode: PaymentModeArgs) => void;
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
  // A Credit term not yet due is paid by a cheque dated on or after its due date (Pay by Cheque).
  const { payMode, setPayMode, dateProblem, title, chequeFieldProps } = useEarlyCreditCheque(term, isOpen);
  const duplicateOf = useDuplicateChequeOf(payMode);
  // A PO payment is paid into the vendor's Payee: no Payee (or none known yet), no request.
  const { payeeBlocked, showPayeeBlockedToast } = useVendorPayeeGate(
    isOpen ? term?.vendor : undefined,
    term?.vendor_name,
  );

  if (!isOpen || !term) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      {/* Capped and scrolling, as the PO page's Request Payment: the cheque fields make it taller than the screen. */}
      <DialogContent className="w-[95vw] sm:max-w-lg max-h-[90vh] overflow-y-auto bg-white p-4 sm:p-6 rounded-lg shadow-xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-gray-800 text-center">
            {title}
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
        <RequestPayToAccount vendor={term.vendor} vendorLabel={term.vendor_name} className="mb-4" />
        <PaymentModeFields
          value={payMode}
          onChange={setPayMode}
          amount={Number(term.amount)}
          vendor={term.vendor}
          {...chequeFieldProps}
        />
        <div className="flex justify-end gap-3 mt-4">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="bg-red-600 hover:bg-red-700 w-32"
            onClick={() => {
              if (payeeBlocked) {
                showPayeeBlockedToast();
                return;
              }
              onConfirm(paymentModeArgs(payMode));
            }}
            disabled={isLoading || isLocked || !!dateProblem || !isPaymentModeComplete(payMode, duplicateOf)}
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