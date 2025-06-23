// src/pages/non-project-expenses/components/UpdatePaymentDetailsDialog.tsx

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
import SITEURL from "@/constants/siteURL";
import { cn } from "@/lib/utils";

interface UpdatePaymentDetailsDialogProps {
    isOpen: boolean;
    setIsOpen: (open: boolean) => void;
    expense: NonProjectExpenses;
    onSuccess?: () => void;
}

interface PaymentFormState {
    payment_date: string;
    payment_ref: string;
}

type AttachmentUpdateAction = "keep" | "replace" | "remove";
const ATTACHMENT_ACCEPTED_TYPES: AcceptedFileType[] = ["image/*", "application/pdf", "text/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"];


export const UpdatePaymentDetailsDialog: React.FC<UpdatePaymentDetailsDialogProps> = ({
    isOpen, setIsOpen, expense, onSuccess
}) => {
    const { toast } = useToast();
    const { updateDoc, loading: updateLoading } = useFrappeUpdateDoc();
    const { upload, loading: uploadLoading } = useFrappeFileUpload();

    const [formState, setFormState] = useState<PaymentFormState>({ payment_date: "", payment_ref: "" });
    const [newAttachmentFile, setNewAttachmentFile] = useState<File | null>(null);
    const [existingAttachmentUrl, setExistingAttachmentUrl] = useState<string | undefined>(undefined);
    const [attachmentAction, setAttachmentAction] = useState<AttachmentUpdateAction>("keep");
    const [formErrors, setFormErrors] = useState<Partial<PaymentFormState>>({});

    useEffect(() => {
        if (isOpen && expense) {
            setFormState({
                payment_date: expense.payment_date ? formatDateFns(new Date(expense.payment_date), "yyyy-MM-dd") : formatDateFns(new Date(), "yyyy-MM-dd"),
                payment_ref: expense.payment_ref || "",
            });
            setExistingAttachmentUrl(expense.payment_attachment);
            setNewAttachmentFile(null);
            setAttachmentAction(expense.payment_attachment ? "keep" : "remove"); // If no existing, default to allow new upload (effectively 'remove' existing null)
            setFormErrors({});
        }
    }, [isOpen, expense]);

    const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormState(prev => ({ ...prev, [name]: value }));
        if (formErrors[name as keyof PaymentFormState]) {
            setFormErrors(prev => ({ ...prev, [name]: undefined }));
        }
    }, [formErrors]);

    const handleNewFileSelected = (file: File | null) => {
        setNewAttachmentFile(file);
        setAttachmentAction(file ? "replace" : (existingAttachmentUrl ? "keep" : "remove"));
    };

    const handleRemoveExistingAttachment = () => {
        setNewAttachmentFile(null); // Clear any staged new file
        setAttachmentAction("remove");
    };

    const handleAttachmentError = useCallback(({ message }: { type: "size" | "type", message: string }) => {
        toast({ title: "Attachment Error", description: message, variant: "destructive" });
    }, [toast]);

    const validate = () => {
        const errors: Partial<PaymentFormState> = {};
        if (!formState.payment_date) errors.payment_date = "Payment date is required.";
        setFormErrors(errors);
        return Object.keys(errors).length === 0;
    };

    const handleSubmit = async () => {
        if (!validate()) {
            toast({ title: "Validation Error", description: "Please check payment details.", variant: "destructive" });
            return;
        }

        const dataToUpdate: Partial<NonProjectExpenses> = {
            payment_date: formState.payment_date,
            payment_ref: formState.payment_ref.trim() || null,
        };

        try {
            if (attachmentAction === "replace" && newAttachmentFile) {
                const uploadedFile = await upload(newAttachmentFile, {
                    doctype: "Non Project Expenses", docname: expense.name,
                    fieldname: "payment_attachment", isPrivate: true,
                });
                dataToUpdate.payment_attachment = uploadedFile.file_url;
            } else if (attachmentAction === "remove") {
                dataToUpdate.payment_attachment = null;
            }
            // If action is "keep", payment_attachment is not added to dataToUpdate, so Frappe retains current value.

            await updateDoc("Non Project Expenses", expense.name, dataToUpdate);
            toast({ title: "Success", description: "Payment details updated.", variant: "success" });
            onSuccess?.();
            setIsOpen(false);
        } catch (error: any) {
            toast({ title: "Error", description: error.message || "Failed to update payment details.", variant: "destructive" });
        }
    };

    const isLoadingOverall = updateLoading || uploadLoading;

    // Determine what to display for current attachment
    let currentAttachmentDisplay: React.ReactNode = null;
    const effectiveExistingUrl = (attachmentAction === "keep" || attachmentAction === "replace") && existingAttachmentUrl;

    if (newAttachmentFile) { // New file is staged
        currentAttachmentDisplay = (
            <div className="flex items-center justify-between p-2 bg-blue-50 dark:bg-blue-900/30 rounded-md text-sm border border-blue-200 dark:border-blue-700">
                <div className="flex items-center gap-2 min-w-0">
                    <Paperclip className="h-4 w-4 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                    <span className="truncate" title={newAttachmentFile.name}>{newAttachmentFile.name}</span>
                    <span className="text-xs text-blue-500 dark:text-blue-500 ml-1 whitespace-nowrap">(New)</span>
                </div>
                {/* CustomAttachment handles its own X button for the new file */}
            </div>
        );
    } else if (effectiveExistingUrl) { // Existing file is kept
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
    } else if (attachmentAction === "remove" && existingAttachmentUrl) { // Marked for removal (was existing)
        currentAttachmentDisplay = (
            <div className="flex items-center gap-2 p-2 bg-amber-50 dark:bg-amber-900/30 rounded-md text-sm text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-700">
                <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                <span>Attachment will be removed.</span>
            </div>
        );
    }


    return (
        <AlertDialog open={isOpen} onOpenChange={setIsOpen}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Update Payment Details</AlertDialogTitle>
                    <AlertDialogDescription>Expense ID: {expense.name}</AlertDialogDescription>
                    <Separator className="my-2" />
                </AlertDialogHeader>
                <div className="space-y-4 py-2">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="payment_date_update_pd" className="text-right col-span-1">Payment Date <sup className="text-destructive">*</sup></Label>
                        <Input id="payment_date_update_pd" name="payment_date" type="date" value={formState.payment_date} onChange={handleInputChange} className="col-span-3" />
                        {formErrors.payment_date && <p className="col-span-3 col-start-2 text-xs text-destructive mt-1">{formErrors.payment_date}</p>}
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="payment_ref_update_pd" className="text-right col-span-1">Payment Ref</Label>
                        <Input id="payment_ref_update_pd" name="payment_ref" value={formState.payment_ref} onChange={handleInputChange} className="col-span-3" />
                    </div>

                    <div className="grid grid-cols-4 items-start gap-3">
                        <Label className="text-right col-span-1 pt-2">Payment Attachment</Label>
                        <div className="col-span-3 space-y-2">
                            {currentAttachmentDisplay}
                            {/* Show uploader if no new file is staged AND (either no existing file OR existing file is marked for removal) */}
                            {(!newAttachmentFile && (attachmentAction === "remove" || !existingAttachmentUrl)) && (
                                <CustomAttachment
                                    label="Upload New Attachment"
                                    selectedFile={newAttachmentFile} // Will be null here
                                    onFileSelect={handleNewFileSelected}
                                    onError={handleAttachmentError}
                                    maxFileSize={5 * 1024 * 1024}
                                    acceptedTypes={ATTACHMENT_ACCEPTED_TYPES}
                                />
                            )}
                            {/* Show uploader to replace if an existing file is present and not marked for removal, and no new file is staged */}
                            {!newAttachmentFile && existingAttachmentUrl && attachmentAction === "keep" && (
                                <CustomAttachment
                                    label="Replace Attachment"
                                    selectedFile={null} // Pass null to indicate it's for replacement
                                    onFileSelect={handleNewFileSelected}
                                    onError={handleAttachmentError}
                                    maxFileSize={5 * 1024 * 1024}
                                    acceptedTypes={ATTACHMENT_ACCEPTED_TYPES}
                                />
                            )}
                        </div>
                    </div>
                </div>
                <AlertDialogFooter>
                    {isLoadingOverall ? <div className="flex justify-center w-full"><TailSpin color="#4f46e5" height={24} width={24} /></div> : (
                        <>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={handleSubmit}>Save Changes</AlertDialogAction>
                        </>
                    )}
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};