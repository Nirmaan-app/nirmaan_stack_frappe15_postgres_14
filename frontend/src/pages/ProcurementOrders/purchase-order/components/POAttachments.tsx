import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/use-toast";
import SITEURL from "@/constants/siteURL";
import { NirmaanAttachment } from "@/types/NirmaanStack/NirmaanAttachment";
import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import { VendorInvoice } from "@/types/NirmaanStack/VendorInvoice";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { useDialogStore } from "@/zustand/useDialogStore";
import { formatDate } from "date-fns";
import { useFrappeGetDocList, useFrappePostCall } from "frappe-react-sdk";
import { Trash2 } from "lucide-react";
import { useCallback, useMemo } from "react";
import { TailSpin } from "react-loader-spinner";
import { KeyedMutator } from "swr";

interface POAttachmentsProps {
  PO: ProcurementOrder | null
  poMutate: KeyedMutator<ProcurementOrder[]>
}

export const POAttachments: React.FC<POAttachmentsProps> = ({ PO, poMutate }) => {

  const { toggleNewInvoiceDialog } = useDialogStore()

  // Fetch vendor invoices for this PO
  const { data: vendorInvoices, isLoading: invoicesLoading, mutate: mutateInvoices } = useFrappeGetDocList<VendorInvoice>("Vendor Invoices", {
    fields: ["name", "invoice_no", "invoice_date", "invoice_amount", "invoice_attachment", "status", "reconciliation_status"],
    filters: [["document_type", "=", "Procurement Orders"], ["document_name", "=", PO?.name || ""]],
    orderBy: { field: "invoice_date", order: "desc" },
    limit: 1000,
  }, PO?.name ? `VendorInvoices-PO-${PO.name}` : null)

  // Fetch delivery challan attachments (still associated with PO)
  const { data: dcAttachmentsData, isLoading: dcAttachmentsLoading, mutate: mutateDcAttachments } = useFrappeGetDocList<NirmaanAttachment>("Nirmaan Attachments", {
    fields: ["*"],
    filters: [
      ["associated_doctype", "=", "Procurement Orders"],
      ["associated_docname", "=", PO?.name || ""],
      ["attachment_type", "=", "po delivery challan"]
    ],
    limit: 1000,
  }, PO?.name ? `Nirmaan Attachments-DC-${PO.name}` : null)

  // Fetch invoice attachments (now associated with Vendor Invoices after migration)
  // We collect the invoice_attachment IDs and fetch them directly
  const invoiceAttachmentIds = useMemo((): string[] =>
    (vendorInvoices?.map(vi => vi.invoice_attachment).filter((id): id is string => !!id) || []),
    [vendorInvoices]
  )

  // Create a stable SWR key that changes when attachment IDs change
  const invoiceAttachmentSwrKey = invoiceAttachmentIds.length > 0
    ? `Nirmaan Attachments-Invoice-${PO?.name}-${invoiceAttachmentIds.join(',')}`
    : null

  // Fetch all attachments associated with this PO's Vendor Invoices
  const { data: invoiceAttachmentsData, isLoading: invoiceAttachmentsLoading, mutate: mutateInvoiceAttachments } = useFrappeGetDocList<NirmaanAttachment>("Nirmaan Attachments", {
    fields: ["*"],
    filters: [
      ["associated_doctype", "=", "Vendor Invoices"],
      ["attachment_type", "=", "po invoice"],
      // Filter to only attachments for this PO's vendor invoices
      ["name", "in", invoiceAttachmentIds]
    ],
    limit: 1000,
  }, invoiceAttachmentSwrKey)

  const dcAttachments = dcAttachmentsData || [];
  const attachmentsLoading = dcAttachmentsLoading || invoiceAttachmentsLoading;
  const mutateAttachments = async () => {
    await mutateDcAttachments();
    await mutateInvoiceAttachments();
  };

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

  const { call: deleteInvoiceEntry, loading: deleteInvoiceEntryLoading } = useFrappePostCall("nirmaan_stack.api.delivery_notes.update_invoice_data.delete_invoice_entry");

  const handleOpenScreenshot = useCallback(
    (attachmentId: string | undefined) => {
      if (!attachmentId) {
        toast({
          title: "Info",
          description: "No attachment linked to this invoice.",
          variant: "default",
        });
        return;
      }
      const attachmentUrl = invoiceAttachmentLookup.get(attachmentId);
      if (attachmentUrl) {
        window.open(`${SITEURL}${attachmentUrl}`, '_blank');
      } else {
        console.error('Invoice attachment not found for ID:', attachmentId);
        toast({
          title: "Error",
          description: "Attachment file not found.",
          variant: "destructive",
        });
      }
    },
    [invoiceAttachmentLookup]
  );

  const handleDeleteInvoiceEntry = useCallback(async (invoiceId: string) => {
    try {
      const response = await deleteInvoiceEntry({
        docname: PO?.name,
        isSR: false,
        invoice_id: invoiceId, // Use invoice_id instead of date
      });
      if (response.message.status === 200) {
        toast({
          title: "Success!",
          description: response.message.message,
          variant: "success",
        });
        await mutateInvoices(); // Refresh vendor invoices
        await mutateAttachments(); // Refresh attachments
        await poMutate(); // Refresh PO if needed
      } else if (response.message.status === 400) {
        toast({
          title: "Failed!",
          description: response.message.error,
          variant: "destructive",
        });
      }
    } catch (error) {
      console.log("Error while deleting invoice entry", error);
      toast({
        title: "Failed!",
        description: "Failed to delete invoice entry. Please try again.",
        variant: "destructive",
      });
    }
  }, [PO, deleteInvoiceEntry, mutateInvoices, mutateAttachments, poMutate]);

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
    <div className="grid gap-4 max-[1000px]:grid-cols-1 grid-cols-6">
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
                <TableHead className="text-black font-bold text-center">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vendorInvoices && vendorInvoices.length > 0 ? vendorInvoices.map((invoice) => {
                const canDelete = ["Pending", "Rejected"].includes(invoice.status);
                return (
                  <TableRow key={invoice.name}>
                    <TableCell>{formatDate(new Date(invoice.invoice_date), "dd-MMM-yyyy")}</TableCell>
                    <TableCell>{formatToRoundedIndianRupee(invoice.invoice_amount)}</TableCell>
                    <TableCell>
                      {invoice.invoice_attachment ? (
                        <Button
                          variant="link"
                          className="p-0 h-auto text-blue-600 hover:underline"
                          onClick={() => handleOpenScreenshot(invoice.invoice_attachment)}
                          title={`View Invoice ${invoice.invoice_no}`}
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
                    <TableCell className="text-center">
                      {canDelete ? (
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-red-600 hover:text-red-800"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>Are you sure?</DialogTitle>
                            </DialogHeader>
                            <div className="flex items-center justify-end gap-2">
                              {deleteInvoiceEntryLoading ? <TailSpin color="red" height={40} width={40} /> : (
                                <>
                                  <DialogClose asChild>
                                    <Button variant={"outline"} className="border-primary text-primary">Cancel</Button>
                                  </DialogClose>
                                  <Button onClick={() => handleDeleteInvoiceEntry(invoice.name)}>Delete</Button>
                                </>
                              )}
                            </div>
                          </DialogContent>
                        </Dialog>
                      ) : (
                        <span className="text-gray-400">--</span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              }) : (
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
      {PO?.status && ["Delivered", "Partially Delivered"].includes(PO.status) && (
        <Card className="rounded-sm shadow-md md:col-span-3 overflow-x-auto">
          <CardHeader>
            <CardTitle>
              <p className="text-xl max-sm:text-lg text-red-600">Delivery Challan</p>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader className="bg-red-100">
                <TableRow>
                  <TableHead className="text-black font-bold">S.NO.</TableHead>
                  <TableHead className="text-black font-bold">Date</TableHead>
                  <TableHead className="text-black font-bold">DC No.</TableHead>
                  <TableHead className="text-black font-bold">Delivery Challan</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dcAttachments?.length > 0 ? dcAttachments.map((att, index) => (
                  <TableRow key={att.name}>
                    <TableCell>{index + 1}</TableCell>
                    <TableCell>{formatDate(att.creation, "dd-MMM-yyyy")}</TableCell>
                    <TableCell>{att.attachment_ref || "-"}</TableCell>
                    <TableCell className="font-semibold text-blue-500 underline truncate max-w-[150px]">
                      <a href={`${SITEURL}${att.attachment}`} target="_blank" rel="noreferrer">
                        {att.attachment?.split("file_name=")[1]}
                      </a>
                    </TableCell>
                  </TableRow>
                )) : (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-4">
                      No Delivery Challans Found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export default POAttachments
