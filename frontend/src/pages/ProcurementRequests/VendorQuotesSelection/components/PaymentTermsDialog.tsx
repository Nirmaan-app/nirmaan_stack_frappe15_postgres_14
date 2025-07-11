// src/pages/ProcurementRequests/VendorQuotesSelection/components/PaymentTermsDialog.tsx

// --- Core React and UI Component Imports ---
import React, { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { PlusCircle, Trash2 } from "lucide-react";

// --- Type Definitions and Helper Imports ---
import { VendorPaymentTerm, PaymentTermMilestone } from "../types/paymentTerms";
import formatToIndianRupee from "@/utils/FormatPrice";
import { parseNumber } from "@/utils/parseNumber";

// Using your robust rounding function for all financial calculations.
const roundToTwo = (num: number) =>
  Math.round((num + Number.EPSILON) * 100) / 100;

// This constant defines the fixed row names for the 'Delivery' type form.
const DELIVERY_TERM_NAMES = [
  "Advance Payment",
  "Material Readiness",
  "After Delivery",
];

export interface PaymentTermsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  vendorName: string;
  poAmount: number;
  initialData?: VendorPaymentTerm | null;
  onConfirm: (data: VendorPaymentTerm) => void;
}

export const PaymentTermsDialog: React.FC<PaymentTermsDialogProps> = ({
  isOpen,
  onClose,
  vendorName,
  poAmount,
  initialData,
  onConfirm,
}) => {
  // --- State Management ---
  const [step, setStep] = useState<"select" | "details">("select");
  const [type, setType] = useState<VendorPaymentTerm["type"] | null>(null);
  const [milestones, setMilestones] = useState<PaymentTermMilestone[]>([]);
  const today = new Date().toISOString().split("T")[0];

  // This `useEffect` hook initializes the dialog state for "add new" or "edit" mode.
  // It uses your robust logic for handling initial data.
  useEffect(() => {
    if (isOpen) {
      if (initialData) {
        setType(initialData.type);
        setStep("details");
        const sanitizedTerms =
          initialData.terms?.map((term) => ({
            ...term,
            amount: roundToTwo(term.amount),
          })) || [];
        if (initialData.type === "Delivery against payment") {
          const savedTermsMap = new Map(sanitizedTerms.map((t) => [t.name, t]));
          const completeMilestones = DELIVERY_TERM_NAMES.map((name) => {
            const existingTerm = savedTermsMap.get(name);
            const placeholderId = `term_${Date.now()}_${name.replace(
              /\s+/g,
              ""
            )}`;
            return (
              existingTerm || {
                id: placeholderId,
                type:initialData.type,
                name,
                amount: 0,
                percentage: 0,
                enabled: false,
              }
            );
          });
          setMilestones(completeMilestones);
        } else {
          setMilestones(sanitizedTerms);
        }
      } else {
        setStep("select");
        setType(null);
        setMilestones([]);
      }
    }
  }, [isOpen, initialData]);

  // --- Derived Data & Validation (Using your more robust logic) ---
  const totalAmount = useMemo(
    () =>
      roundToTwo(
        milestones.reduce((sum, m) => sum + (m.enabled ? m.amount : 0), 0)
      ),
    [milestones]
  );
  const totalPercentage = useMemo(
    () =>
      milestones.reduce((sum, m) => sum + (m.enabled ? m.percentage : 0), 0),
    [milestones]
  );
  const pendingAmount = useMemo(
    () => roundToTwo(poAmount - totalAmount),
    [poAmount, totalAmount]
  );
  const isTotalAmountValid = useMemo(
    () => pendingAmount < 1 && pendingAmount >= 0,
    [pendingAmount]
  );
  const areCreditDatesValid = useMemo(() => {
    if (type !== "Credit") return true;
    return milestones.every((m) => m.enabled && m.due_date);
  }, [type, milestones]);
  const isFormValid = useMemo(
    () => isTotalAmountValid && areCreditDatesValid,
    [isTotalAmountValid, areCreditDatesValid]
  );
  const isOverBudget = useMemo(() => pendingAmount < 0, [pendingAmount]);

  // --- Event Handlers ---
  const getOrdinal = (n: number) => {
    const s = ["th", "st", "nd", "rd"],
      v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };

  const handleTypeSelectionConfirm = () => {
    if (type) {
      if (type === "Credit") {
        setMilestones([
          {
            id: `term_${Date.now()}`,
            type: "Credit",
            name: "1st Payment",
            amount: 0,
            percentage: 0,
            due_date: "",
            enabled: true,
          },
        ]);
      } else if (type === "Delivery against payment") {
        setMilestones(
          DELIVERY_TERM_NAMES.map((name) => ({
            id: `term_${Date.now()}_${name.replace(/\s+/g, "")}`,
            type: "Delivery against payment",
            name,
            amount: 0,
            percentage: 0,
            enabled: false,
          }))
        );
      }
      setStep("details");
    }
  };

  const handleAddMilestone = () => {
    if (type === "Credit") {
      const newPaymentNumber = milestones.length + 1;
      setMilestones([
        ...milestones,
        {
          id: `term_${Date.now()}`,
          type: "Credit",
          name: `${getOrdinal(newPaymentNumber)} Payment`,
          amount: 0,
          percentage: 0,
          due_date: "",
          enabled: true,
        },
      ]);
    }
  };

  const handleRemoveMilestone = (id: string) => {
    setMilestones(milestones.filter((m) => m.id !== id));
  };
  const handleEnableTerm = (id: string, checked: boolean) => {
    setMilestones(
      milestones.map((m) =>
        m.id === id
          ? {
              ...m,
              enabled: checked,
              percentage: checked ? m.percentage : 0,
              amount: checked ? m.amount : 0,
            }
          : m
      )
    );
  };

  // =================================================================
  // --- MERGED: The handleMilestoneChange function combining the best of both versions ---
  // =================================================================
  const handleMilestoneChange = (
    id: string,
    field: keyof PaymentTermMilestone,
    value: string | number
  ) => {
    const index = milestones.findIndex((m) => m.id === id);
    if (index === -1) return;

    const newMilestones = [...milestones];
    const currentMilestone = { ...newMilestones[index] };

    // --- Logic for 'Credit' type (from your code) ---
    if (type === "Credit" && field === "amount") {
      const otherMilestonesTotal = roundToTwo(
        milestones.reduce(
          (sum, ms) => (ms.id !== id ? sum + ms.amount : sum),
          0
        )
      );
      const maxAllowedForThisField = roundToTwo(
        poAmount - otherMilestonesTotal
      );
      let newAmount = parseNumber(value);
      if (newAmount > maxAllowedForThisField) {
        newAmount = maxAllowedForThisField;
      }
      currentMilestone.amount = roundToTwo(newAmount);
      currentMilestone.percentage =
        poAmount > 0 ? (currentMilestone.amount / poAmount) * 100 : 0;

      // --- Logic for 'Delivery against payment' type (integrating my strict capping) ---
    } else if (type === "Delivery against payment" && field === "percentage") {
      let newPercentage = parseNumber(value) || 0;
      let maxPercent = 100;
      if (index === 1) {
        // Material Readiness
        const advancePercent = newMilestones[0].enabled
          ? newMilestones[0].percentage || 0
          : 0;
        maxPercent = 100 - advancePercent;
      }
      // Enforce the maximum value typed by the user
      if (newPercentage > maxPercent) {
        newPercentage = maxPercent;
      }
      currentMilestone.percentage = newPercentage;
      currentMilestone.amount = roundToTwo((newPercentage / 100) * poAmount);

      // --- Handler for other fields like name, due_date ---
    } else {
      currentMilestone[field] = value;
    }

    newMilestones[index] = currentMilestone;

    // --- Auto-completion for 'Delivery against payment' ---
    // if (type === 'Delivery against payment' && (index === 0 || index === 1)) {
    //     const advancePercent = newMilestones[0].enabled ? newMilestones[0].percentage : 0;
    //     const readinessPercent = newMilestones[1].enabled ? newMilestones[1].percentage : 0;
    //     const remainder = Math.max(0, 100 - advancePercent - readinessPercent);
    //     newMilestones[2].percentage = remainder;
    //     newMilestones[2].amount = roundToTwo((remainder / 100) * poAmount);
    //     newMilestones[2].enabled = remainder > 0;
    // }
    setMilestones(newMilestones);
  };

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    if (e.target.value === "0") e.target.value = "";
  };

  const handleFinalConfirm = () => {
    if (type && isFormValid) {
      console.log("DEBUG: handleFinalConfirm",milestones),
      onConfirm({
        type,
        total_po_amount: poAmount,
        terms: milestones.filter((m) => m.enabled),
      });
      onClose();
    }
  };

  // --- Rendering Functions ---

  const renderSelectStep = () => (
    <>
      <DialogHeader>
        <DialogTitle className="text-center">Payment Terms</DialogTitle>
      </DialogHeader>
      <div className="grid items-center justify-center gap-4 py-8 sm:flex">
        <Label htmlFor="payment-type" className="sm:text-right">
          Type* :
        </Label>
        <Select
          value={type ?? undefined}
          onValueChange={(v: VendorPaymentTerm["type"]) => setType(v)}
        >
          <SelectTrigger id="payment-type" className="w-full sm:w-[400px]">
            <SelectValue placeholder="Select Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Credit">Credit</SelectItem>
            <SelectItem value="Delivery against payment">
              Delivery against payment
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-0">
        <Button
          variant="outline"
          onClick={onClose}
          className="w-full sm:w-auto"
        >
          Cancel
        </Button>
        <Button
          onClick={handleTypeSelectionConfirm}
          disabled={!type}
          className="w-full sm:w-auto"
        >
          Confirm
        </Button>
      </DialogFooter>
    </>
  );

  const renderDetailsStep = () => (
    <>
      <DialogHeader>
        <DialogTitle>Payment Terms</DialogTitle>
      </DialogHeader>
      <div className="space-y-4 py-4">
        <div>
          <Label htmlFor="payment-type-disabled">Payment Type* :</Label>
          <Input id="payment-type-disabled" value={type || ""} disabled />
        </div>
        <div className="flex justify-between items-center">
          <Label>PO Amount :</Label>
          <span className="font-semibold text-red-500">
            {formatToIndianRupee(poAmount)}
          </span>
        </div>
        <div className="border rounded-md">
          {type === "Credit" && renderCreditTable()}
          {type === "Delivery against payment" && renderDeliveryTable()}
        </div>
        {type === "Credit" && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleAddMilestone}
            className="w-full"
          >
            <PlusCircle className="mr-2 h-4 w-4" /> Add more
          </Button>
        )}
        <div className="space-y-1">
          <div className="flex justify-between items-center font-medium">
            <Label>Pending Amount :</Label>
            <span className="text-red-500">
              {isOverBudget ? "Rs.0.00" : formatToIndianRupee(pendingAmount)}
            </span>
          </div>
          {!isTotalAmountValid && (
            <div className="flex items-center gap-2 text-xs text-red-500">
              <span className="h-4 w-4 flex items-center justify-center rounded-full border border-red-500">
                !
              </span>
              <span>
                {isOverBudget
                  ? `Total cannot exceed 100%. Current: ${(
                      totalPercentage || 0
                    ).toFixed(2)}%`
                  : "The total amount must exactly match the PO Amount to confirm."}
              </span>
            </div>
          )}
          {!areCreditDatesValid && type === "Credit" && (
            <div className="flex items-center gap-2 text-xs text-red-500">
              <span className="h-4 w-4 flex items-center justify-center rounded-full border border-red-500">
                !
              </span>
              <span>
                A due date is required for every 'Credit' payment term.
              </span>
            </div>
          )}
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleFinalConfirm} disabled={!isFormValid}>
          Confirm
        </Button>
      </DialogFooter>
    </>
  );

  const renderCreditTable = () => (
    <table className="w-full text-sm">
      <thead className="bg-gray-100">
        <tr>
          <th className="p-2 text-left font-medium">TERM</th>
          <th className="p-2 text-left font-medium">AMOUNT</th>
          <th className="p-2 text-left font-medium">DUE DATE</th>
          <th className="p-2 text-left font-medium">PERCENTAGE</th>
          <th className="p-2"></th>
        </tr>
      </thead>
      <tbody>
        {milestones.map((m, index) => {
          const otherMilestonesAmount = roundToTwo(
            totalAmount - (m.enabled ? m.amount : 0)
          );
          const maxAllowed = roundToTwo(poAmount - otherMilestonesAmount);
          return (
            <tr key={m.id} className="border-t">
              <td className="p-2">
                <Input
                  value={m.name}
                  onChange={(e) =>
                    handleMilestoneChange(m.id, "name", e.target.value)
                  }
                  placeholder={`e.g. ${getOrdinal(index + 1)} Payment`}
                />
              </td>
              <td className="p-2">
                <Input
                  type="number"
                  step="0.01"
                  value={m.amount}
                  max={maxAllowed}
                  onChange={(e) =>
                    handleMilestoneChange(m.id, "amount", e.target.value)
                  }
                  onFocus={handleFocus}
                />
              </td>
              <td className="p-2">
                <Input
                  type="date"
                  value={m.due_date || ""}
                  min={today}
                  onChange={(e) =>
                    handleMilestoneChange(m.id, "due_date", e.target.value)
                  }
                  className={
                    !m.due_date
                      ? "border-red-500 focus-visible:ring-red-500"
                      : ""
                  }
                />
              </td>
              <td className="p-2 text-center">
                {(m.percentage || 0).toFixed(0)}%
              </td>
              <td className="p-2 text-center">
                {milestones.length > 1 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRemoveMilestone(m.id)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                )}
              </td>
            </tr>
          );
        })}
        <tr className="border-t bg-gray-50 font-medium">
          <td className="p-2">Total</td>
          <td className="p-2">{formatToIndianRupee(totalAmount)}</td>
          <td></td>
          <td className="p-2 text-center">
            {(totalPercentage || 0).toFixed(0)}%
          </td>
          <td></td>
        </tr>
      </tbody>
    </table>
  );

  const renderDeliveryTable = () => (
    <table className="w-full text-sm">
      <thead className="bg-gray-100">
        <tr>
          <th className="p-2 text-left font-medium w-2/5">TERM</th>
          <th className="p-2 text-left font-medium w-1/4">PERCENTAGE</th>
          <th className="p-2 text-left font-medium w-1/4">AMOUNT</th>
        </tr>
      </thead>
     
      <tbody>
        {milestones.map((m, index) => {
          let maxPercent = 100;

          // --- THIS IS THE NEW LOGIC FOR CAPPING THE PERCENTAGE ---
          if (type === "Delivery against payment") {
            const otherEnabledPercentages = milestones
              .filter((p, i) => i !== index && p.enabled)
              .reduce((sum, p) => sum + p.percentage, 0);
            maxPercent = 100 - otherEnabledPercentages;
          }

          return (
            <tr key={m.id} className="border-t">
              <td className="p-2 flex items-center gap-2">
                {/* The `disabled` prop is now REMOVED from the checkbox */}
                <Checkbox
                  id={m.id}
                  checked={m.enabled}
                  onCheckedChange={(checked) =>
                    handleEnableTerm(m.id, !!checked)
                  }
                />
                <Label htmlFor={m.id} className="font-normal cursor-pointer">
                  {m.name}
                </Label>
              </td>
              <td className="p-2">
                <Input
                  type="number"
                  value={m.enabled ? m.percentage : ""}
                  onChange={(e) =>
                    handleMilestoneChange(m.id, "percentage", e.target.value)
                  }
                  onFocus={handleFocus}
                  placeholder="%"
                  disabled={!m.enabled}
                  max={maxPercent} // Dynamically cap the max value
                  // The `readOnly` prop is now REMOVED
                />
              </td>
              <td className="p-2 font-medium">
                {m.enabled ? formatToIndianRupee(m.amount) : "Rs.0"}
              </td>
            </tr>
          );
        })}
        <tr className="border-t bg-gray-50 font-semibold">
          <td className="p-2">Total</td>
          <td className="p-2">{(totalPercentage || 0).toFixed(0)}%</td>
          <td className="p-2">{formatToIndianRupee(totalAmount)}</td>
        </tr>
      </tbody>
    </table>
  );

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl">
        {step === "select" ? renderSelectStep() : renderDetailsStep()}
      </DialogContent>
    </Dialog>
  );
};

