// src/pages/non-project-expenses/components/EditNonProjectExpense.tsx

import React, { useCallback, useEffect, useState, useMemo } from "react";
import {
    useFrappeUpdateDoc, // Changed from useFrappeCreateDoc
    useFrappeFileUpload,
    useFrappeGetDocList,
    GetDocListArgs,
    FrappeDoc
} from "frappe-react-sdk";
import { TailSpin } from "react-loader-spinner";
import { formatDate as formatDateFns } from "date-fns";
import { Check, ChevronsUpDown, Paperclip, Download as DownloadIcon, X as XIcon, AlertTriangle } from "lucide-react";

// --- UI Components ---
import {
    AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
    AlertDialogHeader, AlertDialogTitle, AlertDialogFooter, AlertDialogAction
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CustomAttachment, AcceptedFileType } from "@/components/helpers/CustomAttachment";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/components/ui/use-toast";
import { Separator } from "@/components/ui/separator";
import {
    Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
    Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import SITEURL from "@/constants/siteURL";

// --- Types ---
import { NonProjectExpenses as NonProjectExpensesType } from "@/types/NirmaanStack/NonProjectExpenses";
import { ExpenseType } from "@/types/NirmaanStack/ExpenseType";

// --- Utils & State ---
import { parseNumber } from "@/utils/parseNumber";
import { useDialogStore } from "@/zustand/useDialogStore";
import { queryKeys, getNonProjectExpenseTypeListOptions } from "@/config/queryKeys";

interface EditExpenseFormState {
    type: string;
    description: string;
    comment: string;
    amount: string;
    payment_date: string;
    payment_ref: string;
    invoice_date: string;
    invoice_ref: string;
}

const ATTACHMENT_ACCEPTED_TYPES: AcceptedFileType[] = ["image/*", "application/pdf", "text/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"];
type AttachmentUpdateAction = "keep" | "replace" | "remove";

interface EditNonProjectExpenseProps {
    expenseToEdit: NonProjectExpensesType;
    onSuccess?: () => void; // To refetch list and close dialog (handled by parent)
}

export const EditNonProjectExpense: React.FC<EditNonProjectExpenseProps> = ({ expenseToEdit, onSuccess }) => {
    const { editNonProjectExpenseDialog, setEditNonProjectExpenseDialog } = useDialogStore();
    const { toast } = useToast();

    const [formState, setFormState] = useState<EditExpenseFormState>({
        type: "", description: "", comment: "", amount: "", payment_date: "", payment_ref: "", invoice_date: "", invoice_ref: ""
    });
    const [formErrors, setFormErrors] = useState<Partial<Record<keyof EditExpenseFormState, string>>>({});

    // Section toggles - initialize based on whether data exists for these sections
    const [recordPaymentDetails, setRecordPaymentDetails] = useState(false);
    const [recordInvoiceDetails, setRecordInvoiceDetails] = useState(false);

    // New files staged for upload
    const [newPaymentAttachmentFile, setNewPaymentAttachmentFile] = useState<File | null>(null);
    const [newInvoiceAttachmentFile, setNewInvoiceAttachmentFile] = useState<File | null>(null);

    // Existing attachment URLs from expenseToEdit
    const [existingPaymentAttachmentUrl, setExistingPaymentAttachmentUrl] = useState<string | undefined>(undefined);
    const [existingInvoiceAttachmentUrl, setExistingInvoiceAttachmentUrl] = useState<string | undefined>(undefined);

    // Actions for attachments
    const [paymentAttachmentAction, setPaymentAttachmentAction] = useState<AttachmentUpdateAction>("keep");
    const [invoiceAttachmentAction, setInvoiceAttachmentAction] = useState<AttachmentUpdateAction>("keep");

    const [expenseTypePopoverOpen, setExpenseTypePopoverOpen] = useState(false);

    const { updateDoc, loading: updateLoading } = useFrappeUpdateDoc(); // Changed
    const { upload, loading: uploadLoading } = useFrappeFileUpload();

    // Initialize form state when expenseToEdit or dialog visibility changes
    useEffect(() => {
        if (editNonProjectExpenseDialog && expenseToEdit) {
            setFormState({
                type: expenseToEdit.type || "",
                description: expenseToEdit.description || "",
                comment: expenseToEdit.comment || "",
                amount: expenseToEdit.amount?.toString() || "",
                payment_date: expenseToEdit.payment_date ? formatDateFns(new Date(expenseToEdit.payment_date), "yyyy-MM-dd") : formatDateFns(new Date(), "yyyy-MM-dd"),
                payment_ref: expenseToEdit.payment_ref || "",
                invoice_date: expenseToEdit.invoice_date ? formatDateFns(new Date(expenseToEdit.invoice_date), "yyyy-MM-dd") : formatDateFns(new Date(), "yyyy-MM-dd"),
                invoice_ref: expenseToEdit.invoice_ref || "",
            });
            // Determine if sections should be initially open
            setRecordPaymentDetails(!!(expenseToEdit.payment_date || expenseToEdit.payment_ref || expenseToEdit.payment_attachment));
            setRecordInvoiceDetails(!!(expenseToEdit.invoice_date || expenseToEdit.invoice_ref || expenseToEdit.invoice_attachment));

            setExistingPaymentAttachmentUrl(expenseToEdit.payment_attachment);
            setExistingInvoiceAttachmentUrl(expenseToEdit.invoice_attachment);

            setPaymentAttachmentAction(expenseToEdit.payment_attachment ? "keep" : "remove");
            setInvoiceAttachmentAction(expenseToEdit.invoice_attachment ? "keep" : "remove");

            setNewPaymentAttachmentFile(null);
            setNewInvoiceAttachmentFile(null);
            setFormErrors({});
            setExpenseTypePopoverOpen(false);
        }
    }, [editNonProjectExpenseDialog, expenseToEdit]);


    const expenseTypeFetchOptions = useMemo(() => getNonProjectExpenseTypeListOptions(), []);
    const expenseTypeQueryKey = queryKeys.expenseTypes.list(expenseTypeFetchOptions);
    const { data: expenseTypesData, isLoading: expenseTypesLoading } = useFrappeGetDocList<ExpenseType>(
        "Expense Type", expenseTypeFetchOptions as GetDocListArgs<FrappeDoc<ExpenseType>>, expenseTypeQueryKey
    );
    const expenseTypeOptionsForCommand = useMemo<Array<{ value: string; label: string }>>(() =>
        expenseTypesData?.map(et => ({ value: et.name, label: et.expense_name })) || [],
        [expenseTypesData]
    );

    const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { /* Same as New... */
        const { name, value } = e.target;
        setFormState(prev => ({ ...prev, [name]: value }));
        if (formErrors[name as keyof EditExpenseFormState]) {
            setFormErrors(prev => ({ ...prev, [name]: undefined }));
        }
    }, [formErrors]);
    const handleExpenseTypeSelect = useCallback((currentValue: string) => { /* Same as New... */
        setFormState(prev => ({ ...prev, type: currentValue === formState.type ? "" : currentValue }));
        setExpenseTypePopoverOpen(false);
        if (formErrors.type && currentValue) {
            setFormErrors(prev => ({ ...prev, type: undefined }));
        }
    }, [formState.type, formErrors.type]);
    const handleAttachmentError = useCallback(({ message }: { type: "size" | "type", message: string }) => { /* Same as New... */
        toast({ title: "Attachment Error", description: message, variant: "destructive", });
    }, [toast]);

    const validateForm = useCallback((): boolean => { /* Same as New... */
        const errors: Partial<Record<keyof EditExpenseFormState, string>> = {};
        if (!formState.type) errors.type = "Expense Type is required.";
        if (!formState.description.trim()) errors.description = "Description is required.";
        if (!formState.amount || parseNumber(formState.amount) <= 0) errors.amount = "A valid amount is required.";
        if (recordPaymentDetails && !formState.payment_date) errors.payment_date = "Payment date is required.";
        if (recordInvoiceDetails && !formState.invoice_date) errors.invoice_date = "Invoice date is required.";
        setFormErrors(errors);
        return Object.keys(errors).length === 0;
    }, [formState, recordPaymentDetails, recordInvoiceDetails]);

    // Attachment Handlers (similar to UpdatePayment/InvoiceDetailsDialog)
    const handleNewPaymentFileSelected = (file: File | null) => {
        setNewPaymentAttachmentFile(file);
        setPaymentAttachmentAction(file ? "replace" : (existingPaymentAttachmentUrl ? "keep" : "remove"));
    };
    const handleRemoveExistingPaymentAttachment = () => {
        setNewPaymentAttachmentFile(null);
        setPaymentAttachmentAction("remove");
    };
    const handleNewInvoiceFileSelected = (file: File | null) => {
        setNewInvoiceAttachmentFile(file);
        setInvoiceAttachmentAction(file ? "replace" : (existingInvoiceAttachmentUrl ? "keep" : "remove"));
    };
    const handleRemoveExistingInvoiceAttachment = () => {
        setNewInvoiceAttachmentFile(null);
        setInvoiceAttachmentAction("remove");
    };

    const handleSubmit = useCallback(async () => {
        if (!validateForm()) {
            toast({ title: "Validation Error", description: "Please correct the form errors.", variant: "destructive" });
            return;
        }

        const dataToUpdate: Partial<NonProjectExpensesType> = {
            type: formState.type,
            description: formState.description.trim(),
            comment: formState.comment.trim() || undefined, // Send null to clear if empty
            amount: parseNumber(formState.amount),
        };

        // Handle Payment Details
        if (recordPaymentDetails) {
            dataToUpdate.payment_date = formState.payment_date;
            dataToUpdate.payment_ref = formState.payment_ref.trim() || null; // Send null to clear
            if (paymentAttachmentAction === "replace" && newPaymentAttachmentFile) {
                const uploaded = await upload(newPaymentAttachmentFile, { doctype: "Non Project Expenses", docname: expenseToEdit.name, fieldname: "payment_attachment", isPrivate: true });
                dataToUpdate.payment_attachment = uploaded.file_url;
            } else if (paymentAttachmentAction === "remove") {
                dataToUpdate.payment_attachment = null;
            }
            // If "keep", don't add payment_attachment to dataToUpdate unless it changed from undefined to null explicitly.
            // If it was undefined and stays undefined, it's fine. If it was a URL and now action is "remove", it's set to null.
        } else { // If section is unchecked, clear related fields
            dataToUpdate.payment_date = null;
            dataToUpdate.payment_ref = null;
            dataToUpdate.payment_attachment = null;
        }

        // Handle Invoice Details
        if (recordInvoiceDetails) {
            dataToUpdate.invoice_date = formState.invoice_date;
            dataToUpdate.invoice_ref = formState.invoice_ref.trim() || null;
            if (invoiceAttachmentAction === "replace" && newInvoiceAttachmentFile) {
                const uploaded = await upload(newInvoiceAttachmentFile, { doctype: "Non Project Expenses", docname: expenseToEdit.name, fieldname: "invoice_attachment", isPrivate: true });
                dataToUpdate.invoice_attachment = uploaded.file_url;
            } else if (invoiceAttachmentAction === "remove") {
                dataToUpdate.invoice_attachment = null;
            }
        } else { // If section is unchecked, clear related fields
            dataToUpdate.invoice_date = null;
            dataToUpdate.invoice_ref = null;
            dataToUpdate.invoice_attachment = null;
        }

        try {
            await updateDoc("Non Project Expenses", expenseToEdit.name, dataToUpdate);
            toast({ title: "Success!", description: "Non-project expense updated successfully!", variant: "success" });
            onSuccess?.(); // This will refetch and close dialog (from parent)
        } catch (error: any) {
            console.error("Error updating non-project expense:", error);
            toast({ title: "Failed!", description: error.message || "Failed to update expense.", variant: "destructive" });
        }
    }, [
        updateDoc, expenseToEdit.name, formState, validateForm, toast, onSuccess, upload,
        recordPaymentDetails, paymentAttachmentAction, newPaymentAttachmentFile,
        recordInvoiceDetails, invoiceAttachmentAction, newInvoiceAttachmentFile
    ]);

    const handleDialogCloseAttempt = useCallback(() => {
        // Reset local form states, but the dialog's open state is controlled by parent via Zustand
        setFormState({ type: "", description: "", comment: "", amount: "", payment_date: "", payment_ref: "", invoice_date: "", invoice_ref: "" });
        setFormErrors({});
        setRecordPaymentDetails(false);
        setRecordInvoiceDetails(false);
        setNewPaymentAttachmentFile(null);
        setNewInvoiceAttachmentFile(null);
        setExistingPaymentAttachmentUrl(undefined);
        setExistingInvoiceAttachmentUrl(undefined);
        setPaymentAttachmentAction("keep");
        setInvoiceAttachmentAction("keep");
        setExpenseTypePopoverOpen(false);
    }, []);


    const isLoadingOverall = updateLoading || uploadLoading || expenseTypesLoading;
    const isSubmitDisabled = isLoadingOverall || !formState.type || !formState.description.trim() || !formState.amount;
    const selectedExpenseTypeLabel = expenseTypeOptionsForCommand.find(option => option.value === formState.type)?.label || "Select Expense Type...";


    // --- Attachment Display Logic (similar to UpdatePaymentDetailsDialog) ---
    const renderAttachmentSection = (
        type: "payment" | "invoice",
        existingUrl: string | undefined,
        newFile: File | null,
        action: AttachmentUpdateAction,
        onNewFileSelected: (file: File | null) => void,
        onRemoveExisting: () => void,
        labelPrefix: string
    ) => {
        let currentAttachmentDisplayNode: React.ReactNode = null;
        const effectiveExistingUrl = (action === "keep" || action === "replace") && existingUrl;

        if (newFile) {
            currentAttachmentDisplayNode = ( /* ... New file display ... */
                <div className="flex items-center justify-between p-2 bg-blue-50 dark:bg-blue-900/30 rounded-md text-sm border border-blue-200 dark:border-blue-700">
                    <div className="flex items-center gap-2 min-w-0"><Paperclip className="h-4 w-4 text-blue-600 dark:text-blue-400 flex-shrink-0" /><span className="truncate" title={newFile.name}>{newFile.name}</span><span className="text-xs text-blue-500 dark:text-blue-500 ml-1 whitespace-nowrap">(New)</span></div>
                </div>
            );
        } else if (effectiveExistingUrl) {
            currentAttachmentDisplayNode = ( /* ... Existing file display ... */
                <div className="flex items-center justify-between p-2 bg-muted/60 rounded-md text-sm">
                    <div className="flex items-center gap-2 min-w-0"><DownloadIcon className="h-4 w-4 text-primary flex-shrink-0" /><a href={SITEURL + effectiveExistingUrl} target="_blank" rel="noopener noreferrer" className="truncate hover:underline" title={`View ${effectiveExistingUrl.split('/').pop()}`}>{effectiveExistingUrl.split('/').pop()}</a></div>
                    <Button variant="ghost" size="icon" onClick={onRemoveExisting} className="h-7 w-7 text-destructive hover:bg-destructive/10"><XIcon className="h-4 w-4" /><span className="sr-only">Remove existing</span></Button>
                </div>
            );
        } else if (action === "remove" && existingUrl) {
            currentAttachmentDisplayNode = ( /* ... Marked for removal ... */
                <div className="flex items-center gap-2 p-2 bg-amber-50 dark:bg-amber-900/30 rounded-md text-sm text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-700">
                    <AlertTriangle className="h-4 w-4 flex-shrink-0" /><span>Attachment will be removed.</span>
                </div>
            );
        }

        return (
            <div className="grid grid-cols-4 items-start gap-3">
                <Label className="text-right col-span-1 pt-2">{labelPrefix} Attachment</Label>
                <div className="col-span-3 space-y-2">
                    {currentAttachmentDisplayNode}
                    {(!newFile && (action === "remove" || !existingUrl)) && (
                        <CustomAttachment label={`Upload New ${labelPrefix} Attachment`} selectedFile={newFile} onFileSelect={onNewFileSelected} onError={handleAttachmentError} maxFileSize={5 * 1024 * 1024} acceptedTypes={ATTACHMENT_ACCEPTED_TYPES} disabled={isLoadingOverall} />
                    )}
                    {!newFile && existingUrl && action === "keep" && (
                        <CustomAttachment label={`Replace ${labelPrefix} Attachment`} selectedFile={null} onFileSelect={onNewFileSelected} onError={handleAttachmentError} maxFileSize={5 * 1024 * 1024} acceptedTypes={ATTACHMENT_ACCEPTED_TYPES} disabled={isLoadingOverall} />
                    )}
                </div>
            </div>
        );
    };


    return (
        <AlertDialog
            open={editNonProjectExpenseDialog}
            onOpenChange={(isOpen) => {
                setEditNonProjectExpenseDialog(isOpen);
                if (!isOpen) handleDialogCloseAttempt();
            }}
        >
            <AlertDialogContent className="max-w-lg">
                <AlertDialogHeader>
                    <AlertDialogTitle className="text-center text-xl">Edit Non-Project Expense</AlertDialogTitle>
                    <AlertDialogDescription className="text-center">ID: {expenseToEdit.name}</AlertDialogDescription>
                    <Separator className="my-3" />
                </AlertDialogHeader>
                <div className="space-y-3 py-1 max-h-[70vh] overflow-y-auto pr-2">
                    {/* Core Details: Type, Description, Amount - Similar to NewNonProjectExpense */}
                    <div className="grid grid-cols-4 items-center gap-3">
                        <Label htmlFor="type_edit_npe_trigger" className="text-right col-span-1">Type <sup className="text-destructive">*</sup></Label>
                        <div className="col-span-3">
                            <Popover open={expenseTypePopoverOpen} onOpenChange={setExpenseTypePopoverOpen}>
                                <PopoverTrigger asChild>
                                    <Button id="type_edit_npe_trigger" variant="outline" role="combobox" aria-expanded={expenseTypePopoverOpen} className="w-full justify-between" disabled={expenseTypesLoading || isLoadingOverall}>
                                        <span className="truncate">{selectedExpenseTypeLabel}</span><ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                                    <Command>
                                        <CommandInput placeholder="Search expense type..." /><CommandList><CommandEmpty>No type found.</CommandEmpty><CommandGroup>
                                            {expenseTypeOptionsForCommand.map((option) => (
                                                <CommandItem key={option.value} value={option.value} onSelect={handleExpenseTypeSelect}>
                                                    <Check className={cn("mr-2 h-4 w-4", formState.type === option.value ? "opacity-100" : "opacity-0")} />{option.label}
                                                </CommandItem>
                                            ))}
                                        </CommandGroup></CommandList>
                                    </Command>
                                </PopoverContent>
                            </Popover>
                            {formErrors.type && <p className="text-xs text-destructive mt-1">{formErrors.type}</p>}
                        </div>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-3">
                        <Label htmlFor="description_edit_npe" className="text-right col-span-1">Description <sup className="text-destructive">*</sup></Label>
                        <Textarea id="description_edit_npe" name="description" value={formState.description} onChange={handleInputChange} className="col-span-3 h-20" disabled={isLoadingOverall} />
                        {formErrors.description && <p className="col-span-3 col-start-2 text-xs text-destructive mt-1">{formErrors.description}</p>}
                    </div>
                    <div className="grid grid-cols-4 items-center gap-3">
                        <Label htmlFor="comment_edit_npe" className="text-right col-span-1">Comment</Label>
                        <Textarea id="comment_edit_npe" name="comment" value={formState.comment} onChange={handleInputChange} className="col-span-3 h-20" disabled={isLoadingOverall} />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-3">
                        <Label htmlFor="amount_edit_npe" className="text-right col-span-1">Amount <sup className="text-destructive">*</sup></Label>
                        <Input id="amount_edit_npe" name="amount" type="number" value={formState.amount} onChange={handleInputChange} className="col-span-3" disabled={isLoadingOverall} />
                        {formErrors.amount && <p className="col-span-3 col-start-2 text-xs text-destructive mt-1">{formErrors.amount}</p>}
                    </div>

                    <Separator className="my-4" />
                    {/* Payment Details Section */}
                    <div className="flex items-center space-x-2">
                        <Checkbox id="recordPaymentDetails_edit_npe" checked={recordPaymentDetails} onCheckedChange={(checked) => setRecordPaymentDetails(Boolean(checked))} disabled={isLoadingOverall} />
                        <Label htmlFor="recordPaymentDetails_edit_npe" className="font-medium">Payment Details</Label>
                    </div>
                    {recordPaymentDetails && (
                        <div className="pl-6 space-y-3 border-l-2 ml-2 mt-2 border-dashed">
                            <div className="grid grid-cols-4 items-center gap-3"> {/* Date */}
                                <Label htmlFor="payment_date_edit_npe" className="text-right col-span-1">Payment Date <sup className="text-destructive">*</sup></Label>
                                <Input id="payment_date_edit_npe" name="payment_date" type="date" value={formState.payment_date} onChange={handleInputChange} max={formatDateFns(new Date(), "yyyy-MM-dd")} className="col-span-3" disabled={isLoadingOverall} />
                                {formErrors.payment_date && <p className="col-span-3 col-start-2 text-xs text-destructive mt-1">{formErrors.payment_date}</p>}
                            </div>
                            <div className="grid grid-cols-4 items-center gap-3"> {/* Ref */}
                                <Label htmlFor="payment_ref_edit_npe" className="text-right col-span-1">Payment Ref</Label>
                                <Input id="payment_ref_edit_npe" name="payment_ref" value={formState.payment_ref} onChange={handleInputChange} className="col-span-3" disabled={isLoadingOverall} />
                            </div>
                            {renderAttachmentSection("payment", existingPaymentAttachmentUrl, newPaymentAttachmentFile, paymentAttachmentAction, handleNewPaymentFileSelected, handleRemoveExistingPaymentAttachment, "Payment")}
                        </div>
                    )}

                    <Separator className="my-4" />
                    {/* Invoice Details Section */}
                    <div className="flex items-center space-x-2">
                        <Checkbox id="recordInvoiceDetails_edit_npe" checked={recordInvoiceDetails} onCheckedChange={(checked) => setRecordInvoiceDetails(Boolean(checked))} disabled={isLoadingOverall} />
                        <Label htmlFor="recordInvoiceDetails_edit_npe" className="font-medium">Invoice Details</Label>
                    </div>
                    {recordInvoiceDetails && (
                        <div className="pl-6 space-y-3 border-l-2 ml-2 mt-2 border-dashed">
                            <div className="grid grid-cols-4 items-center gap-3"> {/* Date */}
                                <Label htmlFor="invoice_date_edit_npe" className="text-right col-span-1">Invoice Date <sup className="text-destructive">*</sup></Label>
                                <Input id="invoice_date_edit_npe" name="invoice_date" type="date" value={formState.invoice_date} onChange={handleInputChange} max={formatDateFns(new Date(), "yyyy-MM-dd")} className="col-span-3" disabled={isLoadingOverall} />
                                {formErrors.invoice_date && <p className="col-span-3 col-start-2 text-xs text-destructive mt-1">{formErrors.invoice_date}</p>}
                            </div>
                            <div className="grid grid-cols-4 items-center gap-3"> {/* Ref */}
                                <Label htmlFor="invoice_ref_edit_npe" className="text-right col-span-1">Invoice Ref</Label>
                                <Input id="invoice_ref_edit_npe" name="invoice_ref" value={formState.invoice_ref} onChange={handleInputChange} className="col-span-3" disabled={isLoadingOverall} />
                            </div>
                            {renderAttachmentSection("invoice", existingInvoiceAttachmentUrl, newInvoiceAttachmentFile, invoiceAttachmentAction, handleNewInvoiceFileSelected, handleRemoveExistingInvoiceAttachment, "Invoice")}
                        </div>
                    )}
                </div>
                <AlertDialogFooter className="pt-4">
                    {isLoadingOverall ? (
                        <div className="flex justify-center w-full"><TailSpin color="#4f46e5" height={28} width={28} /></div>
                    ) : (
                        <>
                            <AlertDialogCancel asChild><Button variant="outline">Cancel</Button></AlertDialogCancel>
                            <AlertDialogAction onClick={handleSubmit} disabled={isSubmitDisabled}>Save Changes</AlertDialogAction>
                        </>
                    )}
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};