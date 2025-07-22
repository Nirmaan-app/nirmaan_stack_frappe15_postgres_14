// src/pages/non-project-expenses/components/NewNonProjectExpense.tsx

import React, { useCallback, useEffect, useState, useMemo } from "react";
import {
    useFrappeCreateDoc,
    useFrappeFileUpload,
    useFrappeGetDocList,
    GetDocListArgs,
    FrappeDoc
} from "frappe-react-sdk";
import { TailSpin } from "react-loader-spinner";
import { formatDate as formatDateFns } from "date-fns";
import { Check, ChevronsUpDown } from "lucide-react"; // Icons for Combobox

// --- UI Components ---
import {
    AlertDialog, AlertDialogCancel, AlertDialogContent,
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
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils"; // For shadcn classnames

// --- Types ---
import { NonProjectExpenses as NonProjectExpensesType } from "@/types/NirmaanStack/NonProjectExpenses";
import { ExpenseType } from "@/types/NirmaanStack/ExpenseType";

// --- Utils & State ---
import { parseNumber } from "@/utils/parseNumber";
import { useDialogStore } from "@/zustand/useDialogStore";
import { queryKeys, getNonProjectExpenseTypeListOptions } from "@/config/queryKeys";

interface NewExpenseFormState {
    type: string; // Will store the value (ID) of the selected ExpenseType
    description: string;
    comment: string;
    amount: string;
    payment_date: string;
    payment_ref: string;
    invoice_date: string;
    invoice_ref: string;
}

const INITIAL_FORM_STATE: NewExpenseFormState = {
    type: "",
    description: "",
    comment: "",
    amount: "",
    payment_date: formatDateFns(new Date(), "yyyy-MM-dd"),
    payment_ref: "",
    invoice_date: formatDateFns(new Date(), "yyyy-MM-dd"),
    invoice_ref: "",
};

const ATTACHMENT_ACCEPTED_TYPES: AcceptedFileType[] = ["image/*", "application/pdf", "text/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"];

interface NewNonProjectExpenseProps {
    refetchList?: () => void;
}

export const NewNonProjectExpense: React.FC<NewNonProjectExpenseProps> = ({ refetchList }) => {
    const { newNonProjectExpenseDialog, toggleNewNonProjectExpenseDialog, setNewNonProjectExpenseDialog } = useDialogStore();
    const { toast } = useToast();

    const [formState, setFormState] = useState<NewExpenseFormState>(INITIAL_FORM_STATE);
    const [formErrors, setFormErrors] = useState<Partial<Record<keyof NewExpenseFormState, string>>>({});

    const [recordPaymentDetails, setRecordPaymentDetails] = useState(true);
    const [recordInvoiceDetails, setRecordInvoiceDetails] = useState(false);

    const [paymentAttachmentFile, setPaymentAttachmentFile] = useState<File | null>(null);
    const [invoiceAttachmentFile, setInvoiceAttachmentFile] = useState<File | null>(null);

    // State for the Expense Type Popover/Command
    const [expenseTypePopoverOpen, setExpenseTypePopoverOpen] = useState(false);

    const { createDoc, loading: createLoading } = useFrappeCreateDoc();
    const { upload, loading: uploadLoading } = useFrappeFileUpload();

    const expenseTypeFetchOptions = useMemo(() => getNonProjectExpenseTypeListOptions(), []);
    const expenseTypeQueryKey = queryKeys.expenseTypes.list(expenseTypeFetchOptions);
    const { data: expenseTypesData, isLoading: expenseTypesLoading } = useFrappeGetDocList<ExpenseType>(
        "Expense Type", expenseTypeFetchOptions as GetDocListArgs<FrappeDoc<ExpenseType>>, expenseTypeQueryKey
    );

    // Prepare options for the Command component { value: string, label: string }
    const expenseTypeOptionsForCommand = useMemo<Array<{ value: string; label: string }>>(() =>
        expenseTypesData?.map(et => ({ value: et.name, label: et.expense_name })) || [],
        [expenseTypesData]
    );

    const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormState(prev => ({ ...prev, [name]: value }));
        if (formErrors[name as keyof NewExpenseFormState]) {
            setFormErrors(prev => ({ ...prev, [name]: undefined }));
        }
    }, [formErrors]);

    // Handler for Expense Type selection from CommandItem
    const handleExpenseTypeSelect = useCallback((currentValue: string) => {
        setFormState(prev => ({ ...prev, type: currentValue === formState.type ? "" : currentValue }));
        setExpenseTypePopoverOpen(false);
        if (formErrors.type && currentValue) {
            setFormErrors(prev => ({ ...prev, type: undefined }));
        }
    }, [formState.type, formErrors.type]);


    const handleAttachmentError = useCallback(({ message }: { type: "size" | "type", message: string }) => {
        toast({
            title: "Attachment Error",
            description: message,
            variant: "destructive",
        });
    }, [toast]);

    const validateForm = useCallback((): boolean => {
        const errors: Partial<Record<keyof NewExpenseFormState, string>> = {};
        if (!formState.type) errors.type = "Expense Type is required.";
        if (!formState.description.trim()) errors.description = "Description is required.";
        if (!formState.amount || parseNumber(formState.amount) <= 0) errors.amount = "A valid amount is required.";

        if (recordPaymentDetails) {
            if (!formState.payment_date) errors.payment_date = "Payment date is required.";
        }
        if (recordInvoiceDetails) {
            if (!formState.invoice_date) errors.invoice_date = "Invoice date is required.";
        }
        setFormErrors(errors);
        return Object.keys(errors).length === 0;
    }, [formState, recordPaymentDetails, recordInvoiceDetails]);

    const handleSubmit = useCallback(async () => {
        if (!validateForm()) {
            toast({ title: "Validation Error", description: "Please correct the form errors.", variant: "destructive" });
            return;
        }

        let paymentAttachmentUrl: string | undefined = undefined;
        let invoiceAttachmentUrl: string | undefined = undefined;

        try {
            // Attachment upload logic (same as before)
            if (recordPaymentDetails && paymentAttachmentFile) {
                const uploadedFile = await upload(paymentAttachmentFile, { doctype: "Non Project Expenses", isPrivate: true, fieldname: "payment_attachment" });
                paymentAttachmentUrl = uploadedFile.file_url;
            }
            if (recordInvoiceDetails && invoiceAttachmentFile) {
                const uploadedFile = await upload(invoiceAttachmentFile, { doctype: "Non Project Expenses", isPrivate: true, fieldname: "invoice_attachment" });
                invoiceAttachmentUrl = uploadedFile.file_url;
            }

            const docToCreate: Partial<NonProjectExpensesType> = {
                type: formState.type,
                description: formState.description.trim(),
                comment: formState.comment.trim() || undefined,
                amount: parseNumber(formState.amount),
                ...(recordPaymentDetails && { payment_date: formState.payment_date, payment_ref: formState.payment_ref.trim() || undefined, payment_attachment: paymentAttachmentUrl }),
                ...(recordInvoiceDetails && { invoice_date: formState.invoice_date, invoice_ref: formState.invoice_ref.trim() || undefined, invoice_attachment: invoiceAttachmentUrl }),
            };

            await createDoc("Non Project Expenses", docToCreate);
            toast({ title: "Success!", description: "Non-project expense added successfully!", variant: "success" });
            refetchList?.();
            closeDialogAndReset();
        } catch (error: any) {
            console.error("Error adding non-project expense:", error);
            toast({ title: "Failed!", description: error.message || "Failed to add expense.", variant: "destructive" });
        }
    }, [
        createDoc, formState, validateForm, toast, refetchList, toggleNewNonProjectExpenseDialog, upload,
        recordPaymentDetails, paymentAttachmentFile, recordInvoiceDetails, invoiceAttachmentFile
    ]);

    const closeDialogAndReset = useCallback(() => {
        setFormState(INITIAL_FORM_STATE);
        setFormErrors({});
        setRecordPaymentDetails(false);
        setRecordInvoiceDetails(false);
        setPaymentAttachmentFile(null);
        setInvoiceAttachmentFile(null);
        setExpenseTypePopoverOpen(false); // Close popover on dialog close
        setNewNonProjectExpenseDialog(false); // Use the setter
    }, [setNewNonProjectExpenseDialog]);

    useEffect(() => {
        if (newNonProjectExpenseDialog) {
            setFormState(INITIAL_FORM_STATE);
            setFormErrors({});
            setRecordPaymentDetails(true);
            setRecordInvoiceDetails(false);
            setPaymentAttachmentFile(null);
            setInvoiceAttachmentFile(null);
            setExpenseTypePopoverOpen(false);
        }
    }, [newNonProjectExpenseDialog]);

    const isLoadingOverall = createLoading || uploadLoading || expenseTypesLoading;
    const isSubmitDisabled = isLoadingOverall || !formState.type || !formState.description.trim() || !formState.amount || !formState.payment_date;

    const selectedExpenseTypeLabel = expenseTypeOptionsForCommand.find(option => option.value === formState.type)?.label || "Select Expense Type...";

    return (
        <AlertDialog open={newNonProjectExpenseDialog} onOpenChange={(isOpen) => !isOpen && closeDialogAndReset()}>
            <AlertDialogContent className="max-w-lg">
                <AlertDialogHeader>
                    <AlertDialogTitle className="text-center text-xl">Record New Non-Project Expense</AlertDialogTitle>
                    <Separator className="my-3" />
                </AlertDialogHeader>
                <div className="space-y-3 py-1 max-h-[70vh] overflow-y-auto pr-2">
                    {/* Core Details */}
                    <div className="grid grid-cols-4 items-center gap-3">
                        <Label htmlFor="type_new_npe_trigger" className="text-right col-span-1">Type <sup className="text-destructive">*</sup></Label>
                        <div className="col-span-3">
                            <Popover open={expenseTypePopoverOpen} onOpenChange={setExpenseTypePopoverOpen}>
                                <PopoverTrigger asChild>
                                    <Button
                                        id="type_new_npe_trigger"
                                        variant="outline"
                                        role="combobox"
                                        aria-expanded={expenseTypePopoverOpen}
                                        className="w-full justify-between"
                                        disabled={expenseTypesLoading || isLoadingOverall}
                                    >
                                        <span className="truncate">{selectedExpenseTypeLabel}</span>
                                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                                    <Command>
                                        <CommandInput placeholder="Search expense type..." />
                                        <CommandList>
                                            <CommandEmpty>No expense type found.</CommandEmpty>
                                            <CommandGroup>
                                                {expenseTypeOptionsForCommand.map((option) => (
                                                    <CommandItem
                                                        key={option.value}
                                                        value={option.value}
                                                        onSelect={handleExpenseTypeSelect}
                                                    >
                                                        <Check
                                                            className={cn(
                                                                "mr-2 h-4 w-4",
                                                                formState.type === option.value ? "opacity-100" : "opacity-0"
                                                            )}
                                                        />
                                                        {option.label}
                                                    </CommandItem>
                                                ))}
                                            </CommandGroup>
                                        </CommandList>
                                    </Command>
                                </PopoverContent>
                            </Popover>
                            {formErrors.type && <p className="text-xs text-destructive mt-1">{formErrors.type}</p>}
                        </div>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-3">
                        <Label htmlFor="description_new_npe" className="text-right col-span-1">Description <sup className="text-destructive">*</sup></Label>
                        <Textarea id="description_new_npe" name="description" value={formState.description} onChange={handleInputChange} className="col-span-3 h-20" disabled={isLoadingOverall} />
                        {formErrors.description && <p className="col-span-3 col-start-2 text-xs text-destructive mt-1">{formErrors.description}</p>}
                    </div>
                    <div className="grid grid-cols-4 items-center gap-3">
                        <Label htmlFor="comment_new_npe" className="text-right col-span-1">Comment</Label>
                        <Textarea id="comment_new_npe" name="comment" value={formState.comment} onChange={handleInputChange} className="col-span-3 h-20" disabled={isLoadingOverall} />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-3">
                        <Label htmlFor="amount_new_npe" className="text-right col-span-1">Amount <sup className="text-destructive">*</sup></Label>
                        <Input id="amount_new_npe" name="amount" type="number" value={formState.amount} onChange={handleInputChange} className="col-span-3" disabled={isLoadingOverall} />
                        {formErrors.amount && <p className="col-span-3 col-start-2 text-xs text-destructive mt-1">{formErrors.amount}</p>}
                    </div>

                    <Separator className="my-4" />

                    {/* Payment Details */}
                    <div className="flex items-center space-x-2">
                        <Checkbox id="recordPaymentDetails_new_npe" checked={recordPaymentDetails} onCheckedChange={(checked) => setRecordPaymentDetails(Boolean(checked))} disabled={isLoadingOverall} />
                        <Label htmlFor="recordPaymentDetails_new_npe" className="font-medium">Record Payment Details</Label>
                    </div>
                    {recordPaymentDetails && (
                        <div className="pl-6 space-y-3 border-l-2 ml-2 mt-2 border-dashed">
                            <div className="grid grid-cols-4 items-center gap-3">
                                <Label htmlFor="payment_date_new_npe" className="text-right col-span-1">Payment Date <sup className="text-destructive">*</sup></Label>
                                <Input id="payment_date_new_npe" name="payment_date" type="date" value={formState.payment_date} onChange={handleInputChange} max={formatDateFns(new Date(), "yyyy-MM-dd")} className="col-span-3" disabled={isLoadingOverall} />
                                {formErrors.payment_date && <p className="col-span-3 col-start-2 text-xs text-destructive mt-1">{formErrors.payment_date}</p>}
                            </div>
                            <div className="grid grid-cols-4 items-center gap-3">
                                <Label htmlFor="payment_ref_new_npe" className="text-right col-span-1">Payment Ref</Label>
                                <Input id="payment_ref_new_npe" name="payment_ref" value={formState.payment_ref} onChange={handleInputChange} className="col-span-3" disabled={isLoadingOverall} />
                            </div>
                            <div className="grid grid-cols-4 items-start gap-3">
                                <Label className="text-right col-span-1 pt-2">Payment Attachment</Label>
                                <div className="col-span-3">
                                    <CustomAttachment
                                        label="Upload Payment Proof"
                                        selectedFile={paymentAttachmentFile}
                                        onFileSelect={setPaymentAttachmentFile}
                                        onError={handleAttachmentError}
                                        maxFileSize={5 * 1024 * 1024}
                                        acceptedTypes={ATTACHMENT_ACCEPTED_TYPES}
                                        disabled={isLoadingOverall}
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    <Separator className="my-4" />

                    {/* Invoice Details */}
                    <div className="flex items-center space-x-2">
                        <Checkbox id="recordInvoiceDetails_new_npe" checked={recordInvoiceDetails} onCheckedChange={(checked) => setRecordInvoiceDetails(Boolean(checked))} disabled={isLoadingOverall} />
                        <Label htmlFor="recordInvoiceDetails_new_npe" className="font-medium">Record Invoice Details</Label>
                    </div>
                    {recordInvoiceDetails && (
                        <div className="pl-6 space-y-3 border-l-2 ml-2 mt-2 border-dashed">
                            <div className="grid grid-cols-4 items-center gap-3">
                                <Label htmlFor="invoice_date_new_npe" className="text-right col-span-1">Invoice Date <sup className="text-destructive">*</sup></Label>
                                <Input id="invoice_date_new_npe" name="invoice_date" type="date" value={formState.invoice_date} onChange={handleInputChange} max={formatDateFns(new Date(), "yyyy-MM-dd")} className="col-span-3" disabled={isLoadingOverall} />
                                {formErrors.invoice_date && <p className="col-span-3 col-start-2 text-xs text-destructive mt-1">{formErrors.invoice_date}</p>}
                            </div>
                            <div className="grid grid-cols-4 items-center gap-3">
                                <Label htmlFor="invoice_ref_new_npe" className="text-right col-span-1">Invoice Ref</Label>
                                <Input id="invoice_ref_new_npe" name="invoice_ref" value={formState.invoice_ref} onChange={handleInputChange} className="col-span-3" disabled={isLoadingOverall} />
                            </div>
                            <div className="grid grid-cols-4 items-start gap-3">
                                <Label className="text-right col-span-1 pt-2">Invoice Attachment</Label>
                                <div className="col-span-3">
                                    <CustomAttachment
                                        label="Upload Invoice Document"
                                        selectedFile={invoiceAttachmentFile}
                                        onFileSelect={setInvoiceAttachmentFile}
                                        onError={handleAttachmentError}
                                        maxFileSize={5 * 1024 * 1024}
                                        acceptedTypes={ATTACHMENT_ACCEPTED_TYPES}
                                        disabled={isLoadingOverall}
                                    />
                                </div>
                            </div>
                        </div>
                    )}
                </div>
                <AlertDialogFooter className="pt-4">
                    {isLoadingOverall ? (
                        <div className="flex justify-center w-full"><TailSpin color="#4f46e5" height={28} width={28} /></div>
                    ) : (
                        <>
                            <AlertDialogCancel asChild><Button variant="outline" onClick={closeDialogAndReset}>Cancel</Button></AlertDialogCancel>
                            <Button onClick={handleSubmit} disabled={isSubmitDisabled}>Add Expense</Button>
                        </>
                    )}
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};