import React, { useCallback, useEffect, useMemo, useRef, useState, useContext } from "react";
import { FrappeConfig, FrappeContext, useFrappeCreateDoc, useFrappeFileUpload, useFrappeGetDocList, useFrappeDocTypeEventListener, useFrappePostCall } from "frappe-react-sdk";
import memoize from 'lodash/memoize';
import { AlertCircle, ArrowDownToLine, Building2, Calendar, CreditCard, FileText, Hash, IndianRupee, Loader2, Sparkles } from "lucide-react";
import { TailSpin } from "react-loader-spinner";
import ReactSelect from "react-select";

// --- UI Components ---
import ProjectSelect from "@/components/custom-select/project-select";
import { CustomAttachment } from "@/components/helpers/CustomAttachment";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
    AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
    AlertDialogHeader, AlertDialogTitle, AlertDialogFooter, AlertDialogAction
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { Separator } from "@/components/ui/separator";

// --- Types ---
import { ProjectInflows as ProjectInflowsType } from "@/types/NirmaanStack/ProjectInflows"; // Alias for clarity
import { ProjectInvoice } from "@/types/NirmaanStack/ProjectInvoice";
import { Projects } from "@/types/NirmaanStack/Projects";
import { Customers } from "@/types/NirmaanStack/Customers";

type InvoiceOption = { value: string; label: string };

// --- Utils & State ---
import { getSelectStyles } from "@/config/selectTheme";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { getTotalInflowAmount } from "@/utils/getAmounts";
import { parseNumber } from "@/utils/parseNumber";
import { useDialogStore } from "@/zustand/useDialogStore";
import { getProjectListOptions, queryKeys } from "@/config/queryKeys";
import { formatDate } from "date-fns";
import { cn } from "@/lib/utils";

// Interface for the form state
interface NewInflowFormState {
    project: string;
    customer: string;
    project_name?: string;
    customer_name?: string;
    amount: string;
    payment_date: string; // YYYY-MM-DD
    utr: string;
    // Add other fields from ProjectInflows that are part of the form
}

const INITIAL_FORM_STATE: NewInflowFormState = {
    project: "",
    customer: "",
    project_name: "",
    customer_name: "",
    amount: "",
    payment_date: formatDate(new Date(), "yyyy-MM-dd"), // Default to today
    utr: "",
};

interface NewInflowPaymentProps {
    refetch?: () => void; // Optional refetch function
}

// --- Component ---
export const NewInflowPayment: React.FC<NewInflowPaymentProps> = ({ refetch }) => {
    const { newInflowDialog, toggleNewInflowDialog } = useDialogStore();
    const { toast } = useToast();


    const [formState, setFormState] = useState<NewInflowFormState>(INITIAL_FORM_STATE);
    const [paymentScreenshot, setPaymentScreenshot] = useState<File | null>(null);
    const [isProjectValidForPayment, setIsProjectValidForPayment] = useState(false); // Project has a customer
    const [formErrors, setFormErrors] = useState<Partial<Record<keyof NewInflowFormState, string>>>({});

    // --- Autofill state ---
    // Gated reveal inside Payment Details: pick project → upload pitch → autofill →
    // pre-filled form. `uploadedFileUrl` caches the upload done at file-select time so
    // submit doesn't re-upload. `autofilledFields` drives amber tint + clears as user edits.
    const [receiptStage, setReceiptStage] = useState<"upload" | "form">("upload");
    const [isAutofilling, setIsAutofilling] = useState(false);
    const [uploadedFileUrl, setUploadedFileUrl] = useState<string | null>(null);
    const [autofilledFields, setAutofilledFields] = useState<Set<string>>(new Set());
    // Session counter that invalidates in-flight extractions on cancel /
    // project change / dialog close. Without this, a slow Document AI response
    // can land after the user has already moved on and silently repopulate
    // the form with stale data.
    const extractionSessionRef = useRef(0);

    // --- Linked invoice (single — one inflow pays against one invoice) ---
    const [selectedInvoice, setSelectedInvoice] = useState<InvoiceOption | null>(null);

    // --- Data Mutators ---
    const { createDoc, loading: createLoading } = useFrappeCreateDoc();
    const { upload, loading: uploadLoading } = useFrappeFileUpload();
    const { call: extractPaymentFields } = useFrappePostCall(
        "nirmaan_stack.api.payment_autofill.extract_payment_fields"
    );

    // --- Supporting Data Fetches ---
    // Fetch all projects for selection, and customers for display mapping
    const projectsFetchOptions = getProjectListOptions({ fields: ["name", "project_name", "customer"] });
    const projectQueryKey = queryKeys.projects.list(projectsFetchOptions);
    const { data: projects, isLoading: projectsLoading } = useFrappeGetDocList<Projects>(
        "Projects", projectsFetchOptions as any, projectQueryKey
    );

    const customersFetchOptions = { fields: ["name", "company_name"], limit: 10000 }; // Fetch many customers
    const customerQueryKey = queryKeys.customers.list(customersFetchOptions);
    const { data: customers, isLoading: customersLoading } = useFrappeGetDocList<Customers>(
        "Customers", customersFetchOptions as any, customerQueryKey
    );

    // Fetch existing inflows to calculate 'Total Amount Received' for a project
    const { data: projectInflows, isLoading: projectInflowsLoading, mutate: projectInflowsMutate } = useFrappeGetDocList<ProjectInflowsType>(
        "Project Inflows", { fields: ["project", "amount"], limit: 100000 }, // Fetch all, only needed fields
        "AllProjectInflowsForValidation" // Specific key for SWR
    );

    // Invoices belonging to the currently selected project — populates the
    // "Linked Invoices" multi-select. Only fires once a project is picked.
    const { data: projectInvoicesForLink, isLoading: projectInvoicesLoading } = useFrappeGetDocList<ProjectInvoice>(
        "Project Invoices",
        {
            filters: formState.project ? [["project", "=", formState.project]] : undefined,
            fields: ["name", "invoice_no", "amount", "invoice_date"],
            limit: 1000,
            orderBy: { field: "invoice_date", order: "desc" },
        },
        formState.project ? `ProjectInvoicesForInflow_${formState.project}` : null
    );

    const invoiceOptions = useMemo<InvoiceOption[]>(
        () =>
            (projectInvoicesForLink ?? []).map(inv => ({
                value: inv.name,
                label: `${inv.invoice_no || inv.name} — ${formatToRoundedIndianRupee(inv.amount || 0)}`,
            })),
        [projectInvoicesForLink]
    );

    // --- Event Listener for Realtime Updates ---
    useFrappeDocTypeEventListener("Project Inflows", (event) => {
        console.log("Project Inflows event received in NewInflowPayment:", event);
        projectInflowsMutate(); // Revalidate SWR cache for projectInflows
    });

    // --- Derived State & Memoized Callbacks ---
    const getAmountReceivedForProject = useMemo(() => memoize((projectId: string): number => {
        if (!projectInflows || !projectId) return 0;
        const filtered = projectInflows.filter(p => p.project === projectId);
        return getTotalInflowAmount(filtered); // Assumes getTotalInflowAmount works with ProjectInflowsType[]
    }), [projectInflows]);

    const handleProjectChange = useCallback((selectedOption: { value: string; label: string } | null) => {
        if (selectedOption) {
            const project = projects?.find(p => p.name === selectedOption.value);
            const customerId = project?.customer || "";
            const customerName = customers?.find(c => c.name === customerId)?.company_name || (customerId ? "Customer not found" : "No Customer");

            setFormState(prev => ({
                ...INITIAL_FORM_STATE, // Reset other fields but keep new project
                payment_date: prev.payment_date || formatDate(new Date(), "yyyy-MM-dd"), // Preserve date if already set
                project: selectedOption.value,
                project_name: selectedOption.label,
                customer: customerId,
                customer_name: customerName
            }));
            setIsProjectValidForPayment(!!customerId);
            if (!customerId) {
                toast({ title: "Warning", description: "Selected project does not have an associated customer. Payment cannot be recorded.", variant: "destructive" });
            }
        } else {
            setFormState(INITIAL_FORM_STATE);
            setIsProjectValidForPayment(false);
        }
        setFormErrors({}); // Clear errors on project change
        // Reset receipt / autofill state — different project means different receipt context.
        // Bump the session counter so any in-flight extraction (e.g., user changed
        // their mind mid-autofill) lands silently and doesn't overwrite the reset.
        extractionSessionRef.current++;
        setPaymentScreenshot(null);
        setUploadedFileUrl(null);
        setAutofilledFields(new Set());
        setIsAutofilling(false);
        setReceiptStage("upload");
        // Linked invoice is project-scoped — clear it when the project changes.
        setSelectedInvoice(null);
    }, [projects, customers, toast]);

    const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormState(prev => ({ ...prev, [name]: value }));
        if (formErrors[name as keyof NewInflowFormState]) {
            setFormErrors(prev => ({...prev, [name]: undefined })); // Clear error on change
        }
        // If user manually edits an auto-filled field, drop its amber tint.
        if (autofilledFields.has(name)) {
            setAutofilledFields(prev => {
                const next = new Set(prev);
                next.delete(name);
                return next;
            });
        }
    }, [formErrors, autofilledFields]);

    const runAutofillExtraction = useCallback(async (file: File) => {
        // Claim a session for this extraction. Any reset / cancel / project
        // change bumps the ref, so by the time the promise resolves we can
        // tell whether the user has moved on and skip state updates.
        const session = ++extractionSessionRef.current;
        setIsAutofilling(true);
        try {
            const tempDocName = `temp-inflow-${Date.now()}`;
            const uploaded = await upload(file, {
                doctype: "Project Inflows",
                docname: tempDocName,
                fieldname: "inflow_attachment",
                isPrivate: true,
            });
            if (session !== extractionSessionRef.current) return;
            setUploadedFileUrl(uploaded.file_url);

            const res = await extractPaymentFields({ file_url: uploaded.file_url });
            if (session !== extractionSessionRef.current) return;
            const data = (res as any)?.message ?? res;

            const filled = new Set<string>();
            const updates: Partial<NewInflowFormState> = {};
            if (data?.utr) { updates.utr = data.utr; filled.add("utr"); }
            if (data?.payment_date) { updates.payment_date = data.payment_date; filled.add("payment_date"); }
            if (data?.transfer_amount) { updates.amount = data.transfer_amount; filled.add("amount"); }
            if (Object.keys(updates).length > 0) {
                setFormState(prev => ({ ...prev, ...updates }));
            }
            setAutofilledFields(filled);

            if (filled.size > 0) {
                toast({
                    title: "Auto-filled from receipt",
                    description: `Filled ${filled.size} field${filled.size > 1 ? "s" : ""}. Please verify before recording.`,
                    variant: "success",
                });
            } else {
                toast({
                    title: "Couldn't auto-fill",
                    description: "Please enter Amount, UTR, and Date manually.",
                });
            }
        } catch (e: any) {
            if (session !== extractionSessionRef.current) return;
            toast({
                title: "Auto-fill failed",
                description: e?.message || "Please enter details manually.",
                variant: "destructive",
            });
        } finally {
            // Only flip stage/spinner if we're still the current session —
            // otherwise the reset path has already moved us back to "upload".
            if (session === extractionSessionRef.current) {
                setIsAutofilling(false);
                setReceiptStage("form");
            }
        }
    }, [upload, extractPaymentFields, toast]);

    const handleFileSelect = useCallback((file: File | null) => {
        setPaymentScreenshot(file);
        // Any previously-uploaded file becomes stale the moment the user picks a new one.
        setUploadedFileUrl(null);
        setAutofilledFields(new Set());
        if (file) {
            runAutofillExtraction(file);
        }
    }, [runAutofillExtraction]);

    const validateForm = useCallback((): boolean => {
        const errors: Partial<Record<keyof NewInflowFormState, string>> = {};
        if (!formState.project) errors.project = "Project is required.";
        if (!isProjectValidForPayment) errors.project = "Selected project must have an associated customer.";
        if (!formState.amount || parseNumber(formState.amount) <= 0) errors.amount = "Valid amount is required.";
        if (!formState.utr.trim()) errors.utr = "Payment Reference (UTR) is required.";
        if (!formState.payment_date) errors.payment_date = "Payment date is required.";
        // Add more validations as needed

        setFormErrors(errors);
        return Object.keys(errors).length === 0;
    }, [formState, isProjectValidForPayment]);


    const handleSubmitPayment = useCallback(async () => {
        if (!validateForm()) {
            toast({ title: "Validation Error", description: "Please correct the errors in the form.", variant: "destructive" });
            return;
        }

        let fileUrl: string | undefined = undefined;
        try {
            if (uploadedFileUrl) {
                // Already uploaded during the autofill flow — reuse the same File record.
                fileUrl = uploadedFileUrl;
            } else if (paymentScreenshot) {
                // Fallback: a screenshot is selected but never went through autofill upload
                // (e.g., autofill failed mid-upload). Upload now under the same temp-docname pattern.
                const tempDocName = `temp-inflow-${Date.now()}`;
                const fileArgs = {
                    doctype: "Project Inflows",
                    docname: tempDocName,
                    fieldname: "inflow_attachment",
                    isPrivate: true,
                };
                const uploadedFile = await upload(paymentScreenshot, fileArgs);
                fileUrl = uploadedFile.file_url;
            }

            const docToCreate: Partial<ProjectInflowsType> = {
                project: formState.project,
                customer: formState.customer,
                amount: parseNumber(formState.amount),
                payment_date: formState.payment_date,
                utr: formState.utr.trim(),
                inflow_attachment: fileUrl, // Will be undefined if no screenshot
                // Single Link to a Project Invoice; one invoice can be paid by multiple inflows.
                invoice: selectedInvoice?.value || undefined,
            };

            await createDoc("Project Inflows", docToCreate);
            // If file was uploaded to a temp name, and if Frappe < v15 doesn't auto-relink,
            // you might need a setValue call here to update the attachment on the *actual* newDoc.name.
            // However, with frappe-react-sdk v0.0.9+ and Frappe v14/15+, `file_url` is usually sufficient.

            toast({ title: "Success!", description: "Inflow payment added successfully!", variant: "success" });
            projectInflowsMutate(); // Revalidate the list of inflows
            refetch?.();
            closeDialogAndReset();
        } catch (error: any) {
            console.error("Error adding inflow payment:", error);
            toast({ title: "Failed!", description: error.message || "Failed to add payment.", variant: "destructive" });
        }
    }, [createDoc, formState, paymentScreenshot, uploadedFileUrl, selectedInvoice, toggleNewInflowDialog, projectInflowsMutate, upload, validateForm, toast]);

    const closeDialogAndReset = () => {
        // Invalidate any in-flight autofill so its eventual response doesn't
        // leak into the next dialog session.
        extractionSessionRef.current++;
        setFormState(INITIAL_FORM_STATE);
        setPaymentScreenshot(null);
        setFormErrors({});
        setUploadedFileUrl(null);
        setAutofilledFields(new Set());
        setIsAutofilling(false);
        setReceiptStage("upload");
        setSelectedInvoice(null);
        toggleNewInflowDialog(); // From Zustand store
    };

    // Effect to reset form when dialog opens/closes (if newInflowDialog state changes externally)
    useEffect(() => {
        if (newInflowDialog) {
            // Bump session so any orphaned autofill from a prior open can't land here.
            extractionSessionRef.current++;
            setFormState(INITIAL_FORM_STATE); // Reset form when dialog is to be shown
            setPaymentScreenshot(null);
            setFormErrors({});
            setIsProjectValidForPayment(false); // Reset validation
            setUploadedFileUrl(null);
            setAutofilledFields(new Set());
            setIsAutofilling(false);
            setReceiptStage("upload");
            setSelectedInvoice(null);
        }
    }, [newInflowDialog]);


    const isSubmitDisabled = !formState.project || !formState.amount || !formState.utr || !formState.payment_date || !isProjectValidForPayment || Object.keys(formErrors).length > 0 || isAutofilling;
    const isLoadingAny = createLoading || uploadLoading || projectsLoading || customersLoading || projectInflowsLoading;

    return (
        <AlertDialog open={newInflowDialog} onOpenChange={closeDialogAndReset}>
            <AlertDialogContent className="max-w-[480px] p-0 gap-0 overflow-hidden border-0 shadow-2xl">
                {/* Header */}
                <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 px-6 py-5">
                    <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center w-10 h-10 rounded-full bg-emerald-500/20 ring-1 ring-emerald-500/30">
                            <ArrowDownToLine className="w-5 h-5 text-emerald-400" />
                        </div>
                        <div>
                            <AlertDialogTitle className="text-lg font-semibold text-white tracking-tight">
                                Record Inflow Payment
                            </AlertDialogTitle>
                            <p className="text-xs text-slate-400 mt-0.5">
                                Add a new payment received from customer
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

                        {/* Project Select */}
                        <div className="space-y-1.5">
                            <Label htmlFor="project" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                                Select Project <span className="text-red-500">*</span>
                            </Label>
                            <ProjectSelect
                                all={true}
                                onChange={handleProjectChange}
                                universal={false}
                                usePortal
                            />
                            {formErrors.project && (
                                <p className="text-xs text-red-500 flex items-center gap-1 mt-1">
                                    <AlertCircle className="w-3 h-3" />
                                    {formErrors.project}
                                </p>
                            )}
                        </div>

                        {/* Customer & Total Received - Side by side badges */}
                        {formState.project && (
                            <div className="grid grid-cols-2 gap-3">
                                <div className={cn(
                                    "rounded-lg px-3 py-2.5 border transition-colors",
                                    isProjectValidForPayment
                                        ? "bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800"
                                        : "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800"
                                )}>
                                    <p className="text-[10px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-0.5">
                                        Customer
                                    </p>
                                    <p className={cn(
                                        "text-sm font-medium truncate",
                                        isProjectValidForPayment
                                            ? "text-slate-900 dark:text-slate-100"
                                            : "text-amber-700 dark:text-amber-400"
                                    )}>
                                        {formState.customer_name || "No Customer"}
                                    </p>
                                </div>
                                <div className="rounded-lg px-3 py-2.5 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
                                    <p className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-0.5">
                                        Total Received
                                    </p>
                                    <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                                        {formatToRoundedIndianRupee(getAmountReceivedForProject(formState.project))}
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* Warning Alert */}
                        {formState.project && !isProjectValidForPayment && (
                            <Alert className="bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 py-3">
                                <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                                <AlertDescription className="text-amber-700 dark:text-amber-300 text-xs leading-relaxed">
                                    This project has no customer assigned. Please update the project details before recording payments.
                                </AlertDescription>
                            </Alert>
                        )}

                        {/* Linked Invoice — single-select, scoped to selected project.
                            One inflow pays against one invoice; one invoice can receive many inflows. */}
                        {formState.project && isProjectValidForPayment && (
                            <div className="space-y-1.5">
                                <Label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                                    Linked Invoice
                                    <span className="text-xs font-normal text-slate-400 ml-1">(Optional)</span>
                                </Label>
                                <ReactSelect
                                    options={invoiceOptions}
                                    value={selectedInvoice}
                                    onChange={(opt) => setSelectedInvoice((opt as InvoiceOption | null) ?? null)}
                                    isClearable
                                    placeholder={
                                        projectInvoicesLoading
                                            ? "Loading invoices…"
                                            : invoiceOptions.length === 0
                                                ? "No invoices found for this project"
                                                : "Select the invoice this payment covers…"
                                    }
                                    isDisabled={projectInvoicesLoading}
                                    isLoading={projectInvoicesLoading}
                                    classNamePrefix="react-select"
                                    menuPortalTarget={typeof document !== "undefined" ? document.body : undefined}
                                    menuPosition="fixed"
                                    // Centralized theme sets `pointer-events: auto` on every menu
                                    // layer — required so clicks land inside Radix dialogs.
                                    styles={getSelectStyles<InvoiceOption, false>()}
                                    noOptionsMessage={() => "No invoices found for this project"}
                                />
                            </div>
                        )}
                    </div>

                    {/* Divider */}
                    <div className="relative">
                        <div className="absolute inset-0 flex items-center">
                            <div className="w-full border-t border-slate-200 dark:border-slate-800" />
                        </div>
                        <div className="relative flex justify-center">
                            <span className="bg-white dark:bg-slate-950 px-3 text-xs font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                                Payment Details
                            </span>
                        </div>
                    </div>

                    {/* Payment Details Section — gated by project validity AND receipt stage.
                        Stage 1 ("upload"): receipt picker + Skip; Stage 2 ("form"): the actual fields. */}
                    <div className={cn(
                        "space-y-4 transition-opacity",
                        !isProjectValidForPayment && "opacity-50 pointer-events-none"
                    )}>
                        {receiptStage === "upload" ? (
                            // ───────── Stage 1: Upload receipt ─────────
                            <div className="space-y-4">
                                {!isAutofilling ? (
                                    <>
                                        <div className="text-center space-y-1">
                                            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                                                Upload Payment Receipt
                                            </h3>
                                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                                We'll read the receipt and fill in Amount, UTR, and Date for you.
                                            </p>
                                        </div>
                                        <CustomAttachment
                                            label="Choose Receipt (PDF or image)"
                                            selectedFile={paymentScreenshot}
                                            onFileSelect={handleFileSelect}
                                            disabled={!isProjectValidForPayment}
                                            maxFileSize={5 * 1024 * 1024}
                                        />
                                        <p className="text-[11px] text-center text-slate-400 dark:text-slate-500">
                                            Supported: PDF, PNG, JPG · max 5 MB
                                        </p>
                                    </>
                                ) : (
                                    <div className="flex flex-col items-center gap-3 py-6">
                                        <Loader2 className="h-8 w-8 text-emerald-600 animate-spin" />
                                        <div className="text-center space-y-1">
                                            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                                                Reading your receipt…
                                            </p>
                                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                                AI is extracting payment details. This usually takes a few seconds.
                                            </p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            // ───────── Stage 2: Form (prefilled if autofill ran) ─────────
                            <>
                                {autofilledFields.size > 0 && (
                                    <div className="flex items-center gap-2 rounded-md bg-amber-50 border border-amber-300 px-3 py-2">
                                        <Sparkles className="h-3.5 w-3.5 text-amber-700 flex-shrink-0" />
                                        <span className="text-xs text-amber-900 leading-snug">
                                            Auto-filled from receipt — please review and edit if anything is wrong.
                                        </span>
                                    </div>
                                )}

                                {/* Amount */}
                                <div className="space-y-1.5">
                                    <Label htmlFor="amount" className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2">
                                        <IndianRupee className="w-3.5 h-3.5 text-slate-400" />
                                        Amount <span className="text-red-500">*</span>
                                    </Label>
                                    <div className="relative">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-medium">₹</span>
                                        <Input
                                            id="amount"
                                            name="amount"
                                            type="number"
                                            placeholder="0.00"
                                            value={formState.amount}
                                            onChange={handleInputChange}
                                            disabled={!isProjectValidForPayment}
                                            className={cn(
                                                "pl-7 h-10 text-base font-medium transition-all",
                                                "focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500",
                                                autofilledFields.has("amount") && "bg-amber-50 border-amber-300 focus-visible:ring-amber-400",
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

                                {/* UTR and Date - Side by side */}
                                <div className="grid grid-cols-2 gap-3">
                                    {/* UTR */}
                                    <div className="space-y-1.5">
                                        <Label htmlFor="utr" className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2">
                                            <Hash className="w-3.5 h-3.5 text-slate-400" />
                                            UTR/Ref <span className="text-red-500">*</span>
                                        </Label>
                                        <Input
                                            id="utr"
                                            name="utr"
                                            type="text"
                                            placeholder="Reference No."
                                            value={formState.utr}
                                            onChange={handleInputChange}
                                            disabled={!isProjectValidForPayment}
                                            className={cn(
                                                "h-10 transition-all",
                                                "focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500",
                                                autofilledFields.has("utr") && "bg-amber-50 border-amber-300 focus-visible:ring-amber-400",
                                                formErrors.utr && "border-red-300 focus:border-red-500 focus:ring-red-500/20"
                                            )}
                                        />
                                        {formErrors.utr && (
                                            <p className="text-xs text-red-500 flex items-center gap-1">
                                                <AlertCircle className="w-3 h-3" />
                                                {formErrors.utr}
                                            </p>
                                        )}
                                    </div>

                                    {/* Payment Date */}
                                    <div className="space-y-1.5">
                                        <Label htmlFor="payment_date" className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2">
                                            <Calendar className="w-3.5 h-3.5 text-slate-400" />
                                            Date <span className="text-red-500">*</span>
                                        </Label>
                                        <Input
                                            id="payment_date"
                                            name="payment_date"
                                            type="date"
                                            value={formState.payment_date}
                                            onChange={handleInputChange}
                                            disabled={!isProjectValidForPayment}
                                            max={formatDate(new Date(), "yyyy-MM-dd")}
                                            className={cn(
                                                "h-10 transition-all",
                                                "focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500",
                                                autofilledFields.has("payment_date") && "bg-amber-50 border-amber-300 focus-visible:ring-amber-400",
                                                formErrors.payment_date && "border-red-300 focus:border-red-500 focus:ring-red-500/20"
                                            )}
                                        />
                                        {formErrors.payment_date && (
                                            <p className="text-xs text-red-500 flex items-center gap-1">
                                                <AlertCircle className="w-3 h-3" />
                                                {formErrors.payment_date}
                                            </p>
                                        )}
                                    </div>
                                </div>

                                {/* Attachment (replaceable; re-pick re-runs autofill) */}
                                <div className="space-y-1.5">
                                    <Label className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2">
                                        <FileText className="w-3.5 h-3.5 text-slate-400" />
                                        Payment Proof
                                        <span className="text-xs font-normal text-slate-400">(Optional)</span>
                                    </Label>
                                    <CustomAttachment
                                        selectedFile={paymentScreenshot}
                                        onFileSelect={handleFileSelect}
                                        disabled={!isProjectValidForPayment}
                                        maxFileSize={5 * 1024 * 1024}
                                    />
                                </div>
                            </>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800">
                    {isLoadingAny ? (
                        <div className="flex items-center justify-center gap-3 py-1">
                            <TailSpin color="#10b981" height={24} width={24} />
                            <span className="text-sm text-slate-500">Processing...</span>
                        </div>
                    ) : (
                        <div className="flex items-center justify-end gap-3">
                            <AlertDialogCancel className="h-10 px-4 text-sm font-medium bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border-slate-200 dark:border-slate-700">
                                Cancel
                            </AlertDialogCancel>
                            <Button
                                onClick={handleSubmitPayment}
                                disabled={isSubmitDisabled}
                                className={cn(
                                    "h-10 px-5 text-sm font-medium",
                                    "bg-emerald-600 hover:bg-emerald-700 text-white",
                                    "shadow-sm shadow-emerald-600/20",
                                    "disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none",
                                    "transition-all duration-200"
                                )}
                            >
                                <CreditCard className="w-4 h-4 mr-2" />
                                Record Payment
                            </Button>
                        </div>
                    )}
                </div>
            </AlertDialogContent>
        </AlertDialog>
    );
};
