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
import SITEURL from "@/constants/siteURL"
import { NirmaanAttachment } from "@/types/NirmaanStack/NirmaanAttachment"
import { ServiceRequests } from "@/types/NirmaanStack/ServiceRequests"
import formatToIndianRupee from "@/utils/FormatPrice"
import { useDialogStore } from "@/zustand/useDialogStore"
import { formatDate } from "date-fns"
import { useFrappeGetDocList } from "frappe-react-sdk"
import { useCallback } from "react"
import { TailSpin } from "react-loader-spinner"

interface POAttachmentsProps {
  SR?: ServiceRequests
}


export const SRAttachments: React.FC<POAttachmentsProps> = ({SR}) => {

  const { toggleNewInvoiceDialog } = useDialogStore()
  
  const {data: attachmentsData, isLoading: attachmentsLoading} = useFrappeGetDocList<NirmaanAttachment>("Nirmaan Attachments", {
      fields: ["*"],
      filters: [["associated_doctype", "=", "Service Requests"], ["associated_docname", "=", SR?.name]],
      limit: 1000,
    }, SR ? `Nirmaan Attachments-${SR?.name}` : null)


  const handleOpenScreenshot = useCallback(
        (att: string | undefined) => {
          const invoice = attachmentsData?.find((i) => i?.name === att)?.attachment;
          if (invoice) {
            window.open(`${SITEURL}${invoice}`, '_blank');
          } else {
            // Handle case where attachment is not found (optional)
            console.error('Invoice attachment not found.');
          }
        },
        [attachmentsData]
      );
    
      if(attachmentsLoading) {
        return (
          <TailSpin color="red" width={40} height={40} />
        )
      }

  return (
            <div className="grid grid-cols-6">
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
                                    {SR?.invoice_data ? Object.keys(SR?.invoice_data?.data)?.map((date) => (
                                      <TableRow key={date}>
                                        <TableCell>{formatDate(date, "dd/MM/yyyy")}</TableCell>
                                        <TableCell>{formatToIndianRupee(SR?.invoice_data?.data[date]?.amount)}</TableCell>
                                          <TableCell onClick={() => handleOpenScreenshot(SR?.invoice_data?.data[date]?.invoice_attachment_id)} className="font-semibold text-blue-500 underline">
                                            {SR?.invoice_data?.data[date]?.invoice_no}
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
        </div>
  )
}

export default SRAttachments