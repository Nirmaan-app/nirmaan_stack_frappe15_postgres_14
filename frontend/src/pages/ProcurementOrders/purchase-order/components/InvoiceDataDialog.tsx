import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import SITEURL from "@/constants/siteURL";
import { VendorInvoice } from "@/types/NirmaanStack/VendorInvoice";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { formatDate } from "@/utils/FormatDate";

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
                        {inv.invoice_attachment ? (
                          <a
                            href={`${SITEURL}${inv.invoice_attachment}`}
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
