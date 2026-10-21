import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import SITEURL from "@/constants/siteURL";
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
import { Projects } from "@/types/NirmaanStack/Projects";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { useMemo } from "react";
import { TruncatedText } from "@/components/common/TruncatedText";
import { NoBankProofBadge } from "@/components/vendor-refunds/NoBankProofBadge";
import { useVendorRefunds } from "@/components/vendor-refunds/useVendorRefunds";
import { GstPaymentTag } from "./components/GstPaymentTag";
import { usePurchaseOrderTds } from "./hooks/usePurchaseOrderTds";
import { useWorkOrderTds } from "./hooks/useWorkOrderTds";
import { paymentsDialogRows } from "./paymentsDialogRows";

interface PaymentsDataDialogProps {
  open: boolean;
  projects?: Projects[];
  vendors?: Vendors[];
  onOpenChange: (open: boolean) => void;
  isPO?: boolean,
  data: any
}

export const PaymentsDataDialog = ({
  open,
  onOpenChange,
  data,
  projects,
  vendors,
  isPO
}: PaymentsDataDialogProps) => {

  // Self-fetch this doc's Paid payments only when the dialog is open (swrKey null
  // disables the request until then). Doctype-agnostic: `document_name` is globally
  // unique, so this filter serves both PO and SR rows. Replaces the whole-table
  // `payments` prop the callers used to pass (ADR-0010 #4 WS-B).
  const { data: fetchedPayments } = useFrappeGetDocList<ProjectPayments>(
    "Project Payments",
    {
      fields: ["name", "document_name", "status", "amount", "payment_date", "creation", "utr", "payment_attachment", "is_gst_payment"],
      filters: [["document_name", "=", data?.name], ["status", "=", "Paid"]],
      limit: 0,
    },
    open && data?.name ? `PaymentsDialog-${data.name}` : null
  );

  // The order's refunds, fetched only while open (a blank name disables the read). Its Received ones are
  // listed as minus rows, so the list adds up to the Amount Paid that was clicked (#1460, ADR-0034).
  const { refunds } = useVendorRefunds({
    documentType: isPO ? "Procurement Orders" : "Service Requests",
    documentName: open ? data?.name ?? "" : "",
  });

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

  // An order's Amount Paid holds the TDS withheld from the vendor on each payment (ADR-0034 Amendments A
  // and B: a Work Order's, and a PO's recorded tax once its payment is netted), so its rows show it. Asked
  // of the server, which checks read on the order: `Payment TDS Deduction` is readable by the accountants
  // only (#1451). A Work Order reads the Work Order page's own cache entry, so its refresh after a payment
  // change reaches this pop-up too.
  const { workOrderTds, error: woTdsError } = useWorkOrderTds(data?.name, open && !isPO);
  const { purchaseOrderTds, error: poTdsError } = usePurchaseOrderTds(data?.name, open && !!isPO);
  const deductions = isPO ? purchaseOrderTds?.payments : workOrderTds?.payments;
  const tdsError = isPO ? poTdsError : woTdsError;
  // Until it answers, the TDS column and the total wait: a total without the tax is not the Amount Paid.
  const tdsPending = !deductions;

  const { rows, total } = useMemo(
    () => paymentsDialogRows(fetchedPayments, refunds, deductions, tdsPending),
    [fetchedPayments, refunds, deductions, tdsPending]
  )

  const tdsPendingCell = tdsError
    ? <span className="text-xs text-muted-foreground">Unavailable</span>
    : <Skeleton className="h-4 w-16" />;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="text-start">
        <DialogHeader className="text-start py-6">
          <DialogTitle />
          <div className="flex flex-wrap gap-4 mb-6">
            {dataAttributes?.project && (
              <div className="flex items-center gap-2">
                <Label className="text-red-700 min-w-[80px]">Project:</Label>
                <span className="text-sm font-medium truncate max-w-xs">{dataAttributes?.project}</span>
              </div>
            )}
            {dataAttributes?.document_name && (
              <div className="flex items-center gap-2">
                <Label className="text-red-700 min-w-[100px]">{isPO ? "PO" : "SR"} Number:</Label>
                <span className="text-sm font-medium truncate max-w-xs">{dataAttributes?.document_name}</span>
              </div>
            )}
            {dataAttributes?.vendor && (
              <div className="flex items-center gap-2">
                <Label className="text-red-700 min-w-[80px]">Vendor:</Label>
                <span className="text-sm font-medium truncate max-w-xs">{dataAttributes?.vendor} </span>
              </div>
            )}
          </div>

          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader className="bg-gray-100">
                <TableRow>
                  <TableHead>Payment Date</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>TDS</TableHead>
                  <TableHead>UTR No.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length > 0 ? (
                  rows.map((row) => row.kind === "refund" ? (
                    <TableRow key={row.name} className="text-red-600">
                      <TableCell className="font-medium">
                        {formatDate(row.refund.payment_date || row.refund.creation)}
                      </TableCell>
                      <TableCell>
                        <span className="flex flex-col items-start gap-1">
                          <span>-{formatToRoundedIndianRupee(row.refund.amount)}</span>
                          <Badge variant="outline" className="border-red-500 px-1 py-0 text-[9px] leading-3 text-red-600">
                            Refund {row.name}
                          </Badge>
                          <NoBankProofBadge refund={row.refund} />
                        </span>
                      </TableCell>
                      <TableCell>--</TableCell>
                      <TableCell className="font-semibold overflow-hidden truncate max-w-28"><TruncatedText text={row.refund.utr} fallback="--" className="max-w-28" /></TableCell>
                    </TableRow>
                  ) : (
                    <TableRow key={row.name}>
                      <TableCell className="font-medium">
                        {formatDate(row.payment.payment_date || row.payment.creation)}
                      </TableCell>
                      <TableCell>
                        {formatToRoundedIndianRupee(row.payment.amount)}
                        <GstPaymentTag payment={row.payment} />
                      </TableCell>
                      <TableCell>
                        {row.tds === undefined ? tdsPendingCell : row.tds ? formatToRoundedIndianRupee(row.tds) : "--"}
                      </TableCell>
                      {row.payment.payment_attachment ? (
                          <TableCell className="font-semibold text-blue-500 underline overflow-hidden truncate max-w-28">
                              <a href={`${SITEURL}${row.payment.payment_attachment}`} target="_blank" rel="noreferrer"
                              >
                                  <TruncatedText text={row.payment.utr} fallback="" className="max-w-28" />
                              </a>
                      </TableCell>
                      ) : (
                          <TableCell className="font-semibold overflow-hidden truncate max-w-28"><TruncatedText text={row.payment.utr} className="max-w-28" /></TableCell>
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
              {rows.length > 0 && (
                <TableFooter>
                  <TableRow>
                    <TableCell className="font-semibold">Total</TableCell>
                    <TableCell className="font-semibold" colSpan={3}>
                      {total === undefined ? tdsPendingCell : formatToRoundedIndianRupee(total)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          </div>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
};
