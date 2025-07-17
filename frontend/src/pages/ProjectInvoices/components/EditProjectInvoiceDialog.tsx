// src/pages/ProjectInvoices/components/EditProjectInvoiceDialog.tsx

import React, { useCallback, useState, useEffect, useMemo } from "react";
import { useFrappeUpdateDoc, useFrappeFileUpload } from "frappe-react-sdk";
import { TailSpin } from "react-loader-spinner";
import { formatDate as formatDateFns } from "date-fns";
import { X as XIcon, Paperclip, Download as DownloadIcon, AlertTriangle } from "lucide-react";

import { CustomAttachment, AcceptedFileType } from "@/components/helpers/CustomAttachment";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/use-toast";
import { ProjectInvoice } from "@/types/NirmaanStack/ProjectInvoice";
import { parseNumber } from "@/utils/parseNumber";
import { useDialogStore } from "@/zustand/useDialogStore";
import SITEURL from "@/constants/siteURL";
// Removed ProjectSelect as project is typically not editable for an existing invoice.
// If it is, ProjectSelect and related project data fetching would be needed.

const DOCTYPE = "Project Invoices";
const ATTACHMENT_ACCEPTED_TYPES: AcceptedFileType[] = ["image/*", "application/pdf"];
type AttachmentUpdateAction = "keep" | "replace" | "remove";

interface EditProjectInvoiceDialogProps {
    invoiceToEdit: ProjectInvoice; // Required for edit mode
    listMutate: KeyedMutator<any>;
    onClose?: () => void;
}

interface InvoiceFormState {
    invoice_no: string;
    amount: string;
    date: string;
    project: string; // Kept for display, assuming not editable
}

export function EditProjectInvoiceDialog({ invoiceToEdit, listMutate, onClose }: EditProjectInvoiceDialogProps) {
    const { editProjectInvoiceDialog, setEditProjectInvoiceDialog } = useDialogStore();

    const getInitialState = useCallback((): InvoiceFormState => ({
        invoice_no: invoiceToEdit?.invoice_no || "",
        amount: invoiceToEdit?.amount?.toString() || "",
        date: invoiceToEdit?.invoice_date ? formatDateFns(new Date(invoiceToEdit.invoice_date), "yyyy-MM-dd") : "",
        project: invoiceToEdit?.project || ""
    }), [invoiceToEdit]);

    const [invoiceData, setInvoiceData] = useState<InvoiceFormState>(getInitialState());
    const [newAttachmentFile, setNewAttachmentFile] = useState<File | null>(null);
    const [existingAttachmentUrl, setExistingAttachmentUrl] = useState<string | undefined>(undefined);
    const [attachmentAction, setAttachmentAction] = useState<AttachmentUpdateAction>("keep");
    const [formErrors, setFormErrors] = useState<Partial<InvoiceFormState>>({});


    const { updateDoc, loading: updateDocLoading } = useFrappeUpdateDoc();
    const { upload, loading: uploadLoading } = useFrappeFileUpload();

    useEffect(() => {
        if (editProjectInvoiceDialog && invoiceToEdit) {
            setInvoiceData(getInitialState());
            setNewAttachmentFile(null);
            setFormErrors({});
            setExistingAttachmentUrl(invoiceToEdit.attachment);
            setAttachmentAction(invoiceToEdit.attachment ? "keep" : "remove");
        }
    }, [editProjectInvoiceDialog, invoiceToEdit, getInitialState]);

    const handleDialogClose = () => {
        setEditProjectInvoiceDialog(false);
        onClose?.();
    };

    const handleAttachmentError = useCallback(({ message }: { type: "size" | "type", message: string }) => {
        toast({ title: "Attachment Error", description: message, variant: "destructive", });
    }, [toast]);

    const handleNewFileSelected = (file: File | null) => {
        setNewAttachmentFile(file);
        setAttachmentAction(file ? "replace" : (existingAttachmentUrl ? "keep" : "remove"));
    };
    const handleRemoveExistingAttachment = () => {
        setNewAttachmentFile(null);
        setAttachmentAction("remove");
    };

    const validateForm = (): boolean => {
        const errors: Partial<InvoiceFormState> = {};
        // Project is not validated as it's assumed fixed in edit mode.
        if (!invoiceData.invoice_no.trim()) errors.invoice_no = "Invoice number is required.";
        if (invoiceData.amount.trim() === '' || isNaN(parseNumber(invoiceData.amount))) {
            errors.amount = "A valid amount is required.";
        }
        if (!invoiceData.date) errors.date = "Invoice date is required.";
        setFormErrors(errors);
        return Object.keys(errors).length === 0;
    }

    const handleSubmitInvoice = useCallback(async (event?: React.FormEvent) => {
        if (event) event.preventDefault();
        if (!validateForm()) {
            toast({ title: "Validation Error", description: "Please fill all required fields.", variant: "destructive" });
            return;
        }

        const payload: Partial<ProjectInvoice> = {
            invoice_no: invoiceData.invoice_no.trim(),
            amount: parseNumber(invoiceData.amount),
            invoice_date: invoiceData.date,
            // Project field is not included in payload, assuming it's not editable
        };

        try {
            if (attachmentAction === "replace" && newAttachmentFile) {
                const uploadedFile = await upload(newAttachmentFile, {
                    doctype: DOCTYPE,
                    docname: invoiceToEdit.name, // Use actual docname for edit
                    fieldname: "attachment",
                    isPrivate: true,
                });
                payload.attachment = uploadedFile.file_url;
            } else if (attachmentAction === "remove") {
                payload.attachment = null;
            }

            await updateDoc(DOCTYPE, invoiceToEdit.name, payload);
            toast({ title: "Success!", description: `Invoice ${invoiceData.invoice_no} updated.`, variant: "success" });
            await listMutate();
            handleDialogClose();
        } catch (error) {
            console.error("Error updating Invoice:", error);
            toast({
                title: "Update Failed",
                description: error instanceof Error ? error.message : "An unexpected error occurred.",
                variant: "destructive"
            });
        }
    }, [
        invoiceData, newAttachmentFile, invoiceToEdit, attachmentAction,
        upload, updateDoc, listMutate, handleDialogClose, validateForm
    ]);

    const isLoading = uploadLoading || updateDocLoading;

    // Attachment Display Logic
    let currentAttachmentDisplayNode: React.ReactNode = null;
    const effectiveExistingUrl = (attachmentAction === "keep" || attachmentAction === "replace") && existingAttachmentUrl;
    if (newAttachmentFile) {
        currentAttachmentDisplayNode = (<div className="flex items-center justify-between p-2 bg-blue-50 dark:bg-blue-900/30 rounded-md text-sm border border-blue-200 dark:border-blue-700"><div className="flex items-center gap-2 min-w-0"><Paperclip className="h-4 w-4 text-blue-600 dark:text-blue-400 flex-shrink-0" /><span className="truncate" title={newAttachmentFile.name}>{newAttachmentFile.name}</span><span className="text-xs text-blue-500 dark:text-blue-500 ml-1 whitespace-nowrap">(New)</span></div></div>);
    } else if (effectiveExistingUrl) {
        currentAttachmentDisplayNode = (<div className="flex items-center justify-between p-2 bg-muted/60 rounded-md text-sm"><div className="flex items-center gap-2 min-w-0"><DownloadIcon className="h-4 w-4 text-primary flex-shrink-0" /><a href={SITEURL + effectiveExistingUrl} target="_blank" rel="noopener noreferrer" className="truncate hover:underline" title={`View ${effectiveExistingUrl.split('/').pop()}`}>{effectiveExistingUrl.split('/').pop()}</a></div><Button variant="ghost" size="icon" onClick={handleRemoveExistingAttachment} className="h-7 w-7 text-destructive hover:bg-destructive/10"><XIcon className="h-4 w-4" /><span className="sr-only">Remove</span></Button></div>);
    } else if (attachmentAction === "remove" && existingAttachmentUrl) {
        currentAttachmentDisplayNode = (<div className="flex items-center gap-2 p-2 bg-amber-50 dark:bg-amber-900/30 rounded-md text-sm text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-700"><AlertTriangle className="h-4 w-4 flex-shrink-0" /><span>Attachment will be removed.</span></div>);
    }

    return (
        <AlertDialog open={editProjectInvoiceDialog} onOpenChange={(isOpen) => { if (!isOpen) handleDialogClose(); else setEditProjectInvoiceDialog(true); }}>
            <AlertDialogContent className="sm:max-w-lg">
                <AlertDialogHeader>
                    <AlertDialogTitle className="text-center text-xl">Edit Invoice</AlertDialogTitle>
                    <AlertDialogDescription className="text-center">ID: {invoiceToEdit.name}</AlertDialogDescription>
                </AlertDialogHeader>

                <form onSubmit={handleSubmitInvoice} className="space-y-6 pt-4">
                    <div className="space-y-4">
                        {/* Project (Display Only) */}
                        <div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-3 sm:items-center sm:gap-4">
                            <Label htmlFor="project_invoice_project_edit" className="sm:text-left">Project:</Label>
                            {/* You might want to fetch project name here if not available on invoiceToEdit or make project field a lookup in ProjectInvoice doctype */}
                            <Input id="project_invoice_project_edit" value={invoiceData.project} className="sm:col-span-2 bg-muted/50" disabled />
                        </div>

                        {/* Invoice No. */}
                        <div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-3 sm:items-center sm:gap-4">
                            <Label htmlFor="invoice_no_edit_proj_inv" className="sm:text-left">Invoice No<sup className="text-red-500 ml-1">*</sup>:</Label>
                            <Input id="invoice_no_edit_proj_inv" value={invoiceData.invoice_no} onChange={(e) => setInvoiceData(prev => ({ ...prev, invoice_no: e.target.value }))} className="sm:col-span-2" disabled={isLoading} />
                            {formErrors.invoice_no && <p className="col-span-1 sm:col-span-3 sm:col-start-2 text-xs text-destructive mt-1">{formErrors.invoice_no}</p>}
                        </div>
                        {/* Date */}
                        <div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-3 sm:items-center sm:gap-4">
                            <Label htmlFor="invoice_date_edit_proj_inv" className="sm:text-left">Invoice Date<sup className="text-red-500 ml-1">*</sup>:</Label>
                            <Input id="invoice_date_edit_proj_inv" type="date" value={invoiceData.date} onChange={(e) => setInvoiceData(prev => ({ ...prev, date: e.target.value }))} max={formatDateFns(new Date(), "yyyy-MM-dd")} className="sm:col-span-2" disabled={isLoading} />
                            {formErrors.date && <p className="col-span-1 sm:col-span-3 sm:col-start-2 text-xs text-destructive mt-1">{formErrors.date}</p>}
                        </div>
                        {/* Amount */}
                        <div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-3 sm:items-center sm:gap-4">
                            <Label htmlFor="invoice_amount_edit_proj_inv" className="sm:text-left">Amount (Incl. GST)<sup className="text-red-500 ml-1">*</sup>:</Label>
                            <Input id="invoice_amount_edit_proj_inv" type="text" inputMode="decimal" value={invoiceData.amount}
                                onChange={(e) => { const val = e.target.value; if (/^-?\d*\.?\d*$/.test(val)) setInvoiceData(prev => ({ ...prev, amount: val })); }}
                                className="sm:col-span-2" disabled={isLoading} />
                            {formErrors.amount && <p className="col-span-1 sm:col-span-3 sm:col-start-2 text-xs text-destructive mt-1">{formErrors.amount}</p>}
                        </div>
                    </div>

                    {/* Attachment Section for Edit */}
                    <div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-3 sm:items-center sm:gap-4">
                        <Label className="sm:text-left pt-1">Attachment:</Label>
                        <div className="sm:col-span-2 space-y-2">
                            {currentAttachmentDisplayNode}
                            {(!newAttachmentFile && (attachmentAction === "remove" || !existingAttachmentUrl)) && (
                                <CustomAttachment label="Upload New Invoice" selectedFile={newAttachmentFile} onFileSelect={handleNewFileSelected} onError={handleAttachmentError} maxFileSize={5 * 1024 * 1024} acceptedTypes={ATTACHMENT_ACCEPTED_TYPES} disabled={isLoading} />
                            )}
                            {!newAttachmentFile && existingAttachmentUrl && attachmentAction === "keep" && (
                                <CustomAttachment label="Replace Invoice" selectedFile={null} onFileSelect={handleNewFileSelected} onError={handleAttachmentError} maxFileSize={5 * 1024 * 1024} acceptedTypes={ATTACHMENT_ACCEPTED_TYPES} disabled={isLoading} />
                            )}
                        </div>
                    </div>

                    <AlertDialogFooter className="pt-4">
                        {isLoading ? (
                            <div className='flex justify-center items-center w-full h-10'><TailSpin color="#4f46e5" width={30} height={30} /></div>
                        ) : (
                            <>
                                <AlertDialogCancel asChild><Button variant="outline" type="button" onClick={handleDialogClose}>Cancel</Button></AlertDialogCancel>
                                <Button type="submit" disabled={isLoading}>Save Changes</Button>
                            </>
                        )}
                    </AlertDialogFooter>
                </form>
            </AlertDialogContent>
        </AlertDialog>
    );
}