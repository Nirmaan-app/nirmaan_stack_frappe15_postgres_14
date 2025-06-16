import { CustomAttachment } from "@/components/helpers/CustomAttachment";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTrigger
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/use-toast";
import { ValidationMessages } from "@/components/validations/ValidationMessages";
import SITEURL from "@/constants/siteURL";
import { usePOValidation } from "@/hooks/usePOValidation";
import { DeletePaymentDialog } from "@/pages/ProjectPayments/update-payment/DeletePaymentDialog";
import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee, { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { parseNumber } from "@/utils/parseNumber";
import { useDialogStore } from "@/zustand/useDialogStore";
import { useFrappeCreateDoc, useFrappeFileUpload, useFrappePostCall } from "frappe-react-sdk";
import { debounce } from "lodash";
import { SquarePlus, Trash2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { TailSpin } from "react-loader-spinner";
// import RequestPaymentDialog from "../ProjectPayments/request-payment-dialog";

interface TransactionDetailsCardProps {
  accountsPage: boolean
  estimatesViewing: boolean
  summaryPage: boolean
  PO: ProcurementOrder | null
  poPayments?: ProjectPayments[]
  poPaymentsMutate: any
  amountPaid: number
  getTotal: {
    total: number
    totalGst: number
    totalAmt: number
  }
  AllPoPaymentsListMutate: any
}

export const TransactionDetailsCard: React.FC<TransactionDetailsCardProps> = ({
  accountsPage, estimatesViewing, summaryPage, PO, getTotal, amountPaid, poPayments, poPaymentsMutate, AllPoPaymentsListMutate
}) => {

  const { errors, isValid } = usePOValidation(PO);
  const { upload: upload, loading: uploadLoading } = useFrappeFileUpload();
  const { call, loading: callLoading } = useFrappePostCall("frappe.client.set_value");
  const { createDoc, loading: createLoading } = useFrappeCreateDoc();

  const { toggleRequestPaymentDialog } = useDialogStore()
  const [newPayment, setNewPayment] = useState({
    amount: "",
    payment_date: "",
    utr: "",
    tds: ""
  });

  const [deleteFlagged, setDeleteFlagged] = useState<ProjectPayments | null>(null);
  const [warning, setWarning] = useState("");
  const [paymentScreenshot, setPaymentScreenshot] = useState<File | null>(null);

  const [newPaymentDialog, setNewPaymentDialog] = useState(false);
  const toggleNewPaymentDialog = useCallback(() => {
    setNewPaymentDialog((prevState) => !prevState);
  }, []);

  // const amountPending = useMemo(() => getTotalAmountPaid((poPayments || []).filter(i => ["Requested", "Approved"].includes(i?.status))), [poPayments]);

  const validateAmount = useCallback(
    debounce((amount: number) => {
      const { totalAmt } = getTotal;

      const compareAmount = totalAmt - amountPaid;

      if (amount > compareAmount) {
        setWarning(
          `Entered amount exceeds the total ${amountPaid ? "remaining" : ""
          } amount including GST: ${formatToRoundedIndianRupee(compareAmount)}`
        );
      } else {
        setWarning(""); // Clear warning if within the limit
      }
    }, 300), []);

  // Handle input change
  const handleAmountChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const amount = e.target.value;
    setNewPayment({ ...newPayment, amount });
    validateAmount(parseNumber(amount));
  }, []);

  const AddPayment = async () => {
    try {
      const res = await createDoc("Project Payments", {
        document_type: "Procurement Orders",
        document_name: PO?.name,
        project: PO?.project,
        vendor: PO?.vendor,
        utr: newPayment?.utr,
        tds: newPayment?.tds,
        amount: newPayment?.amount,
        payment_date: newPayment?.payment_date,
        status: "Paid"
      });

      if (paymentScreenshot) {
        const fileArgs = {
          doctype: "Project Payments",
          docname: res?.name,
          fieldname: "payment_attachment",
          isPrivate: true,
        };

        const uploadedFile = await upload(paymentScreenshot, fileArgs);

        await call({
          doctype: "Project Payments",
          name: res?.name,
          fieldname: "payment_attachment",
          value: uploadedFile.file_url,
        });
      }

      await AllPoPaymentsListMutate();

      await poPaymentsMutate();

      toggleNewPaymentDialog();

      toast({
        title: "Success!",
        description: "Payment added successfully!",
        variant: "success",
      });

      setNewPayment({
        amount: "",
        payment_date: "",
        utr: "",
        tds: ""
      });

      setPaymentScreenshot(null);
    } catch (error) {
      console.log("error", error);
      toast({
        title: "Failed!",
        description: "Failed to add Payment!",
        variant: "destructive",
      });
    }
  };

  return (
    <Card className="rounded-sm shadow-m col-span-3 overflow-x-auto">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <p data-cy="transaction=details-card-heading" className="text-xl max-sm:text-lg text-red-600">
            Transaction Details
          </p>
          {!accountsPage && !estimatesViewing && !summaryPage && (
            <>
              <Tooltip>
                <TooltipTrigger>
                  <Button
                    disabled={!isValid}
                    variant="outline"
                    className="text-primary border-primary text-xs px-2"
                    onClick={isValid ? toggleRequestPaymentDialog : undefined}
                  >
                    Request Payment
                  </Button>
                </TooltipTrigger>
                {!isValid && (
                  <TooltipContent
                    side="bottom"
                    className="bg-background border border-border text-foreground w-80"
                  >
                    <ValidationMessages title="Required Before Requesting Payment" errors={errors} />
                  </TooltipContent>
                )}
              </Tooltip>
            </>
          )}

          {accountsPage && (
            <AlertDialog open={newPaymentDialog} onOpenChange={toggleNewPaymentDialog}>
              <AlertDialogTrigger
                onClick={() => setNewPayment({ ...newPayment, payment_date: new Date().toISOString().split("T")[0] })}
              >
                <SquarePlus className="w-5 h-5 text-red-500 cursor-pointer" />
              </AlertDialogTrigger>
              <AlertDialogContent className="py-8 max-sm:px-12 px-16 text-start overflow-auto">
                <AlertDialogHeader className="text-start">
                  <div className="flex items-center justify-between">
                    <Label className=" text-red-700">Project:</Label>
                    <span className="">{PO?.project_name}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className=" text-red-700">Vendor:</Label>
                    <span className="">{PO?.vendor_name}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className=" text-red-700">PO Amt excl. Tax:</Label>
                    <span className="">{formatToRoundedIndianRupee(getTotal?.total)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className=" text-red-700">PO Amt incl. Tax:</Label>
                    <span className="">{formatToRoundedIndianRupee(Math.floor(getTotal?.totalAmt || 0))}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className=" text-red-700">Amt Paid Till Now:</Label>
                    <span className="">{amountPaid ? formatToRoundedIndianRupee(amountPaid) : "--"}</span>
                  </div>

                  <div className="flex flex-col gap-4 pt-4">
                    <div className="flex gap-4 w-full">
                      <Label className="w-[40%]">Amount<sup className=" text-sm text-red-600">*</sup></Label>
                      <div className="w-full">
                        <Input
                          type="number"
                          placeholder="Enter Amount"
                          value={newPayment.amount}
                          onChange={(e) => handleAmountChange(e)}
                        />
                        {warning && <p className="text-red-600 mt-1 text-xs">{warning}</p>}
                      </div>
                    </div>
                    <div className="flex gap-4 w-full">
                      <Label className="w-[40%]">TDS Amount</Label>
                      <div className="w-full">
                        <Input
                          type="number"
                          placeholder="Enter TDS Amount"
                          value={newPayment.tds}
                          onChange={(e) => {
                            const tdsValue = e.target.value;
                            setNewPayment({ ...newPayment, tds: tdsValue })
                          }}
                        />
                        {parseNumber(newPayment?.tds) > 0 && <span className="text-xs">Amount Paid : {formatToRoundedIndianRupee((parseNumber(newPayment?.amount)) - parseNumber(newPayment?.tds))}</span>}
                      </div>
                    </div>
                    <div className="flex gap-4 w-full">
                      <Label className="w-[40%]">UTR<sup className=" text-sm text-red-600">*</sup></Label>
                      <Input
                        type="number"
                        placeholder="Enter UTR"
                        value={newPayment.utr}
                        onChange={(e) => setNewPayment({ ...newPayment, utr: e.target.value })}
                      />
                    </div>

                    <div className="flex gap-4 w-full" >
                      <Label className="w-[40%]">Payment Date<sup className=" text-sm text-red-600">*</sup></Label>
                      <Input
                        type="date"
                        value={newPayment.payment_date}
                        placeholder="DD/MM/YYYY"
                        onChange={(e) => setNewPayment({ ...newPayment, payment_date: e.target.value })}
                        max={new Date().toISOString().split("T")[0]}
                        onKeyDown={(e) => e.preventDefault()}
                      />
                    </div>

                  </div>

                  <CustomAttachment
                    maxFileSize={20 * 1024 * 1024} // 20MB
                    selectedFile={paymentScreenshot}
                    onFileSelect={setPaymentScreenshot}
                    className="pt-2"
                    label="Attach Screenshot"
                  />

                  <div className="flex gap-2 items-center pt-4 justify-center">
                    {callLoading || createLoading || uploadLoading ? <TailSpin color="red" width={40} height={40} /> : (
                      <>
                        <AlertDialogCancel className="flex-1" asChild>
                          <Button variant={"outline"} className="border-primary text-primary">Cancel</Button>
                        </AlertDialogCancel>
                        <Button
                          onClick={AddPayment}
                          disabled={!newPayment.amount || !newPayment.utr || !newPayment.payment_date || !!warning}
                          className="flex-1">Add Payment
                        </Button>
                      </>
                    )}
                  </div>

                </AlertDialogHeader>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="overflow-auto">
        <Table data-cy="transactions-details-table">
          <TableHeader className="bg-red-100">
            <TableRow>
              <TableHead className="text-black font-bold">Amount</TableHead>
              <TableHead className="text-black font-bold">UTR No.</TableHead>
              <TableHead className="text-black font-bold">Date</TableHead>
              <TableHead className="text-black font-bold w-[5%]">Status</TableHead>
              <TableHead ></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(poPayments || [])?.length > 0 ? (
              poPayments?.map((payment) => {
                return (
                  <TableRow key={payment?.name}>
                    <TableCell>
                      {formatToRoundedIndianRupee(payment?.amount)}
                    </TableCell>
                    {(payment?.utr && payment?.payment_attachment) ? (
                      <TableCell className="text-blue-500 underline">
                        {<a
                          href={`${SITEURL}${payment?.payment_attachment}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {payment?.utr}
                        </a>}
                      </TableCell>
                    ) : (
                      <TableCell>
                        {payment?.utr || "--"}
                      </TableCell>
                    )}
                    <TableCell>
                      {formatDate(
                        payment?.payment_date || payment?.creation
                      )}
                    </TableCell>
                    <TableCell>{payment?.status}</TableCell>
                    <TableCell className="text-red-500 text-end w-[5%]">
                      {!["Paid", "Approved"].includes(payment?.status) && !estimatesViewing && !summaryPage &&
                      <Button
                          data-cy="rejecte-payments-button"
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 p-0 text-destructive hover:bg-destructive/5 hover:text-destructive/90"
                          onClick={() => setDeleteFlagged(payment)} 
                      >
                          <Trash2 className="h-4 w-4" />
                      </Button>
                      }
                      <DeletePaymentDialog isOpen={!!deleteFlagged} onOpenChange={() => setDeleteFlagged(null)} paymentToDelete={payment} onDeleteSuccess={() => poPaymentsMutate()} />
                    </TableCell>
                  </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-2">
                  No Payments Found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

export default TransactionDetailsCard;