/**
 * Add or edit one Non-Project Inflow (#1265).
 *
 * ONE component for both modes (ADR-0010 F3) — the In-Flow Payments page keeps two ~700-line twins,
 * and this record is small enough not to repeat that. The rules (type list, Others needs a
 * description, amount > 0) live in `nonProjectInflowModel.ts`; the doctype enforces them again.
 *
 * ⚠️ THE RECEIPT IS UPLOADED WITH NO DOCTYPE ON PURPOSE. Frappe's `upload_file` checks WRITE on the
 * target doctype even for a record that does not exist yet, and an Accountant holds CREATE only —
 * a bound upload would refuse them outright. The loose File is claimed by the record on save
 * (`integrations/controllers/non_project_inflows.adopt_receipt_file`). Do not "tidy" this back into
 * the `doctype` / `docname` form the In-Flow Payments dialog uses.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useFrappeCreateDoc, useFrappeFileUpload, useFrappePostCall, useFrappeUpdateDoc } from "frappe-react-sdk";
import { format as formatDateFns } from "date-fns";
import { AlertCircle, ArrowDownToLine, Calendar, ExternalLink, FileText, Hash, IndianRupee, Loader2, Pencil, Save, Sparkles, Trash2 } from "lucide-react";

import { CustomAttachment } from "@/components/helpers/CustomAttachment";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import SITEURL from "@/constants/siteURL";
import { cn } from "@/lib/utils";
import { NonProjectInflows } from "@/types/NirmaanStack/NonProjectInflows";

import {
    DOCTYPE,
    INFLOW_TYPES,
    NonProjectInflowForm,
    NonProjectInflowFormErrors,
    buildNonProjectInflowDoc,
    descriptionRequired,
    validateNonProjectInflowForm,
} from "../nonProjectInflowModel";

const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;

// ISO for the date input's value; display dates elsewhere go through `@/utils/FormatDate`.
const today = () => formatDateFns(new Date(), "yyyy-MM-dd");

const emptyForm = (): NonProjectInflowForm => ({
    inflow_type: "",
    description: "",
    amount: "",
    utr: "",
    payment_date: today(),
});

const formFromRecord = (r: NonProjectInflows): NonProjectInflowForm => ({
    inflow_type: r.inflow_type || "",
    description: r.description || "",
    amount: r.amount != null ? String(r.amount) : "",
    utr: r.utr || "",
    payment_date: r.payment_date || "",
});

interface NonProjectInflowDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Present = edit this record; absent = add a new one. */
    inflow?: NonProjectInflows | null;
    onSuccess?: () => void;
}

export const NonProjectInflowDialog: React.FC<NonProjectInflowDialogProps> = ({ open, onOpenChange, inflow, onSuccess }) => {
    const isEdit = !!inflow;
    const { toast } = useToast();

    const [form, setForm] = useState<NonProjectInflowForm>(emptyForm);
    const [errors, setErrors] = useState<NonProjectInflowFormErrors>({});
    // Add mode opens on the receipt step; edit (and "no receipt") goes straight to the fields.
    const [stage, setStage] = useState<"upload" | "form">("upload");
    const [receiptFile, setReceiptFile] = useState<File | null>(null);
    const [attachmentUrl, setAttachmentUrl] = useState<string | null>(null);
    const [isAutofilling, setIsAutofilling] = useState(false);
    const [autofilled, setAutofilled] = useState<Set<keyof NonProjectInflowForm>>(new Set());
    // Bumped on every reset so a slow extraction cannot land in a later session of the dialog.
    const sessionRef = useRef(0);

    const { createDoc, loading: createLoading } = useFrappeCreateDoc();
    const { updateDoc, loading: updateLoading } = useFrappeUpdateDoc();
    const { upload, loading: uploadLoading } = useFrappeFileUpload();
    const { call: extractPaymentFields } = useFrappePostCall("nirmaan_stack.api.payment_autofill.extract_payment_fields");

    // Keyed on the record's NAME, never the object: a parent re-render hands a fresh object for the
    // same record, and resetting on that would wipe what the user is typing.
    const recordName = inflow?.name ?? null;
    useEffect(() => {
        if (!open) return;
        sessionRef.current++;
        setForm(inflow ? formFromRecord(inflow) : emptyForm());
        setErrors({});
        setStage(inflow ? "form" : "upload");
        setReceiptFile(null);
        setAttachmentUrl(inflow?.inflow_attachment || null);
        setIsAutofilling(false);
        setAutofilled(new Set());
        // eslint-disable-next-line react-hooks/exhaustive-deps -- reset per open / per record, see above
    }, [open, recordName]);

    const setField = useCallback((name: keyof NonProjectInflowForm, value: string) => {
        setForm((prev) => ({ ...prev, [name]: value }));
        setErrors((prev) => (prev[name] ? { ...prev, [name]: undefined } : prev));
        setAutofilled((prev) => {
            if (!prev.has(name)) return prev;
            const next = new Set(prev);
            next.delete(name);
            return next;
        });
    }, []);

    const uploadReceipt = useCallback(
        async (file: File) => (await upload(file, { isPrivate: true })).file_url as string,
        [upload]
    );

    /** Add mode: upload, then read amount / reference / date off the receipt. */
    const runAutofill = useCallback(
        async (file: File) => {
            const session = ++sessionRef.current;
            setIsAutofilling(true);
            try {
                const url = await uploadReceipt(file);
                if (session !== sessionRef.current) return;
                setAttachmentUrl(url);

                const res = await extractPaymentFields({ file_url: url });
                if (session !== sessionRef.current) return;
                const data = (res as { message?: Record<string, string> })?.message ?? {};

                const filled = new Set<keyof NonProjectInflowForm>();
                const updates: Partial<NonProjectInflowForm> = {};
                if (data.utr) { updates.utr = data.utr; filled.add("utr"); }
                if (data.payment_date) { updates.payment_date = data.payment_date; filled.add("payment_date"); }
                if (data.transfer_amount) { updates.amount = String(data.transfer_amount); filled.add("amount"); }
                setForm((prev) => ({ ...prev, ...updates }));
                setAutofilled(filled);
                toast(
                    filled.size > 0
                        ? { title: "Auto-filled from receipt", description: `Filled ${filled.size} field${filled.size > 1 ? "s" : ""}. Please check before saving.`, variant: "success" }
                        : { title: "Couldn't auto-fill", description: "Please enter Amount, UTR and Date by hand." }
                );
            } catch (e: any) {
                if (session !== sessionRef.current) return;
                toast({ title: "Auto-fill failed", description: e?.message || "Please enter the details by hand.", variant: "destructive" });
            } finally {
                if (session === sessionRef.current) {
                    setIsAutofilling(false);
                    setStage("form");
                }
            }
        },
        [uploadReceipt, extractPaymentFields, toast]
    );

    const handleFileSelect = useCallback(
        (file: File | null) => {
            setReceiptFile(file);
            setAutofilled(new Set());
            if (!file) {
                // Clearing the picker on an edit keeps the stored receipt; on add it drops the upload.
                if (!isEdit) setAttachmentUrl(null);
                return;
            }
            if (isEdit) {
                // A replacement is uploaded on save; no autofill over values already reviewed.
                return;
            }
            runAutofill(file);
        },
        [isEdit, runAutofill]
    );

    const handleSubmit = useCallback(async () => {
        const found = validateNonProjectInflowForm(form);
        setErrors(found);
        if (Object.keys(found).length > 0) return;
        try {
            let url = attachmentUrl;
            // Edit with a replacement picked, or add where the autofill upload never finished.
            if (receiptFile && (isEdit || !url)) url = await uploadReceipt(receiptFile);
            const doc = buildNonProjectInflowDoc(form, url);
            if (inflow) {
                await updateDoc(DOCTYPE, inflow.name, doc);
                toast({ title: "Saved", description: "Non-project inflow updated.", variant: "success" });
            } else {
                await createDoc(DOCTYPE, doc);
                toast({ title: "Recorded", description: "Non-project inflow added.", variant: "success" });
            }
            onSuccess?.();
            onOpenChange(false);
        } catch (e: any) {
            toast({ title: "Failed", description: e?.message || "Could not save the inflow.", variant: "destructive" });
        }
    }, [form, attachmentUrl, receiptFile, isEdit, inflow, uploadReceipt, updateDoc, createDoc, toast, onSuccess, onOpenChange]);

    const busy = createLoading || updateLoading || uploadLoading || isAutofilling;
    const needsDescription = descriptionRequired(form.inflow_type);

    const tint = (field: keyof NonProjectInflowForm) => autofilled.has(field) && "bg-amber-50 border-amber-300 focus-visible:ring-amber-400";
    const errorLine = (field: keyof NonProjectInflowForm) =>
        errors[field] ? (
            <p className="text-xs text-red-500 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                {errors[field]}
            </p>
        ) : null;

    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent className="max-w-[480px] p-0 gap-0 overflow-hidden border-0 shadow-2xl">
                <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 px-6 py-5">
                    <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center w-10 h-10 rounded-full bg-emerald-500/20 ring-1 ring-emerald-500/30">
                            {isEdit ? <Pencil className="w-5 h-5 text-emerald-400" /> : <ArrowDownToLine className="w-5 h-5 text-emerald-400" />}
                        </div>
                        <div>
                            <AlertDialogTitle className="text-lg font-semibold text-white tracking-tight">
                                {isEdit ? "Edit Non-Project Inflow" : "Record Non-Project Inflow"}
                            </AlertDialogTitle>
                            <p className="text-xs text-slate-400 mt-0.5">
                                {isEdit ? inflow?.name : "Money received that belongs to no project or customer"}
                            </p>
                        </div>
                    </div>
                </div>

                <div className="px-6 py-5 space-y-5 bg-white dark:bg-slate-950 max-h-[70vh] overflow-y-auto">
                    {/* Inflow Type — four owner-fixed values, so buttons rather than a dropdown. */}
                    <div className="space-y-1.5">
                        <Label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                            Inflow Type <span className="text-red-500">*</span>
                        </Label>
                        <div role="radiogroup" aria-label="Inflow Type" className="grid grid-cols-2 gap-2">
                            {INFLOW_TYPES.map((t) => (
                                <button
                                    key={t}
                                    type="button"
                                    role="radio"
                                    aria-checked={form.inflow_type === t}
                                    onClick={() => setField("inflow_type", t)}
                                    className={cn(
                                        "h-9 rounded-md border text-sm font-medium transition-colors",
                                        form.inflow_type === t
                                            ? "border-emerald-600 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                                            : "border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900"
                                    )}
                                >
                                    {t}
                                </button>
                            ))}
                        </div>
                        {errorLine("inflow_type")}
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="npi-description" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                            Description{" "}
                            {needsDescription ? <span className="text-red-500">*</span> : <span className="text-xs font-normal text-slate-400">(Optional)</span>}
                        </Label>
                        <Textarea
                            id="npi-description"
                            rows={2}
                            placeholder={needsDescription ? "What was this money? e.g. vendor refund from …" : "Any note about this inflow"}
                            value={form.description}
                            onChange={(e) => setField("description", e.target.value)}
                            className={cn(errors.description && "border-red-300")}
                        />
                        {errorLine("description")}
                    </div>

                    <div className="relative">
                        <div className="absolute inset-0 flex items-center">
                            <div className="w-full border-t border-slate-200 dark:border-slate-800" />
                        </div>
                        <div className="relative flex justify-center">
                            <span className="bg-white dark:bg-slate-950 px-3 text-xs font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                                Inflow Details
                            </span>
                        </div>
                    </div>

                    {stage === "upload" ? (
                        isAutofilling ? (
                            <div className="flex flex-col items-center gap-3 py-6">
                                <Loader2 className="h-8 w-8 text-emerald-600 animate-spin" />
                                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Reading your receipt…</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                <div className="text-center space-y-1">
                                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Upload Receipt</h3>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                        We'll read it and fill in Amount, UTR and Date for you.
                                    </p>
                                </div>
                                <CustomAttachment
                                    label="Choose Receipt (PDF or image)"
                                    selectedFile={receiptFile}
                                    onFileSelect={handleFileSelect}
                                    maxFileSize={MAX_RECEIPT_BYTES}
                                />
                                <div className="text-center">
                                    <Button variant="link" size="sm" className="text-xs" onClick={() => setStage("form")}>
                                        No receipt — enter the details by hand
                                    </Button>
                                </div>
                            </div>
                        )
                    ) : (
                        <div className="space-y-4">
                            {autofilled.size > 0 && (
                                <div className="flex items-center gap-2 rounded-md bg-amber-50 border border-amber-300 px-3 py-2">
                                    <Sparkles className="h-3.5 w-3.5 text-amber-700 flex-shrink-0" />
                                    <span className="text-xs text-amber-900 leading-snug">
                                        Auto-filled from receipt — please check and correct anything wrong.
                                    </span>
                                </div>
                            )}

                            <div className="space-y-1.5">
                                <Label htmlFor="npi-amount" className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2">
                                    <IndianRupee className="w-3.5 h-3.5 text-slate-400" />
                                    Amount <span className="text-red-500">*</span>
                                </Label>
                                <Input
                                    id="npi-amount"
                                    type="number"
                                    min={0}
                                    placeholder="0.00"
                                    value={form.amount}
                                    onChange={(e) => setField("amount", e.target.value)}
                                    className={cn("h-10", tint("amount"), errors.amount && "border-red-300")}
                                />
                                {errorLine("amount")}
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1.5">
                                    <Label htmlFor="npi-utr" className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2">
                                        <Hash className="w-3.5 h-3.5 text-slate-400" />
                                        UTR/Ref <span className="text-red-500">*</span>
                                    </Label>
                                    <Input
                                        id="npi-utr"
                                        placeholder="Reference No."
                                        value={form.utr}
                                        onChange={(e) => setField("utr", e.target.value)}
                                        className={cn("h-10", tint("utr"), errors.utr && "border-red-300")}
                                    />
                                    {errorLine("utr")}
                                </div>
                                <div className="space-y-1.5">
                                    <Label htmlFor="npi-date" className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2">
                                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                                        Date <span className="text-red-500">*</span>
                                    </Label>
                                    <Input
                                        id="npi-date"
                                        type="date"
                                        max={today()}
                                        value={form.payment_date}
                                        onChange={(e) => setField("payment_date", e.target.value)}
                                        className={cn("h-10", tint("payment_date"), errors.payment_date && "border-red-300")}
                                    />
                                    {errorLine("payment_date")}
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <Label className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2">
                                    <FileText className="w-3.5 h-3.5 text-slate-400" />
                                    Proof <span className="text-xs font-normal text-slate-400">(Optional)</span>
                                </Label>
                                {isEdit && attachmentUrl && !receiptFile && (
                                    <div className="flex items-center justify-between rounded-md border border-slate-200 dark:border-slate-700 px-3 py-2">
                                        <a
                                            href={SITEURL + attachmentUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="text-xs font-medium text-blue-600 hover:underline flex items-center gap-1"
                                        >
                                            <ExternalLink className="h-3 w-3" /> View current proof
                                        </a>
                                        <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={() => setAttachmentUrl(null)}>
                                            <Trash2 className="h-3 w-3 mr-1" /> Remove
                                        </Button>
                                    </div>
                                )}
                                <CustomAttachment
                                    label={isEdit && attachmentUrl ? "Replace proof" : "Upload proof"}
                                    selectedFile={receiptFile}
                                    onFileSelect={handleFileSelect}
                                    maxFileSize={MAX_RECEIPT_BYTES}
                                />
                            </div>
                        </div>
                    )}
                </div>

                <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-3">
                    <AlertDialogCancel disabled={busy} className="h-10 px-4 text-sm">
                        Cancel
                    </AlertDialogCancel>
                    <Button
                        onClick={handleSubmit}
                        disabled={busy || stage === "upload"}
                        className="h-10 px-5 text-sm bg-emerald-600 hover:bg-emerald-700 text-white"
                    >
                        {busy && !isAutofilling ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                        {isEdit ? "Save Changes" : "Record Inflow"}
                    </Button>
                </div>
            </AlertDialogContent>
        </AlertDialog>
    );
};

export default NonProjectInflowDialog;
