import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import SITEURL from "@/constants/siteURL";
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
import { Projects } from "@/types/NirmaanStack/Projects";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";
import { parseNumber } from "@/utils/parseNumber";
import { useMemo } from "react";

interface PaymentsDataDialogProps {
  open: boolean;
  projects?: Projects[];
  vendors?: Vendors[];
  onOpenChange: (open: boolean) => void;
  isPO?: boolean,
  payments?: ProjectPayments[],
  data: any
}

export const PaymentsDataDialog = ({
  open,
  onOpenChange,
  data,
  projects,
  vendors,
  payments,
  isPO
}: PaymentsDataDialogProps) => {

  const dataAttributes = useMemo(() => {
          let project = ""
          let vendor = ""
          let gst = ""
          if (isPO) {
              project = data?.project_name
              vendor = data?.vendor_name
              gst = "true"
          } else {
              project = projects?.find(i => i?.name === data?.project)?.project_name || ""
              vendor = vendors?.find(i => i?.name === data?.vendor)?.vendor_name || ""
              gst = data?.gst
          }
          return { project, vendor, document_name: data?.name, gst }
  }, [projects, vendors, data])

  const paymentsData = useMemo(() => payments?.filter((i) => i?.document_name === data?.name && i?.status === "Paid") || [], [data, payments])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="text-start">
        <DialogHeader className="text-start py-6">
          <DialogTitle />
          <div className="flex flex-wrap gap-4 mb-6">
            {dataAttributes?.project && (
              <div className="flex items-center gap-2">
                <Label className="text-red-700 min-w-[80px]">Project:</Label>
                <span className="text-sm font-medium">{dataAttributes?.project}</span>
              </div>
            )}
            {dataAttributes?.document_name && (
              <div className="flex items-center gap-2">
                <Label className="text-red-700 min-w-[100px]">{isPO ? "PO" : "SR"} Number:</Label>
                <span className="text-sm font-medium">{dataAttributes?.document_name}</span>
              </div>
            )}
            {dataAttributes?.vendor && (
              <div className="flex items-center gap-2">
                <Label className="text-red-700 min-w-[80px]">Vendor:</Label>
                <span className="text-sm font-medium">{dataAttributes?.vendor}</span>
              </div>
            )}
          </div>

          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader className="bg-gray-100">
                <TableRow>
                  <TableHead>Payment Date</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead className="text-right">TDS Amt</TableHead>
                  <TableHead>UTR No.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(paymentsData || []).length > 0 ? (
                  paymentsData?.map((payment) => (
                    <TableRow key={payment?.name}>
                      <TableCell className="font-medium">
                        {formatDate(payment.payment_date || payment.creation)}
                      </TableCell>
                      <TableCell>{formatToIndianRupee(payment?.amount - parseNumber(payment?.tds))}</TableCell>
                      <TableCell className="text-center">
                        {formatToIndianRupee(parseNumber(payment?.tds) || "N/A")}
                      </TableCell>
                      {payment?.payment_attachment ? (
                          <TableCell className="font-semibold text-blue-500 underline">
                              <a href={`${SITEURL}${payment?.payment_attachment}`} target="_blank" rel="noreferrer">
                                  {payment?.utr}
                              </a>
                      </TableCell>
                      ) : (
                          <TableCell className="font-semibold">{payment?.utr || "--"}</TableCell>
                      )}
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center h-24">
                      No valid Payments data available
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