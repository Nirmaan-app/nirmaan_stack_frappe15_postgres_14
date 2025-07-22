// src/pages/ProjectExpenses/components/NewProjectExpenseDialog.tsx

import React, { useCallback, useEffect, useState, useMemo, useRef } from "react";
import { useFrappeCreateDoc, useFrappeGetDocList, GetDocListArgs, FrappeDoc } from "frappe-react-sdk";
import { TailSpin } from "react-loader-spinner";
import { formatDate as formatDateFns } from "date-fns";
import { Check, ChevronsUpDown } from "lucide-react";

// --- UI Components ---
import {
    AlertDialog, AlertDialogCancel, AlertDialogContent,
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
import ProjectSelect from "@/components/custom-select/project-select"; // Assuming this is your project selector

// --- Types ---
import { ProjectExpenses } from "@/types/NirmaanStack/ProjectExpenses";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers";
import { ExpenseType } from "@/types/NirmaanStack/ExpenseType";

// --- Utils & State ---
import { parseNumber } from "@/utils/parseNumber";
import { useDialogStore } from "@/zustand/useDialogStore";
import { queryKeys, getProjectExpenseTypeListOptions } from "@/config/queryKeys";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

interface NewProjectExpenseDialogProps {
    projectId?: string; // Optional: If provided, this dialog is for a specific project
    onSuccess?: () => void;
}

interface FormState {
    projects: string;
    type: string;
    vendor: string;
    description: string;
    comment: string;
    amount: string;
    payment_date: string;
    payment_by: string;
}

const AMOUNT_LIMIT = 15000;
const OTHERS_VENDOR_VALUE = "OTHERS_EMPTY_SELECTION"; // Unique identifier for "Others" option

const INITIAL_STATE: FormState = {
    projects: "",
    type: "",
    vendor: "",
    description: "",
    comment: "",
    amount: "",
    payment_date: formatDateFns(new Date(), 'yyyy-MM-dd'),
    payment_by: ""
};

export const NewProjectExpenseDialog: React.FC<NewProjectExpenseDialogProps> = ({ projectId, onSuccess }) => {
    const { newProjectExpenseDialog, setNewProjectExpenseDialog } = useDialogStore();
    const { toast } = useToast();

    const [formState, setFormState] = useState<FormState>({ ...INITIAL_STATE, projects: projectId || "" });
    const [formErrors, setFormErrors] = useState<Partial<FormState>>({});
    const [expenseTypePopoverOpen, setExpenseTypePopoverOpen] = useState(false);
    const commandListRef = useRef<HTMLDivElement>(null);

    const { data: vendorsData, isLoading: vendorsLoading } = useFrappeGetDocList<Vendors>("Vendors", { fields: ["name", "vendor_name"], limit: 0 });
    const { data: users, isLoading: usersLoading } = useFrappeGetDocList<NirmaanUsers>("Nirmaan Users", { fields: ["name", "full_name"], limit: 0 });
    const expenseTypeFetchOptions = useMemo(() => getProjectExpenseTypeListOptions(), []);
    const { data: expenseTypesData, isLoading: expenseTypesLoading } = useFrappeGetDocList<ExpenseType>("Expense Type", expenseTypeFetchOptions as any, queryKeys.expenseTypes.list(expenseTypeFetchOptions));

    const { createDoc, loading } = useFrappeCreateDoc();

    // --- Memos for Select Options ---
    const vendorOptions = useMemo(() => {
        const vendors = vendorsData?.map(v => ({ value: v.name, label: v.vendor_name })) || [];
        return [{ value: OTHERS_VENDOR_VALUE, label: "Others (No Vendor)" }, ...vendors];
    }, [vendorsData]);

    const expenseTypeOptions = useMemo(() => expenseTypesData?.map(et => ({ value: et.name, label: et.expense_name })) || [], [expenseTypesData]);

    const handleDialogClose = () => setNewProjectExpenseDialog(false);

    // --- Validation and Submission ---
    const validateForm = useCallback((): boolean => {
        const errors: Partial<FormState> = {};
        if (!formState.projects) errors.projects = "Project is required.";
        if (!formState.type) errors.type = "Expense Type is required.";
        if (!formState.description.trim()) errors.description = "Description is required.";
        if (!formState.payment_by) errors.payment_by = "Paid By user is required.";
        if (!formState.payment_date) errors.payment_date = "Payment date is required.";
        if (formState.vendor === "") errors.vendor = "Please select a vendor or choose 'Others'.";

        const amountValue = parseNumber(formState.amount);
        if (!formState.amount.trim() || isNaN(amountValue)) {
            errors.amount = "A valid amount is required.";
        } else if (amountValue > AMOUNT_LIMIT) {
            errors.amount = `Amount cannot exceed ${formatToRoundedIndianRupee(AMOUNT_LIMIT)}.`;
        }

        setFormErrors(errors);
        return Object.keys(errors).length === 0;
    }, [formState]);

    const handleSubmit = async () => {
        if (!validateForm()) {
            toast({ title: "Validation Error", description: "Please fill all required fields correctly.", variant: "destructive" });
            return;
        }
        try {
            const payload = {
                ...formState,
                vendor: formState.vendor === OTHERS_VENDOR_VALUE ? "" : formState.vendor,
                amount: parseNumber(formState.amount)
            };
            await createDoc("Project Expenses", payload);
            toast({ title: "Success", description: "Project expense recorded successfully.", variant: "success" });
            onSuccess?.();
            handleDialogClose();
        } catch (error: any) {
            toast({ title: "Error", description: error.message || "Failed to record expense.", variant: "destructive" });
        }
    };

    // --- State & Effect Hooks ---
    useEffect(() => {
        if (newProjectExpenseDialog) {
            setFormState({ ...INITIAL_STATE, projects: projectId || "" });
            setFormErrors({});
            setExpenseTypePopoverOpen(false);
        }
    }, [newProjectExpenseDialog, projectId]);

    useEffect(() => {
        const commandListElement = commandListRef.current;
        const handleWheel = (e: WheelEvent) => e.stopPropagation();
        if (commandListElement) commandListElement.addEventListener('wheel', handleWheel);
        return () => { if (commandListElement) commandListElement.removeEventListener('wheel', handleWheel); };
    }, [expenseTypePopoverOpen]);

    const handleInputChange = useCallback((fieldName: keyof FormState, value: string) => {
        setFormState(p => ({ ...p, [fieldName]: value }));
        if (formErrors[fieldName]) {
            setFormErrors(prev => ({ ...prev, [fieldName]: undefined }));
        }
    }, [formErrors]);

    const isLoadingOverall = loading || vendorsLoading || usersLoading || expenseTypesLoading;
    const isSubmitDisabled = isLoadingOverall || Object.values(formErrors).some(Boolean);
    const selectedExpenseTypeLabel = expenseTypeOptions.find(option => option.value === formState.type)?.label || "Select an expense type...";

    return (
        <AlertDialog open={newProjectExpenseDialog} onOpenChange={(isOpen) => !isOpen && handleDialogClose()}>
            <AlertDialogContent className="sm:max-w-lg">
                <AlertDialogHeader><AlertDialogTitle className="text-center">Add New Project Expense</AlertDialogTitle></AlertDialogHeader>
                <div className="space-y-4 py-2 max-h-[70vh] overflow-y-auto pr-2">
                    {!projectId && (
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="project" className="text-right">Project <sup className="text-destructive">*</sup></Label>
                            <div className="col-span-3">
                                <ProjectSelect universal onChange={(selected) => handleInputChange('projects', selected?.value || '')} />
                                {formErrors.projects && <p className="text-xs text-destructive mt-1">{formErrors.projects}</p>}
                            </div>
                        </div>
                    )}
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="type" className="text-right">Type <sup className="text-destructive">*</sup></Label>
                        <div className="col-span-3">
                            <Popover open={expenseTypePopoverOpen} onOpenChange={setExpenseTypePopoverOpen}>
                                <PopoverTrigger asChild>
                                    <Button variant="outline" role="combobox" className={`w-full justify-between ${formErrors.type ? "border-destructive" : ""}`} disabled={isLoadingOverall}>
                                        <span className="truncate">{selectedExpenseTypeLabel}</span><ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                                    <Command><CommandInput placeholder="Search type..." /><CommandList ref={commandListRef} className="max-h-[300px]"><CommandEmpty>No type found.</CommandEmpty><CommandGroup>
                                        {expenseTypeOptions.map((option) => (
                                            <CommandItem key={option.value} value={option.value} onSelect={() => { handleInputChange('type', option.value); setExpenseTypePopoverOpen(false); }}>
                                                <Check className={cn("mr-2 h-4 w-4", formState.type === option.value ? "opacity-100" : "opacity-0")} />{option.label}
                                            </CommandItem>
                                        ))}
                                    </CommandGroup></CommandList></Command>
                                </PopoverContent>
                            </Popover>
                            {formErrors.type && <p className="text-xs text-destructive mt-1">{formErrors.type}</p>}
                        </div>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="description" className="text-right">Description <sup className="text-destructive">*</sup></Label>
                        <div className="col-span-3">
                            <Textarea id="description" value={formState.description} onChange={(e) => handleInputChange('description', e.target.value)} className={formErrors.description ? "border-destructive" : ""} disabled={isLoadingOverall} />
                            {formErrors.description && <p className="text-xs text-destructive mt-1">{formErrors.description}</p>}
                        </div>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="amount" className="text-right">Amount <sup className="text-destructive">*</sup></Label>
                        <div className="col-span-3">
                            <Input id="amount" type="number" value={formState.amount} onChange={(e) => handleInputChange('amount', e.target.value)} className={formErrors.amount ? "border-destructive" : ""} disabled={isLoadingOverall} />
                            {formErrors.amount && <p className="text-xs text-destructive mt-1">{formErrors.amount}</p>}
                        </div>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="vendor" className="text-right">Vendor <sup className="text-destructive">*</sup></Label>
                        <div className="col-span-3">
                            <Select value={formState.vendor} onValueChange={(val) => handleInputChange('vendor', val)} disabled={isLoadingOverall}>
                                <SelectTrigger className={formErrors.vendor ? "border-destructive" : ""}><SelectValue placeholder="Select a vendor or 'Others'..." /></SelectTrigger>
                                <SelectContent>{vendorOptions.map(v => <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>)}</SelectContent>
                            </Select>
                            {formErrors.vendor && <p className="text-xs text-destructive mt-1">{formErrors.vendor}</p>}
                        </div>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="payment_date" className="text-right">Payment Date <sup className="text-destructive">*</sup></Label>
                        <div className="col-span-3">
                            <Input id="payment_date" type="date" value={formState.payment_date} onChange={(e) => handleInputChange('payment_date', e.target.value)} className={formErrors.payment_date ? "border-destructive" : ""} max={formatDateFns(new Date(), 'yyyy-MM-dd')} disabled={isLoadingOverall} />
                            {formErrors.payment_date && <p className="text-xs text-destructive mt-1">{formErrors.payment_date}</p>}
                        </div>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="payment_by" className="text-right">Paid By <sup className="text-destructive">*</sup></Label>
                        <div className="col-span-3">
                            <Select value={formState.payment_by} onValueChange={(val) => handleInputChange('payment_by', val)} disabled={isLoadingOverall}>
                                <SelectTrigger className={formErrors.payment_by ? "border-destructive" : ""}><SelectValue placeholder="Select user..." /></SelectTrigger>
                                <SelectContent>{users?.map(u => <SelectItem key={u.name} value={u.name}>{u.full_name}</SelectItem>)}</SelectContent>
                            </Select>
                            {formErrors.payment_by && <p className="text-xs text-destructive mt-1">{formErrors.payment_by}</p>}
                        </div>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="comment" className="text-right">Comment</Label>
                        <Textarea id="comment" value={formState.comment} onChange={(e) => handleInputChange('comment', e.target.value)} className="col-span-3" disabled={isLoadingOverall} />
                    </div>
                </div>
                <AlertDialogFooter>
                    {isLoadingOverall ? <div className="flex justify-end w-full"><TailSpin color="#4f46e5" height={28} width={28} /></div> : <>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleSubmit} disabled={isSubmitDisabled}>Save Expense</AlertDialogAction>
                    </>}
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};