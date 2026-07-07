// src/pages/non-project-expenses/components/UpdatePaymentDetailsDialog.tsx

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useFrappeUpdateDoc, useFrappeFileUpload, useFrappePostCall } from "frappe-react-sdk";
import { TailSpin } from "react-loader-spinner";
import { formatDate as formatDateFns } from "date-fns";
import { X, Download, AlertTriangle, Loader2, Sparkles } from "lucide-react";

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
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { cn } from "@/lib/utils";

interface UpdatePaymentDetailsDialogProps {
    isOpen: boolean;
    setIsOpen: (open: boolean) => void;
    expense: NonProjectExpenses;
    onSuccess?: () => void;
    /** When true, submitting also advances the expense to status "Paid". */
    markAsPaid?: boolean;
}

interface PaymentFormState {
    payment_date: string;
    payment_ref: string;
    invoice_date: string;
    invoice_ref: string;
}

type AttachmentUpdateAction = "keep" | "replace" | "remove";
const ATTACHMENT_ACCEPTED_TYPES: AcceptedFileType[] = ["image/*", "application/pdf", "text/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"];


export const UpdatePaymentDetailsDialog: React.FC<UpdatePaymentDetailsDialogProps> = ({
    isOpen, setIsOpen, expense, onSuccess, markAsPaid = false
}) => {
    const { toast } = useToast();
    const { updateDoc, loading: updateLoading } = useFrappeUpdateDoc();
    const { upload, loading: uploadLoading } = useFrappeFileUpload();

    const [formState, setFormState] = useState<PaymentFormState>({ payment_date: "", payment_ref: "", invoice_date: "", invoice_ref: "" });
    const [newAttachmentFile, setNewAttachmentFile] = useState<File | null>(null);
    // Optional: attach the invoice here if the expense doesn't already have one.
    const [newInvoiceFile, setNewInvoiceFile] = useState<File | null>(null);
    const [existingAttachmentUrl, setExistingAttachmentUrl] = useState<string | undefined>(undefined);
    const [attachmentAction, setAttachmentAction] = useState<AttachmentUpdateAction>("keep");
    const [formErrors, setFormErrors] = useState<Partial<PaymentFormState>>({});

    // --- Payment-receipt AI auto-fill (same feature as the create dialog) ---
    const { call: extractPaymentFields } = useFrappePostCall("nirmaan_stack.api.payment_autofill.extract_payment_fields");
    const [isAutofilling, setIsAutofilling] = useState(false);
    const [uploadedPaymentUrl, setUploadedPaymentUrl] = useState<string | null>(null);
    const [autofilledFields, setAutofilledFields] = useState<Set<string>>(new Set());
    const extractionSessionRef = useRef(0);
    // Two-stage payment UX: "upload" shows only the receipt uploader; after a
    // successful upload we advance to "form" and reveal Payment Date + Ref.
    const [paymentStage, setPaymentStage] = useState<"upload" | "form">("upload");

    const SUPPORTED_AUTOFILL_EXTS = ["pdf", "png", "jpg", "jpeg"];
    const isSupportedForAutofill = (file: File) => {
        const ext = file.name.split(".").pop()?.toLowerCase() || "";
        return SUPPORTED_AUTOFILL_EXTS.includes(ext);
    };

    const runPaymentAutofill = useCallback(async (file: File) => {
        const session = ++extractionSessionRef.current;
        setIsAutofilling(true);
        try {
            const uploaded = await upload(file, {
                doctype: "Non Project Expenses",
                docname: expense.name,
                fieldname: "payment_attachment",
                isPrivate: true,
            });
            if (session !== extractionSessionRef.current) return;
            setUploadedPaymentUrl(uploaded.file_url);

            const res = await extractPaymentFields({ file_url: uploaded.file_url });
            if (session !== extractionSessionRef.current) return;
            const data = (res as any)?.message ?? res;

            const filled = new Set<string>();
            const updates: Partial<PaymentFormState> = {};
            if (data?.utr) { updates.payment_ref = data.utr; filled.add("payment_ref"); }
            if (data?.payment_date) { updates.payment_date = data.payment_date; filled.add("payment_date"); }
            if (Object.keys(updates).length > 0) setFormState(prev => ({ ...prev, ...updates }));
            setAutofilledFields(filled);

            toast(
                filled.size > 0
                    ? { title: "Auto-filled from receipt", description: `Filled ${filled.size} field${filled.size > 1 ? "s" : ""}. Please verify.`, variant: "success" }
                    : { title: "Couldn't auto-fill", description: "Please enter the payment details manually." }
            );
        } catch (e: any) {
            if (session !== extractionSessionRef.current) return;
            toast({ title: "Auto-fill failed", description: e?.message || "Please enter details manually.", variant: "destructive" });
        } finally {
            if (session === extractionSessionRef.current) {
                setIsAutofilling(false);
                setPaymentStage("form"); // reveal the fields (filled) after upload — success or not
            }
        }
    }, [upload, extractPaymentFields, toast, expense.name]);

    useEffect(() => {
        if (isOpen && expense) {
            setFormState({
                payment_date: expense.payment_date ? formatDateFns(new Date(expense.payment_date), "yyyy-MM-dd") : formatDateFns(new Date(), "yyyy-MM-dd"),
                payment_ref: expense.payment_ref || "",
                invoice_date: expense.invoice_date ? formatDateFns(new Date(expense.invoice_date), "yyyy-MM-dd") : "",
                invoice_ref: expense.invoice_ref || "",
            });
            setExistingAttachmentUrl(expense.payment_attachment);
            setNewAttachmentFile(null);
            setNewInvoiceFile(null);
            setAttachmentAction(expense.payment_attachment ? "keep" : "remove"); // If no existing, default to allow new upload (effectively 'remove' existing null)
            setFormErrors({});
            setUploadedPaymentUrl(null);
            setAutofilledFields(new Set());
            setIsAutofilling(false);
            // Start on the upload step unless the expense already has a payment receipt.
            setPaymentStage(expense.payment_attachment ? "form" : "upload");
        }
    }, [isOpen, expense]);

    const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormState(prev => ({ ...prev, [name]: value }));
        if (formErrors[name as keyof PaymentFormState]) {
            setFormErrors(prev => ({ ...prev, [name]: undefined }));
        }
        // If the user edits an auto-filled field, drop its amber tint.
        if (autofilledFields.has(name)) {
            setAutofilledFields(prev => { const next = new Set(prev); next.delete(name); return next; });
        }
    }, [formErrors, autofilledFields]);

    const handleNewFileSelected = (file: File | null) => {
        setNewAttachmentFile(file);
        setUploadedPaymentUrl(null);
        setAutofilledFields(new Set());
        setAttachmentAction(file ? "replace" : (existingAttachmentUrl ? "keep" : "remove"));
        if (file) {
            if (isSupportedForAutofill(file)) {
                runPaymentAutofill(file); // uploads + extracts, then advances to "form"
            } else {
                setPaymentStage("form"); // unsupported for AI — go straight to manual entry
            }
        } else {
            // Removed the staged file — back to the upload step (unless a saved file remains).
            setPaymentStage(existingAttachmentUrl && attachmentAction !== "remove" ? "form" : "upload");
        }
    };

    const handleRemoveExistingAttachment = () => {
        setNewAttachmentFile(null); // Clear any staged new file
        setAttachmentAction("remove");
    };

    const handleAttachmentError = useCallback(({ message }: { type: "size" | "type", message: string }) => {
        toast({ title: "Attachment Error", description: message, variant: "destructive" });
    }, [toast]);

    const hasPaymentAttachment = !!newAttachmentFile || !!uploadedPaymentUrl || (attachmentAction !== "remove" && !!existingAttachmentUrl);

    const validate = () => {
        const errors: Partial<PaymentFormState> = {};
        if (!formState.payment_date) errors.payment_date = "Payment date is required.";
        // Mark as Paid requires a payment reference.
        if (markAsPaid && !formState.payment_ref.trim()) errors.payment_ref = "Payment reference is required.";
        // An invoice attachment (existing or newly staged) requires an Invoice Ref.
        const hasInvoiceAttachment = !!newInvoiceFile || !!expense.invoice_attachment;
        if (hasInvoiceAttachment && !formState.invoice_ref.trim()) errors.invoice_ref = "Invoice reference is required when an invoice is attached.";
        setFormErrors(errors);
        // Mark as Paid requires a payment receipt (attachment).
        if (markAsPaid && !hasPaymentAttachment) {
            toast({ title: "Payment receipt required", description: "Please upload the payment receipt before marking as Paid.", variant: "destructive" });
            return false;
        }
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
            invoice_date: formState.invoice_date || null,
            invoice_ref: formState.invoice_ref.trim() || null,
        };
        if (markAsPaid) {
            dataToUpdate.status = "Paid";
        }

        try {
            if (attachmentAction === "replace" && newAttachmentFile) {
                // Reuse the upload done during auto-fill if available (avoids re-uploading).
                if (uploadedPaymentUrl) {
                    dataToUpdate.payment_attachment = uploadedPaymentUrl;
                } else {
                    const uploadedFile = await upload(newAttachmentFile, {
                        doctype: "Non Project Expenses", docname: expense.name,
                        fieldname: "payment_attachment", isPrivate: true,
                    });
                    dataToUpdate.payment_attachment = uploadedFile.file_url;
                }
            } else if (attachmentAction === "remove") {
                dataToUpdate.payment_attachment = null;
            }
            // If action is "keep", payment_attachment is not added to dataToUpdate, so Frappe retains current value.

            // Invoice attachment: upload the new / replacement file if the accountant added one.
            if (newInvoiceFile) {
                const uploadedInvoice = await upload(newInvoiceFile, {
                    doctype: "Non Project Expenses", docname: expense.name,
                    fieldname: "invoice_attachment", isPrivate: true,
                });
                dataToUpdate.invoice_attachment = uploadedInvoice.file_url;
            }

            await updateDoc("Non Project Expenses", expense.name, dataToUpdate);
            toast({ title: "Success", description: markAsPaid ? "Expense marked Paid." : "Payment details updated.", variant: "success" });
            onSuccess?.();
            setIsOpen(false);
        } catch (error: any) {
            toast({ title: "Error", description: error.message || "Failed to update payment details.", variant: "destructive" });
        }
    };

    const isLoadingOverall = updateLoading || uploadLoading || isAutofilling;

    // Existing saved attachment (shown unless a new file is staged or it's marked for removal).
    const effectiveExistingUrl = (attachmentAction === "keep" || attachmentAction === "replace") ? existingAttachmentUrl : undefined;

    const hasInvoiceAttachmentNow = !!newInvoiceFile || !!expense.invoice_attachment;
    const isSubmitDisabled =
        isLoadingOverall ||
        paymentStage === "upload" ||
        !formState.payment_date ||
        (markAsPaid && !formState.payment_ref.trim()) ||
        (markAsPaid && !hasPaymentAttachment) ||
        (hasInvoiceAttachmentNow && !formState.invoice_ref.trim());


    return (
        <AlertDialog open={isOpen} onOpenChange={setIsOpen}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{markAsPaid ? "Record Payment & Mark as Paid" : "Update Payment Details"}</AlertDialogTitle>
                    <AlertDialogDescription>Expense ID: {expense.name}</AlertDialogDescription>
                    <Separator className="my-2" />
                </AlertDialogHeader>

                {/* Expense details, so the accountant has full context before paying */}
                <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1.5">
                    <div className="flex items-start justify-between gap-4">
                        <span className="text-muted-foreground">Expense Type</span>
                        <span className="font-medium text-right">{expense.type || "--"}</span>
                    </div>
                    <div className="flex items-start justify-between gap-4">
                        <span className="text-muted-foreground">Amount</span>
                        <span className="font-semibold text-right">{formatToRoundedIndianRupee(expense.amount)}</span>
                    </div>
                    <div className="flex items-start justify-between gap-4">
                        <span className="text-muted-foreground">Description</span>
                        <span className="font-medium text-right">{expense.description || "--"}</span>
                    </div>
                    {expense.comment && (
                        <div className="flex items-start justify-between gap-4">
                            <span className="text-muted-foreground">Comment</span>
                            <span className="text-right">{expense.comment}</span>
                        </div>
                    )}
                </div>

                <div className="space-y-4 py-2">
                    <p className="text-sm font-medium">Record Payment Details</p>
                    {paymentStage === "form" && (
                        <>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="payment_date_update_pd" className="text-right col-span-1">Payment Date <sup className="text-destructive">*</sup></Label>
                                <Input id="payment_date_update_pd" name="payment_date" type="date" value={formState.payment_date} onChange={handleInputChange} className={cn("col-span-3", autofilledFields.has("payment_date") && "bg-amber-50 border-amber-300 focus-visible:ring-amber-400")} />
                                {formErrors.payment_date && <p className="col-span-3 col-start-2 text-xs text-destructive mt-1">{formErrors.payment_date}</p>}
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="payment_ref_update_pd" className="text-right col-span-1">Payment Ref{markAsPaid && <sup className="text-destructive"> *</sup>}</Label>
                                <Input id="payment_ref_update_pd" name="payment_ref" value={formState.payment_ref} onChange={handleInputChange} className={cn("col-span-3", autofilledFields.has("payment_ref") && "bg-amber-50 border-amber-300 focus-visible:ring-amber-400", ((markAsPaid && !formState.payment_ref.trim()) || formErrors.payment_ref) && "border-destructive")} />
                                {((markAsPaid && !formState.payment_ref.trim()) || formErrors.payment_ref) && <p className="col-span-3 col-start-2 text-xs text-destructive mt-1">{formErrors.payment_ref || "Payment reference is required."}</p>}
                            </div>
                        </>
                    )}

                    <div className="space-y-2">
                            {/* Existing saved receipt (hidden once a new file is staged) */}
                            {effectiveExistingUrl && !newAttachmentFile && (
                                <div className="flex items-center justify-between p-2 bg-muted/60 rounded-md text-sm">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <Download className="h-4 w-4 text-primary flex-shrink-0" />
                                        <a href={SITEURL + effectiveExistingUrl} target="_blank" rel="noopener noreferrer" className="truncate hover:underline" title={`View ${effectiveExistingUrl.split('/').pop()}`}>{effectiveExistingUrl.split('/').pop()}</a>
                                    </div>
                                    <Button variant="ghost" size="icon" onClick={handleRemoveExistingAttachment} className="h-7 w-7 text-destructive hover:bg-destructive/10" disabled={isLoadingOverall}><X className="h-4 w-4" /><span className="sr-only">Remove existing attachment</span></Button>
                                </div>
                            )}
                            {attachmentAction === "remove" && existingAttachmentUrl && !newAttachmentFile && (
                                <div className="flex items-center gap-2 p-2 bg-amber-50 dark:bg-amber-900/30 rounded-md text-sm text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-700">
                                    <AlertTriangle className="h-4 w-4 flex-shrink-0" /><span>Attachment will be removed.</span>
                                </div>
                            )}
                            {!isAutofilling && autofilledFields.size > 0 && (
                                <div className="flex items-center gap-1.5 text-xs text-amber-800">
                                    <Sparkles className="h-3.5 w-3.5" /> Auto-filled from receipt — please verify.
                                </div>
                            )}
                            {paymentStage === "upload" ? (
                                /* Stage 1 — big "Upload Payment Receipt" card (auto-fill), like the create dialog */
                                <div className="rounded-lg border border-dashed p-3 space-y-2">
                                    {isAutofilling ? (
                                        <div className="flex flex-col items-center gap-3 py-6">
                                            <Loader2 className="h-8 w-8 text-amber-600 animate-spin" />
                                            <div className="text-center space-y-1">
                                                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Reading your receipt…</p>
                                                <p className="text-xs text-muted-foreground">AI is extracting payment details. This usually takes a few seconds.</p>
                                            </div>
                                        </div>
                                    ) : (
                                        <>
                                            <div className="text-center space-y-1">
                                                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{effectiveExistingUrl ? "Replace Payment Receipt" : "Upload Payment Receipt"}</h3>
                                                <p className="text-xs text-muted-foreground">We'll read the receipt and fill in Payment Ref and Payment Date for you.</p>
                                            </div>
                                            <CustomAttachment
                                                label="Choose Receipt (PDF or image)"
                                                selectedFile={newAttachmentFile}
                                                onFileSelect={handleNewFileSelected}
                                                onError={handleAttachmentError}
                                                maxFileSize={5 * 1024 * 1024}
                                                acceptedTypes={ATTACHMENT_ACCEPTED_TYPES}
                                                disabled={isLoadingOverall}
                                            />
                                            <p className="text-[11px] text-center text-muted-foreground">Supported for auto-fill: PDF, PNG, JPG · max 5 MB</p>
                                        </>
                                    )}
                                </div>
                            ) : (
                                /* Stage 2 — plain attachment control to view / replace the processed receipt */
                                <CustomAttachment
                                    label="Upload Payment Proof"
                                    selectedFile={newAttachmentFile}
                                    onFileSelect={handleNewFileSelected}
                                    onError={handleAttachmentError}
                                    maxFileSize={5 * 1024 * 1024}
                                    acceptedTypes={ATTACHMENT_ACCEPTED_TYPES}
                                    disabled={isLoadingOverall}
                                />
                            )}
                    </div>

                    {/* Invoice Details — always shown (invoice can be recorded while paying). */}
                    <Separator className="my-1" />
                    <p className="text-sm font-medium">Invoice Details</p>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="invoice_date_pd" className="text-right col-span-1">Invoice Date</Label>
                        <Input id="invoice_date_pd" name="invoice_date" type="date" value={formState.invoice_date} onChange={handleInputChange} max={formatDateFns(new Date(), "yyyy-MM-dd")} className="col-span-3" />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="invoice_ref_pd" className="text-right col-span-1">Invoice Ref</Label>
                        <Input id="invoice_ref_pd" name="invoice_ref" value={formState.invoice_ref} onChange={handleInputChange} className={cn("col-span-3", formErrors.invoice_ref && "border-destructive")} />
                        {formErrors.invoice_ref && <p className="col-span-3 col-start-2 text-xs text-destructive mt-1">{formErrors.invoice_ref}</p>}
                    </div>
                    <div className="grid grid-cols-4 items-start gap-3">
                        <Label className="text-right col-span-1 pt-2">Invoice Attachment</Label>
                        <div className="col-span-3 space-y-2">
                            {expense.invoice_attachment && !newInvoiceFile && (
                                <div className="flex items-center gap-2 p-2 bg-muted/60 rounded-md text-sm">
                                    <Download className="h-4 w-4 text-primary flex-shrink-0" />
                                    <a
                                        href={SITEURL + expense.invoice_attachment}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="truncate hover:underline"
                                        title={`View ${expense.invoice_attachment.split('/').pop()}`}
                                    >
                                        {expense.invoice_attachment.split('/').pop()}
                                    </a>
                                </div>
                            )}
                            <CustomAttachment
                                label={expense.invoice_attachment ? "Replace Invoice Attachment" : "Upload Invoice Attachment"}
                                selectedFile={newInvoiceFile}
                                onFileSelect={setNewInvoiceFile}
                                onError={handleAttachmentError}
                                maxFileSize={5 * 1024 * 1024}
                                acceptedTypes={ATTACHMENT_ACCEPTED_TYPES}
                            />
                        </div>
                    </div>
                </div>
                <AlertDialogFooter>
                    {isLoadingOverall ? <div className="flex justify-center w-full"><TailSpin color="#4f46e5" height={24} width={24} /></div> : (
                        <>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={handleSubmit} disabled={isSubmitDisabled}>{markAsPaid ? "Mark as Paid" : "Save Changes"}</AlertDialogAction>
                        </>
                    )}
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};