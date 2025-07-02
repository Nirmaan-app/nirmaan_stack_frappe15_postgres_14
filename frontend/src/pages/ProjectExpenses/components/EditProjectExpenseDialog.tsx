// src/pages/ProjectExpenses/components/EditProjectExpenseDialog.tsx

import React, { useCallback, useEffect, useState, useMemo, useRef } from "react";
import { useFrappeUpdateDoc, useFrappeGetDocList, GetDocListArgs, FrappeDoc } from "frappe-react-sdk";
import { TailSpin } from "react-loader-spinner";
import { formatDate as formatDateFns } from "date-fns";
import { Check, ChevronsUpDown } from "lucide-react";

// --- UI Components ---
import {
    AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
    AlertDialogHeader, AlertDialogTitle, AlertDialogFooter, AlertDialogAction
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";

// --- Types ---
import { ProjectExpenses } from "@/types/NirmaanStack/ProjectExpenses";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers";
import { ExpenseType } from "@/types/NirmaanStack/ExpenseType";

// --- Utils & State ---
import { parseNumber } from "@/utils/parseNumber";
import { useDialogStore } from "@/zustand/useDialogStore";
import { queryKeys, getProjectExpenseTypeListOptions } from "@/config/queryKeys"; // Correct helper for types

interface EditProjectExpenseDialogProps {
    expenseToEdit: ProjectExpenses;
    onSuccess?: () => void;
}

interface FormState {
    type: string;
    vendor: string;
    description: string;
    comment: string;
    amount: string;
    payment_date: string;
    payment_by: string;
}

export const EditProjectExpenseDialog: React.FC<EditProjectExpenseDialogProps> = ({ expenseToEdit, onSuccess }) => {
    const { editProjectExpenseDialog, setEditProjectExpenseDialog } = useDialogStore();
    const { toast } = useToast();
    const [formState, setFormState] = useState<FormState>({ type: "", vendor: "", description: "", comment: "", amount: "", payment_date: "", payment_by: "" });
    const [formErrors, setFormErrors] = useState<Partial<FormState>>({});

    const [expenseTypePopoverOpen, setExpenseTypePopoverOpen] = useState(false);
    const commandListRef = useRef<HTMLDivElement>(null);

    const { updateDoc, loading } = useFrappeUpdateDoc();
    const { data: vendors, isLoading: vendorsLoading } = useFrappeGetDocList<Vendors>("Vendors", { fields: ["name", "vendor_name"], limit: 10000 });
    const { data: users, isLoading: usersLoading } = useFrappeGetDocList<NirmaanUsers>("Nirmaan Users", { fields: ["name", "full_name"], limit: 1000 });

    const expenseTypeFetchOptions = useMemo(() => getProjectExpenseTypeListOptions(), []);
    const expenseTypeQueryKey = queryKeys.expenseTypes.list(expenseTypeFetchOptions);
    const { data: expenseTypesData, isLoading: expenseTypesLoading } = useFrappeGetDocList<ExpenseType>(
        "Expense Type", expenseTypeFetchOptions as GetDocListArgs<FrappeDoc<ExpenseType>>, expenseTypeQueryKey
    );

    const expenseTypeOptions = useMemo(() =>
        expenseTypesData?.map(et => ({ value: et.name, label: et.expense_name })) || [],
        [expenseTypesData]);

    useEffect(() => {
        if (editProjectExpenseDialog && expenseToEdit) {
            setFormState({
                type: expenseToEdit.type || "",
                vendor: expenseToEdit.vendor || "",
                description: expenseToEdit.description || "",
                comment: expenseToEdit.comment || "",
                amount: expenseToEdit.amount?.toString() || "",
                payment_date: expenseToEdit.payment_date ? formatDateFns(new Date(expenseToEdit.payment_date), 'yyyy-MM-dd') : "",
                payment_by: expenseToEdit.payment_by || "",
            });
            setFormErrors({});
            setExpenseTypePopoverOpen(false);
        }
    }, [editProjectExpenseDialog, expenseToEdit]);

    // Scroll fix effect
    useEffect(() => {
        const commandListElement = commandListRef.current;
        const handleWheel = (e: WheelEvent) => e.stopPropagation();
        if (commandListElement) commandListElement.addEventListener('wheel', handleWheel);
        return () => { if (commandListElement) commandListElement.removeEventListener('wheel', handleWheel); };
    }, [expenseTypePopoverOpen]);

    const handleDialogClose = () => {
        setEditProjectExpenseDialog(false);
    };

    const validateForm = (): boolean => {
        const errors: Partial<FormState> = {};
        if (!formState.type) errors.type = "Expense Type is required.";
        if (!formState.description.trim()) errors.description = "Description is required.";
        if (!formState.amount || parseNumber(formState.amount) <= 0) errors.amount = "A valid amount is required.";
        if (!formState.payment_date) errors.payment_date = "Payment date is required.";
        if (!formState.payment_by) errors.payment_by = "Paid By user is required.";
        setFormErrors(errors);
        return Object.keys(errors).length === 0;
    };

    const handleSubmit = async () => {
        if (!validateForm()) {
            toast({ title: "Validation Error", description: "Please fill all required fields.", variant: "destructive" });
            return;
        }
        try {
            await updateDoc("Project Expenses", expenseToEdit.name, {
                ...formState,
                amount: parseNumber(formState.amount)
            });
            toast({ title: "Success", description: "Expense updated successfully.", variant: "success" });
            onSuccess?.();
            handleDialogClose();
        } catch (error: any) {
            toast({ title: "Error", description: error.message || "Failed to update expense.", variant: "destructive" });
        }
    };

    const isLoadingOverall = loading || vendorsLoading || usersLoading || expenseTypesLoading;
    const selectedExpenseTypeLabel = expenseTypeOptions.find(option => option.value === formState.type)?.label || "Select an expense type...";

    return (
        <AlertDialog open={editProjectExpenseDialog} onOpenChange={(isOpen) => !isOpen && handleDialogClose()}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Edit Project Expense</AlertDialogTitle>
                    <AlertDialogDescription>ID: {expenseToEdit.name}</AlertDialogDescription>
                </AlertDialogHeader>
                <div className="space-y-4 py-2 max-h-[70vh] overflow-y-auto pr-2">
                    {/* Type */}
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="type_edit" className="text-right">Type <sup className="text-destructive">*</sup></Label>
                        <Popover open={expenseTypePopoverOpen} onOpenChange={setExpenseTypePopoverOpen}>
                            <PopoverTrigger asChild>
                                <Button id="type_edit" variant="outline" role="combobox" className="col-span-3 justify-between" disabled={isLoadingOverall}>
                                    <span className="truncate">{selectedExpenseTypeLabel}</span><ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                                <Command>
                                    <CommandInput placeholder="Search type..." />
                                    <CommandList ref={commandListRef} className="max-h-[300px]">
                                        <CommandEmpty>No type found.</CommandEmpty>
                                        <CommandGroup>
                                            {expenseTypeOptions.map((option) => (
                                                <CommandItem key={option.value} value={option.value} onSelect={(val) => { setFormState(p => ({ ...p, type: val })); setExpenseTypePopoverOpen(false); }}>
                                                    <Check className={cn("mr-2 h-4 w-4", formState.type === option.value ? "opacity-100" : "opacity-0")} />
                                                    {option.label}
                                                </CommandItem>
                                            ))}
                                        </CommandGroup>
                                    </CommandList>
                                </Command>
                            </PopoverContent>
                        </Popover>
                        {formErrors.type && <p className="col-span-3 col-start-2 text-xs text-destructive mt-1">{formErrors.type}</p>}
                    </div>
                    {/* Description */}
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="description_edit" className="text-right">Description <sup className="text-destructive">*</sup></Label>
                        <Textarea id="description_edit" value={formState.description} onChange={(e) => setFormState(p => ({ ...p, description: e.target.value }))} className="col-span-3" disabled={isLoadingOverall} />
                        {formErrors.description && <p className="col-span-3 col-start-2 text-xs text-destructive mt-1">{formErrors.description}</p>}
                    </div>
                    {/* Amount */}
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="amount_edit" className="text-right">Amount <sup className="text-destructive">*</sup></Label>
                        <Input id="amount_edit" type="number" value={formState.amount} onChange={(e) => setFormState(p => ({ ...p, amount: e.target.value }))} className="col-span-3" disabled={isLoadingOverall} />
                        {formErrors.amount && <p className="col-span-3 col-start-2 text-xs text-destructive mt-1">{formErrors.amount}</p>}
                    </div>
                    {/* Vendor */}
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="vendor_edit" className="text-right">Vendor</Label>
                        <Select value={formState.vendor} onValueChange={(val) => setFormState(p => ({ ...p, vendor: val }))} disabled={isLoadingOverall}>
                            <SelectTrigger id="vendor_edit" className="col-span-3"><SelectValue placeholder="Select a vendor..." /></SelectTrigger>
                            <SelectContent>{vendors?.map(v => <SelectItem key={v.name} value={v.name}>{v.vendor_name}</SelectItem>)}</SelectContent>
                        </Select>
                    </div>
                    {/* Payment Date */}
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="payment_date_edit" className="text-right">Payment Date <sup className="text-destructive">*</sup></Label>
                        <Input id="payment_date_edit" type="date" value={formState.payment_date} onChange={(e) => setFormState(p => ({ ...p, payment_date: e.target.value }))} className="col-span-3" max={formatDateFns(new Date(), 'yyyy-MM-dd')} disabled={isLoadingOverall} />
                        {formErrors.payment_date && <p className="col-span-3 col-start-2 text-xs text-destructive mt-1">{formErrors.payment_date}</p>}
                    </div>
                    {/* Paid By */}
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="payment_by_edit" className="text-right">Paid By <sup className="text-destructive">*</sup></Label>
                        <Select value={formState.payment_by} onValueChange={(val) => setFormState(p => ({ ...p, payment_by: val }))} disabled={isLoadingOverall}>
                            <SelectTrigger id="payment_by_edit" className="col-span-3"><SelectValue placeholder="Select user..." /></SelectTrigger>
                            <SelectContent>{users?.map(u => <SelectItem key={u.name} value={u.name}>{u.full_name}</SelectItem>)}</SelectContent>
                        </Select>
                        {formErrors.payment_by && <p className="col-span-3 col-start-2 text-xs text-destructive mt-1">{formErrors.payment_by}</p>}
                    </div>
                    {/* Comment */}
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="comment_edit" className="text-right">Comment</Label>
                        <Textarea id="comment_edit" value={formState.comment} onChange={(e) => setFormState(p => ({ ...p, comment: e.target.value }))} className="col-span-3" disabled={isLoadingOverall} />
                    </div>
                </div>
                <AlertDialogFooter>
                    {loading ? <div className="flex justify-end w-full"><TailSpin color="#4f46e5" height={28} width={28} /></div> : <>
                        <AlertDialogCancel asChild><Button variant="outline" type="button" onClick={handleDialogClose}>Cancel</Button></AlertDialogCancel>
                        <AlertDialogAction onClick={handleSubmit}>Save Changes</AlertDialogAction>
                    </>}
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};