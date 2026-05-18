// src/pages/ProjectInvoices/components/NewProjectInvoiceDialog.tsx

import React, { useCallback, useState, useEffect, useMemo } from "react";
import { useFrappeCreateDoc, useFrappeFileUpload, useFrappeGetDocList, useFrappePostCall } from "frappe-react-sdk";
import { useGstOptions } from "@/hooks/useGstOptions";
import { TailSpin } from "react-loader-spinner";
import { KeyedMutator } from 'swr';
import { formatDate as formatDateFns } from "date-fns";
import {
    AlertCircle,
    AlertTriangle,
    FileUp,
    Building2,
    Calendar,
    Hash,
    IndianRupee,
    FileText,
    Sparkles,
    Loader2,
    ArrowLeft,
    ArrowRight,
} from "lucide-react";

// --- UI Components ---
import ProjectSelect from "@/components/custom-select/project-select";
import { CustomAttachment, AcceptedFileType } from "@/components/helpers/CustomAttachment";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
    AlertDialog, AlertDialogCancel, AlertDialogContent,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
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
    amount_excl_gst: string;
    date: string;
    project: string;
    project_name: string;
    project_gst: string;
    customer: string;
    customer_name: string;
}

const INITIAL_FORM_STATE: InvoiceFormState = {
    invoice_no: "",
    amount: "",
    amount_excl_gst: "",
    date: formatDateFns(new Date(), "yyyy-MM-dd"),
    project: "",
    project_name: "",
    project_gst: "",
    customer: "",
    customer_name: "",
};

type Stage = "select" | "upload" | "form";

export function NewProjectInvoiceDialog({ listMutate, ProjectId, onClose }: NewProjectInvoiceDialogProps) {
    const { newProjectInvoiceDialog, setNewProjectInvoiceDialog } = useDialogStore();

    const [invoiceData, setInvoiceData] = useState<InvoiceFormState>({
        ...INITIAL_FORM_STATE,
        project: ProjectId || ""
    });
    const [selectedAttachment, setSelectedAttachment] = useState<File | null>(null);
    const [formErrors, setFormErrors] = useState<Partial<Record<keyof InvoiceFormState, string>>>({});
    const [isProjectValidForInvoice, setIsProjectValidForInvoice] = useState(false);
    const [stage, setStage] = useState<Stage>(ProjectId ? "upload" : "select");

    // Document AI autofill state
    const [isAutofilling, setIsAutofilling] = useState(false);
    const [autofilledFields, setAutofilledFields] = useState<Set<"invoice_no" | "date" | "amount" | "amount_excl_gst">>(new Set());
    const [uploadedFileUrl, setUploadedFileUrl] = useState<string | null>(null);
    const [autofillConfidence, setAutofillConfidence] = useState<Record<string, number> | null>(null);
    const [autofillExtractedValues, setAutofillExtractedValues] = useState<{
        invoice_no?: string;
        invoice_date?: string;
        amount?: string;
        net_amount?: string;
    } | null>(null);
    const [autofillAllEntities, setAutofillAllEntities] = useState<
        Array<{ type: string; value: string; confidence: number }> | null
    >(null);
    const [autofillProcessorId, setAutofillProcessorId] = useState<string | null>(null);
    const [autofillSupplierGstin, setAutofillSupplierGstin] = useState<string>("");

    const { createDoc, loading: createDocLoading } = useFrappeCreateDoc();
    const { upload, loading: uploadLoading } = useFrappeFileUpload();
    const { call: extractInvoiceFieldsApi } = useFrappePostCall(
        "nirmaan_stack.api.invoice_autofill.extract_invoice_fields"
    );

    // Fetch projects and customers for validation
    const { data: projects, isLoading: projectsLoading } = useFrappeGetDocList<Projects>(
        "Projects",
        getProjectListOptions({ fields: ["name", "project_name", "customer", "project_gst"] }) as any,
        queryKeys.projects.list()
    );
    const { gstOptions, isLoading: gstOptionsLoading } = useGstOptions();
    const { data: customers, isLoading: customersLoading } = useFrappeGetDocList<Customers>(
        "Customers",
        getCustomerListOptions() as any,
        queryKeys.customers.list()
    );

    // Reset everything when dialog opens
    useEffect(() => {
        if (newProjectInvoiceDialog) {
            setInvoiceData(INITIAL_FORM_STATE);
            setSelectedAttachment(null);
            setFormErrors({});
            setIsProjectValidForInvoice(false);
            setStage(ProjectId ? "upload" : "select");
            setIsAutofilling(false);
            setAutofilledFields(new Set());
            setUploadedFileUrl(null);
            setAutofillConfidence(null);
            setAutofillExtractedValues(null);
            setAutofillAllEntities(null);
            setAutofillProcessorId(null);
            setAutofillSupplierGstin("");
        }
    }, [newProjectInvoiceDialog, ProjectId]);

    // Reset autofill state when user clears the file
    useEffect(() => {
        if (selectedAttachment === null) {
            setAutofilledFields(new Set());
            setUploadedFileUrl(null);
            setAutofillConfidence(null);
            setAutofillExtractedValues(null);
            setAutofillAllEntities(null);
            setAutofillProcessorId(null);
            setAutofillSupplierGstin("");
        }
    }, [selectedAttachment]);

    // Pre-fill from ProjectId if provided
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
                    project_gst: project.project_gst || "",
                    customer: customerId,
                    customer_name: customerName || (customerId ? "Customer not found" : "No Customer"),
                });
                setIsProjectValidForInvoice(!!customerId);
            }
        }
    }, [newProjectInvoiceDialog, ProjectId, projects, customers]);

    const handleDialogClose = useCallback(() => {
        setNewProjectInvoiceDialog(false);
        setInvoiceData(INITIAL_FORM_STATE);
        setSelectedAttachment(null);
        setFormErrors({});
        setIsProjectValidForInvoice(false);
        setStage(ProjectId ? "upload" : "select");
        onClose?.();
    }, [setNewProjectInvoiceDialog, ProjectId, onClose]);

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
                project_gst: project?.project_gst || "",
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

    const clearAutofillFlag = useCallback((field: "invoice_no" | "date" | "amount" | "amount_excl_gst") => {
        setAutofilledFields(prev => {
            if (!prev.has(field)) return prev;
            const next = new Set(prev);
            next.delete(field);
            return next;
        });
    }, []);

    const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setInvoiceData(prev => ({ ...prev, [name]: value }));
        if (formErrors[name as keyof InvoiceFormState]) {
            setFormErrors(prev => ({ ...prev, [name]: undefined }));
        }
        if (name === "invoice_no") clearAutofillFlag("invoice_no");
        if (name === "date") clearAutofillFlag("date");
    }, [formErrors, clearAutofillFlag]);

    const handleAttachmentError = useCallback(({ message }: { type: "size" | "type", message: string }) => {
        toast({ title: "Attachment Error", description: message, variant: "destructive" });
    }, []);

    const runAutofillExtraction = useCallback(async (file: File) => {
        setIsAutofilling(true);
        try {
            const tempDocName = `temp-proj-inv-${Date.now()}`;
            const uploaded = await upload(file, {
                doctype: DOCTYPE,
                docname: tempDocName,
                fieldname: "attachment",
                isPrivate: true,
            });
            const fileUrl = uploaded.file_url;
            setUploadedFileUrl(fileUrl);

            const response = await extractInvoiceFieldsApi({ file_url: fileUrl });
            const extracted = response?.message;
            if (!extracted) {
                toast({
                    title: "Auto-fill returned nothing",
                    description: "AI could not extract any fields. Please fill in manually.",
                    variant: "default",
                });
                return;
            }

            // Compute updates synchronously so `filled.size` reflects the actual
            // count when we decide which toast to show.
            const filled = new Set<"invoice_no" | "date" | "amount" | "amount_excl_gst">();
            const updates: Partial<InvoiceFormState> = {};
            if (extracted.invoice_no) {
                updates.invoice_no = extracted.invoice_no;
                filled.add("invoice_no");
            }
            if (extracted.invoice_date) {
                updates.date = extracted.invoice_date;
                filled.add("date");
            }
            if (extracted.amount) {
                updates.amount = String(extracted.amount);
                filled.add("amount");
            }
            if (extracted.net_amount) {
                updates.amount_excl_gst = String(extracted.net_amount);
                filled.add("amount_excl_gst");
            }

            if (Array.isArray(extracted.entities)) {
                setAutofillAllEntities(extracted.entities);
                const sup = extracted.entities.find((e: any) =>
                    (e?.type || "").toLowerCase() === "supplier_gstin"
                );
                setAutofillSupplierGstin((sup?.value || "").trim().toUpperCase());
            }

            setInvoiceData((prev) => ({ ...prev, ...updates }));
            setAutofilledFields(filled);
            setAutofillExtractedValues({
                invoice_no: extracted.invoice_no || "",
                invoice_date: extracted.invoice_date || "",
                amount: extracted.amount ? String(extracted.amount) : "",
                net_amount: extracted.net_amount ? String(extracted.net_amount) : "",
            });
            if (extracted.confidence && typeof extracted.confidence === "object") {
                setAutofillConfidence(extracted.confidence);
            }
            if (extracted.processor_id) {
                setAutofillProcessorId(extracted.processor_id);
            }

            if (filled.size > 0) {
                setFormErrors(prev => {
                    const next = { ...prev };
                    if (filled.has("invoice_no")) delete next.invoice_no;
                    if (filled.has("date")) delete next.date;
                    if (filled.has("amount")) delete next.amount;
                    if (filled.has("amount_excl_gst")) delete next.amount_excl_gst;
                    return next;
                });
            }

            if (filled.size === 0) {
                toast({
                    title: "No high-confidence fields found",
                    description: "AI did not return values above the confidence threshold. Please fill in manually.",
                    variant: "default",
                });
            } else {
                toast({
                    title: "Auto-filled from invoice",
                    description: `${filled.size} field(s) extracted. Please review before submitting.`,
                    variant: "success",
                });
            }
        } catch (error) {
            console.error("Auto-fill error:", error);
            toast({
                title: "Auto-fill Failed",
                description: error instanceof Error ? `${error.message} You can fill in the details manually.` : "Could not extract fields. Please fill in manually.",
                variant: "destructive",
            });
        } finally {
            setIsAutofilling(false);
            // Always advance to form stage — manual fill is the fallback.
            setStage("form");
        }
    }, [upload, extractInvoiceFieldsApi]);

    const handleAttachmentSelect = useCallback((file: File | null) => {
        setSelectedAttachment(file);
        if (file && !isAutofilling) {
            runAutofillExtraction(file);
        }
    }, [isAutofilling, runAutofillExtraction]);

    const validateForm = useCallback((): boolean => {
        const errors: Partial<Record<keyof InvoiceFormState, string>> = {};
        if (!invoiceData.project) errors.project = "Project is required.";
        if (!isProjectValidForInvoice) errors.project = "Selected project must have an associated customer.";
        if (!invoiceData.invoice_no.trim()) errors.invoice_no = "Invoice number is required.";
        if (invoiceData.amount.trim() === '' || isNaN(parseNumber(invoiceData.amount))) {
            errors.amount = "A valid amount is required.";
        }
        if (!invoiceData.project_gst) errors.project_gst = "Project GST is required.";
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
            // Reuse the URL from the autofill upload if available — avoids a
            // second upload of the same file.
            let fileUrl: string | null = uploadedFileUrl;
            if (!fileUrl && selectedAttachment) {
                const tempDocName = `temp-proj-inv-${Date.now()}`;
                const fileArgs = { doctype: DOCTYPE, docname: tempDocName, fieldname: "attachment", isPrivate: true };
                const uploadedFile = await upload(selectedAttachment, fileArgs);
                fileUrl = uploadedFile.file_url;
            }

            if (!fileUrl) {
                toast({ title: "Attachment Error", description: "File upload failed or no attachment selected.", variant: "destructive" });
                return;
            }

            const autofillUsed = autofilledFields.size > 0;
            const newInvoicePayload: Partial<ProjectInvoice> = {
                invoice_no: invoiceData.invoice_no.trim(),
                amount: parseNumber(invoiceData.amount),
                invoice_date: invoiceData.date,
                attachment: fileUrl,
                project: invoiceData.project,
                project_gst: invoiceData.project_gst,
                // Excl. GST is optional — only persist when user entered or AI filled it
                ...(invoiceData.amount_excl_gst.trim() !== ""
                    ? { amount_excl_gst: parseNumber(invoiceData.amount_excl_gst) }
                    : {}),
                // Autofill audit fields — only persisted when autofill was used
                autofill_used: autofillUsed ? 1 : 0,
                ...(autofillUsed && autofillProcessorId
                    ? { autofill_processor_id: autofillProcessorId }
                    : {}),
                ...(autofillUsed && autofillExtractedValues?.invoice_no
                    ? { autofill_extracted_invoice_no: autofillExtractedValues.invoice_no }
                    : {}),
                ...(autofillUsed && autofillExtractedValues?.invoice_date
                    ? { autofill_extracted_invoice_date: autofillExtractedValues.invoice_date }
                    : {}),
                ...(autofillUsed && autofillExtractedValues?.amount
                    ? { autofill_extracted_amount: parseNumber(autofillExtractedValues.amount) }
                    : {}),
                ...(autofillUsed && autofillExtractedValues?.net_amount
                    ? { autofill_extracted_net_amount: parseNumber(autofillExtractedValues.net_amount) }
                    : {}),
                ...(autofillUsed && autofillConfidence
                    ? { autofill_confidence_json: JSON.stringify(autofillConfidence) }
                    : {}),
                ...(autofillUsed && autofillAllEntities && autofillAllEntities.length > 0
                    ? { autofill_all_entities_json: JSON.stringify(autofillAllEntities) }
                    : {}),
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
    }, [
        invoiceData,
        selectedAttachment,
        uploadedFileUrl,
        upload,
        createDoc,
        listMutate,
        validateForm,
        handleDialogClose,
        autofilledFields,
        autofillConfidence,
        autofillExtractedValues,
        autofillAllEntities,
        autofillProcessorId,
    ]);

    const isLoading = uploadLoading || createDocLoading || projectsLoading || customersLoading || gstOptionsLoading;

    // Supplier-GSTIN mismatch — extracted supplier (= Nirmaan, since this is a
    // sales invoice) vs the GSTIN behind the selected Project GST option.
    // Frontend-only soft warning; submit is never blocked.
    const expectedSupplierGstin = useMemo(() => {
        const opt = gstOptions.find(o => o.value === invoiceData.project_gst);
        return (opt?.gst || "").trim().toUpperCase();
    }, [gstOptions, invoiceData.project_gst]);

    const supplierGstinMismatch = useMemo(() => {
        if (!autofillSupplierGstin || !expectedSupplierGstin) return false;
        return autofillSupplierGstin !== expectedSupplierGstin;
    }, [autofillSupplierGstin, expectedSupplierGstin]);

    // Truncate filename for display
    const getDisplayFileName = (name: string, maxLength: number = 25) => {
        if (name.length <= maxLength) return name;
        return name.slice(0, maxLength - 3) + '...';
    };

    const canContinueFromSelect =
        !!invoiceData.project &&
        isProjectValidForInvoice &&
        !!invoiceData.project_gst;

    const handleContinueToUpload = useCallback(() => {
        const errors: Partial<Record<keyof InvoiceFormState, string>> = {};
        if (!invoiceData.project) errors.project = "Project is required.";
        else if (!isProjectValidForInvoice) errors.project = "Selected project must have an associated customer.";
        if (!invoiceData.project_gst) errors.project_gst = "Project GST is required.";
        setFormErrors(errors);
        if (Object.keys(errors).length === 0) {
            setStage("upload");
        }
    }, [invoiceData.project, invoiceData.project_gst, isProjectValidForInvoice]);

    const handleBackFromUpload = useCallback(() => {
        setSelectedAttachment(null);
        setStage("select");
    }, []);

    const handleBackFromForm = useCallback(() => {
        // Going back to upload clears the attachment so the user can re-pick.
        setSelectedAttachment(null);
        setStage("upload");
    }, []);

    const isSubmitDisabled =
        isLoading ||
        !invoiceData.invoice_no.trim() ||
        !invoiceData.amount ||
        !invoiceData.date ||
        !selectedAttachment ||
        !isProjectValidForInvoice ||
        !invoiceData.project_gst;

    // Context badge shown above upload + form stages so user keeps orientation.
    // Uses `grid grid-cols-2 min-w-0` so long names truncate cleanly instead of
    // pushing the dialog wider than max-w-[480px].
    const contextBadge = (
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-3 py-2 space-y-1 min-w-0">
            <div className="grid grid-cols-2 gap-3 min-w-0">
                <div className="min-w-0">
                    <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Project</p>
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate" title={invoiceData.project_name || invoiceData.project}>
                        {invoiceData.project_name || invoiceData.project}
                    </p>
                </div>
                <div className="min-w-0 text-right">
                    <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Customer</p>
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate" title={invoiceData.customer_name || ""}>
                        {invoiceData.customer_name || "—"}
                    </p>
                </div>
            </div>
            {invoiceData.project_gst && (
                <div className="flex items-center gap-2 pt-1 border-t border-slate-200 dark:border-slate-800 min-w-0">
                    <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider shrink-0">GST</p>
                    <p className="text-xs font-mono text-slate-700 dark:text-slate-300 truncate shrink-0">
                        {gstOptions.find(o => o.value === invoiceData.project_gst)?.gst || invoiceData.project_gst}
                    </p>
                    <p className="text-xs text-slate-500 truncate min-w-0">
                        ({gstOptions.find(o => o.value === invoiceData.project_gst)?.location || ""})
                    </p>
                </div>
            )}
        </div>
    );

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
                                {stage === "select" && "Choose project and GST"}
                                {stage === "upload" && "Upload your invoice — we'll read it for you"}
                                {stage === "form" && "Review the extracted details"}
                            </p>
                        </div>
                    </div>
                </div>

                {/* ───── Stage 1: Select project + GST ─────
                    Always mounted (when no ProjectId) so the uncontrolled
                    ProjectSelect keeps its internal state across Back navigation.
                    Toggled via `hidden` instead of conditional render. */}
                {!ProjectId && (
                    <div className={cn(stage !== "select" && "hidden")}>
                <div className="px-6 py-5 space-y-5 bg-white dark:bg-slate-950">
                    <div className="space-y-4">
                        <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                            <Building2 className="w-3.5 h-3.5" />
                            Project Context
                        </div>

                        {/* Project Select */}
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

                            {/* Customer badge */}
                        {invoiceData.project && (
                                <div className={cn(
                                    "rounded-lg px-3 py-2.5 border transition-colors",
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
                        )}

                        {invoiceData.project && !isProjectValidForInvoice && (
                            <Alert className="bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 py-3">
                                <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                                <AlertDescription className="text-amber-700 dark:text-amber-300 text-xs leading-relaxed">
                                    This project has no customer assigned. Please update the project details before creating invoices.
                                </AlertDescription>
                            </Alert>
                        )}
                    </div>

                            {/* Project GST */}
                        <div className="space-y-1.5 px-0.5">
                            <Label htmlFor="project_gst" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                                Project GST <span className="text-red-500">*</span>
                            </Label>
                            <Select
                                value={invoiceData.project_gst}
                                onValueChange={(val) => {
                                    setInvoiceData(prev => ({ ...prev, project_gst: val }));
                                    if (formErrors.project_gst) {
                                        setFormErrors(prev => ({ ...prev, project_gst: undefined }));
                                    }
                                }}
                                disabled={isLoading || !isProjectValidForInvoice}
                            >
                                <SelectTrigger className={cn(
                                    "h-10 transition-all focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500",
                                    formErrors.project_gst && "border-red-300 focus:border-red-500 focus:ring-red-500/20"
                                )}>
                                    <SelectValue placeholder="Select GST Location" />
                                </SelectTrigger>
                                <SelectContent>
                                    {gstOptions.map((opt) => (
                                        <SelectItem key={opt.value} value={opt.value}>
                                            <div className="flex items-center gap-2">
                                                <span className="font-medium text-sm">{opt.location}</span>
                                                <span className="text-[10px] text-slate-500 font-mono">({opt.gst})</span>
                                            </div>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {formErrors.project_gst && (
                                <p className="text-xs text-red-500 flex items-center gap-1 mt-1">
                                    <AlertCircle className="w-3 h-3" />
                                    {formErrors.project_gst}
                                </p>
                            )}
                        </div>
                    </div>

                        {/* Footer */}
                        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800">
                            <div className="flex items-center justify-end gap-3">
                                <AlertDialogCancel
                                    onClick={handleDialogClose}
                                    className="h-10 px-4 text-sm font-medium bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border-slate-200 dark:border-slate-700"
                                >
                                    Cancel
                                </AlertDialogCancel>
                                <Button
                                    onClick={handleContinueToUpload}
                                    disabled={!canContinueFromSelect || isLoading}
                                    className={cn(
                                        "h-10 px-5 text-sm font-medium",
                                        "bg-emerald-600 hover:bg-emerald-700 text-white",
                                        "shadow-sm shadow-emerald-600/20",
                                        "disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none",
                                        "transition-all duration-200"
                                    )}
                                >
                                    Continue
                                    <ArrowRight className="w-4 h-4 ml-2" />
                                </Button>
                            </div>
                        </div>
                    </div>
                )}

                {/* ───── Stage 2: Upload ───── */}
                {stage === "upload" && (
                    <>
                        <div className="px-6 py-5 space-y-4 bg-white dark:bg-slate-950">
                            {contextBadge}

                            {/* Guard: ProjectId path can reach this stage even when the
                                project has no customer (Stage 1 is skipped). Block upload
                                with a clear warning instead of letting the user upload a
                                file that submit-validation will later reject. */}
                            {!isProjectValidForInvoice && invoiceData.project && (
                                <Alert className="bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 py-3">
                                    <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                                    <AlertDescription className="text-amber-700 dark:text-amber-300 text-xs leading-relaxed">
                                        This project has no customer assigned. Please update the project details before creating an invoice.
                                    </AlertDescription>
                                </Alert>
                            )}

                            {!isAutofilling ? (
                                <div className="space-y-3 py-2">
                                    <div className="text-center space-y-1">
                                        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                                            Upload your invoice
                                        </h3>
                                        <p className="text-xs text-slate-500">
                                            We'll read the invoice and fill in the details for you.
                                        </p>
                                    </div>
                                    <CustomAttachment
                                        label="Choose Invoice File (PDF or image)"
                                        selectedFile={selectedAttachment}
                                        onFileSelect={handleAttachmentSelect}
                                        onError={handleAttachmentError}
                                        maxFileSize={5 * 1024 * 1024}
                                        acceptedTypes={ATTACHMENT_ACCEPTED_TYPES}
                                        disabled={isLoading || isAutofilling || !isProjectValidForInvoice}
                                        className="w-full"
                                    />
                                    <p className="text-[11px] text-center text-slate-400">
                                        Supported: PDF, PNG, JPG · max 5 MB
                                    </p>
                                </div>
                            ) : (
                                <div className="flex flex-col items-center gap-3 py-6">
                                    <Loader2 className="h-8 w-8 text-amber-600 animate-spin" />
                                    <div className="text-center space-y-1">
                                        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                                            Reading your invoice…
                                        </p>
                                        <p className="text-xs text-slate-500">
                                            AI is extracting invoice details. This usually takes a few seconds.
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        {!isAutofilling && (
                            <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800">
                                <div className="flex items-center justify-between gap-3">
                                    {!ProjectId ? (
                                        <Button
                                            variant="outline"
                                            onClick={handleBackFromUpload}
                                            disabled={isLoading}
                                            className="h-10 px-4 text-sm font-medium"
                                        >
                                            <ArrowLeft className="w-4 h-4 mr-2" />
                                            Back
                                        </Button>
                                    ) : <span />}
                                    <AlertDialogCancel
                                        onClick={handleDialogClose}
                                        className="h-10 px-4 text-sm font-medium bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border-slate-200 dark:border-slate-700"
                                    >
                                        Cancel
                                    </AlertDialogCancel>
                                </div>
                            </div>
                        )}
                    </>
                )}

                {/* ───── Stage 3: Review form ───── */}
                {stage === "form" && (
                    <>
                        <div className="px-6 py-5 space-y-4 bg-white dark:bg-slate-950">
                            {contextBadge}

                            {/* Success banner */}
                            {autofilledFields.size > 0 && (
                                <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-50 border border-amber-200">
                                    <Sparkles className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                                    <p className="text-xs text-amber-800 leading-relaxed">
                                        Auto-filled from your invoice. Highlighted fields were extracted by AI — please review before submitting.
                                    </p>
                                </div>
                            )}

                            {/* Supplier GSTIN mismatch (soft warning) */}
                            {supplierGstinMismatch && (
                                <div className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-300 px-3 py-2">
                                    <AlertTriangle className="h-4 w-4 text-amber-700 flex-shrink-0 mt-0.5" />
                                    <div className="text-xs text-amber-900 leading-snug">
                                        <p className="font-medium">Supplier GSTIN mismatch.</p>
                                        <p className="mt-0.5">
                                            Invoice's supplier GSTIN <span className="font-mono">{autofillSupplierGstin}</span> doesn't
                                            match the selected Project GST <span className="font-mono">{expectedSupplierGstin}</span>.
                                        </p>
                                    </div>
                                </div>
                            )}

                            {/* Invoice Number + Date side-by-side */}
                            <div className="grid grid-cols-2 gap-3">
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
                                            "focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500",
                                            formErrors.invoice_no && "border-red-300 focus:border-red-500 focus:ring-red-500/20",
                                            autofilledFields.has("invoice_no") && "bg-amber-50 border-amber-300 focus-visible:ring-amber-400"
                                        )}
                                    />
                                    {formErrors.invoice_no && (
                                        <p className="text-xs text-red-500 flex items-center gap-1">
                                            <AlertCircle className="w-3 h-3" />
                                            {formErrors.invoice_no}
                                        </p>
                                    )}
                                </div>

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
                                        "focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500",
                                        formErrors.date && "border-red-300 focus:border-red-500 focus:ring-red-500/20",
                                        autofilledFields.has("date") && "bg-amber-50 border-amber-300 focus-visible:ring-amber-400"
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

                        {/* Amount Excl. GST + Incl. GST side-by-side */}
                        <div className="grid grid-cols-2 gap-3">
                            {/* Amount (Excl. GST) — optional, AI fills from net_amount */}
                            <div className="space-y-1.5">
                                <Label htmlFor="amount_excl_gst" className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2">
                                    <IndianRupee className="w-3.5 h-3.5 text-slate-400" />
                                    Amount (Excl. GST)
                                </Label>
                                <div className="relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-medium">₹</span>
                                    <Input
                                        id="amount_excl_gst"
                                        name="amount_excl_gst"
                                        type="text"
                                        inputMode="decimal"
                                        placeholder="0.00"
                                        value={invoiceData.amount_excl_gst}
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            if (/^-?\d*\.?\d*$/.test(val)) {
                                                clearAutofillFlag("amount_excl_gst");
                                                setInvoiceData(prev => ({ ...prev, amount_excl_gst: val }));
                                                if (formErrors.amount_excl_gst) {
                                                    setFormErrors(prev => ({ ...prev, amount_excl_gst: undefined }));
                                                }
                                            }
                                        }}
                                        disabled={isLoading}
                                        className={cn(
                                            "pl-7 h-10 text-base font-medium transition-all",
                                            "focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500",
                                            formErrors.amount_excl_gst && "border-red-300 focus:border-red-500 focus:ring-red-500/20",
                                            autofilledFields.has("amount_excl_gst") && "bg-amber-50 border-amber-300 focus-visible:ring-amber-400"
                                        )}
                                    />
                                </div>
                                {formErrors.amount_excl_gst && (
                                    <p className="text-xs text-red-500 flex items-center gap-1">
                                        <AlertCircle className="w-3 h-3" />
                                        {formErrors.amount_excl_gst}
                                    </p>
                                )}
                            </div>

                            {/* Amount (Incl. GST) — required */}
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
                                                clearAutofillFlag("amount");
                                                setInvoiceData(prev => ({ ...prev, amount: val }));
                                                if (formErrors.amount) {
                                                    setFormErrors(prev => ({ ...prev, amount: undefined }));
                                                }
                                            }
                                        }}
                                        disabled={isLoading}
                                        className={cn(
                                            "pl-7 h-10 text-base font-medium transition-all",
                                            "focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500",
                                            formErrors.amount && "border-red-300 focus:border-red-500 focus:ring-red-500/20",
                                            autofilledFields.has("amount") && "bg-amber-50 border-amber-300 focus-visible:ring-amber-400"
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
                        </div>

                            {/* Attached file summary */}
                            {selectedAttachment && (
                                <div className="flex items-center gap-2 p-2.5 bg-emerald-50 dark:bg-emerald-950/30 rounded-lg border border-emerald-200 dark:border-emerald-800">
                                    <FileText className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                    <p className="text-xs font-medium text-emerald-900 dark:text-emerald-100 truncate flex-1" title={selectedAttachment.name}>
                                        {getDisplayFileName(selectedAttachment.name, 40)}
                                    </p>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={handleBackFromForm}
                                        className="h-7 px-2 text-xs text-emerald-700 hover:text-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/50"
                                    >
                                        Replace
                                    </Button>
                                </div>
                            )}
                        </div>

                    {/* Footer */}
                    <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800">
                        {isLoading ? (
                            <div className="flex items-center justify-center gap-3 py-1">
                                <TailSpin color="#10b981" height={24} width={24} />
                                <span className="text-sm text-slate-500">Creating invoice...</span>
                            </div>
                        ) : (
                            <div className="flex items-center justify-between gap-3">
                                <Button
                                    variant="outline"
                                    onClick={handleBackFromForm}
                                    disabled={isLoading}
                                    className="h-10 px-4 text-sm font-medium"
                                >
                                    <ArrowLeft className="w-4 h-4 mr-2" />
                                    Back
                                </Button>
                                    <div className="flex items-center gap-3">
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
                                </div>
                            )}
                        </div>
                    </>
                )}
            </AlertDialogContent>
        </AlertDialog>
    );
}
