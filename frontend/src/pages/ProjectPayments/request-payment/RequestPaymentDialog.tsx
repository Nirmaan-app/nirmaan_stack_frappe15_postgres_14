import {
  AlertDialog, AlertDialogContent, AlertDialogHeader,
  AlertDialogTitle, AlertDialogCancel
} from "@/components/ui/alert-dialog";
import { Button }     from "@/components/ui/button";
import { Input }      from "@/components/ui/input";
import { Label }      from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radiogroup";
import { toast }      from "@/components/ui/use-toast";
import { TailSpin }   from "react-loader-spinner";
import { useState, useMemo } from "react";
import { parseNumber } from "@/utils/parseNumber";
import { useDialogStore } from "@/zustand/useDialogStore";
import { useRequestPayment } from "../hooks/useRequestPayment";
import formatToIndianRupee from "@/utils/FormatPrice";
import { useCEOHoldGuard } from "@/hooks/useCEOHoldGuard";
import { PaymentModeFields } from "../components/PaymentModeFields";
import { PaymentSummaryBlock, usePaymentSummary } from "../components/PaymentSummaryBlock";
import { PayFor, payForCap } from "../components/paymentSummaryView";
import { PayForChoice } from "../components/PayForChoice";
import { raiserLandingNote, raiserLevelOf, TIER_L2_ABOVE } from "@/utils/approvalTiers";
import { CEO_AUTHORIZED_USER } from "@/constants/ceoHold";
import { useUserData } from "@/hooks/useUserData";
import { useVendorTdsRates } from "../hooks/useVendorTdsRates";
import {
  EMPTY_PAYMENT_MODE, isPaymentModeComplete, paymentModeArgs, PAYMENT_MODE_CHEQUE, PaymentModeValue,
} from "../paymentMode";
import { forecastTds } from "../tdsForecast";

interface Props {
  totalIncGST : number;
  totalExGST  : number;
  paid        : number;
  pending     : number;
  gst         : boolean;
  docType     : "Procurement Orders" | "Service Requests";
  docName     : string;
  project     : string;
  vendor      : string;
  onSuccess   ?: () => void;
}
export default function RequestPaymentDialog(p:Props){
  const { requestPaymentDialog:open, toggleRequestPaymentDialog:toggle } = useDialogStore();

  /* Where the payment will land when the raiser already holds an approval (owner, 2026-09-21).
     The server decides; this only says so before the request is made. */
  const { role, user_id } = useUserData();

  /* CEO Hold guard */
  const { isCEOHold, showBlockedToast } = useCEOHoldGuard(p.project);

  /* local state */
  const [mode,setMode] = useState<"custom"|"percentage"|"full"|"exGST"|"due">("custom");
  const [custom,setCustom] = useState("");
  const [perc,setPerc]     = useState("");
  const [warn,setWarn]     = useState("");
  const [payMode,setPayMode] = useState<PaymentModeValue>(EMPTY_PAYMENT_MODE);
  const [payFor,setPayFor] = useState<PayFor>("base");

  /* Where this WO's money already stands (owner, 2026-09-21). WO only: the PO page requests
     through its payment terms, and this dialog's PO path has no live trigger. */
  const isWO = p.docType === "Service Requests";
  const { summary, isLoading: summaryLoading, error: summaryError } = usePaymentSummary(
    open && isWO ? p.docType : null,
    open && isWO ? p.docName : null
  );

  /* A GST-on Work Order pays Base or GST, never a mix (ADR-0030). Each part has its own cap,
     read from the summary's `limit.caps` -- the server's Work Order payment limit, never re-derived
     here. Full / % / Due all measure against the chosen part's cap (story 25: after a 40,000 base
     payment, Full (Base) offers 60,000); nothing can be confirmed until the limit has loaded,
     because there is no local figure to fall back on. */
  const gstWO = isWO && p.gst;
  const limit = summary?.limit;
  const cap = useMemo(()=> (gstWO && limit ? payForCap(limit, payFor) : null), [gstWO, limit, payFor]);
  const gstPayment = gstWO && payFor === "gst";

  const payable = gstWO ? (cap?.max ?? 0) : p.totalIncGST;

  // ⚠️ ONE BALANCE: once the summary has loaded, "Due", the cap warning and the block's
  // "Left after this payment" all read the server's figures. They count payments gross of TDS as
  // this dialog always has, and also count a Rejected payment not yet deleted -- as the server's
  // cap does, so a request the server would refuse is refused here first. On a GST-off WO or a PO,
  // until the summary loads (or if it fails) the local figure stands, exactly as before.
  const localMax = payable - p.paid - p.pending;
  const max = useMemo(
    ()=> (gstWO ? (cap?.max ?? 0) : isWO && summary ? summary.left : localMax),
    [gstWO, cap?.max, isWO, summary, localMax]
  );
  const amount = useMemo(()=>{
    switch(mode){
      case "full"   : return payable;
      case "exGST"  : return p.totalExGST;
      case "due"    : return max;
      case "percentage": return (payable*parseNumber(perc))/100;
      default       : return parseNumber(custom);
    }
  },[mode,custom,perc,max,payable,p]);

  useMemo(()=>{
    if(cap && amount>max+1e-6)
      setWarn(`Request exceeds ${cap.capLabel} ${formatToIndianRupee(max)}`);
    else if(!gstWO && amount>max+1e-6)
      setWarn(`Request exceeds balance ${formatToIndianRupee(max)}`);
    else setWarn("");
  },[amount,max,cap,gstWO]);

  /* A cheque is written for the figure AFTER TDS, so the dialog says what that is. Fetched only
     while a cheque is being requested: the dialog is mounted on every PO / WO page. */
  const isCheque = payMode.mode === PAYMENT_MODE_CHEQUE;
  const tdsRows = useMemo(
    () => (open && isCheque ? [{ vendor: p.vendor, document_type: p.docType, document_name: p.docName }] : []),
    [open, isCheque, p.vendor, p.docType, p.docName]
  );
  const { rateFor, companyBorneFor, isLoading: tdsLoading } = useVendorTdsRates(tdsRows);
  const companyBorne = companyBorneFor(p.docName);
  const tds = forecastTds(p.docType, amount, rateFor(p.vendor), companyBorne, gstPayment);

  const { trigger, isMutating } = useRequestPayment();

  const submit = async ()=>{
    if (isCEOHold) {
      showBlockedToast();
      return;
    }
    try{
      await trigger({
        doctype:p.docType, docname:p.docName, amount, ...paymentModeArgs(payMode),
        ...(isWO ? { is_gst_payment: gstPayment ? 1 : 0 } : {}),
      });
      toggle(); setCustom(""); setPerc(""); setPayMode(EMPTY_PAYMENT_MODE); setPayFor("base");
      toast({title:"Success",description:"Payment request created",variant:"success"});
      p.onSuccess?.();
    }catch(e:any){
      let err = e._server_messages
      if(err && typeof err === "object") {
        err = typeof err[0] === "object" ? err[0].message : JSON.parse(err[0])?.message
      } else if(err && typeof err === "string") {
        err = JSON.parse(err)
        err = typeof err[0] === "object" ? err[0]?.message : JSON.parse(err[0])?.message
      }
      if(err) {
        setWarn(err)
      }
      toast({title:"Error",description:err ?? "Failed",variant:"destructive"});
    }
  };

  /* ---------- UI ---------- */
  return (
  <AlertDialog open={open} onOpenChange={toggle}>
    <AlertDialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
      <AlertDialogHeader><AlertDialogTitle className="text-center">
         Request Payment
      </AlertDialogTitle></AlertDialogHeader>

      {isWO && (summary || summaryLoading) &&
        <PaymentSummaryBlock summary={summary} isLoading={summaryLoading} thisAmount={amount} />}

      {gstWO && limit && <PayForChoice limit={limit} value={payFor} onChange={setPayFor}/>}

      {gstWO && !limit && !summaryLoading && summaryError &&
        <p className="text-xs text-red-600 text-center">Couldn't load this Work Order's payment limit. Close and try again.</p>}

      <RadioGroup value={mode} onValueChange={v=>setMode(v as any)} className="space-y-3">

        <div className="flex items-center gap-2">
          <RadioGroupItem value="custom" id="custom"/>
          <Label htmlFor="custom" className="w-24">Custom</Label>
          <Input type="number" className="w-32 h-8"
                 disabled={mode!=="custom"} value={custom}
                 onChange={e=>setCustom(e.target.value)} />
        </div>

        {/* On a GST Work Order the shortcuts measure against what is left of the chosen part, so
            they stay meaningful after earlier payments. */}
        {(gstWO || (p.paid===0 && p.pending===0)) && <>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="percentage" id="pct"/>
            <Input type="number" className="w-16 h-8"
                   disabled={mode!=="percentage"} value={perc}
                   onChange={e=>setPerc(e.target.value)} />
            <Label htmlFor="pct">% of Amount</Label>
          </div>

          {p.gst && !isWO &&
            <div className="flex items-center gap-2">
              <RadioGroupItem value="exGST" id="exgst"/>
              <Label htmlFor="exgst">Total (ex-GST)</Label>
            </div>}

          <div className="flex items-center gap-2">
            <RadioGroupItem value="full" id="full"/>
            <Label htmlFor="full">Full Amount{gstWO && (payFor === "gst" ? " (GST)" : " (Base)")}</Label>
          </div>
        </>}

        {/* On a GST Work Order with nothing left of the chosen part, hide "Due" -- there is
            nothing to request. */}
        {p.paid>0 && (!gstWO || max>0) &&
          <div className="flex items-center gap-2">
            <RadioGroupItem value="due" id="due"/>
            <Label htmlFor="due">Due {formatToIndianRupee(max)}</Label>
          </div>}
      </RadioGroup>

      {warn && <p className="text-xs text-red-600 mt-1">{warn}</p>}

      <p className="mt-2 text-center font-semibold">
        Requesting: <span className="text-primary">{formatToIndianRupee(amount)}</span>
      </p>
      {(() => {
        const note = raiserLandingNote(amount, TIER_L2_ABOVE, raiserLevelOf(role, user_id, CEO_AUTHORIZED_USER));
        return note ? <p className="text-center text-xs text-sky-700 dark:text-sky-400">{note}</p> : null;
      })()}

      {/* No cheque figure until the rate has landed: with no rate yet it would show the gross. */}
      <PaymentModeFields value={payMode} onChange={setPayMode} amount={tdsLoading ? undefined : amount}
                         tds={tds} companyBorne={companyBorne} />

      <div className="mt-3 flex gap-2 justify-center">
        {isMutating
          ? <TailSpin color="red" height={40} width={40}/>
          : <>
              <AlertDialogCancel className="flex-1">Cancel</AlertDialogCancel>
              <Button className="flex-1"
                      disabled={amount===0 || !!warn || !isPaymentModeComplete(payMode) || (gstWO && !cap)}
                      onClick={submit}>Confirm</Button>
            </>}
      </div>
    </AlertDialogContent>
  </AlertDialog>);
}