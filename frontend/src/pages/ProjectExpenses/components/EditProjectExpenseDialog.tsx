// src/pages/ProjectExpenses/components/EditProjectExpenseDialog.tsx

import React, { useCallback, useEffect, useState, useMemo, useRef } from "react";
import { useFrappeUpdateDoc, useFrappeFileUpload, useFrappeGetDocList } from "frappe-react-sdk";
import { TailSpin } from "react-loader-spinner";
import { formatDate as formatDateFns } from "date-fns";
import { Check, ChevronsUpDown, Download } from "lucide-react";

// --- UI Components ---
import {
    AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
    AlertDialogHeader, AlertDialogTitle, AlertDialogFooter, AlertDialogAction
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { CustomAttachment, AcceptedFileType } from "@/components/helpers/CustomAttachment";
import { FuzzySearchSelect, type FuzzyOptionType, type TokenSearchConfig } from "@/components/ui/fuzzy-search-select";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";

// --- Types ---
import { ProjectExpenses } from "@/types/NirmaanStack/ProjectExpenses";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { ExpenseType } from "@/types/NirmaanStack/ExpenseType";
import { Projects } from "@/types/NirmaanStack/Projects";

// --- Utils & State ---
import { parseNumber } from "@/utils/parseNumber";
import { useDialogStore } from "@/zustand/useDialogStore";
import { queryKeys, getProjectExpenseTypeListOptions } from "@/config/queryKeys";
import { useCEOHoldGuard } from "@/hooks/useCEOHoldGuard";
import { useExpenseFieldAccess } from "@/hooks/useExpenseDecision";
import { mayEditExpenseField } from "@/utils/expenses/expenseDecision";
import { isPaidExpense } from "@/pages/ProjectPayments/config/queueRowActions";
import SITEURL from "@/constants/siteURL";
import { invoiceAttachmentUrl, projectField } from "@/utils/porterExpense";
import { PorterSectionBlock, usePorterExpense } from "@/components/common/PorterExpense";
import { ExpenseEditPayToSection, useExpenseEditPayTo } from "@/components/payees/ExpenseEditPayTo";
import { expenseAccountSaveError } from "@/components/payees/useChangeExpenseAccount";

// The Project picker searches name and code, as `ProjectSelect` does. `ProjectSelect` itself takes no
// `value`, so it cannot show the project this expense already has; this picker is controlled.
const PROJECT_SEARCH: TokenSearchConfig = {
    searchFields: ["label", "value"],
    minSearchLength: 1,
    partialMatch: true,
    minTokenLength: 1,
    fieldWeights: { label: 2.0, value: 1.5 },
    minTokenMatches: 1,
};

interface ProjectOption extends FuzzyOptionType {
    value: string;
    label: string;
}

interface EditProjectExpenseDialogProps {
    expenseToEdit: ProjectExpenses;
    onSuccess?: () => void;
}

interface FormState {
    projects: string;
    type: string;
    vendor: string;
    description: string;
    comment: string;
    amount: string;
    payment_date: string;
    payment_ref: string;
    invoice_date: string;
    invoice_ref: string;
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
const OTHERS_VENDOR_VALUE = "OTHERS_EMPTY_SELECTION";
const DOCTYPE = "Project Expenses";

const ATTACHMENT_ACCEPTED_TYPES: AcceptedFileType[] = ["image/*", "application/pdf", "text/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"];

const INITIAL_STATE: FormState = {
    projects: "", type: "", vendor: "", description: "", comment: "", amount: "",
    payment_date: "", payment_ref: "", invoice_date: "", invoice_ref: "",
};

export const EditProjectExpenseDialog: React.FC<EditProjectExpenseDialogProps> = ({ expenseToEdit, onSuccess }) => {
    const { editProjectExpenseDialog, setEditProjectExpenseDialog } = useDialogStore();
    const { toast } = useToast();
    const [formState, setFormState] = useState<FormState>(INITIAL_STATE);
    const [formErrors, setFormErrors] = useState<Partial<FormState>>({});
    const [newInvoiceFile, setNewInvoiceFile] = useState<File | null>(null);

    // CEO Hold guard - get project from the expense being edited
    const { isCEOHold, showBlockedToast } = useCEOHoldGuard(expenseToEdit?.projects);

    // Payment details exist only once the expense is PAID, and are shown then. Which fields this
    // caller may change is the server's answer (`get_expense_edit_access`, story 50): on a Paid
    // expense Admin and the Accountant Lead correct its details, and its amount and payment stay
    // read-only for everyone. A field the answer withholds is shown disabled and never sent.
    const isPaid = isPaidExpense(expenseToEdit?.status);
    const fieldAccess = useExpenseFieldAccess();
    const mayEdit = useCallback(
        (field: string) => mayEditExpenseField(fieldAccess, expenseToEdit?.status, field),
        [fieldAccess, expenseToEdit?.status],
    );

    // A Porter Expense (#1450): its project is shown locked -- it moves only through Rectify in Bulk
    // Import, which keeps the import's record in step -- and its Porter facts are shown read-only. The
    // dialog has no project field for any other expense, as before.
    const project = projectField(expenseToEdit);
    const porter = usePorterExpense(DOCTYPE, expenseToEdit?.name, project.locked && editProjectExpenseDialog);

    const [expenseTypePopoverOpen, setExpenseTypePopoverOpen] = useState(false);
    const commandListRef = useRef<HTMLDivElement>(null);

    const { updateDoc, loading } = useFrappeUpdateDoc();
    const { upload, loading: uploadLoading } = useFrappeFileUpload();
    const { data: vendorsData, isLoading: vendorsLoading } = useFrappeGetDocList<Vendors>("Vendors", { fields: ["name", "vendor_name"], limit: 0 });
    const { data: projectsData, isLoading: projectsLoading } = useFrappeGetDocList<Projects>("Projects", {
        fields: ["name", "project_name"], orderBy: { field: "project_name", order: "asc" }, limit: 0,
    });
    const expenseTypeFetchOptions = useMemo(() => getProjectExpenseTypeListOptions(), []);
    const { data: expenseTypesData, isLoading: expenseTypesLoading } = useFrappeGetDocList<ExpenseType>("Expense Type", expenseTypeFetchOptions as any, queryKeys.expenseTypes.list(expenseTypeFetchOptions));

    const vendorOptions = useMemo(() => {
        const vendors = vendorsData?.map(v => ({ value: v.name, label: v.vendor_name })) || [];
        return [{ value: OTHERS_VENDOR_VALUE, label: "Others (No Vendor)" }, ...vendors];
    }, [vendorsData]);

    const expenseTypeOptions = useMemo(() => expenseTypesData?.map(et => ({ value: et.name, label: et.expense_name })) || [], [expenseTypesData]);

    // Who gets paid (#1465, #1472): Accounts set an Approved expense's account here, and the raiser of a
    // Direct Expense a Requested one's, saved with the edit.
    const selectedExpenseType = expenseTypesData?.find(et => et.name === formState.type);
    const vendorNamed = !!formState.vendor && formState.vendor !== OTHERS_VENDOR_VALUE;
    const payTo = useExpenseEditPayTo({
        doctype: DOCTYPE,
        name: expenseToEdit.name,
        expense: expenseToEdit,
        rule: selectedExpenseType ? selectedExpenseType.payee_rule ?? null : undefined,
        vendorNamed,
    });
    const { reset: resetPayTo } = payTo;

    useEffect(() => {
        if (editProjectExpenseDialog && expenseToEdit) {
            setFormState({
                projects: expenseToEdit.projects || "",
                type: expenseToEdit.type || "",
                vendor: expenseToEdit.vendor || OTHERS_VENDOR_VALUE,
                description: expenseToEdit.description || "",
                comment: expenseToEdit.comment || "",
                amount: expenseToEdit.amount?.toString() || "",
                payment_date: expenseToEdit.payment_date ? formatDateFns(new Date(expenseToEdit.payment_date), 'yyyy-MM-dd') : "",
                payment_ref: expenseToEdit.payment_ref || "",
                invoice_date: expenseToEdit.invoice_date ? formatDateFns(new Date(expenseToEdit.invoice_date), 'yyyy-MM-dd') : "",
                invoice_ref: expenseToEdit.invoice_ref || "",
            });
            setNewInvoiceFile(null);
            setFormErrors({});
            setExpenseTypePopoverOpen(false);
        }
    }, [editProjectExpenseDialog, expenseToEdit]);

    useEffect(() => {
        const commandListElement = commandListRef.current;
        const handleWheel = (e: WheelEvent) => e.stopPropagation();
        if (commandListElement) commandListElement.addEventListener('wheel', handleWheel);
        return () => { if (commandListElement) commandListElement.removeEventListener('wheel', handleWheel); };
    }, [expenseTypePopoverOpen]);

    // THE close: Cancel, Escape and a save all come through here, so the next open starts with nothing
    // picked. A save closes it here too, not only through the parent's store write, which bypasses
    // `onOpenChange`.
    const closeDialog = useCallback(() => {
        resetPayTo();
        setEditProjectExpenseDialog(false);
    }, [resetPayTo, setEditProjectExpenseDialog]);

    const handleAttachmentError = useCallback(({ message }: { type: "size" | "type", message: string }) => {
        toast({ title: "Attachment Error", description: message, variant: "destructive" });
    }, [toast]);

    const hasInvoiceAttachment = !!newInvoiceFile || !!expenseToEdit?.invoice_attachment;

    const validateForm = useCallback((): boolean => {
        const errors: Partial<FormState> = {};
        if (!formState.type) errors.type = "Expense Type is required.";
        if (!formState.description.trim()) errors.description = "Description is required.";
        if (formState.vendor === "") errors.vendor = "Please select a vendor or 'Others'.";
        // An invoice attachment (existing or newly staged) requires an Invoice Ref.
        if (hasInvoiceAttachment && !formState.invoice_ref.trim()) {
            errors.invoice_ref = "Invoice reference is required when an invoice is attached.";
        }

        const amountValue = parseNumber(formState.amount);
        if (!formState.amount.trim() || isNaN(amountValue)) {
            errors.amount = "A valid amount is required.";
        }

        setFormErrors(errors);
        return Object.keys(errors).length === 0;
    }, [formState, hasInvoiceAttachment, expenseTypeOptions]);

    const handleSubmit = async () => {
        if (isCEOHold) {
            showBlockedToast();
            return;
        }
        if (!validateForm()) {
            toast({ title: "Validation Error", description: "Please fill all required fields correctly.", variant: "destructive" });
            return;
        }
        try {
            // Who gets paid, resolved FIRST: a new payee is added now, and a duplicate stops the save
            // before anything is written. It is copied onto the expense after the update below.
            const payee = await payTo.resolve();
            const finalVendor = formState.vendor === OTHERS_VENDOR_VALUE ? "" : formState.vendor;
            // null CLEARS a field (undefined would be omitted from the payload and Frappe would
            // retain the current value).
            const changes: Record<string, string | number | null> = {
                // A Porter Expense's project moves only through Rectify, so it is never sent.
                ...(project.locked ? {} : { projects: formState.projects }),
                amount: parseNumber(formState.amount),
                type: formState.type,
                vendor: finalVendor,
                description: formState.description.trim(),
                comment: formState.comment.trim(),
                invoice_date: formState.invoice_date || null,
                invoice_ref: formState.invoice_ref.trim() || null,
            };

            // Upload replacement attachments (doc exists → docname-linked to the doctype).
            if (newInvoiceFile && mayEdit("invoice_attachment")) {
                const uploaded = await upload(newInvoiceFile, { doctype: DOCTYPE, docname: expenseToEdit.name, fieldname: "invoice_attachment", isPrivate: true });
                changes.invoice_attachment = uploaded.file_url;
            }
            // Only what the server lets this caller change (the payment date / ref are never sent).
            const dataToUpdate = Object.fromEntries(Object.entries(changes).filter(([field]) => mayEdit(field)));

            await updateDoc(DOCTYPE, expenseToEdit.name, dataToUpdate);
            await payTo.apply(payee);
            toast({ title: "Success", description: "Expense updated successfully.", variant: "success" });
            closeDialog();
            onSuccess?.();
        } catch (error: unknown) {
            toast({ title: "Could not update the expense", description: expenseAccountSaveError(error), variant: "destructive" });
        }
    };

    const handleInputChange = useCallback((fieldName: keyof FormState, value: string) => {
        setFormState(p => ({ ...p, [fieldName]: value }));
        if (formErrors[fieldName]) {
            setFormErrors(prev => ({ ...prev, [fieldName]: undefined }));
        }
    }, [formErrors]);

    const isLoadingOverall = loading || uploadLoading || vendorsLoading || projectsLoading || expenseTypesLoading || payTo.busy;
    const isSubmitDisabled = isLoadingOverall || Object.values(formErrors).some(Boolean) || !!payTo.problem;
    const projectOptions: ProjectOption[] = useMemo(
        () => (projectsData || []).map(p => ({ value: p.name, label: p.project_name || p.name })),
        [projectsData],
    );
    const selectedProjectOption = projectOptions.find(o => o.value === formState.projects) ?? null;
    const selectedExpenseTypeLabel = expenseTypeOptions.find(option => option.value === formState.type)?.label || "Select an expense type...";

    return (
        <AlertDialog open={editProjectExpenseDialog} onOpenChange={(isOpen) => (isOpen ? setEditProjectExpenseDialog(true) : closeDialog())}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Edit Project Expense</AlertDialogTitle>
                    <AlertDialogDescription>ID: {expenseToEdit.name}</AlertDialogDescription>
                </AlertDialogHeader>
                <div className="space-y-4 py-2 max-h-[70vh] overflow-y-auto pr-2">
                    {project.locked ? (
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="project_edit" className="text-right">Project</Label>
                            <div className="col-span-3">
                                <Input id="project_edit" value={porter.section?.project_name || expenseToEdit.projects || ""} disabled readOnly />
                                <p className="text-xs text-muted-foreground mt-1">{project.hint}</p>
                            </div>
                        </div>
                    ) : (
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="project_edit" className="text-right">Project</Label>
                            <div className="col-span-3">
                                <FuzzySearchSelect<ProjectOption, false>
                                    inputId="project_edit"
                                    allOptions={projectOptions}
                                    tokenSearchConfig={PROJECT_SEARCH}
                                    isLoading={projectsLoading}
                                    isDisabled={isLoadingOverall || !mayEdit("projects")}
                                    value={selectedProjectOption}
                                    onChange={(o) => handleInputChange('projects', o?.value ?? "")}
                                    placeholder="Select a project..."
                                    // In the dialog's scroll box the menu would be clipped: render it on the body.
                                    menuPortalTarget={document.body}
                                    menuPosition="fixed"
                                />
                            </div>
                        </div>
                    )}
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="type_edit" className="text-right">Type <sup className="text-destructive">*</sup></Label>
                        <div className="col-span-3">
                            <Popover open={expenseTypePopoverOpen} onOpenChange={setExpenseTypePopoverOpen}>
                                <PopoverTrigger asChild><Button variant="outline" role="combobox" className={`w-full justify-between ${formErrors.type ? "border-destructive" : ""}`} disabled={isLoadingOverall}>{selectedExpenseTypeLabel}<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" /></Button></PopoverTrigger>
                                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start"><Command><CommandInput placeholder="Search type..." /><CommandList ref={commandListRef} className="max-h-[300px]"><CommandEmpty>No type found.</CommandEmpty><CommandGroup>
                                    {expenseTypeOptions.map((option) => (
                                        <CommandItem key={option.value} value={option.value} onSelect={() => { handleInputChange('type', option.value); setExpenseTypePopoverOpen(false); }}>
                                            <Check className={cn("mr-2 h-4 w-4", formState.type === option.value ? "opacity-100" : "opacity-0")} />{option.label}
                                        </CommandItem>
                                    ))}
                                </CommandGroup></CommandList></Command></PopoverContent>
                            </Popover>
                            {formErrors.type && <p className="text-xs text-destructive mt-1">{formErrors.type}</p>}
                        </div>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="description_edit" className="text-right">Description <sup className="text-destructive">*</sup></Label>
                        <div className="col-span-3">
                            <Textarea id="description_edit" value={formState.description} onChange={(e) => handleInputChange('description', e.target.value)} className={formErrors.description ? "border-destructive" : ""} disabled={isLoadingOverall} />
                            {formErrors.description && <p className="text-xs text-destructive mt-1">{formErrors.description}</p>}
                        </div>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="amount_edit" className="text-right">Amount <sup className="text-destructive">*</sup></Label>
                        <div className="col-span-3">
                            <Input id="amount_edit" type="number" value={formState.amount} onChange={(e) => handleInputChange('amount', e.target.value)} className={formErrors.amount ? "border-destructive" : ""} disabled={isLoadingOverall || !mayEdit("amount")} />
                            {formErrors.amount && <p className="text-xs text-destructive mt-1">{formErrors.amount}</p>}
                            {isPaid && !mayEdit("amount") && <p className="text-xs text-muted-foreground mt-1">Paid — the amount can no longer be changed.</p>}
                        </div>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="vendor_edit" className="text-right">Vendor <sup className="text-destructive">*</sup></Label>
                        <div className="col-span-3">
                            <Select value={formState.vendor} onValueChange={(val) => handleInputChange('vendor', val)} disabled={isLoadingOverall}>
                                <SelectTrigger id="vendor_edit" className={formErrors.vendor ? "border-destructive" : ""}><SelectValue placeholder="Select a vendor or 'Others'..." /></SelectTrigger>
                                <SelectContent>{vendorOptions.map(v => <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>)}</SelectContent>
                            </Select>
                            {formErrors.vendor && <p className="text-xs text-destructive mt-1">{formErrors.vendor}</p>}
                        </div>
                    </div>
                    <ExpenseEditPayToSection
                        payTo={payTo}
                        expenseType={selectedExpenseType?.expense_name || formState.type}
                        vendor={vendorNamed ? formState.vendor : undefined}
                        vendorName={vendorNamed ? vendorOptions.find(v => v.value === formState.vendor)?.label : null}
                        disabled={isLoadingOverall}
                    />
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="comment_edit" className="text-right">Comment</Label>
                        <Textarea id="comment_edit" value={formState.comment} onChange={(e) => handleInputChange('comment', e.target.value)} className="col-span-3" disabled={isLoadingOverall} />
                    </div>

                    {/* Invoice Details (editable in any stage) */}
                    <Separator className="my-1" />
                    <p className="text-sm font-medium">Invoice Details</p>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="invoice_date_edit" className="text-right col-span-1">Invoice Date</Label>
                        <Input id="invoice_date_edit" type="date" value={formState.invoice_date} onChange={(e) => handleInputChange('invoice_date', e.target.value)} max={formatDateFns(new Date(), 'yyyy-MM-dd')} className="col-span-3" disabled={isLoadingOverall} />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="invoice_ref_edit" className="text-right col-span-1">Invoice Ref{hasInvoiceAttachment && <sup className="text-destructive"> *</sup>}</Label>
                        <div className="col-span-3">
                            <Input id="invoice_ref_edit" value={formState.invoice_ref} onChange={(e) => handleInputChange('invoice_ref', e.target.value)} className={formErrors.invoice_ref ? "border-destructive" : ""} disabled={isLoadingOverall} />
                            {formErrors.invoice_ref && <p className="text-xs text-destructive mt-1">{formErrors.invoice_ref}</p>}
                        </div>
                    </div>
                    <div className="grid grid-cols-4 items-start gap-3">
                        <Label className="text-right col-span-1 pt-2">Invoice Attachment</Label>
                        <div className="col-span-3 space-y-2">
                            {expenseToEdit.invoice_attachment && !newInvoiceFile && (
                                <div className="flex items-center gap-2 p-2 bg-muted/60 rounded-md text-sm">
                                    <Download className="h-4 w-4 text-primary flex-shrink-0" />
                                    <a href={SITEURL + (invoiceAttachmentUrl(DOCTYPE, expenseToEdit) ?? expenseToEdit.invoice_attachment)} target="_blank" rel="noreferrer" className="truncate hover:underline" title={`View ${expenseToEdit.invoice_attachment.split('/').pop()}`}>{expenseToEdit.invoice_attachment.split('/').pop()}</a>
                                </div>
                            )}
                            <CustomAttachment
                                label={expenseToEdit.invoice_attachment ? "Replace Invoice Attachment" : "Upload Invoice Attachment"}
                                selectedFile={newInvoiceFile}
                                onFileSelect={setNewInvoiceFile}
                                onError={handleAttachmentError}
                                maxFileSize={5 * 1024 * 1024}
                                acceptedTypes={ATTACHMENT_ACCEPTED_TYPES}
                                disabled={isLoadingOverall}
                            />
                        </div>
                    </div>

                    {/* Payment Details — Paid only, and read-only: the server locks a Paid expense's payment for everyone. */}
                    {isPaid && (
                        <>
                            <Separator className="my-1" />
                            <p className="text-sm font-medium">Payment Details</p>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="payment_date_edit" className="text-right col-span-1">Payment Date</Label>
                                <Input id="payment_date_edit" type="date" value={formState.payment_date} className="col-span-3" disabled readOnly />
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="payment_ref_edit" className="text-right col-span-1">Payment Ref</Label>
                                <Input id="payment_ref_edit" value={formState.payment_ref} className="col-span-3" disabled readOnly />
                            </div>
                            <div className="grid grid-cols-4 items-start gap-3">
                                <Label className="text-right col-span-1 pt-2">Payment Attachment</Label>
                                <div className="col-span-3 space-y-2">
                                    {expenseToEdit.payment_attachment ? (
                                        <div className="flex items-center gap-2 p-2 bg-muted/60 rounded-md text-sm">
                                            <Download className="h-4 w-4 text-primary flex-shrink-0" />
                                            <a href={SITEURL + expenseToEdit.payment_attachment} target="_blank" rel="noreferrer" className="truncate hover:underline" title={`View ${expenseToEdit.payment_attachment.split('/').pop()}`}>{expenseToEdit.payment_attachment.split('/').pop()}</a>
                                        </div>
                                    ) : <p className="text-sm text-muted-foreground pt-2">--</p>}
                                </div>
                            </div>
                        </>
                    )}

                    {project.locked && (
                        <>
                            <Separator className="my-1" />
                            <PorterSectionBlock section={porter.section} isLoading={porter.isLoading} error={porter.error} />
                        </>
                    )}
                </div>
                <AlertDialogFooter>
                    {isLoadingOverall ? <div className="flex justify-end w-full"><TailSpin color="#4f46e5" height={28} width={28} /></div> : <>
                        <AlertDialogCancel asChild><Button variant="outline" type="button">Cancel</Button></AlertDialogCancel>
                        <AlertDialogAction onClick={(e) => { e.preventDefault(); handleSubmit(); }} disabled={isSubmitDisabled}>Save Changes</AlertDialogAction>
                    </>}
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};
