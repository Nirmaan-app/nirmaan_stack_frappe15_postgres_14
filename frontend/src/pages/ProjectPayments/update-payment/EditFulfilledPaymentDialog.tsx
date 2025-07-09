// src/pages/ProjectPayments/update-payment/EditFulfilledPaymentDialog.tsx
// Create this new file.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useFrappeUpdateDoc, useFrappeFileUpload } from "frappe-react-sdk";
import { TailSpin } from "react-loader-spinner";
import { formatDate as formatDateFns } from "date-fns";
import { X as XIcon, Paperclip, Download as DownloadIcon, AlertTriangle } from "lucide-react";

import {
    AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
    AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CustomAttachment, AcceptedFileType } from "@/components/helpers/CustomAttachment";
import { useToast } from "@/components/ui/use-toast";
import { Separator } from "@/components/ui/separator";
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
import SITEURL from "@/constants/siteURL";
import { useDialogStore } from "@/zustand/useDialogStore";
import { parseNumber } from "@/utils/parseNumber";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

interface EditFulfilledPaymentDialogProps {
    payment: ProjectPayments;
    onSuccess?: () => void;
}

interface FormState {
    amount: string;
    tds: string;
    utr: string;
}

type AttachmentUpdateAction = "keep" | "replace" | "remove";
const ATTACHMENT_ACCEPTED_TYPES: AcceptedFileType[] = ["image/*", "application/pdf"];

export const EditFulfilledPaymentDialog: React.FC<EditFulfilledPaymentDialogProps> = ({ payment, onSuccess }) => {
    const { editFulfilledPaymentDialog, setEditFulfilledPaymentDialog } = useDialogStore();
    const { toast } = useToast();
    const { updateDoc, loading: updateLoading } = useFrappeUpdateDoc();
    const { upload, loading: uploadLoading } = useFrappeFileUpload();

    const [formState, setFormState] = useState<FormState>({ amount: "", tds: "", utr: "" });
    const [newAttachmentFile, setNewAttachmentFile] = useState<File | null>(null);
    const [existingAttachmentUrl, setExistingAttachmentUrl] = useState<string | undefined>(undefined);
    const [attachmentAction, setAttachmentAction] = useState<AttachmentUpdateAction>("keep");

    useEffect(() => {
        if (editFulfilledPaymentDialog && payment) {
            setFormState({
                amount: payment.amount?.toString() || "",
                tds: payment.tds?.toString() || "",
                utr: payment.utr || "",
            });
            setExistingAttachmentUrl(payment.payment_attachment);
            setAttachmentAction(payment.payment_attachment ? "keep" : "remove");
            setNewAttachmentFile(null);
        }
    }, [editFulfilledPaymentDialog, payment]);

    // --- (Indicator) NEW: Calculate amountPaid using useMemo for efficiency ---
    const amountPaid = useMemo(() => {
        const totalAmount = parseNumber(formState.amount);
        const tdsAmount = parseNumber(formState.tds);
        return totalAmount - tdsAmount;
    }, [formState.amount, formState.tds]);

    const handleDialogClose = () => setEditFulfilledPaymentDialog(false);

    const handleSubmit = async () => {
        const payload: Partial<ProjectPayments> = {
            amount: parseNumber(formState.amount),
            tds: parseNumber(formState.tds),
            utr: formState.utr,
        };

        try {
            if (attachmentAction === "replace" && newAttachmentFile) {
                const uploadedFile = await upload(newAttachmentFile, {
                    doctype: "Project Payments", docname: payment.name,
                    fieldname: "payment_attachment", isPrivate: true,
                });
                payload.payment_attachment = uploadedFile.file_url;
            } else if (attachmentAction === "remove") {
                payload.payment_attachment = null;
            }

            await updateDoc("Project Payments", payment.name, payload);
            toast({ title: "Success", description: "Payment details updated successfully.", variant: "success" });
            onSuccess?.();
            handleDialogClose();
        } catch (error: any) {
            toast({ title: "Update Failed", description: error.message || "Failed to update payment.", variant: "destructive" });
        }
    };

    const handleNewFileSelected = (file: File | null) => {
        setNewAttachmentFile(file);
        setAttachmentAction(file ? "replace" : (existingAttachmentUrl ? "keep" : "remove"));
    };

    const handleRemoveExistingAttachment = () => {
        setNewAttachmentFile(null);
        setAttachmentAction("remove");
    };

    const isLoadingOverall = updateLoading || uploadLoading;

    // Attachment Display Logic
    let currentAttachmentDisplay: React.ReactNode = null;
    if (newAttachmentFile) {
        currentAttachmentDisplay = (<div className="flex items-center justify-between p-2 bg-blue-50 dark:bg-blue-900/30 rounded-md text-sm border border-blue-200 dark:border-blue-700"><div className="flex items-center gap-2 min-w-0"><Paperclip className="h-4 w-4 text-blue-600 flex-shrink-0" /><span className="truncate" title={newAttachmentFile.name}>{newAttachmentFile.name}</span><span className="text-xs text-blue-500 ml-1 whitespace-nowrap">(New)</span></div></div>);
    } else if ((attachmentAction === "keep" || attachmentAction === "replace") && existingAttachmentUrl) {
        currentAttachmentDisplay = (<div className="flex items-center justify-between p-2 bg-muted/60 rounded-md text-sm"><div className="flex items-center gap-2 min-w-0"><DownloadIcon className="h-4 w-4 text-primary flex-shrink-0" /><a href={SITEURL + existingAttachmentUrl} target="_blank" rel="noopener noreferrer" className="truncate hover:underline">{existingAttachmentUrl.split('/').pop()}</a></div><Button variant="ghost" size="icon" onClick={handleRemoveExistingAttachment} className="h-7 w-7 text-destructive hover:bg-destructive/10"><XIcon className="h-4 w-4" /></Button></div>);
    } else if (attachmentAction === "remove" && existingAttachmentUrl) {
        currentAttachmentDisplay = (<div className="flex items-center gap-2 p-2 bg-amber-50 dark:bg-amber-900/30 rounded-md text-sm text-amber-700"><AlertTriangle className="h-4 w-4 flex-shrink-0" /><span>Attachment will be removed.</span></div>);
    }

    return (
        <AlertDialog open={editFulfilledPaymentDialog} onOpenChange={handleDialogClose}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Edit Fulfilled Payment</AlertDialogTitle>
                    <AlertDialogDescription>Payment ID: {payment.name}</AlertDialogDescription>
                </AlertDialogHeader>
                <div className="py-4 space-y-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="amount_edit" className="text-right">Total Amount</Label>
                        <Input id="amount_edit" type="number" value={formState.amount} onChange={(e) => setFormState(p => ({ ...p, amount: e.target.value }))} className="col-span-3" />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="tds_edit" className="text-right">TDS</Label>
                        <Input id="tds_edit" type="number" value={formState.tds} onChange={(e) => setFormState(p => ({ ...p, tds: e.target.value }))} className="col-span-3" />
                    </div>
                    {/* --- (Indicator) NEW: Display the calculated Amount Paid --- */}
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="amount_paid_display" className="text-right font-semibold">Amount Paid</Label>
                        <div id="amount_paid_display" className="col-span-3">
                            {formatToRoundedIndianRupee(amountPaid)}
                        </div>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="utr_edit" className="text-right">UTR</Label>
                        <Input id="utr_edit" value={formState.utr} onChange={(e) => setFormState(p => ({ ...p, utr: e.target.value }))} className="col-span-3" />
                    </div>
                    <div className="grid grid-cols-4 items-start gap-3">
                        <Label className="text-right col-span-1 pt-2">Proof</Label>
                        <div className="col-span-3 space-y-2">
                            {currentAttachmentDisplay}
                            {(!newAttachmentFile && (attachmentAction === "remove" || !existingAttachmentUrl)) && <CustomAttachment label="Upload New Proof" onFileSelect={handleNewFileSelected} maxFileSize={5 * 1024 * 1024} acceptedTypes={ATTACHMENT_ACCEPTED_TYPES} />}
                            {!newAttachmentFile && existingAttachmentUrl && attachmentAction === "keep" && <CustomAttachment label="Replace Proof" onFileSelect={handleNewFileSelected} maxFileSize={5 * 1024 * 1024} acceptedTypes={ATTACHMENT_ACCEPTED_TYPES} />}
                        </div>
                    </div>
                </div>
                <AlertDialogFooter>
                    {isLoadingOverall ? <div className="flex justify-end w-full"><TailSpin color="#4f46e5" height={28} width={28} /></div> : <>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleSubmit}>Save Changes</AlertDialogAction>
                    </>}
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};