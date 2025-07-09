// src/pages/ProjectExpenses/components/NewProjectExpenseDialog.tsx
import React, { useMemo, useEffect, useRef, useState } from "react";
import { useFrappeCreateDoc, useFrappeGetDocList } from "frappe-react-sdk";
import { ProjectExpenses } from "@/types/NirmaanStack/ProjectExpenses";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers";
import { ExpenseType } from "@/types/NirmaanStack/ExpenseType"; // --- (Indicator) NEW: Import ExpenseType ---
import { useDialogStore } from "@/zustand/useDialogStore";
import { parseNumber } from "@/utils/parseNumber";
import { useToast } from "@/components/ui/use-toast";
import { queryKeys, getProjectExpenseTypeListOptions } from "@/config/queryKeys"; // Use correct helper
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TailSpin } from "react-loader-spinner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { formatDate as formatDateFns } from "date-fns";
import { Check, ChevronsUpDown } from "lucide-react";


interface NewProjectExpenseDialogProps {
    projectId: string;
    onSuccess?: () => void;
}

interface FormState {
    type: string; // --- (Indicator) NEW ---
    vendor: string;
    description: string;
    comment: string;
    amount: string;
    payment_date: string;
    payment_by: string;
}

const INITIAL_STATE: FormState = { type: "", vendor: "", description: "", comment: "", amount: "", payment_date: formatDateFns(new Date(), 'yyyy-MM-dd'), payment_by: "" };

export const NewProjectExpenseDialog: React.FC<NewProjectExpenseDialogProps> = ({ projectId, onSuccess }) => {
    const { newProjectExpenseDialog, setNewProjectExpenseDialog } = useDialogStore();
    const { toast } = useToast();
    const [formState, setFormState] = useState<FormState>(INITIAL_STATE);
    const [expenseTypePopoverOpen, setExpenseTypePopoverOpen] = useState(false); // --- (Indicator) NEW ---
    const commandListRef = useRef<HTMLDivElement>(null); // For scroll fix

    // Fetch Expense Types filtered for projects
    const expenseTypeFetchOptions = useMemo(() => getProjectExpenseTypeListOptions(), []);
    const expenseTypeQueryKey = queryKeys.expenseTypes.list(expenseTypeFetchOptions);
    const { data: expenseTypesData, isLoading: expenseTypesLoading } = useFrappeGetDocList<ExpenseType>(
        "Expense Type", expenseTypeFetchOptions as GetDocListArgs<FrappeDoc<ExpenseType>>, expenseTypeQueryKey
    );
    const expenseTypeOptions = useMemo(() =>
        expenseTypesData?.map(et => ({ value: et.name, label: et.expense_name })) || [],
        [expenseTypesData]);

    const { data: vendors } = useFrappeGetDocList<Vendors>("Vendors", { fields: ["name", "vendor_name"], limit: 10000 });
    const { data: users } = useFrappeGetDocList<NirmaanUsers>("Nirmaan Users", { fields: ["name", "full_name"], limit: 1000 });

    const { createDoc, loading } = useFrappeCreateDoc();

    useEffect(() => {
        if (newProjectExpenseDialog) {
            setFormState(INITIAL_STATE);
        }
    }, [newProjectExpenseDialog]);

    // --- (Indicator) FIX: Add an effect to stop scroll propagation ---
    useEffect(() => {
        const commandListElement = commandListRef.current;
        const handleWheel = (e: WheelEvent) => {
            e.stopPropagation();
        };
        if (commandListElement) {
            commandListElement.addEventListener('wheel', handleWheel);
        }
        return () => {
            if (commandListElement) {
                commandListElement.removeEventListener('wheel', handleWheel);
            }
        };
    }, [expenseTypePopoverOpen]); // Re-run this effect when the popover's visibility changes

    const selectedExpenseTypeLabel = expenseTypeOptions.find(option => option.value === formState.type)?.label || "Select an expense type...";

    const handleSubmit = async () => {
        if (!formState.type || !formState.description || !formState.amount || !formState.payment_date || !formState.payment_by) {
            toast({ title: "Missing Fields", description: "Please fill all required fields.", variant: "destructive" });
            return;
        }

        try {
            await createDoc("Project Expenses", {
                ...formState,
                projects: projectId,
                amount: parseNumber(formState.amount)
            });
            toast({ title: "Success", description: "Project expense recorded successfully.", variant: "success" });
            onSuccess?.();
            setNewProjectExpenseDialog(false);
        } catch (error: any) {
            toast({ title: "Error", description: error.message || "Failed to record expense.", variant: "destructive" });
        }
    };

    return (
        <AlertDialog open={newProjectExpenseDialog} onOpenChange={setNewProjectExpenseDialog}>
            <AlertDialogContent>
                <AlertDialogHeader><AlertDialogTitle>Add New Project Expense</AlertDialogTitle></AlertDialogHeader>
                <div className="space-y-4 py-2 max-h-[70vh] overflow-y-auto pr-2">
                    {/* --- (Indicator) NEW: Expense Type Selector --- */}
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="type" className="text-right">Type <sup className="text-destructive">*</sup></Label>
                        <Popover open={expenseTypePopoverOpen} onOpenChange={setExpenseTypePopoverOpen}>
                            <PopoverTrigger asChild>
                                <Button variant="outline" role="combobox" className="col-span-3 justify-between" disabled={expenseTypesLoading}>
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
                    </div>
                </div>
                <div className="space-y-4 py-2">
                    {/* Description */}
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="description" className="text-right">Description <sup className="text-destructive">*</sup></Label>
                        <Textarea id="description" value={formState.description} onChange={(e) => setFormState(p => ({ ...p, description: e.target.value }))} className="col-span-3" />
                    </div>
                    {/* Amount */}
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="amount" className="text-right">Amount <sup className="text-destructive">*</sup></Label>
                        <Input id="amount" type="number" value={formState.amount} onChange={(e) => setFormState(p => ({ ...p, amount: e.target.value }))} className="col-span-3" />
                    </div>
                    {/* Vendor */}
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="vendor" className="text-right">Vendor</Label>
                        <Select value={formState.vendor} onValueChange={(val) => setFormState(p => ({ ...p, vendor: val }))}><SelectTrigger className="col-span-3"><SelectValue placeholder="Select a vendor..." /></SelectTrigger><SelectContent>{vendors?.map(v => <SelectItem key={v.name} value={v.name}>{v.vendor_name}</SelectItem>)}</SelectContent></Select>
                    </div>
                    {/* Payment Date */}
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="payment_date" className="text-right">Payment Date <sup className="text-destructive">*</sup></Label>
                        <Input id="payment_date" type="date" value={formState.payment_date} onChange={(e) => setFormState(p => ({ ...p, payment_date: e.target.value }))} className="col-span-3" max={formatDateFns(new Date(), 'yyyy-MM-dd')} />
                    </div>
                    {/* Paid By */}
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="payment_by" className="text-right">Paid By <sup className="text-destructive">*</sup></Label>
                        <Select value={formState.payment_by} onValueChange={(val) => setFormState(p => ({ ...p, payment_by: val }))}><SelectTrigger className="col-span-3"><SelectValue placeholder="Select user..." /></SelectTrigger><SelectContent>{users?.map(u => <SelectItem key={u.name} value={u.name}>{u.full_name}</SelectItem>)}</SelectContent></Select>
                    </div>
                    {/* Comment */}
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="comment" className="text-right">Comment</Label>
                        <Textarea id="comment" value={formState.comment} onChange={(e) => setFormState(p => ({ ...p, comment: e.target.value }))} className="col-span-3" />
                    </div>
                </div>
                <AlertDialogFooter>
                    {loading ? <div className="flex justify-end w-full"><TailSpin color="#4f46e5" height={28} width={28} /></div> : <>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleSubmit}>Save Expense</AlertDialogAction>
                    </>}
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};