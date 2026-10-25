import React, { useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { API_APPROVE_VENDOR_INVOICE } from "@/pages/tasks/invoices/constants";
import { VendorInvoice } from "@/types/NirmaanStack/VendorInvoice";

interface RejectApprovedInvoiceDialogProps {
  /** The Approved Work Order invoice being rejected, or null when the dialog is closed. */
  invoice: VendorInvoice | null;
  onClose: () => void;
  /** Called after the server rejected it, so the card refetches its invoices and totals. */
  onRejected: () => void;
}

/**
 * Reject an Approved Work Order invoice, with a reason (spec #1528 story 11): the correction path for
 * anyone who may not edit an Approved invoice, who then uploads it again. The server decides who may
 * (`approve_vendor_invoice`, the invoice-approval roles).
 */
export const RejectApprovedInvoiceDialog: React.FC<RejectApprovedInvoiceDialogProps> = ({
  invoice,
  onClose,
  onRejected,
}) => {
  const [reason, setReason] = useState("");
  const { toast } = useToast();
  const { call, loading } = useFrappePostCall(API_APPROVE_VENDOR_INVOICE);

  const close = () => {
    setReason("");
    onClose();
  };

  const reject = async () => {
    if (!invoice) return;
    try {
      const response = await call({ invoice_id: invoice.name, action: "Rejected", rejection_reason: reason.trim() });
      if (response.message?.status !== 200) {
        throw new Error(response.message?.message || "The invoice could not be rejected.");
      }
      toast({ title: "Invoice rejected", description: `${invoice.invoice_no} is rejected. Upload the corrected one.`, variant: "success" });
      onRejected();
      close();
    } catch (error) {
      toast({
        title: "Could not reject the invoice",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={!!invoice} onOpenChange={(open) => !open && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject approved invoice {invoice?.invoice_no}?</DialogTitle>
          <DialogDescription>
            It stops counting as invoiced on this Work Order. Upload the corrected invoice afterwards.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          placeholder="Why is it rejected?"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={loading}>Cancel</Button>
          <Button variant="destructive" onClick={reject} disabled={loading || !reason.trim()}>
            {loading ? "Rejecting…" : "Reject"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
