// src/components/invoice/InvoiceDataDialog.tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import SITEURL from "@/constants/siteURL";
import { NirmaanAttachment } from "@/types/NirmaanStack/NirmaanAttachment";
import { InvoiceDataType, InvoiceItem } from "@/types/NirmaanStack/ProcurementOrders";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";
import { useFrappeGetDocList } from "frappe-react-sdk";
import memoize from "lodash/memoize";
import { useMemo } from "react";

interface InvoiceDataDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceData: InvoiceDataType | string;
  project?: string;
  poNumber?: string;
  vendor?: string;
}

const getInvoiceDetails = (data: InvoiceDataType | string) => {
  try {
    const parsedData = typeof data === 'string' ? JSON.parse(data)?.data : data?.data;
    const items = Object.entries(parsedData || {}) as [string, InvoiceItem][];
    
    return {
      isValid: true,
      items: items.map(([date, item]) => ({
        date,
        invoiceNo: item.invoice_no,
        amount: item.amount,
        attachment: item.invoice_attachment_id
      }))
    };
  } catch (error) {
    console.error('Error parsing invoice data:', error);
    return { isValid: false, items: [] };
  }
};

export const InvoiceDataDialog = ({
  open,
  onOpenChange,
  invoiceData,
  project,
  poNumber,
  vendor
}: InvoiceDataDialogProps) => {
  const { isValid, items } = useMemo(() => getInvoiceDetails(invoiceData), [invoiceData]);

  const {data: attachmentsData, isLoading: attachmentsDataLoading } = useFrappeGetDocList<NirmaanAttachment>("Nirmaan Attachments", {
    fields: ["name", "attachment"],
    filters: [["associated_docname", "=", poNumber]],
  }, poNumber ? `Nirmaan Attachments ${poNumber}` : null)

  const getAttachmentUrl = useMemo(() => memoize((id: string) => {
    const attachment = attachmentsData?.find(i => i?.name === id);
    return attachment?.attachment;
  }, (id: string) => id), [attachmentsData]);

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
                {isValid && items.length > 0 ? (
                  items.map((item) => (
                    <TableRow key={`${item.date}-${item.invoiceNo}`}>
                      <TableCell className="font-medium">
                        {formatDate(item.date)}
                      </TableCell>
                      <TableCell>{item.invoiceNo}</TableCell>
                      <TableCell className="text-right">
                        {formatToIndianRupee(Number(item.amount))}
                      </TableCell>
                      <TableCell>
                        {item.attachment ? (
                          <a
                            href={`${SITEURL}${getAttachmentUrl(item.attachment)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline"
                          >
                            View Attachment
                          </a>
                        ) : (
                          'N/A'
                        )}
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