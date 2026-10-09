// src/pages/non-project-expenses/components/UpdateInvoiceDetailsDialog.tsx

import React, { useState, useEffect, useCallback } from "react";
import { useFrappeUpdateDoc, useFrappeFileUpload } from "frappe-react-sdk";
import { TailSpin } from "react-loader-spinner";
import { formatDate as formatDateFns } from "date-fns";
import { X, Paperclip, Download, AlertTriangle } from "lucide-react";

import {
    AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
    AlertDialogHeader, AlertDialogTitle, AlertDialogFooter, AlertDialogAction
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CustomAttachment, AcceptedFileType } from "@/components/helpers/CustomAttachment";
import { useToast } from "@/components/ui/use-toast";
import { Separator } from "@/components/ui/separator";
import { NonProjectExpenses } from "@/types/NirmaanStack/NonProjectExpenses";
import { ProjectExpenses } from "@/types/NirmaanStack/ProjectExpenses";
import SITEURL from "@/constants/siteURL";
import { cn } from "@/lib/utils";
import { getFrappeError } from "@/utils/frappeErrors";

/** The invoice form is the same on both expense ledgers — one dialog serves both. */
type ExpenseDoctype = "Project Expenses" | "Non Project Expenses";
type InvoiceFields = "name" | "invoice_date" | "invoice_ref" | "invoice_attachment";

interface UpdateInvoiceDetailsDialogProps {
    isOpen: boolean;
    setIsOpen: (open: boolean) => void;
    expense: Pick<NonProjectExpenses, InvoiceFields> | Pick<ProjectExpenses, InvoiceFields>;
    /** Which ledger `expense` belongs to. Defaults to the Non Project Expenses page's own. */
    doctype?: ExpenseDoctype;
    /**
     * The invoice FILE (and so its ref) must be present to save. The Paid tab's Upload / Edit Inv sets
     * it; the Non Project Expenses page's "Record Invoice" does not, since a ref may be recorded there
     * before the file arrives.
     */
    requireAttachment?: boolean;
    onSuccess?: () => void;
}

interface InvoiceFormState {
    invoice_date: string;
    invoice_ref: string;
}
type InvoiceFormErrors = Partial<InvoiceFormState & { attachment: string }>;

type AttachmentUpdateAction = "keep" | "replace" | "remove";
const ATTACHMENT_ACCEPTED_TYPES: AcceptedFileType[] = ["image/*", "application/pdf", "text/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"];


export const UpdateInvoiceDetailsDialog: React.FC<UpdateInvoiceDetailsDialogProps> = ({
    isOpen, setIsOpen, expense, doctype = "Non Project Expenses", requireAttachment = false, onSuccess
}) => {
    const { toast } = useToast();
    const { updateDoc, loading: updateLoading } = useFrappeUpdateDoc();
    const { upload, loading: uploadLoading } = useFrappeFileUpload();

    const [formState, setFormState] = useState<InvoiceFormState>({ invoice_date: "", invoice_ref: "" });
    const [newAttachmentFile, setNewAttachmentFile] = useState<File | null>(null);
    const [existingAttachmentUrl, setExistingAttachmentUrl] = useState<string | undefined>(undefined);
    const [attachmentAction, setAttachmentAction] = useState<AttachmentUpdateAction>("keep");
    const [formErrors, setFormErrors] = useState<InvoiceFormErrors>({});

    useEffect(() => {
        if (isOpen && expense) {
            setFormState({
                invoice_date: expense.invoice_date ? formatDateFns(new Date(expense.invoice_date), "yyyy-MM-dd") : formatDateFns(new Date(), "yyyy-MM-dd"),
                invoice_ref: expense.invoice_ref || "",
            });
            setExistingAttachmentUrl(expense.invoice_attachment);
            setNewAttachmentFile(null);
            setAttachmentAction(expense.invoice_attachment ? "keep" : "remove");
            setFormErrors({});
        }
    }, [isOpen, expense]);

    const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormState(prev => ({ ...prev, [name]: value }));
        if (formErrors[name as keyof InvoiceFormState]) {
            setFormErrors(prev => ({ ...prev, [name]: undefined }));
        }
    }, [formErrors]);

    const handleNewFileSelected = (file: File | null) => {
        setNewAttachmentFile(file);
        setAttachmentAction(file ? "replace" : (existingAttachmentUrl ? "keep" : "remove"));
        if (file) setFormErrors(prev => ({ ...prev, attachment: undefined }));
    };

    const handleRemoveExistingAttachment = () => {
        setNewAttachmentFile(null);
        setAttachmentAction("remove");
    };

    const handleAttachmentError = useCallback(({ message }: { type: "size" | "type", message: string }) => {
        toast({ title: "Attachment Error", description: message, variant: "destructive" });
    }, [toast]);

    // Edit when the expense already carries an invoice file, upload otherwise.
    const isEditMode = !!expense.invoice_attachment;
    // An invoice attachment (kept existing or newly staged) requires an Invoice Ref -- the same rule
    // every expense dialog applies.
    const hasAttachment = !!newAttachmentFile || (attachmentAction !== "remove" && !!existingAttachmentUrl);
    const refRequired = requireAttachment || hasAttachment;
    // With `requireAttachment`, Save stays disabled until both the file and the ref are there -- an
    // invoice with neither is not an invoice. `validate` below repeats it as the backstop.
    const missingRequired = requireAttachment && (!hasAttachment || !formState.invoice_ref.trim());

    const validate = () => {
        const errors: InvoiceFormErrors = {};
        if (!formState.invoice_date) errors.invoice_date = "Invoice date is required.";
        // `max` only limits the picker -- a typed date can still land past today.
        else if (formState.invoice_date > formatDateFns(new Date(), "yyyy-MM-dd")) errors.invoice_date = "Invoice date cannot be in the future.";
        if (requireAttachment && !hasAttachment) errors.attachment = "Invoice file is required.";
        if (refRequired && !formState.invoice_ref.trim()) errors.invoice_ref = "Invoice reference is required when an invoice is attached.";
        setFormErrors(errors);
        return Object.keys(errors).length === 0;
    };

    const handleSubmit = async () => {
        if (!validate()) {
            toast({ title: "Validation Error", description: "Please check invoice details.", variant: "destructive" });
            return;
        }

        const dataToUpdate: { invoice_date: string; invoice_ref: string | null; invoice_attachment?: string | null } = {
            invoice_date: formState.invoice_date,
            invoice_ref: formState.invoice_ref.trim() || null,
        };

        try {
            if (attachmentAction === "replace" && newAttachmentFile) {
                const uploadedFile = await upload(newAttachmentFile, {
                    doctype, docname: expense.name,
                    fieldname: "invoice_attachment", isPrivate: true,
                });
                dataToUpdate.invoice_attachment = uploadedFile.file_url;
            } else if (attachmentAction === "remove") {
                dataToUpdate.invoice_attachment = null;
            }
            // If action is "keep", invoice_attachment is not added to dataToUpdate.

            await updateDoc(doctype, expense.name, dataToUpdate);
            toast({ title: "Success", description: "Invoice details updated.", variant: "success" });
            onSuccess?.();
            setIsOpen(false);
        } catch (error: any) {
            toast({ title: "Error", description: getFrappeError(error) || "Failed to update invoice details.", variant: "destructive" });
        }
    };

    const isLoadingOverall = updateLoading || uploadLoading;

    let currentAttachmentDisplay: React.ReactNode = null;
    const effectiveExistingUrl = (attachmentAction === "keep" || attachmentAction === "replace") && existingAttachmentUrl;

    if (newAttachmentFile) {
        currentAttachmentDisplay = (
            <div className="flex items-center justify-between p-2 bg-blue-50 dark:bg-blue-900/30 rounded-md text-sm border border-blue-200 dark:border-blue-700">
                <div className="flex items-center gap-2 min-w-0">
                    <Paperclip className="h-4 w-4 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                    <span className="truncate" title={newAttachmentFile.name}>{newAttachmentFile.name}</span>
                    <span className="text-xs text-blue-500 dark:text-blue-500 ml-1 whitespace-nowrap">(New)</span>
                </div>
                <Button variant="ghost" size="icon" onClick={() => handleNewFileSelected(null)} className="h-7 w-7 text-destructive hover:bg-destructive/10">
                    <X className="h-4 w-4" />
                    <span className="sr-only">Clear selected file</span>
                </Button>
            </div>
        );
    } else if (effectiveExistingUrl) {
        currentAttachmentDisplay = (
            <div className="flex items-center justify-between p-2 bg-muted/60 rounded-md text-sm">
                <div className="flex items-center gap-2 min-w-0">
                    <Download className="h-4 w-4 text-primary flex-shrink-0" />
                    <a
                        href={SITEURL + effectiveExistingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="truncate hover:underline"
                        title={`View ${effectiveExistingUrl.split('/').pop()}`}
                    >
                        {effectiveExistingUrl.split('/').pop()}
                    </a>
                </div>
                <Button variant="ghost" size="icon" onClick={handleRemoveExistingAttachment} className="h-7 w-7 text-destructive hover:bg-destructive/10">
                    <X className="h-4 w-4" />
                    <span className="sr-only">Remove existing attachment</span>
                </Button>
            </div>
        );
    } else if (attachmentAction === "remove" && existingAttachmentUrl) {
        currentAttachmentDisplay = (
            <div className="flex items-center gap-2 p-2 bg-amber-50 dark:bg-amber-900/30 rounded-md text-sm text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-700">
                <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                <span>Attachment will be removed.</span>
            </div>
        );
    }

    return (
        // No closing mid-save (Escape / outside click): a host that unmounts the dialog on close
        // would drop the upload half-way.
        <AlertDialog open={isOpen} onOpenChange={(open) => { if (!isLoadingOverall) setIsOpen(open); }}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{isEditMode ? "Edit Invoice" : "Upload Invoice"}</AlertDialogTitle>
                    <AlertDialogDescription>Expense ID: {expense.name}</AlertDialogDescription>
                    <Separator className="my-2" />
                </AlertDialogHeader>
                <div className="space-y-4 py-2">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="invoice_date_update_id" className="text-right col-span-1">Invoice Date <sup className="text-destructive">*</sup></Label>
                        <Input id="invoice_date_update_id" name="invoice_date" type="date" value={formState.invoice_date} onChange={handleInputChange} max={formatDateFns(new Date(), "yyyy-MM-dd")} className="col-span-3" />
                        {formErrors.invoice_date && <p className="col-span-3 col-start-2 text-xs text-destructive mt-1">{formErrors.invoice_date}</p>}
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="invoice_ref_update_id" className="text-right col-span-1">Invoice Ref{refRequired && <sup className="text-destructive"> *</sup>}</Label>
                        <Input id="invoice_ref_update_id" name="invoice_ref" value={formState.invoice_ref} onChange={handleInputChange} className={cn("col-span-3", formErrors.invoice_ref && "border-destructive")} />
                        {formErrors.invoice_ref && <p className="col-span-3 col-start-2 text-xs text-destructive mt-1">{formErrors.invoice_ref}</p>}
                    </div>

                    <div className="grid grid-cols-4 items-start gap-3">
                        <Label className="text-right col-span-1 pt-2">Invoice Attachment{requireAttachment && <sup className="text-destructive"> *</sup>}</Label>
                        <div className="col-span-3 space-y-2">
                            {currentAttachmentDisplay}
                            {(!newAttachmentFile && (attachmentAction === "remove" || !existingAttachmentUrl)) && (
                                <CustomAttachment
                                    label="Upload New Attachment"
                                    selectedFile={newAttachmentFile}
                                    onFileSelect={handleNewFileSelected}
                                    onError={handleAttachmentError}
                                    maxFileSize={5 * 1024 * 1024}
                                    acceptedTypes={ATTACHMENT_ACCEPTED_TYPES}
                                />
                            )}
                            {!newAttachmentFile && existingAttachmentUrl && attachmentAction === "keep" && (
                                <CustomAttachment
                                    label="Replace Attachment"
                                    selectedFile={null}
                                    onFileSelect={handleNewFileSelected}
                                    onError={handleAttachmentError}
                                    maxFileSize={5 * 1024 * 1024}
                                    acceptedTypes={ATTACHMENT_ACCEPTED_TYPES}
                                />
                            )}
                            {formErrors.attachment && <p className="text-xs text-destructive">{formErrors.attachment}</p>}
                        </div>
                    </div>
                </div>
                <AlertDialogFooter>
                    {isLoadingOverall ? <div className="flex justify-center w-full"><TailSpin color="#4f46e5" height={24} width={24} /></div> : (
                        <>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            {/* preventDefault: an AlertDialogAction closes the dialog on click, BEFORE the save
                                runs -- a validation error then vanished with the dialog and nothing saved.
                                handleSubmit closes it itself, on success only. */}
                            <AlertDialogAction
                                disabled={missingRequired}
                                title={missingRequired ? "Attach the invoice file and enter its ref" : undefined}
                                onClick={(e) => { e.preventDefault(); handleSubmit(); }}>
                                Save Invoice
                            </AlertDialogAction>
                        </>
                    )}
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};