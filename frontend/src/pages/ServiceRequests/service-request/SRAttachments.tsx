import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import SITEURL from "@/constants/siteURL"
import { NirmaanAttachment } from "@/types/NirmaanStack/NirmaanAttachment"
import { ServiceRequests } from "@/types/NirmaanStack/ServiceRequests"
import { VendorInvoice } from "@/types/NirmaanStack/VendorInvoice"
import formatToIndianRupee from "@/utils/FormatPrice"
import { useDialogStore } from "@/zustand/useDialogStore"
import { formatDate } from "date-fns"
import { useFrappeGetDocList } from "frappe-react-sdk"
import { useCallback, useMemo } from "react"
import { TailSpin } from "react-loader-spinner"
import { useUsersList } from "@/pages/ProcurementRequests/ApproveNewPR/hooks/useUsersList"

interface SRAttachmentsProps {
  SR?: ServiceRequests
}


export const SRAttachments: React.FC<SRAttachmentsProps> = ({ SR }) => {

  const { toggleNewInvoiceDialog } = useDialogStore()

  // Fetch users list for displaying "Uploaded By" names
  const { data: usersList } = useUsersList();

  // Convert user ID to display name
  const getUserName = useCallback((id: string | undefined): string => {
    if (!id) return "--";
    if (id === "Administrator") return "Administrator";
    const user = usersList?.find(u => u.name === id);
    return user?.full_name || id;
  }, [usersList]);

  // Fetch vendor invoices for this SR
  const { data: vendorInvoices, isLoading: invoicesLoading } = useFrappeGetDocList<VendorInvoice>("Vendor Invoices", {
    fields: ["name", "invoice_no", "invoice_date", "invoice_amount", "invoice_attachment", "status", "uploaded_by"],
    filters: [["document_type", "=", "Service Requests"], ["document_name", "=", SR?.name || ""]],
    orderBy: { field: "invoice_date", order: "desc" },
    limit: 1000,
  }, SR?.name ? `VendorInvoices-SR-${SR.name}` : null)

  // Fetch invoice attachments (now associated with Vendor Invoices after migration)
  // We collect the invoice_attachment IDs and fetch them directly
  const invoiceAttachmentIds = useMemo((): string[] =>
    (vendorInvoices?.map(vi => vi.invoice_attachment).filter((id): id is string => !!id) || []),
    [vendorInvoices]
  )

  // Create a stable SWR key that changes when attachment IDs change
  const invoiceAttachmentSwrKey = invoiceAttachmentIds.length > 0
    ? `Nirmaan Attachments-Invoice-SR-${SR?.name}-${invoiceAttachmentIds.join(',')}`
    : null

  // Fetch all attachments associated with this SR's Vendor Invoices
  const { data: invoiceAttachmentsData, isLoading: attachmentsLoading } = useFrappeGetDocList<NirmaanAttachment>("Nirmaan Attachments", {
    fields: ["*"],
    filters: [
      ["associated_doctype", "=", "Vendor Invoices"],
      ["attachment_type", "in", ["service request invoice", "sr invoice"]],
      // Filter to only attachments for this SR's vendor invoices
      ["name", "in", invoiceAttachmentIds]
    ],
    limit: 1000,
  }, invoiceAttachmentSwrKey)

  // Create a lookup map from attachment ID to attachment URL
  const invoiceAttachmentLookup = useMemo(() => {
    const lookup = new Map<string, string>();
    invoiceAttachmentsData?.forEach((att) => {
      if (att.attachment) {
        lookup.set(att.name, att.attachment);
      }
    });
    return lookup;
  }, [invoiceAttachmentsData]);

  const handleOpenScreenshot = useCallback(
    (attachmentId: string | undefined) => {
      if (!attachmentId) {
        console.error('No attachment ID provided.');
        return;
      }
      const attachmentUrl = invoiceAttachmentLookup.get(attachmentId);
      if (attachmentUrl) {
        window.open(`${SITEURL}${attachmentUrl}`, '_blank');
      } else {
        console.error('Invoice attachment not found for ID:', attachmentId);
      }
    },
    [invoiceAttachmentLookup]
  );

  // Get status badge variant
  const getStatusBadgeVariant = (status?: VendorInvoice['status']): 'default' | 'secondary' | 'destructive' | 'outline' | 'red' | 'green' => {
    switch (status) {
      case 'Pending': return 'red';
      case 'Approved': return 'green';
      case 'Rejected': return 'destructive';
      default: return 'secondary';
    }
  };

  if (attachmentsLoading || invoicesLoading) {
    return (
      <TailSpin color="red" width={40} height={40} />
    )
  }

  return (
    <div className="grid md:grid-cols-6">
      <Card className="rounded-sm shadow-md md:col-span-3 overflow-x-auto">
        <CardHeader>
          <CardTitle className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <p className="text-xl max-sm:text-lg text-red-600">Invoice</p>
              <Badge variant="secondary" className="text-sm">
                {vendorInvoices?.length || 0}
              </Badge>
            </div>
            <Button
              variant="outline"
              className="text-primary border-primary text-xs px-2"
              onClick={toggleNewInvoiceDialog}
            >
              Add Invoice
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader className="bg-red-100">
              <TableRow>
                <TableHead className="text-black font-bold">Date</TableHead>
                <TableHead className="text-black font-bold">Amount</TableHead>
                <TableHead className="text-black font-bold">Invoice No.</TableHead>
                <TableHead className="text-black font-bold">Status</TableHead>
                <TableHead className="text-black font-bold">Uploaded By</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vendorInvoices && vendorInvoices.length > 0 ? vendorInvoices.map((invoice) => (
                <TableRow key={invoice.name}>
                  <TableCell>{formatDate(new Date(invoice.invoice_date), "dd-MMM-yyyy")}</TableCell>
                  <TableCell>{formatToIndianRupee(invoice.invoice_amount)}</TableCell>
                  <TableCell>
                    {invoice.invoice_attachment ? (
                      <Button
                        variant="link"
                        className="p-0 h-auto font-semibold text-blue-500 hover:underline"
                        onClick={() => handleOpenScreenshot(invoice.invoice_attachment)}
                      >
                        {invoice.invoice_no || 'View'}
                      </Button>
                    ) : (
                      <span className="text-gray-600">{invoice.invoice_no || '--'}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={getStatusBadgeVariant(invoice.status)}>
                      {invoice.status || 'Approved'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-gray-600 text-sm">
                    {getUserName(invoice.uploaded_by)}
                  </TableCell>
                </TableRow>
              )) : (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-4">
                    No Invoices Found
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

export default SRAttachments
