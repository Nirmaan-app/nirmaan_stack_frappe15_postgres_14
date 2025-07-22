import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogCancel
} from "@/components/ui/alert-dialog";
import { Button }     from "@/components/ui/button";
import { Input }      from "@/components/ui/input";
import { Label }      from "@/components/ui/label";
import { Separator }  from "@/components/ui/separator";
import { toast }      from "@/components/ui/use-toast";
import { TailSpin }   from "react-loader-spinner";

import { parseNumber }           from "@/utils/parseNumber";
import { formatToRoundedIndianRupee as fmt } from "@/utils/FormatPrice";
import { CustomAttachment }      from "@/components/helpers/CustomAttachment";

import { useDialogStore }          from "@/zustand/useDialogStore";

import { useState } from "react";
import { useUpdatePaymentRequest } from "../hooks/useUpdatePaymentRequests";
import { useFrappeFileUpload } from "frappe-react-sdk";
import { DOC_TYPES } from "../approve-payments/constants";
import { useOrderPayments } from "@/hooks/useOrderPayments";
import { useOrderTotals } from "@/hooks/useOrderTotals";

/* ---------- tiny sub-component for label/value rows --------------- */
const Row = ({ label, val, labelClass, valClass }: { label: string; val: string | number, labelClass?: string, valClass?: string }) => (
  <div className="flex items-center justify-between text-sm">
    <span className={labelClass ?? "text-muted-foreground"}>{label}:</span>
    <span className={valClass ?? "font-medium"}>{val}</span>
  </div>
);


export interface ProjectPaymentUpdateFields {
        name   : string;
        project_label : string;
        vendor_label  : string;
        document_name : string;
        document_type : string;
        amount        : number;
    }

/* ---------- exported dialog --------------------------------------- */
export interface UpdatePaymentDialogProps {
  mode         : "fulfil" | "delete";
  payment      : ProjectPaymentUpdateFields;
  onSuccess    : () => void; // refetch list on success
}

export default function UpdatePaymentRequestDialog({
  mode, payment, onSuccess
}: UpdatePaymentDialogProps) {

  const { getAmount: getTotalAmountPaidForPO } = useOrderPayments()
  const { getTotalAmount } = useOrderTotals()

  /* global dialog open/close from zustand */
  const { paymentDialog: open, togglePaymentDialog: toggle } =
    useDialogStore();

  /* local form state (fulfil only) */
  const [utr, setUtr]       = useState("");
  const [tds, setTds]       = useState("");
  const [payDate, setPD]    = useState("");
  const [file, setFile]     = useState<File | null>(null);

  const { trigger, isMutating } = useUpdatePaymentRequest();
  const { upload, loading: uploadLoading } = useFrappeFileUpload();

  /* ---------------- submit handlers ------------------------------- */
  const reset = () => { setUtr(""); setTds(""); setPD(""); setFile(null); };

  const doFulfil = async () => {
    try {

      let uploadedFile;
      if (file) {
          uploadedFile = await upload(file, {
              doctype: DOC_TYPES.PROJECT_PAYMENTS, docname: payment.name,
              fieldname: "payment_attachment", isPrivate: true,
          });

      } 
      const payload = {
        action : "fulfil" as const,
        name   : payment.name,
        utr,
        tds    : parseNumber(tds) || 0,
        pay_date : payDate,
        file_url   : uploadedFile ? uploadedFile.file_url : undefined
      };
      await trigger(payload);
      toast({ title: "Success", description: "Payment fulfilled", variant: "success" });
      onSuccess(); toggle(); reset();
    } catch (e: any) {
      // const msg = e?.message || "Failed";

      // // friendly duplicate UTR toast
      // const isDup = /UTR .* already exists/i.test(msg);
      let err = e._server_messages
      if(err && typeof err === "object") {
        err = typeof err[0] === "object" ? err[0].message : JSON.parse(err[0])?.message
      } else if(err && typeof err === "string") {
        err = JSON.parse(err)
        err = typeof err[0] === "object" ? err[0]?.message : JSON.parse(err[0])?.message
      }

      toast({
      title: "Error",
      description: err || "Failed",
      variant: "destructive",
    });

    }
  };

  const doDelete = async () => {
    try {
      await trigger({ action: "delete", name: payment.name });
      toast({ title: "Deleted", variant: "success" });
      onSuccess(); toggle(); reset();
    } catch (e: any) {
      toast({ title: "Error", description: e.message || "Failed", variant: "destructive" });
    }
  };

  /* ---------------- UI ------------------------------- */
  return (
    <AlertDialog open={open} onOpenChange={toggle}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-center">
            {mode === "fulfil" ? "Fulfil Payment" : "Delete Payment Request"}
          </AlertDialogTitle>
        </AlertDialogHeader>

        {/* ---------- Common Summary ---------- */}
        <div className="space-y-2 pt-2">
          <Row label="Project"  val={payment.project_label} />
          <Row label="Vendor"   val={payment.vendor_label} />
          <Row label="Doc #"    val={payment.document_name} />
          <Row label="Req. Amt" val={fmt(payment.amount)} labelClass="font-bold" valClass="font-bold" />
          <Row label="PO Value" val={fmt(getTotalAmount(payment.document_name, payment.document_type).total)} />
          <Row label="Total Paid" val={fmt(getTotalAmountPaidForPO(payment.document_name, ["Paid"]))} />
        </div>

        {mode === "fulfil" ? (
          <>
            <Separator className="my-3" />

            {/* UTR */}
            <div className="grid grid-cols-5 items-center gap-4">
              <Label htmlFor="utr" className="col-span-2 text-right">
                UTR <sup className="text-red-500">*</sup>
              </Label>
              <Input id="utr" className="col-span-3 h-8"
                     value={utr} onChange={e=>setUtr(e.target.value)} />
            </div>

            {/* TDS */}
            <div className="grid grid-cols-5 items-center gap-4">
              <Label htmlFor="tds" className="col-span-2 text-right">TDS</Label>
              <div className="col-span-3">
                <Input id="tds" type="number" className="h-8"
                       value={tds} onChange={e=>setTds(e.target.value)} />
                {parseNumber(tds) > 0 &&
                  <span className="text-xs text-muted-foreground">
                    Amt&nbsp;Paid:&nbsp;{fmt(payment.amount - parseNumber(tds))}
                  </span>}
              </div>
            </div>

            {/* Date */}
            <div className="grid grid-cols-5 items-center gap-4">
              <Label htmlFor="payDate" className="col-span-2 text-right">
                Payment Date <sup className="text-red-500">*</sup>
              </Label>
              <Input id="payDate" type="date" className="col-span-3 h-8"
                     value={payDate} onChange={e=>setPD(e.target.value)}
                     max={new Date().toISOString().slice(0,10)} />
            </div>

            {/* Attachment */}
            <CustomAttachment
              label="Payment Proof"
              selectedFile={file}
              onFileSelect={setFile}
              maxFileSize={5 * 1024 * 1024}
            />
          </>
        ) : (
          <p className="pt-4 text-sm">
            Are you sure you want to delete this payment request?
          </p>
        )}

        {/* ---------- Buttons ---------- */}
        <div className="flex gap-2 items-center pt-6 justify-end">
          {isMutating || uploadLoading
            ? <TailSpin height={24} width={24} color="red" />
            : <>
                <AlertDialogCancel asChild>
                  <Button variant="outline">Cancel</Button>
                </AlertDialogCancel>
                {mode === "fulfil"
                  ? <Button onClick={doFulfil}
                      disabled={!utr || !payDate}>Confirm Payment</Button>
                  : <Button variant="destructive" onClick={doDelete}>
                      Confirm Delete
                    </Button>}
              </>}
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}