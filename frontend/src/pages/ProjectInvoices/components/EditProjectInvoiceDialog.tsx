// src/pages/ProjectInvoices/components/EditProjectInvoiceDialog.tsx

import React, { useCallback, useState, useEffect } from "react";
import { useFrappeUpdateDoc, useFrappeFileUpload, useFrappeGetDocList } from "frappe-react-sdk";
import { TailSpin } from "react-loader-spinner";
import { KeyedMutator } from 'swr';
import { formatDate as formatDateFns } from "date-fns";
import {
    AlertCircle,
    Pencil,
    Building2,
    Calendar,
    Hash,
    IndianRupee,
    FileText,
    Paperclip,
    X as XIcon,
    Save,
    ExternalLink,
    Trash2,
    AlertTriangle
} from "lucide-react";

// --- UI Components ---
import { CustomAttachment, AcceptedFileType } from "@/components/helpers/CustomAttachment";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
    AlertDialog, AlertDialogCancel, AlertDialogContent,
    AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/use-toast";

// --- Types ---
import { ProjectInvoice } from "@/types/NirmaanStack/ProjectInvoice";
import { Projects } from "@/types/NirmaanStack/Projects";
import { Customers } from "@/types/NirmaanStack/Customers";

// --- Utils & State ---
import { parseNumber } from "@/utils/parseNumber";
import { useDialogStore } from "@/zustand/useDialogStore";
import { getProjectListOptions, queryKeys, getCustomerListOptions } from "@/config/queryKeys";
import { cn } from "@/lib/utils";
import SITEURL from "@/constants/siteURL";

const DOCTYPE = "Project Invoices";
const ATTACHMENT_ACCEPTED_TYPES: AcceptedFileType[] = ["image/*", "application/pdf"];
type AttachmentUpdateAction = "keep" | "replace" | "remove";

interface EditProjectInvoiceDialogProps {
    invoiceToEdit: ProjectInvoice;
    listMutate: KeyedMutator<any>;
    onClose?: () => void;
}

interface InvoiceFormState {
    invoice_no: string;
    amount: string;
    date: string;
    project: string;
    project_name: string;
    customer: string;
    customer_name: string;
}

export function EditProjectInvoiceDialog({ invoiceToEdit, listMutate, onClose }: EditProjectInvoiceDialogProps) {
    const { editProjectInvoiceDialog, setEditProjectInvoiceDialog } = useDialogStore();

    const [invoiceData, setInvoiceData] = useState<InvoiceFormState>({
        invoice_no: "",
        amount: "",
        date: "",
        project: "",
        project_name: "",
        customer: "",
        customer_name: "",
    });
    const [newAttachmentFile, setNewAttachmentFile] = useState<File | null>(null);
    const [existingAttachmentUrl, setExistingAttachmentUrl] = useState<string | undefined>(undefined);
    const [attachmentAction, setAttachmentAction] = useState<AttachmentUpdateAction>("keep");
    const [formErrors, setFormErrors] = useState<Partial<Record<keyof InvoiceFormState, string>>>({});
    const [isProjectValid, setIsProjectValid] = useState(true);

    const { updateDoc, loading: updateDocLoading } = useFrappeUpdateDoc();
    const { upload, loading: uploadLoading } = useFrappeFileUpload();

    // Fetch projects and customers for display
    const { data: projects, isLoading: projectsLoading } = useFrappeGetDocList<Projects>(
        "Projects",
        getProjectListOptions({ fields: ["name", "project_name", "customer"] }) as any,
        queryKeys.projects.list()
    );
    const { data: customers, isLoading: customersLoading } = useFrappeGetDocList<Customers>(
        "Customers",
        getCustomerListOptions({ fields: ["name", "company_name"] }) as any,
        queryKeys.customers.list()
    );

    // Initialize form when dialog opens
    useEffect(() => {
        if (editProjectInvoiceDialog && invoiceToEdit) {
            const project = projects?.find(p => p.name === invoiceToEdit.project);
            const customerId = project?.customer || "";
            const customerName = customers?.find(c => c.name === customerId)?.company_name || "";

            setInvoiceData({
                invoice_no: invoiceToEdit.invoice_no || "",
                amount: invoiceToEdit.amount?.toString() || "",
                date: invoiceToEdit.invoice_date ? formatDateFns(new Date(invoiceToEdit.invoice_date), "yyyy-MM-dd") : "",
                project: invoiceToEdit.project || "",
                project_name: project?.project_name || invoiceToEdit.project || "",
                customer: customerId,
                customer_name: customerName || (customerId ? "Customer not found" : "No Customer"),
            });
            setNewAttachmentFile(null);
            setFormErrors({});
            setExistingAttachmentUrl(invoiceToEdit.attachment);
            setAttachmentAction(invoiceToEdit.attachment ? "keep" : "remove");
            setIsProjectValid(!!customerId);

            if (!customerId && invoiceToEdit.project) {
                toast({
                    title: "Warning",
                    description: "The associated project does not have a customer linked.",
                    variant: "default"
                });
            }
        }
    }, [editProjectInvoiceDialog, invoiceToEdit, projects, customers]);

    const handleDialogClose = () => {
        setEditProjectInvoiceDialog(false);
        setInvoiceData({
            invoice_no: "",
            amount: "",
            date: "",
            project: "",
            project_name: "",
            customer: "",
            customer_name: "",
        });
        setNewAttachmentFile(null);
        setExistingAttachmentUrl(undefined);
        setAttachmentAction("keep");
        setFormErrors({});
        onClose?.();
    };

    const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setInvoiceData(prev => ({ ...prev, [name]: value }));
        if (formErrors[name as keyof InvoiceFormState]) {
            setFormErrors(prev => ({ ...prev, [name]: undefined }));
        }
    }, [formErrors]);

    const handleAttachmentError = useCallback(({ message }: { type: "size" | "type", message: string }) => {
        toast({ title: "Attachment Error", description: message, variant: "destructive" });
    }, []);

    const handleNewFileSelected = (file: File | null) => {
        setNewAttachmentFile(file);
        setAttachmentAction(file ? "replace" : (existingAttachmentUrl ? "keep" : "remove"));
    };

    const handleRemoveExistingAttachment = () => {
        setNewAttachmentFile(null);
        setAttachmentAction("remove");
    };

    const validateForm = useCallback((): boolean => {
        const errors: Partial<Record<keyof InvoiceFormState, string>> = {};
        if (!invoiceData.invoice_no.trim()) errors.invoice_no = "Invoice number is required.";
        if (invoiceData.amount.trim() === '' || isNaN(parseNumber(invoiceData.amount)) || parseNumber(invoiceData.amount) <= 0) {
            errors.amount = "A valid amount is required.";
        }
        if (!invoiceData.date) errors.date = "Invoice date is required.";
        setFormErrors(errors);
        return Object.keys(errors).length === 0;
    }, [invoiceData]);

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
        };

        try {
            if (attachmentAction === "replace" && newAttachmentFile) {
                const uploadedFile = await upload(newAttachmentFile, {
                    doctype: DOCTYPE,
                    docname: invoiceToEdit.name,
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
    }, [invoiceData, newAttachmentFile, invoiceToEdit, attachmentAction, upload, updateDoc, listMutate, validateForm]);

    const isLoading = uploadLoading || updateDocLoading || projectsLoading || customersLoading;
    const isSubmitDisabled = isLoading || !invoiceData.invoice_no || !invoiceData.amount || !invoiceData.date;

    // Get filename from URL and truncate
    const getFileName = (url: string, maxLength: number = 25) => {
        const parts = url.split('/');
        const filename = parts[parts.length - 1] || 'attachment';
        if (filename.length <= maxLength) return filename;
        const ext = filename.lastIndexOf('.') > 0 ? filename.slice(filename.lastIndexOf('.')) : '';
        const nameWithoutExt = filename.slice(0, filename.lastIndexOf('.') > 0 ? filename.lastIndexOf('.') : filename.length);
        const truncatedName = nameWithoutExt.slice(0, maxLength - ext.length - 3) + '...' + ext;
        return truncatedName;
    };

    // Truncate new filename for display
    const getDisplayFileName = (name: string, maxLength: number = 25) => {
        if (name.length <= maxLength) return name;
        return name.slice(0, maxLength - 3) + '...';
    };

    return (
        <AlertDialog open={editProjectInvoiceDialog} onOpenChange={(isOpen) => { if (!isOpen) handleDialogClose(); else setEditProjectInvoiceDialog(true); }}>
            <AlertDialogContent className="max-w-[480px] p-0 gap-0 overflow-hidden border-0 shadow-2xl">
                {/* Header */}
                <div className="bg-gradient-to-br from-slate-800 via-slate-700 to-slate-800 px-6 py-5">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-amber-500/20 ring-1 ring-amber-500/30">
                                <Pencil className="w-5 h-5 text-amber-400" />
                            </div>
                            <div>
                                <AlertDialogTitle className="text-lg font-semibold text-white tracking-tight">
                                    Edit Invoice
                                </AlertDialogTitle>
                                <p className="text-xs text-slate-400 mt-0.5">
                                    Update invoice details
                                </p>
                            </div>
                        </div>
                        <div className="px-2.5 py-1 rounded-md bg-slate-600/50 border border-slate-500/30">
                            <p className="text-[10px] font-mono text-slate-300">{invoiceToEdit.name}</p>
                        </div>
                    </div>
                </div>

                {/* Body */}
                <div className="px-6 py-5 space-y-5 bg-white dark:bg-slate-950">
                    {/* Project Context Section - Read Only */}
                    <div className="space-y-3">
                        <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                            <Building2 className="w-3.5 h-3.5" />
                            Invoice Context
                        </div>

                        {/* Project & Customer Badges */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="rounded-lg px-3 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                                <p className="text-[10px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-0.5">
                                    Project
                                </p>
                                <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate" title={invoiceData.project_name || invoiceData.project}>
                                    {invoiceData.project_name || invoiceData.project || "--"}
                                </p>
                            </div>
                            <div className={cn(
                                "rounded-lg px-3 py-2.5 border transition-colors",
                                isProjectValid
                                    ? "bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800"
                                    : "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800"
                            )}>
                                <p className="text-[10px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-0.5">
                                    Customer
                                </p>
                                <p className={cn(
                                    "text-sm font-medium truncate",
                                    isProjectValid
                                        ? "text-slate-900 dark:text-slate-100"
                                        : "text-amber-700 dark:text-amber-400"
                                )}>
                                    {invoiceData.customer_name || "No Customer"}
                                </p>
                            </div>
                        </div>

                        {/* Warning Alert */}
                        {invoiceData.project && !isProjectValid && (
                            <Alert className="bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 py-3">
                                <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                                <AlertDescription className="text-amber-700 dark:text-amber-300 text-xs leading-relaxed">
                                    This project has no customer assigned. Please update the project details first.
                                </AlertDescription>
                            </Alert>
                        )}
                    </div>

                    {/* Divider */}
                    <div className="relative">
                        <div className="absolute inset-0 flex items-center">
                            <div className="w-full border-t border-slate-200 dark:border-slate-800" />
                        </div>
                        <div className="relative flex justify-center">
                            <span className="bg-white dark:bg-slate-950 px-3 text-xs font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                                Invoice Details
                            </span>
                        </div>
                    </div>

                    {/* Invoice Details Section */}
                    <div className="space-y-4">
                        {/* Invoice Number and Date - Side by side */}
                        <div className="grid grid-cols-2 gap-3">
                            {/* Invoice Number */}
                            <div className="space-y-1.5">
                                <Label htmlFor="invoice_no" className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2">
                                    <Hash className="w-3.5 h-3.5 text-slate-400" />
                                    Invoice No <span className="text-red-500">*</span>
                                </Label>
                                <Input
                                    id="invoice_no"
                                    name="invoice_no"
                                    type="text"
                                    placeholder="INV-001"
                                    value={invoiceData.invoice_no}
                                    onChange={handleInputChange}
                                    disabled={isLoading}
                                    className={cn(
                                        "h-10 transition-all",
                                        "focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500",
                                        formErrors.invoice_no && "border-red-300 focus:border-red-500 focus:ring-red-500/20"
                                    )}
                                />
                                {formErrors.invoice_no && (
                                    <p className="text-xs text-red-500 flex items-center gap-1">
                                        <AlertCircle className="w-3 h-3" />
                                        {formErrors.invoice_no}
                                    </p>
                                )}
                            </div>

                            {/* Invoice Date */}
                            <div className="space-y-1.5">
                                <Label htmlFor="date" className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2">
                                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                                    Date <span className="text-red-500">*</span>
                                </Label>
                                <Input
                                    id="date"
                                    name="date"
                                    type="date"
                                    value={invoiceData.date}
                                    onChange={handleInputChange}
                                    disabled={isLoading}
                                    max={formatDateFns(new Date(), "yyyy-MM-dd")}
                                    className={cn(
                                        "h-10 transition-all",
                                        "focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500",
                                        formErrors.date && "border-red-300 focus:border-red-500 focus:ring-red-500/20"
                                    )}
                                />
                                {formErrors.date && (
                                    <p className="text-xs text-red-500 flex items-center gap-1">
                                        <AlertCircle className="w-3 h-3" />
                                        {formErrors.date}
                                    </p>
                                )}
                            </div>
                        </div>

                        {/* Amount */}
                        <div className="space-y-1.5">
                            <Label htmlFor="amount" className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2">
                                <IndianRupee className="w-3.5 h-3.5 text-slate-400" />
                                Amount (Incl. GST) <span className="text-red-500">*</span>
                            </Label>
                            <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-medium">₹</span>
                                <Input
                                    id="amount"
                                    name="amount"
                                    type="text"
                                    inputMode="decimal"
                                    placeholder="0.00"
                                    value={invoiceData.amount}
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        if (/^-?\d*\.?\d*$/.test(val)) {
                                            setInvoiceData(prev => ({ ...prev, amount: val }));
                                            if (formErrors.amount) {
                                                setFormErrors(prev => ({ ...prev, amount: undefined }));
                                            }
                                        }
                                    }}
                                    disabled={isLoading}
                                    className={cn(
                                        "pl-7 h-10 text-base font-medium transition-all",
                                        "focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500",
                                        formErrors.amount && "border-red-300 focus:border-red-500 focus:ring-red-500/20"
                                    )}
                                />
                            </div>
                            {formErrors.amount && (
                                <p className="text-xs text-red-500 flex items-center gap-1">
                                    <AlertCircle className="w-3 h-3" />
                                    {formErrors.amount}
                                </p>
                            )}
                        </div>

                        {/* Attachment Section */}
                        <div className="space-y-2">
                            <Label className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2">
                                <FileText className="w-3.5 h-3.5 text-slate-400" />
                                Invoice Attachment
                                <span className="text-xs font-normal text-slate-400">(Optional)</span>
                            </Label>

                            {/* New file selected */}
                            {newAttachmentFile && (
                                <div className="flex items-center justify-between p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-800">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <div className="flex items-center justify-center w-8 h-8 rounded-md bg-blue-100 dark:bg-blue-900/50">
                                            <Paperclip className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-sm font-medium text-blue-900 dark:text-blue-100 truncate">
                                                {getDisplayFileName(newAttachmentFile.name)}
                                            </p>
                                            <p className="text-xs text-blue-600 dark:text-blue-400">New file selected</p>
                                        </div>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => setNewAttachmentFile(null)}
                                        className="h-8 w-8 text-blue-600 hover:text-blue-700 hover:bg-blue-100 dark:hover:bg-blue-900/50"
                                    >
                                        <XIcon className="h-4 w-4" />
                                    </Button>
                                </div>
                            )}

                            {/* Existing attachment */}
                            {!newAttachmentFile && existingAttachmentUrl && attachmentAction === "keep" && (
                                <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <div className="flex items-center justify-center w-8 h-8 rounded-md bg-slate-100 dark:bg-slate-800">
                                            <FileText className="h-4 w-4 text-slate-600 dark:text-slate-400" />
                                        </div>
                                        <div className="min-w-0">
                                            <a
                                                href={SITEURL + existingAttachmentUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-sm font-medium text-slate-900 dark:text-slate-100 hover:text-blue-600 dark:hover:text-blue-400 truncate flex items-center gap-1"
                                            >
                                                {getFileName(existingAttachmentUrl)}
                                                <ExternalLink className="w-3 h-3 flex-shrink-0" />
                                            </a>
                                            <p className="text-xs text-slate-500">Current attachment</p>
                                        </div>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={handleRemoveExistingAttachment}
                                        className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            )}

                            {/* Marked for removal */}
                            {!newAttachmentFile && attachmentAction === "remove" && existingAttachmentUrl && (
                                <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-200 dark:border-amber-800">
                                    <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                                    <p className="text-sm text-amber-700 dark:text-amber-300">
                                        Attachment will be removed on save
                                    </p>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setAttachmentAction("keep")}
                                        className="ml-auto h-7 text-xs text-amber-700 hover:text-amber-800 hover:bg-amber-100 dark:hover:bg-amber-900/30"
                                    >
                                        Undo
                                    </Button>
                                </div>
                            )}

                            {/* Upload new attachment */}
                            {!newAttachmentFile && (attachmentAction === "remove" || !existingAttachmentUrl) && (
                                <CustomAttachment
                                    label="Upload New Invoice"
                                    selectedFile={newAttachmentFile}
                                    onFileSelect={handleNewFileSelected}
                                    onError={handleAttachmentError}
                                    maxFileSize={5 * 1024 * 1024}
                                    acceptedTypes={ATTACHMENT_ACCEPTED_TYPES}
                                    disabled={isLoading}
                                />
                            )}

                            {/* Replace option when keeping existing */}
                            {!newAttachmentFile && existingAttachmentUrl && attachmentAction === "keep" && (
                                <CustomAttachment
                                    label="Replace with new file"
                                    selectedFile={null}
                                    onFileSelect={handleNewFileSelected}
                                    onError={handleAttachmentError}
                                    maxFileSize={5 * 1024 * 1024}
                                    acceptedTypes={ATTACHMENT_ACCEPTED_TYPES}
                                    disabled={isLoading}
                                />
                            )}
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800">
                    {isLoading ? (
                        <div className="flex items-center justify-center gap-3 py-1">
                            <TailSpin color="#f59e0b" height={24} width={24} />
                            <span className="text-sm text-slate-500">Saving changes...</span>
                        </div>
                    ) : (
                        <div className="flex items-center justify-end gap-3">
                            <AlertDialogCancel
                                onClick={handleDialogClose}
                                className="h-10 px-4 text-sm font-medium bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border-slate-200 dark:border-slate-700"
                            >
                                Cancel
                            </AlertDialogCancel>
                            <Button
                                onClick={handleSubmitInvoice}
                                disabled={isSubmitDisabled}
                                className={cn(
                                    "h-10 px-5 text-sm font-medium",
                                    "bg-amber-600 hover:bg-amber-700 text-white",
                                    "shadow-sm shadow-amber-600/20",
                                    "disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none",
                                    "transition-all duration-200"
                                )}
                            >
                                <Save className="w-4 h-4 mr-2" />
                                Save Changes
                            </Button>
                        </div>
                    )}
                </div>
            </AlertDialogContent>
        </AlertDialog>
    );
}
