// src/pages/ProjectExpenses/components/EditProjectExpenseDialog.tsx

import React, { useCallback, useEffect, useState, useMemo, useRef } from "react";
import { useFrappeUpdateDoc, useFrappeFileUpload, useFrappeGetDocList } from "frappe-react-sdk";
import { TailSpin } from "react-loader-spinner";
import { formatDate as formatDateFns } from "date-fns";
import { Check, ChevronsUpDown, Download } from "lucide-react";

// --- UI Components ---
import {
    AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
    AlertDialogHeader, AlertDialogTitle, AlertDialogFooter, AlertDialogAction
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { CustomAttachment, AcceptedFileType } from "@/components/helpers/CustomAttachment";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";

// --- Types ---
import { ProjectExpenses } from "@/types/NirmaanStack/ProjectExpenses";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { ExpenseType } from "@/types/NirmaanStack/ExpenseType";

// --- Utils & State ---
import { parseNumber } from "@/utils/parseNumber";
import { useDialogStore } from "@/zustand/useDialogStore";
import { queryKeys, getProjectExpenseTypeListOptions } from "@/config/queryKeys";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { useCEOHoldGuard } from "@/hooks/useCEOHoldGuard";
import SITEURL from "@/constants/siteURL";

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
    payment_ref: string;
    invoice_date: string;
    invoice_ref: string;
}

const AMOUNT_LIMIT = 15000;
const OTHERS_VENDOR_VALUE = "OTHERS_EMPTY_SELECTION";
const DOCTYPE = "Project Expenses";

// Expense types whose amount is user-defined with NO cap (the AMOUNT_LIMIT does not
// apply). Matched as a case-insensitive SUBSTRING of the type's docname / display label,
// so ANY type that includes one of these words is exempt — e.g. "Accommodation Deposit",
// "Staff Accommodation Rent", "Labour Accommodation Rent", or a future plain "Accommodation".
const NO_LIMIT_EXPENSE_TYPE_KEYWORDS = ["accommodation"];
const isUncappedExpenseType = (
    typeId: string,
    options: { value: string; label: string }[]
) => {
    const norm = (s?: string) => (s || "").trim().toLowerCase();
    const label = norm(options.find((o) => o.value === typeId)?.label);
    const id = norm(typeId);
    return NO_LIMIT_EXPENSE_TYPE_KEYWORDS.some((kw) => label.includes(kw) || id.includes(kw));
};
const ATTACHMENT_ACCEPTED_TYPES: AcceptedFileType[] = ["image/*", "application/pdf", "text/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"];

const INITIAL_STATE: FormState = {
    type: "", vendor: "", description: "", comment: "", amount: "",
    payment_date: "", payment_ref: "", invoice_date: "", invoice_ref: "",
};

export const EditProjectExpenseDialog: React.FC<EditProjectExpenseDialogProps> = ({ expenseToEdit, onSuccess }) => {
    const { editProjectExpenseDialog, setEditProjectExpenseDialog } = useDialogStore();
    const { toast } = useToast();
    const [formState, setFormState] = useState<FormState>(INITIAL_STATE);
    const [formErrors, setFormErrors] = useState<Partial<FormState>>({});
    const [newInvoiceFile, setNewInvoiceFile] = useState<File | null>(null);
    const [newPaymentFile, setNewPaymentFile] = useState<File | null>(null);

    // CEO Hold guard - get project from the expense being edited
    const { isCEOHold, showBlockedToast } = useCEOHoldGuard(expenseToEdit?.projects);

    // Payment details are only relevant once the expense leaves the Requested stage.
    const isRequested = (expenseToEdit?.status || "Requested") === "Requested";

    const [expenseTypePopoverOpen, setExpenseTypePopoverOpen] = useState(false);
    const commandListRef = useRef<HTMLDivElement>(null);

    const { updateDoc, loading } = useFrappeUpdateDoc();
    const { upload, loading: uploadLoading } = useFrappeFileUpload();
    const { data: vendorsData, isLoading: vendorsLoading } = useFrappeGetDocList<Vendors>("Vendors", { fields: ["name", "vendor_name"], limit: 0 });
    const expenseTypeFetchOptions = useMemo(() => getProjectExpenseTypeListOptions(), []);
    const { data: expenseTypesData, isLoading: expenseTypesLoading } = useFrappeGetDocList<ExpenseType>("Expense Type", expenseTypeFetchOptions as any, queryKeys.expenseTypes.list(expenseTypeFetchOptions));

    const vendorOptions = useMemo(() => {
        const vendors = vendorsData?.map(v => ({ value: v.name, label: v.vendor_name })) || [];
        return [{ value: OTHERS_VENDOR_VALUE, label: "Others (No Vendor)" }, ...vendors];
    }, [vendorsData]);

    const expenseTypeOptions = useMemo(() => expenseTypesData?.map(et => ({ value: et.name, label: et.expense_name })) || [], [expenseTypesData]);

    useEffect(() => {
        if (editProjectExpenseDialog && expenseToEdit) {
            setFormState({
                type: expenseToEdit.type || "",
                vendor: expenseToEdit.vendor || OTHERS_VENDOR_VALUE,
                description: expenseToEdit.description || "",
                comment: expenseToEdit.comment || "",
                amount: expenseToEdit.amount?.toString() || "",
                payment_date: expenseToEdit.payment_date ? formatDateFns(new Date(expenseToEdit.payment_date), 'yyyy-MM-dd') : "",
                payment_ref: expenseToEdit.payment_ref || "",
                invoice_date: expenseToEdit.invoice_date ? formatDateFns(new Date(expenseToEdit.invoice_date), 'yyyy-MM-dd') : "",
                invoice_ref: expenseToEdit.invoice_ref || "",
            });
            setNewInvoiceFile(null);
            setNewPaymentFile(null);
            setFormErrors({});
            setExpenseTypePopoverOpen(false);
        }
    }, [editProjectExpenseDialog, expenseToEdit]);

    useEffect(() => {
        const commandListElement = commandListRef.current;
        const handleWheel = (e: WheelEvent) => e.stopPropagation();
        if (commandListElement) commandListElement.addEventListener('wheel', handleWheel);
        return () => { if (commandListElement) commandListElement.removeEventListener('wheel', handleWheel); };
    }, [expenseTypePopoverOpen]);

    const handleDialogClose = () => setEditProjectExpenseDialog(false);

    const handleAttachmentError = useCallback(({ message }: { type: "size" | "type", message: string }) => {
        toast({ title: "Attachment Error", description: message, variant: "destructive" });
    }, [toast]);

    const hasInvoiceAttachment = !!newInvoiceFile || !!expenseToEdit?.invoice_attachment;

    const validateForm = useCallback((): boolean => {
        const errors: Partial<FormState> = {};
        if (!formState.type) errors.type = "Expense Type is required.";
        if (!formState.description.trim()) errors.description = "Description is required.";
        if (formState.vendor === "") errors.vendor = "Please select a vendor or 'Others'.";
        if (!isRequested && !formState.payment_date) {
            errors.payment_date = "Payment date is required.";
        }
        // An invoice attachment (existing or newly staged) requires an Invoice Ref.
        if (hasInvoiceAttachment && !formState.invoice_ref.trim()) {
            errors.invoice_ref = "Invoice reference is required when an invoice is attached.";
        }

        const amountValue = parseNumber(formState.amount);
        if (!formState.amount.trim() || isNaN(amountValue)) {
            errors.amount = "A valid amount is required.";
        } else if (!isUncappedExpenseType(formState.type, expenseTypeOptions) && amountValue > AMOUNT_LIMIT) {
            // No cap for user-defined types (e.g. Accommodation); all others cap at AMOUNT_LIMIT.
            errors.amount = `Amount cannot exceed ${formatToRoundedIndianRupee(AMOUNT_LIMIT)}.`;
        }

        setFormErrors(errors);
        return Object.keys(errors).length === 0;
    }, [formState, isRequested, hasInvoiceAttachment, expenseTypeOptions]);

    const handleSubmit = async () => {
        if (isCEOHold) {
            showBlockedToast();
            return;
        }
        if (!validateForm()) {
            toast({ title: "Validation Error", description: "Please fill all required fields correctly.", variant: "destructive" });
            return;
        }
        try {
            const finalVendor = formState.vendor === OTHERS_VENDOR_VALUE ? "" : formState.vendor;
            // Record<string, any>: null is used to CLEAR a field (undefined would be
            // omitted from the payload and Frappe would retain the current value).
            const dataToUpdate: Record<string, any> = {
                type: formState.type,
                vendor: finalVendor,
                description: formState.description.trim(),
                comment: formState.comment.trim(),
                amount: parseNumber(formState.amount),
                invoice_date: formState.invoice_date || null,
                invoice_ref: formState.invoice_ref.trim() || null,
            };
            if (!isRequested) {
                dataToUpdate.payment_date = formState.payment_date;
                dataToUpdate.payment_ref = formState.payment_ref.trim() || null;
            }

            // Upload replacement attachments (doc exists → docname-linked to the doctype).
            if (newInvoiceFile) {
                const uploaded = await upload(newInvoiceFile, { doctype: DOCTYPE, docname: expenseToEdit.name, fieldname: "invoice_attachment", isPrivate: true });
                dataToUpdate.invoice_attachment = uploaded.file_url;
            }
            if (!isRequested && newPaymentFile) {
                const uploaded = await upload(newPaymentFile, { doctype: DOCTYPE, docname: expenseToEdit.name, fieldname: "payment_attachment", isPrivate: true });
                dataToUpdate.payment_attachment = uploaded.file_url;
            }

            await updateDoc(DOCTYPE, expenseToEdit.name, dataToUpdate);
            toast({ title: "Success", description: "Expense updated successfully.", variant: "success" });
            onSuccess?.();
            handleDialogClose();
        } catch (error: any) {
            toast({ title: "Error", description: error.message || "Failed to update expense.", variant: "destructive" });
        }
    };

    const handleInputChange = useCallback((fieldName: keyof FormState, value: string) => {
        setFormState(p => ({ ...p, [fieldName]: value }));
        if (formErrors[fieldName]) {
            setFormErrors(prev => ({ ...prev, [fieldName]: undefined }));
        }
    }, [formErrors]);

    const isLoadingOverall = loading || uploadLoading || vendorsLoading || expenseTypesLoading;
    const isSubmitDisabled = isLoadingOverall || Object.values(formErrors).some(Boolean);
    const selectedExpenseTypeLabel = expenseTypeOptions.find(option => option.value === formState.type)?.label || "Select an expense type...";

    return (
        <AlertDialog open={editProjectExpenseDialog} onOpenChange={(isOpen) => !isOpen && handleDialogClose()}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Edit Project Expense</AlertDialogTitle>
                    <AlertDialogDescription>ID: {expenseToEdit.name}</AlertDialogDescription>
                </AlertDialogHeader>
                <div className="space-y-4 py-2 max-h-[70vh] overflow-y-auto pr-2">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="type_edit" className="text-right">Type <sup className="text-destructive">*</sup></Label>
                        <div className="col-span-3">
                            <Popover open={expenseTypePopoverOpen} onOpenChange={setExpenseTypePopoverOpen}>
                                <PopoverTrigger asChild><Button variant="outline" role="combobox" className={`w-full justify-between ${formErrors.type ? "border-destructive" : ""}`} disabled={isLoadingOverall}>{selectedExpenseTypeLabel}<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" /></Button></PopoverTrigger>
                                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start"><Command><CommandInput placeholder="Search type..." /><CommandList ref={commandListRef} className="max-h-[300px]"><CommandEmpty>No type found.</CommandEmpty><CommandGroup>
                                    {expenseTypeOptions.map((option) => (
                                        <CommandItem key={option.value} value={option.value} onSelect={() => { handleInputChange('type', option.value); setExpenseTypePopoverOpen(false); }}>
                                            <Check className={cn("mr-2 h-4 w-4", formState.type === option.value ? "opacity-100" : "opacity-0")} />{option.label}
                                        </CommandItem>
                                    ))}
                                </CommandGroup></CommandList></Command></PopoverContent>
                            </Popover>
                            {formErrors.type && <p className="text-xs text-destructive mt-1">{formErrors.type}</p>}
                        </div>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="description_edit" className="text-right">Description <sup className="text-destructive">*</sup></Label>
                        <div className="col-span-3">
                            <Textarea id="description_edit" value={formState.description} onChange={(e) => handleInputChange('description', e.target.value)} className={formErrors.description ? "border-destructive" : ""} disabled={isLoadingOverall} />
                            {formErrors.description && <p className="text-xs text-destructive mt-1">{formErrors.description}</p>}
                        </div>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="amount_edit" className="text-right">Amount <sup className="text-destructive">*</sup></Label>
                        <div className="col-span-3">
                            <Input id="amount_edit" type="number" value={formState.amount} onChange={(e) => handleInputChange('amount', e.target.value)} className={formErrors.amount ? "border-destructive" : ""} disabled={isLoadingOverall} />
                            {formErrors.amount && <p className="text-xs text-destructive mt-1">{formErrors.amount}</p>}
                            {isUncappedExpenseType(formState.type, expenseTypeOptions) && <p className="text-xs text-muted-foreground mt-1">No amount limit for this expense type.</p>}
                        </div>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="vendor_edit" className="text-right">Vendor <sup className="text-destructive">*</sup></Label>
                        <div className="col-span-3">
                            <Select value={formState.vendor} onValueChange={(val) => handleInputChange('vendor', val)} disabled={isLoadingOverall}>
                                <SelectTrigger id="vendor_edit" className={formErrors.vendor ? "border-destructive" : ""}><SelectValue placeholder="Select a vendor or 'Others'..." /></SelectTrigger>
                                <SelectContent>{vendorOptions.map(v => <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>)}</SelectContent>
                            </Select>
                            {formErrors.vendor && <p className="text-xs text-destructive mt-1">{formErrors.vendor}</p>}
                        </div>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="comment_edit" className="text-right">Comment</Label>
                        <Textarea id="comment_edit" value={formState.comment} onChange={(e) => handleInputChange('comment', e.target.value)} className="col-span-3" disabled={isLoadingOverall} />
                    </div>

                    {/* Invoice Details (editable in any stage) */}
                    <Separator className="my-1" />
                    <p className="text-sm font-medium">Invoice Details</p>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="invoice_date_edit" className="text-right col-span-1">Invoice Date</Label>
                        <Input id="invoice_date_edit" type="date" value={formState.invoice_date} onChange={(e) => handleInputChange('invoice_date', e.target.value)} max={formatDateFns(new Date(), 'yyyy-MM-dd')} className="col-span-3" disabled={isLoadingOverall} />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="invoice_ref_edit" className="text-right col-span-1">Invoice Ref{hasInvoiceAttachment && <sup className="text-destructive"> *</sup>}</Label>
                        <div className="col-span-3">
                            <Input id="invoice_ref_edit" value={formState.invoice_ref} onChange={(e) => handleInputChange('invoice_ref', e.target.value)} className={formErrors.invoice_ref ? "border-destructive" : ""} disabled={isLoadingOverall} />
                            {formErrors.invoice_ref && <p className="text-xs text-destructive mt-1">{formErrors.invoice_ref}</p>}
                        </div>
                    </div>
                    <div className="grid grid-cols-4 items-start gap-3">
                        <Label className="text-right col-span-1 pt-2">Invoice Attachment</Label>
                        <div className="col-span-3 space-y-2">
                            {expenseToEdit.invoice_attachment && !newInvoiceFile && (
                                <div className="flex items-center gap-2 p-2 bg-muted/60 rounded-md text-sm">
                                    <Download className="h-4 w-4 text-primary flex-shrink-0" />
                                    <a href={SITEURL + expenseToEdit.invoice_attachment} target="_blank" rel="noreferrer" className="truncate hover:underline" title={`View ${expenseToEdit.invoice_attachment.split('/').pop()}`}>{expenseToEdit.invoice_attachment.split('/').pop()}</a>
                                </div>
                            )}
                            <CustomAttachment
                                label={expenseToEdit.invoice_attachment ? "Replace Invoice Attachment" : "Upload Invoice Attachment"}
                                selectedFile={newInvoiceFile}
                                onFileSelect={setNewInvoiceFile}
                                onError={handleAttachmentError}
                                maxFileSize={5 * 1024 * 1024}
                                acceptedTypes={ATTACHMENT_ACCEPTED_TYPES}
                                disabled={isLoadingOverall}
                            />
                        </div>
                    </div>

                    {/* Payment Details — only once past Requested (Approved / Paid) */}
                    {!isRequested && (
                        <>
                            <Separator className="my-1" />
                            <p className="text-sm font-medium">Payment Details</p>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="payment_date_edit" className="text-right col-span-1">Payment Date <sup className="text-destructive">*</sup></Label>
                                <div className="col-span-3">
                                    <Input id="payment_date_edit" type="date" value={formState.payment_date} onChange={(e) => handleInputChange('payment_date', e.target.value)} className={formErrors.payment_date ? "border-destructive" : ""} max={formatDateFns(new Date(), 'yyyy-MM-dd')} disabled={isLoadingOverall} />
                                    {formErrors.payment_date && <p className="text-xs text-destructive mt-1">{formErrors.payment_date}</p>}
                                </div>
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="payment_ref_edit" className="text-right col-span-1">Payment Ref</Label>
                                <Input id="payment_ref_edit" value={formState.payment_ref} onChange={(e) => handleInputChange('payment_ref', e.target.value)} className="col-span-3" disabled={isLoadingOverall} />
                            </div>
                            <div className="grid grid-cols-4 items-start gap-3">
                                <Label className="text-right col-span-1 pt-2">Payment Attachment</Label>
                                <div className="col-span-3 space-y-2">
                                    {expenseToEdit.payment_attachment && !newPaymentFile && (
                                        <div className="flex items-center gap-2 p-2 bg-muted/60 rounded-md text-sm">
                                            <Download className="h-4 w-4 text-primary flex-shrink-0" />
                                            <a href={SITEURL + expenseToEdit.payment_attachment} target="_blank" rel="noreferrer" className="truncate hover:underline" title={`View ${expenseToEdit.payment_attachment.split('/').pop()}`}>{expenseToEdit.payment_attachment.split('/').pop()}</a>
                                        </div>
                                    )}
                                    <CustomAttachment
                                        label={expenseToEdit.payment_attachment ? "Replace Payment Attachment" : "Upload Payment Attachment"}
                                        selectedFile={newPaymentFile}
                                        onFileSelect={setNewPaymentFile}
                                        onError={handleAttachmentError}
                                        maxFileSize={5 * 1024 * 1024}
                                        acceptedTypes={ATTACHMENT_ACCEPTED_TYPES}
                                        disabled={isLoadingOverall}
                                    />
                                </div>
                            </div>
                        </>
                    )}
                </div>
                <AlertDialogFooter>
                    {isLoadingOverall ? <div className="flex justify-end w-full"><TailSpin color="#4f46e5" height={28} width={28} /></div> : <>
                        <AlertDialogCancel asChild><Button variant="outline" type="button" onClick={handleDialogClose}>Cancel</Button></AlertDialogCancel>
                        <AlertDialogAction onClick={(e) => { e.preventDefault(); handleSubmit(); }} disabled={isSubmitDisabled}>Save Changes</AlertDialogAction>
                    </>}
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};
