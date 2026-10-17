// src/pages/ProjectExpenses/components/NewProjectExpenseDialog.tsx
//
// Add Expense -> Project Expense: records a Direct Expense (spec #1470 ticket #1474). It names who
// gets paid the way an Expense Request does (`utils/payees/expensePayee.whoGetsPaidView`): a Vendor
// picked shows that Vendor's account read-only (`useVendorAccount`, the one vendor-account SWR key),
// on a Not asked type too; "Others (No Vendor)" picks or adds a Payee when the type asks (Required /
// Optional). A Required type cannot be saved without an account (a screen rule). The server saves the
// expense and copies the account in one step (`components/payees/useCreateDirectExpense`,
// `api/expenses/direct_expense.create_direct_expense`;
// with a vendor named it copies the vendor's Payee, so no Payee is sent).

import React, { useCallback, useEffect, useState, useMemo, useRef } from "react";
import {
    useFrappeUpdateDoc,
    useFrappeFileUpload,
    useFrappeGetDocList,
    useFrappePostCall,
} from "frappe-react-sdk";
import { TailSpin } from "react-loader-spinner";
import { formatDate as formatDateFns } from "date-fns";
import { Check, ChevronsUpDown, Loader2, Sparkles } from "lucide-react";

// --- UI Components ---
import {
    AlertDialog, AlertDialogCancel, AlertDialogContent,
    AlertDialogHeader, AlertDialogTitle, AlertDialogFooter, AlertDialogAction
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { CustomAttachment, AcceptedFileType } from "@/components/helpers/CustomAttachment";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import ProjectSelect from "@/components/custom-select/project-select"; // Assuming this is your project selector

// --- Types ---
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { ExpenseType } from "@/types/NirmaanStack/ExpenseType";

// --- Utils & State ---
import { parseNumber } from "@/utils/parseNumber";
import { getExpenseCreatedToast, getExpenseSubmitLabel } from "@/utils/expenseApproval";
import { useDialogStore } from "@/zustand/useDialogStore";
import { queryKeys, getProjectExpenseTypeListOptions } from "@/config/queryKeys";
import { useCEOHoldGuard } from "@/hooks/useCEOHoldGuard";
import { useCreateDirectExpense } from "@/components/payees/useCreateDirectExpense";
import { directExpenseErrorToast } from "@/utils/payees/directExpense";
import { useVendorAccount } from "@/components/payees/vendorPayeeAccount";
import { whoGetsPaidView } from "@/utils/payees/expensePayee";
import WhoGetsPaidSection from "@/pages/ExpenseRequests/components/WhoGetsPaidSection";

interface NewProjectExpenseDialogProps {
    projectId?: string; // Optional: If provided, this dialog is for a specific project
    onSuccess?: () => void;
}

interface FormState {
    projects: string;
    type: string;
    vendor: string;
    description: string;
    comment: string;
    amount: string;
    invoice_ref: string;
    invoice_date: string;
}

// AMOUNT CAP REMOVED (owner, 2026-09-15). This screen used to refuse any expense over
// ₹15,000 unless its type matched an "accommodation" keyword, so every genuinely large
// expense had to be renamed into an exempt type to get through. Nothing enforced it
// server-side, so it was never a control -- only an obstacle.
//
// ⚠️ THE ₹10,000 AUTO-APPROVE THRESHOLD IS A DIFFERENT RULE AND IS UNTOUCHED. That one
// lives in the doctype's own `validate` (`initial_status` / `is_auto_approved`) and
// decides whether a saved expense is Approved outright or routed to an approver. It has
// always been a ROUTING rule, never a ceiling -- removing this cap does not let anything
// skip approval, it just lets a large expense be entered and sent to an approver.
const OTHERS_VENDOR_VALUE = "OTHERS_EMPTY_SELECTION"; // Unique identifier for "Others" option
const DOCTYPE = "Project Expenses";


const INITIAL_STATE: FormState = {
    projects: "",
    type: "",
    vendor: "",
    description: "",
    comment: "",
    amount: "",
    invoice_ref: "",
    invoice_date: "",
};

const ATTACHMENT_ACCEPTED_TYPES: AcceptedFileType[] = ["image/*", "application/pdf", "text/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"];
// Document AI reads these; csv/xlsx are archival-only (backend would throw on extraction).
const SUPPORTED_AUTOFILL_EXTS = ["pdf", "png", "jpg", "jpeg"];
const isSupportedForAutofill = (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    return SUPPORTED_AUTOFILL_EXTS.includes(ext);
};

export const NewProjectExpenseDialog: React.FC<NewProjectExpenseDialogProps> = ({ projectId, onSuccess }) => {
    const { newProjectExpenseDialog, setNewProjectExpenseDialog } = useDialogStore();
    const { toast } = useToast();

    const [formState, setFormState] = useState<FormState>({ ...INITIAL_STATE, projects: projectId || "" });

    // CEO Hold guard - use either prop projectId or form-selected project
    const { isCEOHold, showBlockedToast } = useCEOHoldGuard(projectId || formState.projects || undefined);
    const [formErrors, setFormErrors] = useState<Partial<FormState>>({});
    const [expenseTypePopoverOpen, setExpenseTypePopoverOpen] = useState(false);
    const commandListRef = useRef<HTMLDivElement>(null);

    // --- Invoice Details (optional) + Document AI autofill ---
    // When the creator uploads an invoice we extract Invoice No / Date / Amount via
    // the invoice processor and pre-fill the form. The session ref invalidates
    // in-flight extractions on cancel / reset / uncheck so a stale response can't
    // leak into a fresh form.
    const [recordInvoiceDetails, setRecordInvoiceDetails] = useState(false);
    const [invoiceAttachmentFile, setInvoiceAttachmentFile] = useState<File | null>(null);
    const [uploadedInvoiceUrl, setUploadedInvoiceUrl] = useState<string | null>(null);
    const [uploadedInvoiceFileName, setUploadedInvoiceFileName] = useState<string | null>(null);
    const [autofilledFields, setAutofilledFields] = useState<Set<string>>(new Set());
    const [isAutofilling, setIsAutofilling] = useState(false);
    // Two-stage flow inside the Invoice Details block: "upload" → invoice picker;
    // "form" → the actual date/ref/attachment fields.
    const [invoiceStage, setInvoiceStage] = useState<"upload" | "form">("upload");
    const extractionSessionRef = useRef(0);

    const { data: vendorsData, isLoading: vendorsLoading } = useFrappeGetDocList<Vendors>("Vendors", { fields: ["name", "vendor_name"], limit: 0 });
    const expenseTypeFetchOptions = useMemo(() => getProjectExpenseTypeListOptions(), []);
    const { data: expenseTypesData, isLoading: expenseTypesLoading } = useFrappeGetDocList<ExpenseType>("Expense Type", expenseTypeFetchOptions as any, queryKeys.expenseTypes.list(expenseTypeFetchOptions));

    // Who gets paid with "Others (No Vendor)": an existing Payee, or a new one added on save; saved
    // with the expense.
    const { payeeChoice, create: createDirectExpense, loading } = useCreateDirectExpense(DOCTYPE);
    const { updateDoc } = useFrappeUpdateDoc();
    const { upload, loading: uploadLoading } = useFrappeFileUpload();
    const { call: extractInvoiceFields } = useFrappePostCall("nirmaan_stack.api.invoice_autofill.extract_invoice_fields");

    // --- Memos for Select Options ---
    const vendorOptions = useMemo(() => {
        const vendors = vendorsData?.map(v => ({ value: v.name, label: v.vendor_name })) || [];
        return [{ value: OTHERS_VENDOR_VALUE, label: "Others (No Vendor)" }, ...vendors];
    }, [vendorsData]);

    const expenseTypeOptions = useMemo(() => expenseTypesData?.map(et => ({ value: et.name, label: et.expense_name })) || [], [expenseTypesData]);

    // Who gets paid, by the type's rule. A vendor named is paid into its own account, read-only.
    const selectedType = expenseTypesData?.find(et => et.name === formState.type);
    const selectedTypeLabel = selectedType?.expense_name ?? formState.type;
    const payeeRule = selectedType?.payee_rule ?? "";
    const vendorChosen = !!formState.vendor && formState.vendor !== OTHERS_VENDOR_VALUE;
    const { account: vendorAccount, isLoading: vendorAccountLoading } =
        useVendorAccount(formState.vendor, vendorChosen && !!selectedType);
    const vendorName = vendorChosen
        ? (vendorAccount?.vendor_name || vendorOptions.find(v => v.value === formState.vendor)?.label || formState.vendor)
        : null;
    const whoGetsPaid = whoGetsPaidView({
        rule: payeeRule,
        expenseType: selectedTypeLabel,
        typeChosen: !!selectedType,
        vendor: vendorName,
        vendorHasAccount: !!vendorAccount?.payee,
        vendorAccountLoading,
        choice: payeeChoice,
    });

    // Escape does not close mid-save (`loading` spans the whole save, the payee add included): a close
    // there would reset the choice before the add lands its pick, and that pick would outlive the reopen.
    const handleDialogClose = () => {
        payeeChoice.reset();
        setNewProjectExpenseDialog(false);
    };

    // --- Invoice autofill: upload → extract → prefill ---
    const runInvoiceAutofill = useCallback(async (file: File) => {
        const session = ++extractionSessionRef.current;
        setIsAutofilling(true);
        try {
            // Upload with the doctype but no docname yet (doc doesn't exist); we
            // re-link the File to the real expense after createDoc on submit.
            const uploaded = await upload(file, {
                doctype: DOCTYPE,
                fieldname: "invoice_attachment",
                isPrivate: true,
            });
            if (session !== extractionSessionRef.current) return;
            setUploadedInvoiceUrl(uploaded.file_url);
            setUploadedInvoiceFileName(uploaded.name || null);

            const res = await extractInvoiceFields({ file_url: uploaded.file_url });
            if (session !== extractionSessionRef.current) return;
            const data = (res as any)?.message ?? res;

            const filled = new Set<string>();
            const updates: Partial<FormState> = {};
            if (data?.invoice_no) { updates.invoice_ref = data.invoice_no; filled.add("invoice_ref"); }
            if (data?.invoice_date) { updates.invoice_date = data.invoice_date; filled.add("invoice_date"); }
            if (data?.amount) { updates.amount = String(data.amount); filled.add("amount"); }
            if (Object.keys(updates).length > 0) setFormState(prev => ({ ...prev, ...updates }));
            setAutofilledFields(filled);

            toast(
                filled.size > 0
                    ? { title: "Auto-filled from invoice", description: `Filled ${filled.size} field${filled.size > 1 ? "s" : ""}. Please verify before saving.`, variant: "success" }
                    : { title: "Couldn't auto-fill", description: "Please enter the invoice details manually." }
            );
        } catch (e: any) {
            if (session !== extractionSessionRef.current) return;
            toast({ title: "Auto-fill failed", description: e?.message || "Please enter details manually.", variant: "destructive" });
        } finally {
            if (session === extractionSessionRef.current) {
                setIsAutofilling(false);
                // Advance to the form whether extraction succeeded or failed —
                // user always lands on the fields to verify / complete entry.
                setInvoiceStage("form");
            }
        }
    }, [upload, extractInvoiceFields, toast]);

    const handleInvoiceFileSelect = useCallback((file: File | null) => {
        setInvoiceAttachmentFile(file);
        // Picking a new file invalidates any cached upload + autofill tint.
        setUploadedInvoiceUrl(null);
        setUploadedInvoiceFileName(null);
        setAutofilledFields(new Set());
        if (file) {
            if (isSupportedForAutofill(file)) {
                runInvoiceAutofill(file);
            } else {
                setInvoiceStage("form"); // unsupported for AI — go straight to manual entry
            }
        }
    }, [runInvoiceAutofill]);

    const handleAttachmentError = useCallback(({ message }: { type: "size" | "type", message: string }) => {
        toast({ title: "Attachment Error", description: message, variant: "destructive" });
    }, [toast]);

    // --- Validation and Submission ---
    const validateForm = useCallback((): Partial<FormState> => {
        const errors: Partial<FormState> = {};
        if (!formState.projects) errors.projects = "Project is required.";
        if (!formState.type) errors.type = "Expense Type is required.";
        if (!formState.description.trim()) errors.description = "Description is required.";
        if (formState.vendor === "") errors.vendor = "Please select a vendor or choose 'Others'.";

        const amountValue = parseNumber(formState.amount);
        if (!formState.amount.trim() || isNaN(amountValue)) {
            errors.amount = "A valid amount is required.";
        }

        // Invoice details, when recorded, need a date; an attached invoice needs a ref.
        if (recordInvoiceDetails) {
            if (!formState.invoice_date) errors.invoice_date = "Invoice date is required.";
            if ((invoiceAttachmentFile || uploadedInvoiceUrl) && !formState.invoice_ref.trim()) {
                errors.invoice_ref = "Invoice reference is required when an invoice is attached.";
            }
        }

        setFormErrors(errors);
        return errors;
    }, [formState, recordInvoiceDetails, invoiceAttachmentFile, uploadedInvoiceUrl, expenseTypeOptions]);

    const handleSubmit = async () => {
        if (isCEOHold) {
            showBlockedToast();
            return;
        }
        const errors = validateForm();
        const errorMessages = Object.values(errors).filter(Boolean) as string[];
        if (errorMessages.length > 0) {
            toast({
                title: `Validation Error — ${errorMessages.length} ${errorMessages.length === 1 ? "issue" : "issues"}`,
                description: (
                    <ul className="mt-1 list-disc list-inside space-y-0.5">
                        {errorMessages.map((msg, idx) => <li key={idx}>{msg}</li>)}
                    </ul>
                ),
                variant: "destructive",
            });
            return;
        }
        if (!whoGetsPaid.ready) return;
        let invoiceAttachmentUrl: string | undefined = uploadedInvoiceUrl || undefined;
        try {
            // Who gets paid is resolved FIRST: new payee details are added before any upload (a
            // duplicate stops here, with the Payee to pick shown in the section). With a vendor named,
            // or on a Not asked type, none is sent: the server copies the vendor's Payee. The expense
            // and its pay-to account are saved together on the server.
            const created = await createDirectExpense(whoGetsPaid.sendsPayee, async () => {
                // Fallback: an unsupported-for-AI invoice file was never uploaded during
                // autofill — upload it now (no docname yet; re-linked after create).
                if (recordInvoiceDetails && invoiceAttachmentFile && !invoiceAttachmentUrl) {
                    const uploaded = await upload(invoiceAttachmentFile, { doctype: DOCTYPE, fieldname: "invoice_attachment", isPrivate: true });
                    invoiceAttachmentUrl = uploaded.file_url;
                    setUploadedInvoiceFileName(uploaded.name || null);
                }

                return {
                    projects: formState.projects,
                    type: formState.type,
                    vendor: formState.vendor === OTHERS_VENDOR_VALUE ? "" : formState.vendor,
                    description: formState.description.trim(),
                    comment: formState.comment.trim(),
                    amount: parseNumber(formState.amount),
                    ...(recordInvoiceDetails && {
                        invoice_ref: formState.invoice_ref.trim() || undefined,
                        invoice_date: formState.invoice_date || undefined,
                        invoice_attachment: invoiceAttachmentUrl,
                    }),
                };
            });

            // Re-link the uploaded invoice File to the freshly-created expense so it
            // shows under the doc's attachments (attached_to_doctype / _name). Field
            // URL is already saved above, so a re-link failure is non-blocking.
            if (recordInvoiceDetails && invoiceAttachmentUrl && uploadedInvoiceFileName && created?.name) {
                try {
                    await updateDoc("File", uploadedInvoiceFileName, {
                        attached_to_doctype: DOCTYPE,
                        attached_to_name: created.name,
                        attached_to_field: "invoice_attachment",
                    });
                } catch { /* non-blocking: the field URL is set regardless */ }
            }

            // Name the path the expense took: an auto-approved one never reaches an
            // approver, and the server's returned status is the authority on that.
            toast({ ...getExpenseCreatedToast(created?.status, formState.amount), variant: "success" });
            onSuccess?.();
            handleDialogClose();
        } catch (error: unknown) {
            toast(directExpenseErrorToast(error, "Error", "Failed to record expense."));
        }
    };

    // Changing the type re-applies its rule: a pick made under one type is not carried to another.
    const handleTypeSelect = (type: string) => {
        if (type !== formState.type) payeeChoice.reset();
        handleInputChange('type', type);
        setExpenseTypePopoverOpen(false);
    };

    // --- State & Effect Hooks ---
    const resetInvoiceState = useCallback(() => {
        setRecordInvoiceDetails(false);
        setInvoiceAttachmentFile(null);
        setUploadedInvoiceUrl(null);
        setUploadedInvoiceFileName(null);
        setAutofilledFields(new Set());
        setIsAutofilling(false);
        setInvoiceStage("upload");
    }, []);

    useEffect(() => {
        if (newProjectExpenseDialog) {
            // Bump session so any orphan autofill from a previous open can't land here.
            extractionSessionRef.current++;
            setFormState({ ...INITIAL_STATE, projects: projectId || "" });
            setFormErrors({});
            setExpenseTypePopoverOpen(false);
            resetInvoiceState();
        }
    }, [newProjectExpenseDialog, projectId, resetInvoiceState]);

    useEffect(() => {
        const commandListElement = commandListRef.current;
        const handleWheel = (e: WheelEvent) => e.stopPropagation();
        if (commandListElement) commandListElement.addEventListener('wheel', handleWheel);
        return () => { if (commandListElement) commandListElement.removeEventListener('wheel', handleWheel); };
    }, [expenseTypePopoverOpen]);

    const handleInputChange = useCallback((fieldName: keyof FormState, value: string) => {
        setFormState(p => ({ ...p, [fieldName]: value }));
        if (formErrors[fieldName]) {
            setFormErrors(prev => ({ ...prev, [fieldName]: undefined }));
        }
        // If the user manually edits an auto-filled field, drop its amber tint.
        if (autofilledFields.has(fieldName)) {
            setAutofilledFields(prev => { const next = new Set(prev); next.delete(fieldName); return next; });
        }
    }, [formErrors, autofilledFields]);

    const isLoadingOverall = loading || uploadLoading || vendorsLoading || expenseTypesLoading;
    const isSubmitDisabled = isLoadingOverall || isAutofilling || !whoGetsPaid.ready || Object.values(formErrors).some(Boolean);
    const selectedExpenseTypeLabel = expenseTypeOptions.find(option => option.value === formState.type)?.label || "Select an expense type...";
    // The submit label names the path this expense will actually take: a positive amount
    // BELOW ₹15,000 is auto-approved on save ("Raise Expense"), anything else -- at or
    // above ₹15,000, a refund, or a blank amount -- goes to an approver.
    //
    // ⚠️ The threshold comes from the CENTRALIZED rule (`utils/approvalTiers.ts`, itself a
    // pinned mirror of `services/approval_tiers.py`), which is what both expense doctype
    // controllers now route on. It used to be a separate ₹10,000 owned by
    // `expenseApproval.ts`, and that copy drifted: for ₹10,001-₹14,999 the server
    // auto-approved while this button still read "Send for Approval".
    const submitLabel = getExpenseSubmitLabel(formState.amount);

    return (
        <AlertDialog open={newProjectExpenseDialog} onOpenChange={(isOpen) => !isOpen && !loading && handleDialogClose()}>
            <AlertDialogContent className="sm:max-w-lg">
                <AlertDialogHeader><AlertDialogTitle className="text-center">Add New Project Expense</AlertDialogTitle></AlertDialogHeader>
                <div className="space-y-4 py-2 max-h-[70vh] overflow-y-auto pr-2">
                    {!projectId && (
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="project" className="text-right">Project <sup className="text-destructive">*</sup></Label>
                            <div className="col-span-3">
                                <ProjectSelect universal usePortal onChange={(selected) => handleInputChange('projects', selected?.value || '')} />
                                {formErrors.projects && <p className="text-xs text-destructive mt-1">{formErrors.projects}</p>}
                            </div>
                        </div>
                    )}
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="type" className="text-right">Type <sup className="text-destructive">*</sup></Label>
                        <div className="col-span-3">
                            <Popover open={expenseTypePopoverOpen} onOpenChange={setExpenseTypePopoverOpen}>
                                <PopoverTrigger asChild>
                                    <Button variant="outline" role="combobox" className={`w-full justify-between ${formErrors.type ? "border-destructive" : ""}`} disabled={isLoadingOverall}>
                                        <span className="truncate">{selectedExpenseTypeLabel}</span><ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                                    <Command><CommandInput placeholder="Search type..." /><CommandList ref={commandListRef} className="max-h-[300px]"><CommandEmpty>No type found.</CommandEmpty><CommandGroup>
                                        {expenseTypeOptions.map((option) => (
                                            <CommandItem key={option.value} value={option.value} onSelect={() => handleTypeSelect(option.value)}>
                                                <Check className={cn("mr-2 h-4 w-4", formState.type === option.value ? "opacity-100" : "opacity-0")} />{option.label}
                                            </CommandItem>
                                        ))}
                                    </CommandGroup></CommandList></Command>
                                </PopoverContent>
                            </Popover>
                            {formErrors.type && <p className="text-xs text-destructive mt-1">{formErrors.type}</p>}
                        </div>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="description" className="text-right">Description <sup className="text-destructive">*</sup></Label>
                        <div className="col-span-3">
                            <Textarea id="description" value={formState.description} onChange={(e) => handleInputChange('description', e.target.value)} className={formErrors.description ? "border-destructive" : ""} disabled={isLoadingOverall} />
                            {formErrors.description && <p className="text-xs text-destructive mt-1">{formErrors.description}</p>}
                        </div>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="amount" className="text-right">Amount <sup className="text-destructive">*</sup></Label>
                        <div className="col-span-3">
                            <Input id="amount" type="number" value={formState.amount} onChange={(e) => handleInputChange('amount', e.target.value)} className={cn(formErrors.amount ? "border-destructive" : "", autofilledFields.has("amount") && "bg-amber-50 border-amber-300 focus-visible:ring-amber-400")} disabled={isLoadingOverall} />
                            {formErrors.amount && <p className="text-xs text-destructive mt-1">{formErrors.amount}</p>}
                        </div>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="vendor" className="text-right">Vendor <sup className="text-destructive">*</sup></Label>
                        <div className="col-span-3">
                            <Select value={formState.vendor} onValueChange={(val) => handleInputChange('vendor', val)} disabled={isLoadingOverall}>
                                <SelectTrigger className={formErrors.vendor ? "border-destructive" : ""}><SelectValue placeholder="Select a vendor or 'Others'..." /></SelectTrigger>
                                <SelectContent>{vendorOptions.map(v => <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>)}</SelectContent>
                            </Select>
                            {formErrors.vendor && <p className="text-xs text-destructive mt-1">{formErrors.vendor}</p>}
                        </div>
                    </div>
                    {whoGetsPaid.shows && (
                        <WhoGetsPaidSection
                            rule={payeeRule}
                            expenseType={selectedTypeLabel}
                            vendorChosen={vendorChosen}
                            vendorName={vendorName}
                            vendorPayTo={vendorAccount?.payee ?? null}
                            vendorPayToLoading={vendorAccountLoading}
                            choice={payeeChoice}
                            problem={whoGetsPaid.problem}
                            disabled={isLoadingOverall}
                        />
                    )}
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="comment" className="text-right">Comment</Label>
                        <Textarea id="comment" value={formState.comment} onChange={(e) => handleInputChange('comment', e.target.value)} className="col-span-3" disabled={isLoadingOverall} />
                    </div>

                    <Separator className="my-2" />

                    {/* Invoice Details (optional) — recorded by the creator; payment is
                        recorded later by the Accountant at Mark-as-Paid. */}
                    <div className="flex items-center space-x-2">
                        <Checkbox id="recordInvoiceDetails_new_pe" checked={recordInvoiceDetails} onCheckedChange={(checked) => setRecordInvoiceDetails(Boolean(checked))} disabled={isLoadingOverall} />
                        <Label htmlFor="recordInvoiceDetails_new_pe" className="font-medium">Record Invoice Details</Label>
                    </div>
                    {recordInvoiceDetails && (
                        <div className="pl-6 space-y-3 border-l-2 ml-2 mt-2 border-dashed">
                            {invoiceStage === "upload" ? (
                                // ───────── Stage 1: Upload invoice ─────────
                                <div className="space-y-4 py-2">
                                    {!isAutofilling ? (
                                        <>
                                            <div className="text-center space-y-1">
                                                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Upload Invoice</h3>
                                                <p className="text-xs text-muted-foreground">We'll read the invoice and fill in Invoice Ref, Invoice Date, and Amount for you.</p>
                                            </div>
                                            <CustomAttachment
                                                label="Choose Invoice (PDF or image)"
                                                selectedFile={invoiceAttachmentFile}
                                                onFileSelect={handleInvoiceFileSelect}
                                                onError={handleAttachmentError}
                                                maxFileSize={5 * 1024 * 1024}
                                                acceptedTypes={ATTACHMENT_ACCEPTED_TYPES}
                                                disabled={isLoadingOverall}
                                            />
                                            <p className="text-[11px] text-center text-muted-foreground">Supported for auto-fill: PDF, PNG, JPG · max 5 MB</p>
                                        </>
                                    ) : (
                                        <div className="flex flex-col items-center gap-3 py-6">
                                            <Loader2 className="h-8 w-8 text-amber-600 animate-spin" />
                                            <div className="text-center space-y-1">
                                                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Reading your invoice…</p>
                                                <p className="text-xs text-muted-foreground">AI is extracting invoice details. This usually takes a few seconds.</p>
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
                                            <span className="text-xs text-amber-900 leading-snug">Auto-filled from invoice — please review and edit if anything is wrong.</span>
                                        </div>
                                    )}
                                    <div className="grid grid-cols-4 items-center gap-3">
                                        <Label htmlFor="invoice_date_new_pe" className="text-right col-span-1">Invoice Date <sup className="text-destructive">*</sup></Label>
                                        <Input id="invoice_date_new_pe" name="invoice_date" type="date" value={formState.invoice_date} onChange={(e) => handleInputChange('invoice_date', e.target.value)} max={formatDateFns(new Date(), "yyyy-MM-dd")} className={cn("col-span-3", autofilledFields.has("invoice_date") && "bg-amber-50 border-amber-300 focus-visible:ring-amber-400", formErrors.invoice_date && "border-destructive")} disabled={isLoadingOverall} />
                                        {formErrors.invoice_date && <p className="col-span-3 col-start-2 text-xs text-destructive mt-1">{formErrors.invoice_date}</p>}
                                    </div>
                                    <div className="grid grid-cols-4 items-center gap-3">
                                        <Label htmlFor="invoice_ref_new_pe" className="text-right col-span-1">Invoice Ref{(invoiceAttachmentFile || uploadedInvoiceUrl) && <sup className="text-destructive"> *</sup>}</Label>
                                        <Input id="invoice_ref_new_pe" name="invoice_ref" value={formState.invoice_ref} onChange={(e) => handleInputChange('invoice_ref', e.target.value)} className={cn("col-span-3", autofilledFields.has("invoice_ref") && "bg-amber-50 border-amber-300 focus-visible:ring-amber-400", formErrors.invoice_ref && "border-destructive")} disabled={isLoadingOverall} />
                                        {formErrors.invoice_ref && <p className="col-span-3 col-start-2 text-xs text-destructive mt-1">{formErrors.invoice_ref}</p>}
                                    </div>
                                    <div className="grid grid-cols-4 items-start gap-3">
                                        <Label className="text-right col-span-1 pt-2">Invoice Attachment</Label>
                                        <div className="col-span-3">
                                            <CustomAttachment
                                                label="Upload Invoice Document"
                                                selectedFile={invoiceAttachmentFile}
                                                onFileSelect={handleInvoiceFileSelect}
                                                onError={handleAttachmentError}
                                                maxFileSize={5 * 1024 * 1024}
                                                acceptedTypes={ATTACHMENT_ACCEPTED_TYPES}
                                                disabled={isLoadingOverall}
                                            />
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </div>
                <AlertDialogFooter>
                    {isLoadingOverall ? <div className="flex justify-end w-full"><TailSpin color="#4f46e5" height={28} width={28} /></div> : <>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={(e) => { e.preventDefault(); handleSubmit(); }} disabled={isSubmitDisabled}>{submitLabel}</AlertDialogAction>
                    </>}
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};
