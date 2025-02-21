import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radiogroup";
import { toast } from "@/components/ui/use-toast";
import formatToIndianRupee from "@/utils/FormatPrice";
import { useDialogStore } from "@/zustand/useDialogStore";
import { useFrappeCreateDoc } from "frappe-react-sdk";
import { debounce } from "lodash";
import { useState } from "react";
import { TailSpin } from "react-loader-spinner";

interface RequestPaymentDialogProps {
  totalAmount: number;
  totalAmountWithoutGST: number;
  totalPaid: number;
  po?: any;
  sr?: any;
  gst?: any
  isSr?: boolean;
  paymentsMutate?: any;
}

const RequestPaymentDialog = ({
  totalAmount,
  totalAmountWithoutGST,
  totalPaid,
  po,
  sr,
  paymentsMutate,
  isSr=false,
  gst = true
} : RequestPaymentDialogProps) => {

  const {requestPaymentDialog, toggleRequestPaymentDialog} = useDialogStore()

  const [amountRequesting, setAmountRequesting] = useState(0);
  const [selectedOption, setSelectedOption] = useState(""); // Track selected radio option
  const [customAmount, setCustomAmount] = useState("");
  const [percentage, setPercentage] = useState("");
  const [warning, setWarning] = useState("");

  const { createDoc, loading: createLoading } = useFrappeCreateDoc();

  const handleRadioChange = (value) => {
    setSelectedOption(value);

    if (value === "full") {
      setAmountRequesting(gst ? totalAmount : totalAmountWithoutGST);
    } else if (value === "withoutGST") {
      setAmountRequesting(totalAmountWithoutGST);
    } else if (value === "due") {
      setAmountRequesting((gst ? totalAmount : totalAmountWithoutGST) - totalPaid);
    }
    else if (value === "custom") {
      setAmountRequesting(Number(customAmount));
    } else {
      setAmountRequesting(((gst ? totalAmount : totalAmountWithoutGST) * Number(percentage)) / 100);
    }
  };

  const validateAmount = debounce((amount) => {

    const compareAmount =  gst ? totalAmount - totalPaid : totalAmountWithoutGST - totalPaid;

    if (parseFloat(amount) > compareAmount) {
      setWarning(
        `Entered amount exceeds the total ${
          totalPaid ? "remaining" : ""
        } amount ${gst ? "including" : "excluding"} GST: ${formatToIndianRupee(compareAmount)}`
      );
    } else {
      setWarning(""); // Clear warning if within the limit
    }
  }, 300);

  const AddPayment = async () => {
    try {
      await createDoc("Project Payments", {
        document_type: !isSr ? "Procurement Orders" : "Service Requests",
        document_name: !isSr ? po?.name : sr?.name,
        project: !isSr ? po?.project : sr?.project,
        vendor: !isSr ? po?.vendor : sr?.vendor,
        amount: Math.floor(amountRequesting),
        status: "Requested"
      });

      await paymentsMutate();

      toggleRequestPaymentDialog()

      toast({
        title: "Success!",
        description: "Payment added successfully!",
        variant: "success",
      });

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
    <AlertDialog open={requestPaymentDialog} onOpenChange={toggleRequestPaymentDialog}>
      <AlertDialogContent className="max-w-xs">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-center">Request Payment</AlertDialogTitle>
        </AlertDialogHeader>
          <RadioGroup className="space-y-2" onValueChange={handleRadioChange} value={selectedOption}>
          {/* 1️⃣ Custom Amount */}
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="custom" id="custom" />
            <div className="flex items-center space-x-6">
            <Label htmlFor="custom">Amount</Label>
            <Input
              type="number"
              className="w-24 h-8"
              disabled={selectedOption !== "custom"}
              value={customAmount}
              onChange={(e) => {
                setCustomAmount(e.target.value);
                setAmountRequesting(Number(e.target.value));
                validateAmount(Number(e.target.value));
              }}
            />
            </div>
          </div>

          {warning && <p className="text-red-600 mt-1 text-xs">{warning}</p>}

          {(totalPaid <= 0 || !totalPaid) && (
            <>
            {/* 2️⃣ Percentage of Amount */}
          <div className="flex items-center space-x-2">
          <RadioGroupItem value="percentage" id="percentage" />
          <Input
            type="number"
            className="w-16 h-8"
            disabled={selectedOption !== "percentage"}
            value={percentage}
            onChange={(e) => {
              setPercentage(e.target.value);
              setAmountRequesting(((gst ? totalAmount : totalAmountWithoutGST) * Number(e.target.value)) / 100);
            }}
          />
          <Label htmlFor="percentage">% of the Amount</Label>
        </div>

        {/* 3️⃣ Total Amount Without GST */}
        {gst && (
           <div className="flex items-center space-x-2">
           <RadioGroupItem value="withoutGST" id="withoutGST" />
           <Label htmlFor="withoutGST">Total Amount Holding GST</Label>
         </div>

        )}

        {/* 4️⃣ Full Amount */}
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="full" id="full" />
          <Label htmlFor="full">Full Amount</Label>
        </div>
        </>

          )}
          {totalPaid > 0 && (
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="due" id="due" />
            <Label htmlFor="due">Due amount: {formatToIndianRupee((gst ? totalAmount : totalAmountWithoutGST) - totalPaid)}</Label>
          </div>
          )}
        </RadioGroup>
        {/* Display selected amount */}
        <div className="mt-2 text-center font-semibold">
          Requesting Amount: <span className="text-primary">{formatToIndianRupee(amountRequesting)}</span>
        </div>

        <div className="mt-2 flex items-center justify-center space-x-2">
          {createLoading ? <TailSpin color="red" height={40} width={40} /> : (
            <>
            <Button disabled={amountRequesting <= 0 || warning !== ""} onClick={AddPayment} className="flex-1">Confirm</Button>
            <AlertDialogCancel className="flex-1">Cancel</AlertDialogCancel>
            </>
          )}
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default RequestPaymentDialog;
