// src/pages/ProjectInvoices/components/NewProjectInvoiceDialog.tsx

import React, { useCallback, useState, useEffect, useMemo } from "react";
import { useFrappeCreateDoc, useFrappeFileUpload, useFrappeGetDocList } from "frappe-react-sdk";
import { TailSpin } from "react-loader-spinner";
import { KeyedMutator } from 'swr';
import { formatDate as formatDateFns } from "date-fns";
import {
    AlertCircle,
    FileUp,
    Building2,
    Calendar,
    Hash,
    IndianRupee,
    FileText,
    Paperclip,
    X as XIcon
} from "lucide-react";

// --- UI Components ---
import ProjectSelect from "@/components/custom-select/project-select";
import { CustomAttachment, AcceptedFileType } from "@/components/helpers/CustomAttachment";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
    AlertDialog, AlertDialogCancel, AlertDialogContent,
    AlertDialogHeader, AlertDialogTitle, AlertDialogFooter
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

const DOCTYPE = "Project Invoices";
const ATTACHMENT_ACCEPTED_TYPES: AcceptedFileType[] = ["image/*", "application/pdf"];

interface NewProjectInvoiceDialogProps {
    listMutate: KeyedMutator<any>;
    ProjectId?: string;
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

const INITIAL_FORM_STATE: InvoiceFormState = {
    invoice_no: "",
    amount: "",
    date: formatDateFns(new Date(), "yyyy-MM-dd"),
    project: "",
    project_name: "",
    customer: "",
    customer_name: "",
};

export function NewProjectInvoiceDialog({ listMutate, ProjectId, onClose }: NewProjectInvoiceDialogProps) {
    const { newProjectInvoiceDialog, toggleNewProjectInvoiceDialog, setNewProjectInvoiceDialog } = useDialogStore();

    const [invoiceData, setInvoiceData] = useState<InvoiceFormState>({
        ...INITIAL_FORM_STATE,
        project: ProjectId || ""
    });
    const [selectedAttachment, setSelectedAttachment] = useState<File | null>(null);
    const [formErrors, setFormErrors] = useState<Partial<Record<keyof InvoiceFormState, string>>>({});
    const [isProjectValidForInvoice, setIsProjectValidForInvoice] = useState(false);

    const { createDoc, loading: createDocLoading } = useFrappeCreateDoc();
    const { upload, loading: uploadLoading } = useFrappeFileUpload();

    // Fetch projects and customers for validation
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

    // Reset form when dialog opens (runs first to clear any stale state)
    useEffect(() => {
        if (newProjectInvoiceDialog) {
            // Always reset to initial state first
            setInvoiceData(INITIAL_FORM_STATE);
            setSelectedAttachment(null);
            setFormErrors({});
            setIsProjectValidForInvoice(false);
        }
    }, [newProjectInvoiceDialog]);

    // Initialize with ProjectId if provided (runs after reset)
    useEffect(() => {
        if (newProjectInvoiceDialog && ProjectId && projects && customers) {
            const project = projects.find(p => p.name === ProjectId);
            if (project) {
                const customerId = project.customer || "";
                const customerName = customers.find(c => c.name === customerId)?.company_name || "";
                setInvoiceData({
                    ...INITIAL_FORM_STATE,
                    project: ProjectId,
                    project_name: project.project_name,
                    customer: customerId,
                    customer_name: customerName || (customerId ? "Customer not found" : "No Customer"),
                });
                setIsProjectValidForInvoice(!!customerId);
            }
        }
    }, [newProjectInvoiceDialog, ProjectId, projects, customers]);

    const handleDialogClose = () => {
        setNewProjectInvoiceDialog(false);
        setInvoiceData(INITIAL_FORM_STATE);
        setSelectedAttachment(null);
        setFormErrors({});
        setIsProjectValidForInvoice(false);
        onClose?.();
    };

    const handleProjectChange = useCallback((selectedOption: { value: string; label: string } | null) => {
        if (selectedOption) {
            const project = projects?.find(p => p.name === selectedOption.value);
            const customerId = project?.customer || "";
            const customerName = customers?.find(c => c.name === customerId)?.company_name || "";

            setInvoiceData(prev => ({
                ...INITIAL_FORM_STATE,
                date: prev.date,
                project: selectedOption.value,
                project_name: selectedOption.label,
                customer: customerId,
                customer_name: customerName || (customerId ? "Customer not found" : "No Customer"),
            }));
            setIsProjectValidForInvoice(!!customerId);

            if (!customerId) {
                toast({
                    title: "Warning",
                    description: "Selected project does not have an associated customer. Invoice cannot be created.",
                    variant: "destructive"
                });
            }
        } else {
            setInvoiceData(INITIAL_FORM_STATE);
            setIsProjectValidForInvoice(false);
        }
        setFormErrors({});
    }, [projects, customers]);

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

    const validateForm = useCallback((): boolean => {
        const errors: Partial<Record<keyof InvoiceFormState, string>> = {};
        if (!invoiceData.project) errors.project = "Project is required.";
        if (!isProjectValidForInvoice) errors.project = "Selected project must have an associated customer.";
        if (!invoiceData.invoice_no.trim()) errors.invoice_no = "Invoice number is required.";
        if (invoiceData.amount.trim() === '' || isNaN(parseNumber(invoiceData.amount)) || parseNumber(invoiceData.amount) <= 0) {
            errors.amount = "A valid amount is required.";
        }
        if (!invoiceData.date) errors.date = "Invoice date is required.";
        if (!selectedAttachment) errors.invoice_no = "Invoice attachment is required.";

        setFormErrors(errors);
        return Object.keys(errors).length === 0;
    }, [invoiceData, isProjectValidForInvoice, selectedAttachment]);

    const handleSubmitInvoice = useCallback(async (event?: React.FormEvent) => {
        if (event) event.preventDefault();
        if (!validateForm()) {
            toast({ title: "Validation Error", description: "Please fill all required fields and attach the invoice.", variant: "destructive" });
            return;
        }

        try {
            let fileUrl: string | undefined = undefined;
            if (selectedAttachment) {
                const tempDocName = `temp-proj-inv-${Date.now()}`;
                const fileArgs = { doctype: DOCTYPE, docname: tempDocName, fieldname: "attachment", isPrivate: true };
                const uploadedFile = await upload(selectedAttachment, fileArgs);
                fileUrl = uploadedFile.file_url;
            }

            if (!fileUrl) {
                toast({ title: "Attachment Error", description: "File upload failed or no attachment selected.", variant: "destructive" });
                return;
            }

            const newInvoicePayload: Omit<ProjectInvoice, 'name' | 'owner' | 'creation' | 'modified'> = {
                invoice_no: invoiceData.invoice_no.trim(),
                amount: parseNumber(invoiceData.amount),
                invoice_date: invoiceData.date,
                attachment: fileUrl,
                project: invoiceData.project,
            };

            await createDoc(DOCTYPE, newInvoicePayload);
            toast({ title: "Success!", description: `Invoice ${invoiceData.invoice_no} created.`, variant: "success" });
            await listMutate();
            handleDialogClose();
        } catch (error) {
            console.error("Error creating Invoice:", error);
            toast({
                title: "Creation Failed",
                description: error instanceof Error ? error.message : "An unexpected error occurred.",
                variant: "destructive"
            });
        }
    }, [invoiceData, selectedAttachment, upload, createDoc, listMutate, validateForm]);

    const isLoading = uploadLoading || createDocLoading || projectsLoading || customersLoading;
    const isSubmitDisabled = isLoading || !invoiceData.project || !invoiceData.invoice_no || !invoiceData.amount || !invoiceData.date || !selectedAttachment || !isProjectValidForInvoice;

    // Truncate filename for display
    const getDisplayFileName = (name: string, maxLength: number = 25) => {
        if (name.length <= maxLength) return name;
        return name.slice(0, maxLength - 3) + '...';
    };

    return (
        <AlertDialog open={newProjectInvoiceDialog} onOpenChange={(isOpen) => { if (!isOpen) handleDialogClose(); else setNewProjectInvoiceDialog(true); }}>
            <AlertDialogContent className="max-w-[480px] p-0 gap-0 overflow-hidden border-0 shadow-2xl">
                {/* Header */}
                <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 px-6 py-5">
                    <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center w-10 h-10 rounded-full bg-emerald-500/20 ring-1 ring-emerald-500/30">
                            <FileUp className="w-5 h-5 text-emerald-400" />
                        </div>
                        <div>
                            <AlertDialogTitle className="text-lg font-semibold text-white tracking-tight">
                                Add New Invoice
                            </AlertDialogTitle>
                            <p className="text-xs text-slate-400 mt-0.5">
                                Upload a project invoice document
                            </p>
                        </div>
                    </div>
                </div>

                {/* Body */}
                <div className="px-6 py-5 space-y-5 bg-white dark:bg-slate-950">
                    {/* Project Context Section */}
                    <div className="space-y-4">
                        <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                            <Building2 className="w-3.5 h-3.5" />
                            Project Context
                        </div>

                        {/* Project Select - only show if no ProjectId */}
                        {!ProjectId && (
                            <div className="space-y-1.5">
                                <Label htmlFor="project" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                                    Select Project <span className="text-red-500">*</span>
                                </Label>
                                <ProjectSelect
                                    key={`project-select-${newProjectInvoiceDialog}`}
                                    onChange={handleProjectChange}
                                    disabled={isLoading}
                                    universal={false}
                                    all
                                    usePortal
                                />
                                {formErrors.project && (
                                    <p className="text-xs text-red-500 flex items-center gap-1 mt-1">
                                        <AlertCircle className="w-3 h-3" />
                                        {formErrors.project}
                                    </p>
                                )}
                            </div>
                        )}

                        {/* Project & Customer Badges */}
                        {invoiceData.project && (
                            <div className="grid grid-cols-2 gap-3">
                                {ProjectId && (
                                    <div className="rounded-lg px-3 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                                        <p className="text-[10px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-0.5">
                                            Project
                                        </p>
                                        <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate" title={invoiceData.project_name || invoiceData.project}>
                                            {invoiceData.project_name || invoiceData.project}
                                        </p>
                                    </div>
                                )}
                                <div className={cn(
                                    "rounded-lg px-3 py-2.5 border transition-colors",
                                    !ProjectId ? "col-span-2" : "",
                                    isProjectValidForInvoice
                                        ? "bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800"
                                        : "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800"
                                )}>
                                    <p className="text-[10px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-0.5">
                                        Customer
                                    </p>
                                    <p className={cn(
                                        "text-sm font-medium truncate",
                                        isProjectValidForInvoice
                                            ? "text-slate-900 dark:text-slate-100"
                                            : "text-amber-700 dark:text-amber-400"
                                    )}>
                                        {invoiceData.customer_name || "No Customer"}
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* Warning Alert */}
                        {invoiceData.project && !isProjectValidForInvoice && (
                            <Alert className="bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 py-3">
                                <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                                <AlertDescription className="text-amber-700 dark:text-amber-300 text-xs leading-relaxed">
                                    This project has no customer assigned. Please update the project details before creating invoices.
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
                    <div className={cn(
                        "space-y-4 transition-opacity",
                        !isProjectValidForInvoice && "opacity-50 pointer-events-none"
                    )}>
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
                                    disabled={!isProjectValidForInvoice || isLoading}
                                    className={cn(
                                        "h-10 transition-all",
                                        "focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500",
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
                                    disabled={!isProjectValidForInvoice || isLoading}
                                    max={formatDateFns(new Date(), "yyyy-MM-dd")}
                                    className={cn(
                                        "h-10 transition-all",
                                        "focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500",
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
                                    disabled={!isProjectValidForInvoice || isLoading}
                                    className={cn(
                                        "pl-7 h-10 text-base font-medium transition-all",
                                        "focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500",
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
                                Invoice Attachment <span className="text-red-500">*</span>
                            </Label>

                            {/* Selected file display */}
                            {selectedAttachment && (
                                <div className="flex items-center justify-between p-3 bg-emerald-50 dark:bg-emerald-950/30 rounded-lg border border-emerald-200 dark:border-emerald-800">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <div className="flex items-center justify-center w-8 h-8 rounded-md bg-emerald-100 dark:bg-emerald-900/50">
                                            <Paperclip className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-sm font-medium text-emerald-900 dark:text-emerald-100 truncate">
                                                {getDisplayFileName(selectedAttachment.name)}
                                            </p>
                                            <p className="text-xs text-emerald-600 dark:text-emerald-400">Ready to upload</p>
                                        </div>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => setSelectedAttachment(null)}
                                        className="h-8 w-8 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-100 dark:hover:bg-emerald-900/50"
                                    >
                                        <XIcon className="h-4 w-4" />
                                    </Button>
                                </div>
                            )}

                            {/* File picker */}
                            {!selectedAttachment && (
                                <CustomAttachment
                                    label="Attach Invoice File"
                                    selectedFile={selectedAttachment}
                                    onFileSelect={setSelectedAttachment}
                                    onError={handleAttachmentError}
                                    maxFileSize={5 * 1024 * 1024}
                                    acceptedTypes={ATTACHMENT_ACCEPTED_TYPES}
                                    isRequired={true}
                                    disabled={!isProjectValidForInvoice || isLoading}
                                />
                            )}
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800">
                    {isLoading ? (
                        <div className="flex items-center justify-center gap-3 py-1">
                            <TailSpin color="#10b981" height={24} width={24} />
                            <span className="text-sm text-slate-500">Creating invoice...</span>
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
                                    "bg-emerald-600 hover:bg-emerald-700 text-white",
                                    "shadow-sm shadow-emerald-600/20",
                                    "disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none",
                                    "transition-all duration-200"
                                )}
                            >
                                <FileUp className="w-4 h-4 mr-2" />
                                Create Invoice
                            </Button>
                        </div>
                    )}
                </div>
            </AlertDialogContent>
        </AlertDialog>
    );
}
