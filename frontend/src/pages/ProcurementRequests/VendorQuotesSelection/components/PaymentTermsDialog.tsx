// src/pages/ProcurementRequests/VendorQuotesSelection/components/PaymentTermsDialog.tsx

// --- Core React and UI Component Imports ---
import React, { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from '@/components/ui/checkbox';
import { PlusCircle, Trash2 } from 'lucide-react';

// --- Type Definitions and Helper Imports ---
import { VendorPaymentTerm, PaymentTermMilestone } from '../types/paymentTerms';
import formatToIndianRupee from '@/utils/FormatPrice';
import { parseNumber } from '@/utils/parseNumber';


// =================================================================================
// --- SECTION 1: COMPONENT DEFINITION AND STATE MANAGEMENT ---
// =================================================================================

// This constant defines the fixed row names for the 'Delivery' type form.
const DELIVERY_TERM_NAMES = ["Advance Payment", "Material Readiness", "After Delivery"];

export const PaymentTermsDialog: React.FC<PaymentTermsDialogProps> = ({
  isOpen, onClose, vendorName, poAmount, initialData, onConfirm
}) => {

  // --- STATE ---
  // This state tracks which view is visible: the initial selection or the detailed form.
  const [step, setStep] = useState<'select' | 'details'>('select');
  // This stores the user's main choice: 'Credit' or 'Delivery against payment'.
  const [type, setType] = useState<VendorPaymentTerm['type'] | null>(null);
  // This is the most important state. It's an array that holds all the data for the payment breakdown table.
  const [milestones, setMilestones] = useState<PaymentTermMilestone[]>([]);
  // This gets today's date in YYYY-MM-DD format, used to prevent selecting past dates.
  const today = new Date().toISOString().split('T')[0];


  // =================================================================================
  // --- SECTION 2: LIFECYCLE AND INITIALIZATION (useEffect) ---
  // =================================================================================

  // This `useEffect` hook runs whenever the dialog is opened (`isOpen` becomes true).
// This `useEffect` hook runs whenever the dialog is opened (`isOpen` becomes true).
useEffect(() => {
    if (isOpen) {
        if (initialData) {
            setType(initialData.type);
            setStep('details');

            if (initialData.type === 'Delivery against payment') {
                const savedTermsMap = new Map(initialData.terms.map(t => [t.name, t]));
                const completeMilestones = DELIVERY_TERM_NAMES.map(name => {
                    const existingTerm = savedTermsMap.get(name);
                    // --- MODIFIED: Use the new, consistent ID format for placeholders ---
                    const placeholderId = `term_${Date.now()}_${name.replace(/\s+/g, '')}`;
                    return existingTerm || { id: placeholderId, name, amount: 0, percentage: 0, enabled: false };
                });
                setMilestones(completeMilestones);
            } else {
                setMilestones(initialData.terms || []);
            }
        } else {
            setStep('select');
            setType(null);
            setMilestones([]);
        }
    }
}, [isOpen, initialData]);

  // =================================================================================
  // --- SECTION 3: DERIVED DATA AND VALIDATION (useMemo) ---
  // =================================================================================

  // These `useMemo` hooks calculate values based on the current state.
  // They are a performance optimization: they only re-run when their dependencies (e.g., `milestones`) change.

  // Calculate the total amount from all *enabled* milestones.
  const totalAmount = useMemo(() => milestones.reduce((sum, m) => sum + (m.enabled ? m.amount : 0), 0), [milestones]);
  // Calculate the total percentage from all *enabled* milestones.
  const totalPercentage = useMemo(() => milestones.reduce((sum, m) => sum + (m.enabled ? m.percentage : 0), 0), [milestones]);
  // A boolean flag that is true only if the total percentage is exactly 100. Used to enable/disable the final confirm button.
  const isTotalValid = useMemo(() => Math.abs(totalPercentage - 100) < 0.01, [totalPercentage]);
  // A boolean flag to detect if the user has entered more than 100%. Used for displaying a specific error message.
  const isOverBudget = useMemo(() => totalPercentage > 100.01, [totalPercentage]);


  // =================================================================================
  // --- SECTION 4: EVENT HANDLERS (The "Logic") ---
  // =================================================================================

  // This function runs when the user clicks "Confirm" on the first step.
const handleTypeSelectionConfirm = () => {
    if (type) {
        if (type === 'Credit') {
            // --- MODIFIED: Use the new, consistent ID format ---
            const newId = `term_${Date.now()}`;
            setMilestones([{ id: newId, name: '1st Payment', amount: 0, percentage: 0, due_date: '', enabled: true }]);
        } else if (type === 'Delivery against payment') {
            // --- MODIFIED: Use the new, consistent ID format for each static term ---
            setMilestones(DELIVERY_TERM_NAMES.map(name => ({
                id: `term_${Date.now()}_${name.replace(/\s+/g, '')}`, // e.g., term_1750..._AdvancePayment
                name, 
                amount: 0, 
                percentage: 0, 
                enabled: false,
            })));
        }
        setStep('details');
    }
};
 // Adds a new, empty row to the table (only for 'Credit' type).
const handleAddMilestone = () => {
    if (type === 'Credit') {
        // --- MODIFIED: Use the new, consistent ID format ---
        const newId = `term_${Date.now()}`;
        setMilestones([...milestones, { id: newId, name: '', amount: 0, percentage: 0, due_date: '', enabled: true }]);
    }
};

  // Removes a row from the table by its unique ID (only for 'Credit' type).
  const handleRemoveMilestone = (id: string) => {
    setMilestones(milestones.filter(m => m.id !== id));
  };

  // Handles the checkbox for the 'Delivery' type.
  const handleEnableTerm = (id: string, checked: boolean) => {
    setMilestones(milestones.map(m => {
      if (m.id === id) {
        // If unchecking, reset the values to 0 to remove them from the total calculation.
        if (!checked) return { ...m, enabled: false, percentage: 0, amount: 0 };
        return { ...m, enabled: true };
      }
      return m;
    }));
  };
// This is the most complex handler. It updates a single field in a single milestone.
const handleMilestoneChange = (id: string, field: keyof PaymentTermMilestone, value: string | number) => {
    setMilestones(milestones.map(m => {
      if (m.id === id) {
        let newMilestone = { ...m, [field]: value };

        // If the 'amount' field was changed in 'Credit' mode...
        if (type === 'Credit' && field === 'amount') {
          // --- NEW LOGIC: Prevent amount from exceeding the PO total ---
          // 1. Calculate the total amount of all *other* milestones.
          const otherMilestonesTotal = milestones.reduce((sum, ms) => {
            if (ms.id !== id) { // Exclude the current milestone from the sum
              return sum + (ms.enabled ? ms.amount : 0);
            }
            return sum;
          }, 0);

          // 2. The maximum allowed for this field is the PO amount minus what's already allocated.
          const maxAllowedForThisField = poAmount - otherMilestonesTotal;

          // 3. Get the new amount the user typed.
          let newAmount = parseNumber(value);

          // 4. "Clamp" the value: If the user enters too much, force it to be the maximum allowed.
          if (newAmount > maxAllowedForThisField) {
            newAmount = maxAllowedForThisField;
          }
          
          // 5. Update the milestone with the (potentially corrected) new amount.
          newMilestone.amount = newAmount;
          newMilestone.percentage = poAmount > 0 ? (newAmount / poAmount) * 100 : 0;
        } 
        // If the 'percentage' field was changed in 'Delivery' mode...
        else if (type === 'Delivery against payment' && field === 'percentage') {
          // ...automatically recalculate the amount.
          const newPercentage = parseNumber(value);
          newMilestone.percentage = newPercentage;
          newMilestone.amount = (newPercentage / 100) * poAmount;
        }
        return newMilestone;
      }
      return m;
    }));
  };
  // Clears the "0" from an input when the user clicks on it, for better UX.
  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    if (e.target.value === '0') e.target.value = '';
  };

  // Bundles up the final, clean data and sends it back to the parent component via the `onConfirm` prop.
  const handleFinalConfirm = () => {
    if (type && isTotalValid) {
      onConfirm({
        type,
        total_po_amount: poAmount,
        terms: milestones.filter(m => m.enabled), // Only include enabled terms in the final data.
      });
      onClose(); // Close the dialog.
    }
  };


  // =================================================================================
  // --- SECTION 5: JSX AND RENDERING (The "View") ---
  // =================================================================================

  // --- SUB-COMPONENT for Step 1 ---
  const renderSelectStep = () => (
    <>
      <DialogHeader><DialogTitle className="text-center">Payment Terms</DialogTitle></DialogHeader>
      <div className="py-8">
        <Label htmlFor="payment-type" className="pr-4">Type* :</Label>
        <Select value={type ?? undefined} onValueChange={(v: VendorPaymentTerm['type']) => setType(v)}>
          <SelectTrigger id="payment-type" className="inline-flex w-auto min-w-[200px]"><SelectValue placeholder="Select Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="Credit">Credit</SelectItem>
            <SelectItem value="Delivery against payment">Delivery against payment</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={handleTypeSelectionConfirm} disabled={!type}>Confirm</Button>
      </DialogFooter>
    </>
  );

  // --- SUB-COMPONENT for Step 2 ---
  const renderDetailsStep = () => (
    <>
      <DialogHeader><DialogTitle>Payment Terms</DialogTitle></DialogHeader>
      <div className="space-y-4 py-4">
        <div>
          <Label htmlFor="payment-type-disabled">Payment Type* :</Label>
          <Input id="payment-type-disabled" value={type || ''} disabled />
        </div>
        <div className="flex justify-between items-center"><Label>PO Amount :</Label><span className="font-semibold text-red-500">{formatToIndianRupee(poAmount)}</span></div>
        <div className="border rounded-md">
          {type === 'Credit' && renderCreditTable()}
          {type === 'Delivery against payment' && renderDeliveryTable()}
        </div>
        {type === 'Credit' && (
          <Button variant="outline" size="sm" onClick={handleAddMilestone} className="w-full">
            <PlusCircle className="mr-2 h-4 w-4" /> Add more
          </Button>
        )}
        <div className="space-y-1">
          <div className="flex justify-between items-center font-medium">
            <Label>Pending Amount :</Label>
            <span className="text-red-500">{isOverBudget ? 'Rs.0' : formatToIndianRupee(poAmount - totalAmount)}</span>
          </div>
          {/* --- MODIFIED: More specific alert messages --- */}
          {!isTotalValid && (
            <div className="flex items-center gap-2 text-xs text-red-500">
              <span className="h-4 w-4 flex items-center justify-center rounded-full border border-red-500">!</span>
              <span>
                {isOverBudget 
                  ? `Total cannot exceed 100%. Current: ${(totalPercentage || 0).toFixed(0)}%` 
                  : 'The total must be exactly 100% to confirm.'}
              </span>
            </div>
          )}
        </div>
      </div>
      <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={handleFinalConfirm} disabled={!isTotalValid}>Confirm</Button></DialogFooter>
    </>
  );

  // This sub-component renders the dynamic table for the 'Credit' type.
const renderCreditTable = () => (
    <table className="w-full text-sm">
      <thead className="bg-gray-100">
          <tr><th className="p-2 text-left font-medium">TERM</th><th className="p-2 text-left font-medium">AMOUNT</th><th className="p-2 text-left font-medium">DUE DATE</th><th className="p-2 text-left font-medium">PERCENTAGE</th><th className="p-2"></th></tr>
      </thead>
      <tbody>
        {milestones.map((m, index) => {
            // --- NEW: Calculate the max allowed for this specific input ---
            const otherMilestonesAmount = totalAmount - (m.enabled ? m.amount : 0);
            const maxAllowed = poAmount - otherMilestonesAmount;

            return (
              <tr key={m.id} className="border-t">
                <td className="p-2"><Input value={m.name} onChange={e => handleMilestoneChange(m.id, 'name', e.target.value)} placeholder={`e.g. ${index + 1}st Payment`} /></td>
                <td className="p-2">
                  <Input 
                    type="number" 
                    value={m.amount} 
                    // --- NEW: Added max attribute and improved handler call ---
                    max={maxAllowed}
                    onChange={e => handleMilestoneChange(m.id, 'amount', e.target.value)} 
                    onFocus={handleFocus} 
                  />
                </td>
                <td className="p-2"><Input type="date" value={m.due_date} min={today} onChange={e => handleMilestoneChange(m.id, 'due_date', e.target.value)} /></td>
                <td className="p-2 text-center">{(m.percentage || 0).toFixed(0)}%</td>
                <td className="p-2 text-center">{milestones.length > 1 && <Button variant="ghost" size="icon" onClick={() => handleRemoveMilestone(m.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>}</td>
              </tr>
            );
        })}
        <tr className="border-t bg-gray-50 font-medium">
            <td className="p-2">Total</td><td className="p-2">{formatToIndianRupee(totalAmount)}</td><td></td><td className="p-2 text-center">{(totalPercentage || 0).toFixed(0)}%</td><td></td>
        </tr>
      </tbody>
    </table>
);

  // --- SUB-COMPONENT for the Delivery Table ---
  const renderDeliveryTable = () => (
    <table className="w-full text-sm">
      <thead className="bg-gray-100">
          <tr><th className="p-2 text-left font-medium w-2/5">TERM</th><th className="p-2 text-left font-medium w-1/4">PERCENTAGE</th><th className="p-2 text-left font-medium w-1/4">AMOUNT</th></tr>
      </thead>
      <tbody>
        {milestones.map(m => (
          <tr key={m.id} className="border-t">
            <td className="p-2 flex items-center gap-2"><Checkbox id={m.id} checked={m.enabled} onCheckedChange={(checked) => handleEnableTerm(m.id, !!checked)} /><Label htmlFor={m.id} className="font-normal cursor-pointer">{m.name}</Label></td>
            <td className="p-2"><Input type="number" value={m.enabled ? m.percentage : ''} onChange={e => handleMilestoneChange(m.id, 'percentage', e.target.value)} onFocus={handleFocus} placeholder="%" disabled={!m.enabled} /></td>
            <td className="p-2 font-medium">{m.enabled ? formatToIndianRupee(m.amount) : 'Rs.0'}</td>
          </tr>
        ))}
        <tr className="border-t bg-gray-50 font-semibold">
            <td className="p-2">Total</td><td className="p-2">{(totalPercentage || 0).toFixed(0)}%</td><td className="p-2">{formatToIndianRupee(totalAmount)}</td>
        </tr>
      </tbody>
    </table>
  );


  // =================================================================================
  // --- SECTION 6: MAIN RENDER ---
  // =================================================================================

  // The main return statement for the entire component. It uses a simple ternary
  // operator to decide which step's sub-component to render.
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl">
        {step === 'select' ? renderSelectStep() : renderDetailsStep()}
      </DialogContent>
    </Dialog>
  );
};