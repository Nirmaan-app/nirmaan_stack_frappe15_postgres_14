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

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, Sparkles } from "lucide-react";
import { useUpdatePaymentRequest } from "../hooks/useUpdatePaymentRequests";
import { useFrappeFileUpload, useFrappePostCall } from "frappe-react-sdk";
import { DOC_TYPES } from "../approve-payments/constants";
import { useOrderPayments } from "@/hooks/useOrderPayments";
import { useOrderTotals } from "@/hooks/useOrderTotals";
import { invalidateSidebarCounts } from "@/hooks/useSidebarCounts";

/* ---------- tiny sub-component for label/value rows --------------- */
const Row = ({ label, val, labelClass, valClass }: { label: string; val: string | number, labelClass?: string, valClass?: string }) => (
  <div className="flex items-center justify-between text-sm">
    <span className={labelClass ?? "text-muted-foreground"}>{label}:</span>
    <span className={valClass ?? "font-medium"}>{val}</span>
  </div>
);


export interface ProjectPaymentUpdateFields {
        name   : string;
        project: string;  // Project ID for CEO Hold check
        project_label : string;
        vendor_label  : string;
        document_name : string;
        document_type : string;
        amount        : number;
        status        : string;
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

  /* Two-stage flow (fulfil mode only): "upload" shows just the file picker
     so the user uploads the receipt first; once Document AI returns, we
     flip to "form" with UTR + Payment Date pre-filled. Users who don't
     have a receipt handy can skip straight to the form. */
  const [stage, setStage]                       = useState<"upload" | "form">("upload");
  const [autofilledFields, setAutofilledFields] = useState<Set<string>>(new Set());
  const [isAutofilling, setIsAutofilling]       = useState(false);
  const [uploadedFileUrl, setUploadedFileUrl]   = useState<string | null>(null);
  /* Raw values from Document AI — frontend re-derives the mismatch state
     against (payment.amount − tds) so the banner reacts as TDS changes. */
  const [receiptAmount, setReceiptAmount]       = useState<number | null>(null);
  const [amountDeltaThreshold, setAmountDeltaThreshold] = useState<number>(2);

  /* Reset every form / autofill bit whenever the dialog (re)opens or the
     selected payment row changes. The dialog component stays mounted
     between opens (parent toggles a Zustand `open` flag), so without this
     a Cancel on row A would leak its UTR / Payment Date into row B's
     dialog the next time the user clicks Pay. */
  useEffect(() => {
    if (open && mode === "fulfil") {
      setUtr(""); setTds(""); setPD(""); setFile(null);
      setAutofilledFields(new Set());
      setUploadedFileUrl(null);
      setIsAutofilling(false);
      setReceiptAmount(null);
      setStage("upload");
    }
  }, [open, mode, payment.name]);

  const { trigger, isMutating } = useUpdatePaymentRequest();
  const { upload, loading: uploadLoading } = useFrappeFileUpload();
  const { call: extractPaymentFields } = useFrappePostCall(
    "nirmaan_stack.api.payment_autofill.extract_payment_fields"
  );

  /* ---------------- submit handlers ------------------------------- */
  const reset = () => {
    setUtr(""); setTds(""); setPD(""); setFile(null);
    setAutofilledFields(new Set());
    setUploadedFileUrl(null);
    setIsAutofilling(false);
    setReceiptAmount(null);
    setStage("upload");
  };

  const clearAutofillFlag = (field: string) => {
    if (!autofilledFields.has(field)) return;
    const next = new Set(autofilledFields);
    next.delete(field);
    setAutofilledFields(next);
  };

  const runAutofillExtraction = async (selectedFile: File) => {
    setIsAutofilling(true);
    try {
      const uploaded = await upload(selectedFile, {
        doctype: DOC_TYPES.PROJECT_PAYMENTS,
        docname: payment.name,
        fieldname: "payment_attachment",
        isPrivate: true,
      });
      setUploadedFileUrl(uploaded.file_url);

      const res = await extractPaymentFields({ file_url: uploaded.file_url });
      const data = (res as any)?.message ?? res;

      const filled = new Set<string>();
      if (data?.utr) {
        setUtr(data.utr);
        filled.add("utr");
      }
      if (data?.payment_date) {
        setPD(data.payment_date);
        filled.add("payment_date");
      }
      setAutofilledFields(filled);

      // Stash raw extracted amount + tolerance; the form derives the
      // mismatch state dynamically against (payment.amount − tds).
      const amt = data?.validation?.amount;
      setReceiptAmount(typeof amt?.extracted === "number" ? amt.extracted : null);
      if (typeof amt?.delta_threshold === "number") {
        setAmountDeltaThreshold(amt.delta_threshold);
      }

      if (filled.size > 0) {
        toast({
          title: "Auto-filled from receipt",
          description: `Filled ${filled.size} field${filled.size > 1 ? "s" : ""}. Please verify before confirming.`,
          variant: "success",
        });
      } else {
        toast({
          title: "Couldn't auto-fill",
          description: "Please enter UTR and Payment Date manually.",
          variant: "default",
        });
      }
    } catch (e: any) {
      toast({
        title: "Auto-fill failed",
        description: e?.message || "Please enter details manually.",
        variant: "destructive",
      });
    } finally {
      setIsAutofilling(false);
      // Whether autofill succeeded or failed, move the user into the form
      // so they can verify / fill the remaining fields.
      setStage("form");
    }
  };

  const handleFileSelect = (selectedFile: File | null) => {
    setFile(selectedFile);
    setUploadedFileUrl(null);
    setAutofilledFields(new Set());
    setReceiptAmount(null);
    if (selectedFile) {
      runAutofillExtraction(selectedFile);
    }
  };

  /* Live amount mismatch — recomputes when TDS changes so the banner
     hides automatically once the user accounts for the deduction. */
  const amountMismatch = useMemo(() => {
    if (receiptAmount == null) return null;
    const effectiveExpected = payment.amount - (parseNumber(tds) || 0);
    const delta = +(receiptAmount - effectiveExpected).toFixed(2);
    if (Math.abs(delta) <= amountDeltaThreshold) return null;
    return {
      expected: effectiveExpected,
      extracted: receiptAmount,
      delta,
    };
  }, [receiptAmount, amountDeltaThreshold, payment.amount, tds]);

  const doFulfil = async () => {
    try {

      let uploadedFile: { file_url: string } | undefined;
      if (uploadedFileUrl) {
        // Already uploaded during autofill — reuse the same File record.
        uploadedFile = { file_url: uploadedFileUrl };
      } else if (file) {
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
        status: payment?.status,
        file_url   : uploadedFile ? uploadedFile.file_url : undefined
      };
      await trigger(payload);
      toast({ title: "Success", description: "Payment fulfilled", variant: "success" });
      invalidateSidebarCounts();
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
      invalidateSidebarCounts();
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
          stage === "upload" ? (
            // ───────── Stage 1: Upload receipt ─────────
            <div className="pt-4 space-y-4">
              <Separator />
              {!isAutofilling ? (
                <>
                  <div className="text-center space-y-1">
                    <h3 className="text-sm font-semibold text-gray-900">
                      Upload Payment Receipt
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      We'll read the receipt and fill in UTR and Payment Date for you.
                    </p>
                  </div>
                  <CustomAttachment
                    label="Choose Receipt (PDF or image)"
                    selectedFile={file}
                    onFileSelect={handleFileSelect}
                    maxFileSize={5 * 1024 * 1024}
                    className="w-full"
                  />
                  <p className="text-[11px] text-center text-muted-foreground">
                    Supported: PDF, PNG, JPG · max 5 MB
                  </p>
                </>
              ) : (
                <div className="flex flex-col items-center gap-3 py-6">
                  <Loader2 className="h-8 w-8 text-amber-600 animate-spin" />
                  <div className="text-center space-y-1">
                    <p className="text-sm font-medium text-gray-900">
                      Reading your receipt…
                    </p>
                    <p className="text-xs text-muted-foreground">
                      AI is extracting payment details. This usually takes a few seconds.
                    </p>
                  </div>
                </div>
              )}
              {!isAutofilling && (
                <div className="flex justify-end items-center pt-3 border-t">
                  <AlertDialogCancel asChild>
                    <Button variant="outline" size="sm">Cancel</Button>
                  </AlertDialogCancel>
                </div>
              )}
            </div>
          ) : (
            // ───────── Stage 2: Form (prefilled if autofill ran) ─────────
            <>
              <Separator className="my-3" />

              {autofilledFields.size > 0 && (
                <div className="flex items-center gap-2 text-xs text-amber-900 bg-amber-50 border border-amber-300 rounded px-2 py-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-amber-700 flex-shrink-0" />
                  <span>Auto-filled from receipt — please review and edit if anything is wrong.</span>
                </div>
              )}

              {/* Soft warning: receipt amount differs from (requested − TDS) by > ₹2 */}
              {amountMismatch && (
                <div className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-300 px-3 py-2">
                  <AlertTriangle className="h-4 w-4 text-amber-700 flex-shrink-0 mt-0.5" />
                  <div className="text-xs text-amber-900 leading-snug">
                    <p className="font-medium">Amount mismatch on receipt.</p>
                    <p className="mt-0.5">
                      Receipt shows {fmt(amountMismatch.extracted)} transferred, but the expected payable is {fmt(amountMismatch.expected)}
                      {parseNumber(tds) > 0 ? ` (${fmt(payment.amount)} − ${fmt(parseNumber(tds))} TDS)` : ""}
                      {" "}— off by {fmt(Math.abs(amountMismatch.delta))}. Please double-check the receipt
                      {parseNumber(tds) === 0 ? " or enter TDS if applicable." : "."}
                    </p>
                  </div>
                </div>
              )}

              {/* UTR */}
              <div className="grid grid-cols-5 items-center gap-4">
                <Label htmlFor="utr" className="col-span-2 text-right">
                  UTR <sup className="text-red-500">*</sup>
                </Label>
                <Input id="utr"
                       className={`col-span-3 h-8 ${autofilledFields.has("utr") ? "bg-amber-50 border-amber-300 focus-visible:ring-amber-400" : ""}`}
                       value={utr}
                       onChange={e => { setUtr(e.target.value); clearAutofillFlag("utr"); }} />
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
                <Input id="payDate" type="date"
                       className={`col-span-3 h-8 ${autofilledFields.has("payment_date") ? "bg-amber-50 border-amber-300 focus-visible:ring-amber-400" : ""}`}
                       value={payDate}
                       onChange={e => { setPD(e.target.value); clearAutofillFlag("payment_date"); }}
                       max={new Date().toISOString().slice(0,10)} />
              </div>

              {/* Attachment (re-shown so user can replace the receipt without
                  losing the form). Re-running autofill on replace is intentional. */}
              <CustomAttachment
                label="Payment Proof"
                selectedFile={file}
                onFileSelect={handleFileSelect}
                maxFileSize={5 * 1024 * 1024}
              />
            </>
          )
        ) : (
          <p className="pt-4 text-sm">
            Are you sure you want to delete this payment request?
          </p>
        )}

        {/* ---------- Buttons ---------- */}
        {!(mode === "fulfil" && stage === "upload") && (
          <div className="flex gap-2 items-center pt-6 justify-end">
            {isMutating || uploadLoading
              ? <TailSpin height={24} width={24} color="red" />
              : <>
                  <AlertDialogCancel asChild>
                    <Button variant="outline">Cancel</Button>
                  </AlertDialogCancel>
                  {mode === "fulfil"
                    ? <Button onClick={doFulfil}
                        disabled={!utr || !payDate || isAutofilling}>Confirm Payment</Button>
                    : <Button variant="destructive" onClick={doDelete}>
                        Confirm Delete
                      </Button>}
                </>}
          </div>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}