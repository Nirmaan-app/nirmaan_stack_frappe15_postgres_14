import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import SITEURL from "@/constants/siteURL";
import { NirmaanAttachment } from "@/types/NirmaanStack/NirmaanAttachment";
import { VendorInvoice } from "@/types/NirmaanStack/VendorInvoice";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { formatDate } from "@/utils/FormatDate";
import { useFrappeGetDocList, useFrappeGetCall } from "frappe-react-sdk";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";

interface POItemBilling {
  po_item_id: string;
  po_item_name?: string;
  unit?: string;
  po_quantity: number;
  po_amount: number;
  invoiced_quantity: number;
  invoiced_amount: number;
  invoice_count: number;
  over_billed_amount: number;
  over_billed_quantity: number;
  is_over_billed: boolean;
}

interface InvoiceDataDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendorInvoices?: VendorInvoice[];
  project?: string;
  poNumber?: string;
  vendor?: string;
}

export const InvoiceDataDialog = ({
  open,
  onOpenChange,
  vendorInvoices,
  project,
  poNumber,
  vendor
}: InvoiceDataDialogProps) => {
  const approvedInvoices = vendorInvoices?.filter(inv => inv.status === "Approved") ?? [];

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

  // Cross-invoice item-level billing rollup (Approved + Pending invoices).
  // Surfaces "invoiced so far" per PO item and cumulative over-billing.
  const { data: billingResp } = useFrappeGetCall<{ message: { items: POItemBilling[]; summary: any } }>(
    "nirmaan_stack.api.invoices.get_po_item_billing.get_po_item_billing",
    { po: poNumber },
    open && poNumber ? `po-item-billing-${poNumber}` : null
  );
  const billing = billingResp?.message;
  // Only show the rollup once there's mapped invoice data (legacy invoices have
  // no line_mappings → an all-zero table would just be noise).
  const showBilling = !!billing && (billing.summary?.total_invoiced_amount ?? 0) > 0;

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

          {/* Item-level billing rollup across submitted invoices (Phase C). */}
          {showBilling && billing && (
            <div className="mt-6">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <Label className="text-red-700">Item-Level Billing</Label>
                <span className="text-xs text-muted-foreground">
                  invoiced so far across Approved + Pending invoices
                </span>
                {billing.summary?.over_billed > 0 && (
                  <Badge variant="red" className="inline-flex items-center gap-0.5">
                    <AlertTriangle className="h-3 w-3" /> {billing.summary.over_billed} item
                    {billing.summary.over_billed > 1 ? "s" : ""} over PO
                  </Badge>
                )}
              </div>
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader className="bg-gray-100">
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">Invoiced</TableHead>
                      <TableHead className="text-right">PO Amount</TableHead>
                      <TableHead className="text-right">Qty (inv / PO)</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {billing.items.map((it) => (
                      <TableRow key={it.po_item_id} className={it.is_over_billed ? "bg-red-50" : ""}>
                        <TableCell className="font-medium">
                          {it.po_item_name || it.po_item_id}
                          {it.unit ? <span className="text-gray-400 text-xs"> · {it.unit}</span> : null}
                        </TableCell>
                        <TableCell className={`text-right tabular-nums ${it.is_over_billed ? "text-red-700 font-semibold" : ""}`}>
                          {formatToRoundedIndianRupee(it.invoiced_amount)}
                          {it.invoice_count > 0 && (
                            <span className="text-gray-400 text-xs"> ({it.invoice_count})</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-gray-600">
                          {formatToRoundedIndianRupee(it.po_amount)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-gray-600">
                          {it.invoiced_quantity} / {it.po_quantity}
                        </TableCell>
                        <TableCell>
                          {it.is_over_billed && (
                            <Badge variant="red" className="inline-flex items-center gap-0.5">
                              <AlertTriangle className="h-3 w-3" /> over PO
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
};
