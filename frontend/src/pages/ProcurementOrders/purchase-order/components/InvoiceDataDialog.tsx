import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import SITEURL from "@/constants/siteURL";
import { NirmaanAttachment } from "@/types/NirmaanStack/NirmaanAttachment";
import { VendorInvoice } from "@/types/NirmaanStack/VendorInvoice";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { formatDate } from "@/utils/FormatDate";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { useMemo } from "react";

interface InvoiceDataDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project?: string;
  poNumber?: string;
  vendor?: string;
}

export const InvoiceDataDialog = ({
  open,
  onOpenChange,
  project,
  poNumber,
  vendor
}: InvoiceDataDialogProps) => {
  // Self-fetch this doc's Approved invoices only when the dialog is open (swrKey null
  // disables until then). Filter by `document_name` (= poNumber) + status only — NOT
  // `document_type`: document_name is globally unique, so this preserves the PO-and-SR
  // behavior of the shared callers. Replaces the whole-table `vendorInvoices` prop
  // (ADR-0010 #4 WS-B).
  const { data: fetchedInvoices } = useFrappeGetDocList<VendorInvoice>(
    "Vendor Invoices",
    {
      fields: ["name", "document_name", "invoice_amount", "invoice_no", "invoice_date", "invoice_attachment", "status"],
      filters: [["document_name", "=", poNumber ?? ""], ["status", "=", "Approved"]],
      limit: 0,
    },
    open && poNumber ? `InvoiceDialog-${poNumber}` : null
  );
  const approvedInvoices = fetchedInvoices ?? [];

  // `invoice_attachment` on a Vendor Invoice is a Link to a `Nirmaan Attachments`
  // doc (an ID, not a file URL). Resolve IDs → file URLs in one batch when the
  // dialog is open.
  const attachmentIds = useMemo(
    () => approvedInvoices.map(inv => inv.invoice_attachment).filter((id): id is string => !!id),
    [approvedInvoices]
  );

  const { data: attachmentDocs } = useFrappeGetDocList<NirmaanAttachment>(
    "Nirmaan Attachments",
    {
      fields: ["name", "attachment"],
      filters: [["name", "in", attachmentIds]],
      limit: attachmentIds.length || 1,
    },
    open && attachmentIds.length > 0
      ? `InvoiceDataDialog-Attachments-${attachmentIds.join(",")}`
      : null
  );

  const attachmentUrlById = useMemo(() => {
    const map = new Map<string, string>();
    attachmentDocs?.forEach(doc => {
      if (doc.attachment) map.set(doc.name, doc.attachment);
    });
    return map;
  }, [attachmentDocs]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="text-start">
        <DialogHeader className="text-start py-6">
          <DialogTitle />
          <div className="flex flex-wrap gap-4 mb-6">
            {project && (
              <div className="flex items-center gap-2">
                <Label className="text-red-700 min-w-[80px]">Project:</Label>
                <span className="text-sm font-medium">{project}</span>
              </div>
            )}
            {poNumber && (
              <div className="flex items-center gap-2">
                <Label className="text-red-700 min-w-[100px]">PO Number:</Label>
                <span className="text-sm font-medium">{poNumber}</span>
              </div>
            )}
            {vendor && (
              <div className="flex items-center gap-2">
                <Label className="text-red-700 min-w-[80px]">Vendor:</Label>
                <span className="text-sm font-medium">{vendor}</span>
              </div>
            )}
          </div>

          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader className="bg-gray-100">
                <TableRow>
                  <TableHead>Invoice Date</TableHead>
                  <TableHead>Invoice No.</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Attachment</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {approvedInvoices.length > 0 ? (
                  approvedInvoices.map((inv) => (
                    <TableRow key={inv.name}>
                      <TableCell className="font-medium">
                        {inv.invoice_date ? formatDate(inv.invoice_date) : 'N/A'}
                      </TableCell>
                      <TableCell>{inv.invoice_no || '--'}</TableCell>
                      <TableCell className="text-right">
                        {formatToRoundedIndianRupee(inv.invoice_amount)}
                      </TableCell>
                      <TableCell>
                        {(() => {
                          const fileUrl = inv.invoice_attachment
                            ? attachmentUrlById.get(inv.invoice_attachment)
                            : undefined;
                          return fileUrl ? (
                            <a
                              href={`${SITEURL}${fileUrl}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:underline"
                            >
                              View Attachment
                            </a>
                          ) : (
                            'N/A'
                          );
                        })()}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center h-24">
                      No valid invoice data available
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
};
