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

  /* local state */
  const [mode,setMode] = useState<"custom"|"percentage"|"full"|"exGST"|"due">("custom");
  const [custom,setCustom] = useState("");
  const [perc,setPerc]     = useState("");
  const [warn,setWarn]     = useState("");

  const max = useMemo(()=> p.totalIncGST - p.paid - p.pending, [p]);
  const amount = useMemo(()=>{
    switch(mode){
      case "full"   : return p.totalIncGST;
      case "exGST"  : return p.totalExGST;
      case "due"    : return max;
      case "percentage": return (p.totalIncGST*parseNumber(perc))/100;
      default       : return parseNumber(custom);
    }
  },[mode,custom,perc,max,p]);

  useMemo(()=>{
    if(amount>max+1e-6)
      setWarn(`Request exceeds balance ${formatToIndianRupee(max)}`);
    else setWarn("");
  },[amount,max]);

  const { trigger, isMutating, error } = useRequestPayment();

  const submit = async ()=>{
    try{
      await trigger({doctype:p.docType, docname:p.docName, amount});
      toggle(); setCustom(""); setPerc("");
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
    <AlertDialogContent className="max-w-md">
      <AlertDialogHeader><AlertDialogTitle className="text-center">
         Request Payment
      </AlertDialogTitle></AlertDialogHeader>

      <RadioGroup value={mode} onValueChange={v=>setMode(v as any)} className="space-y-3">

        <div className="flex items-center gap-2">
          <RadioGroupItem value="custom" id="custom"/>
          <Label htmlFor="custom" className="w-24">Custom</Label>
          <Input type="number" className="w-32 h-8"
                 disabled={mode!=="custom"} value={custom}
                 onChange={e=>setCustom(e.target.value)} />
        </div>

        {p.paid===0 && p.pending===0 && <>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="percentage" id="pct"/>
            <Input type="number" className="w-16 h-8"
                   disabled={mode!=="percentage"} value={perc}
                   onChange={e=>setPerc(e.target.value)} />
            <Label htmlFor="pct">% of Amount</Label>
          </div>

          {p.gst &&
            <div className="flex items-center gap-2">
              <RadioGroupItem value="exGST" id="exgst"/>
              <Label htmlFor="exgst">Total (ex-GST)</Label>
            </div>}

          <div className="flex items-center gap-2">
            <RadioGroupItem value="full" id="full"/>
            <Label htmlFor="full">Full Amount</Label>
          </div>
        </>}

        {p.paid>0 &&
          <div className="flex items-center gap-2">
            <RadioGroupItem value="due" id="due"/>
            <Label htmlFor="due">Due {formatToIndianRupee(max)}</Label>
          </div>}
      </RadioGroup>

      {warn && <p className="text-xs text-red-600 mt-1">{warn}</p>}

      <p className="mt-2 text-center font-semibold">
        Requesting: <span className="text-primary">{formatToIndianRupee(amount)}</span>
      </p>

      <div className="mt-3 flex gap-2 justify-center">
        {isMutating
          ? <TailSpin color="red" height={40} width={40}/>
          : <>
              <AlertDialogCancel className="flex-1">Cancel</AlertDialogCancel>
              <Button className="flex-1"
                      disabled={amount<=0 || !!warn}
                      onClick={submit}>Confirm</Button>
            </>}
      </div>
    </AlertDialogContent>
  </AlertDialog>);
}