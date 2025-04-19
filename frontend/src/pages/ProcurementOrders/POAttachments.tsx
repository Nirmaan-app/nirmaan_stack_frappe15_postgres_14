import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import SITEURL from "@/constants/siteURL";
import { NirmaanAttachment } from "@/types/NirmaanStack/NirmaanAttachment";
import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import formatToIndianRupee, {formatToRoundedIndianRupee} from "@/utils/FormatPrice";
import { useDialogStore } from "@/zustand/useDialogStore";
import { formatDate } from "date-fns";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { useCallback, useMemo } from "react";
import { TailSpin } from "react-loader-spinner";

interface POAttachmentsProps {
  PO: ProcurementOrder | null
}

export const POAttachments: React.FC<POAttachmentsProps> = ({ PO }) => {

  const { toggleNewInvoiceDialog } = useDialogStore()

  const {data: attachmentsData, isLoading: attachmentsLoading} = useFrappeGetDocList<NirmaanAttachment>("Nirmaan Attachments", {
    fields: ["*"],
    filters: [["associated_doctype", "=", "Procurement Orders"], ["associated_docname", "=", PO?.name]],
    limit: 1000,
  }, PO ? `Nirmaan Attachments-${PO?.name}` : null)

  const dcAttachments = useMemo(() => attachmentsData?.filter((i) => i?.attachment_type === "po delivery challan") || [], [attachmentsData]);

  const invoiceAttachments = useMemo(() => attachmentsData?.filter((i) => i?.attachment_type === "po invoice") || [], [attachmentsData]);

  const handleOpenScreenshot = useCallback(
    (att: string | undefined) => {
      const invoice = invoiceAttachments?.find((i) => i?.name === att)?.attachment;
      if (invoice) {
        window.open(`${SITEURL}${invoice}`, '_blank');
      } else {
        // Handle case where attachment is not found (optional)
        console.error('Invoice attachment not found.');
      }
    },
    [invoiceAttachments]
  );

  if(attachmentsLoading) {
    return (
      <TailSpin color="red" width={40} height={40} />
    )
  }

  return (
      <div className="grid gap-4 max-[1000px]:grid-cols-1 grid-cols-6">
          <Card className="rounded-sm shadow-md md:col-span-3 overflow-x-auto">
            <CardHeader>
              <CardTitle className="flex justify-between items-center">
                <p className="text-xl max-sm:text-lg text-red-600">Invoice</p>
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
                        </TableRow>
                      </TableHeader>
                        <TableBody>
                          {PO?.invoice_data ? Object.keys(PO?.invoice_data?.data)?.map((date) => (
                            <TableRow key={date}>
                              <TableCell>{formatDate(date, "dd/MM/yyyy")}</TableCell>
                              <TableCell>{formatToRoundedIndianRupee(PO?.invoice_data?.data[date]?.amount)}</TableCell>
                                <TableCell onClick={() => handleOpenScreenshot(PO?.invoice_data?.data[date]?.invoice_attachment_id)} className="font-semibold text-blue-500 underline">
                                  {PO?.invoice_data?.data[date]?.invoice_no}
                                </TableCell>
                            </TableRow>
                          )) : (
                            <TableRow>
                              <TableCell colSpan={3} className="text-center py-4">
                                No Invoices Found
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                  </Table>
            </CardContent>
          </Card>
          {["Delivered", "Partially Delivered"].includes(PO?.status) && (
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
                          <TableHead className="text-black font-bold">Delivery Challan</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                          {dcAttachments?.length > 0 ? dcAttachments.map((att, index) => (
                            <TableRow key={att.name}>
                              <TableCell>{index + 1}</TableCell>
                              <TableCell>{formatDate(att.creation, "dd/MM/yyyy")}</TableCell>
                              <TableCell className="font-semibold text-blue-500 underline truncate max-w-[150px]">
                                <a href={`${SITEURL}${att.attachment}`} target="_blank" rel="noreferrer">
                                  {att.attachment?.split("file_name=")[1]}
                                </a>
                              </TableCell>
                            </TableRow>
                          )) : (
                            <TableRow>
                              <TableCell colSpan={3} className="text-center py-4">
                                No Invoices Found
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