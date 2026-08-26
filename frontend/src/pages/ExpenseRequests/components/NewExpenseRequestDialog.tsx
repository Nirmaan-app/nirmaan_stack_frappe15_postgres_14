// src/pages/ExpenseRequests/components/NewExpenseRequestDialog.tsx
//
// Raise an expense request. This creates an `Expense Request`, NOT an expense — the ledger
// row only exists once a reviewer approves.
//
// The type list comes from the backend (`get_request_catalog`) rather than a TS mirror, so
// the picker can never offer a type the create endpoint would then refuse. The catalog also
// carries each type's project flags, which drive the CONDITIONAL Project field:
//   project only     -> shown and required
//   non-project only -> hidden entirely
//   both             -> shown and optional; the choice picks the ledger

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFrappeFileUpload, useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { AlertTriangle } from "lucide-react";
import { TailSpin } from "react-loader-spinner";

import {
    AlertDialog, AlertDialogCancel, AlertDialogContent,
    AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
    Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import ProjectSelect from "@/components/custom-select/project-select";
import VendorSelect, { OTHERS_VENDOR_VALUE } from "@/components/custom-select/vendor-select";

import { useDialogStore } from "@/zustand/useDialogStore";
import { useUserData } from "@/hooks/useUserData";
import { parseNumber } from "@/utils/parseNumber";
import { getFrappeError } from "@/utils/frappeErrors";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { formatDate } from "@/utils/FormatDate";
import type {
    ExpenseRequest, GetRequestCatalogResponse, RequestCatalogType,
} from "@/types/NirmaanStack/ExpenseRequest";
import {
    answersFromSourceData, parseFormat, readDetailDescription, seedAnswers,
} from "@/utils/expenseFormat";
import FormatFieldsRenderer, {
    FormatAnswers, FormatFiles, requiredKeys, toResponses,
} from "./FormatFieldsRenderer";

interface Props {
    onSuccess?: () => void;
    /** The request being EDITED, or null to raise a new one.
     *
     *  ONE dialog for both, deliberately (ADR-0010 F3): a copy would be a near-twin of ~390
     *  lines, and every rule the create path applies -- the type/project gate, the vendor
     *  gate, the duplicate warning, the format renderer -- would have to be kept in step by
     *  hand across the two. */
    editing?: ExpenseRequest | null;
    onEditingChange?: (r: ExpenseRequest | null) => void;
}

interface FormState {
    expense_type: string;
    projects: string;
    // Holds the SENTINEL for "Others (No Vendor)", never "" -- see `vendor-select`. The
    // payload maps it back to nothing, so the sentinel never leaves this file.
    vendor: string;
    amount: string;
    description: string;
    comment: string;
}

const EMPTY: FormState = {
    expense_type: "", projects: "", vendor: "", amount: "", description: "", comment: "",
};

export const NewExpenseRequestDialog: React.FC<Props> = ({
    onSuccess, editing = null, onEditingChange,
}) => {
    const { newExpenseRequestDialog, setNewExpenseRequestDialog } = useDialogStore();
    const { toast } = useToast();
    const { full_name, user_id } = useUserData();

    const [form, setForm] = useState<FormState>(EMPTY);
    const [answers, setAnswers] = useState<FormatAnswers>({});
    // Files are held, not uploaded, until submit -- a cancelled dialog then cannot orphan one.
    const [files, setFiles] = useState<FormatFiles>({});
    const [submitting, setSubmitting] = useState(false);
    // Edit-only: the requester has asked to swap the project, so hand them the picker.
    const [changingProject, setChangingProject] = useState(false);

    const { data: catalogRes, isLoading: catalogLoading } =
        useFrappeGetCall<{ message: GetRequestCatalogResponse }>(
            "nirmaan_stack.api.expense_requests.read.get_request_catalog",
            undefined,
            "expense_request_catalog"
        );

    const isEdit = !!editing;
    const { call: updateRequest } = useFrappePostCall(
        "nirmaan_stack.api.expense_requests.update.update_expense_request"
    );
    const { call: createRequest } = useFrappePostCall(
        "nirmaan_stack.api.expense_requests.create.create_expense_request"
    );
    const { upload } = useFrappeFileUpload();

    // Fetched only once a type with a format is picked -- most types have none, so this
    // stays off the critical path for the common case.
    const { data: formatRes } = useFrappeGetCall<{ message: { source_format: string | null } }>(
        "nirmaan_stack.api.expense_requests.read.get_expense_format",
        { expense_type: form.expense_type },
        form.expense_type ? `expense_format_${form.expense_type}` : null
    );
    const parsedFormat = useMemo(
        () => parseFormat(formatRes?.message?.source_format),
        [formatRes]
    );

    // ⚠️ WARN, NEVER BLOCK (owner, 2026-08-20). Debounced while the form is filled, because
    // the answers that identify a duplicate -- the person and the period -- are typed late.
    // A type with no rule, or a half-filled form, returns nothing, so this never nags.
    const [duplicates, setDuplicates] = useState<{ subject: string; overlapping: any[] } | null>(null);
    const { call: checkDuplicates } = useFrappePostCall(
        "nirmaan_stack.api.expense_requests.similar.check_new_request"
    );
    const answersKey = JSON.stringify(toResponses(answers));
    useEffect(() => {
        if (!form.expense_type || !parsedFormat) { setDuplicates(null); return; }
        let live = true;
        const t = setTimeout(async () => {
            try {
                const res = await checkDuplicates({
                    expense_type: form.expense_type,
                    source_data: JSON.stringify({ responses: JSON.parse(answersKey) }),
                });
                if (live) setDuplicates(res?.message ?? null);
            } catch { if (live) setDuplicates(null); }
        }, 500);
        return () => { live = false; clearTimeout(t); };
    }, [form.expense_type, answersKey, parsedFormat, checkDuplicates]);

    const categories = catalogRes?.message?.categories ?? [];

    const typesById = useMemo(() => {
        const m = new Map<string, RequestCatalogType>();
        categories.forEach((c) => c.types.forEach((t) => m.set(t.expense_type, t)));
        return m;
    }, [categories]);

    // Seed bound + default answers once a format is chosen. Keyed on the format's identity,
    // and it runs only after `handleTypeChange` has already cleared `answers` -- so it fills a
    // blank form and never overwrites something the requester typed.
    // ⚠️ SKIPPED ONCE WHEN OPENING AN EDIT. The format is fetched from the type, so this
    // effect resolves AFTER the edit seed below and would overwrite the requester's stored
    // answers with blank defaults -- silently, and only for formatted types. It is skipped
    // exactly once per opened request; a later type CHANGE clears the flag, so switching type
    // mid-edit still seeds the new format's defaults as it does on a fresh request.
    const skipNextSeed = useRef(false);
    useEffect(() => {
        if (!parsedFormat) return;
        if (skipNextSeed.current) { skipNextSeed.current = false; return; }
        setAnswers(seedAnswers(parsedFormat, { userFullName: full_name, userEmail: user_id }));
    }, [parsedFormat, full_name, user_id]);

    // The project to SHOW instead of the picker: only on an edit, only while the requester has
    // not asked to change it, and only while `form.projects` still holds what the request came
    // with -- a type change clears it, which must hand back the picker rather than keep showing
    // a project the new type may not even allow. Falls back to the id when the readable name is
    // absent, because showing the id beats showing nothing on a required field.
    const chosenProjectLabel = isEdit && !changingProject && form.projects
        ? (editing?.projects_name || form.projects)
        : "";

    const selected = form.expense_type ? typesById.get(form.expense_type) : undefined;
    const showProject = !!selected?.project_allowed;
    const projectRequired = !!selected?.project_required;

    // Vendor is a PROJECT-ONLY field, and the gate is the project being CHOSEN, not merely
    // offered: `Non Project Expenses` has no vendor column at all, so a vendor recorded on a
    // non-project request would be silently dropped at approval. Asking for it only once a
    // project is on screen is what keeps the request and the ledger row able to agree.
    const showVendor = showProject && !!form.projects;

    // Description is the FALLBACK for a type with no format. Where a format exists its fields
    // ARE the description, so asking for both invites the same fact in two places.
    const showDescription = !parsedFormat;

    const set = useCallback(
        <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v })),
        []
    );

    // Answers belong to the type that was on screen when they were typed. Carrying them to
    // a different type would silently file one type's answers under another's format.
    const handleTypeChange = useCallback((value: string) => {
        setAnswers({});
        setFiles({});
        // Clear the project: a stale value on a type that just became non-project would be
        // refused by the server, which reads as the form ignoring what was typed. The vendor
        // hangs off the project, so it goes with it -- a vendor left behind on a now
        // non-project type is exactly the value the server refuses.
        setForm((f) => ({ ...f, expense_type: value, projects: "", vendor: "" }));
    }, []);

    // Clearing or switching the project clears the vendor with it. Without this a vendor
    // picked under one project would silently ride along to another, or sit invisible on a
    // request with no project at all.
    const handleProjectChange = useCallback((projectId: string) => {
        setForm((f) => (f.projects === projectId ? f : { ...f, projects: projectId, vendor: "" }));
    }, []);

    const amountValue = parseNumber(form.amount);
    const missingFormatAnswers = useMemo(
        () => requiredKeys(parsedFormat).filter((k) => !(answers[k] || "").trim()),
        [parsedFormat, answers]
    );
    const canSubmit =
        !!form.expense_type &&
        amountValue > 0 &&
        (!projectRequired || !!form.projects) &&
        missingFormatAnswers.length === 0 &&
        !submitting;

    const close = useCallback(() => {
        setForm(EMPTY);
        setChangingProject(false);
        setAnswers({});
        setFiles({});
        setNewExpenseRequestDialog(false);
        onEditingChange?.(null);
    }, [setNewExpenseRequestDialog, onEditingChange]);

    // Seed from the request being edited. Keyed on its NAME, not the object: the row is
    // re-fetched on every refresh, so an object-identity dep would re-seed the form under the
    // requester mid-edit and discard what they had typed.
    useEffect(() => {
        if (!editing) return;
        setForm({
            expense_type: editing.type ?? "",
            projects: editing.projects ?? "",
            vendor: editing.vendor ?? "",
            amount: String(editing.amount ?? ""),
            // A format-less request keeps its typed text under the synthetic `detail`
            // key -- the doctype has no `description` column to read it back from.
            description: readDetailDescription(editing.source_data),
            comment: editing.comment ?? "",
        });
        setChangingProject(false);
        skipNextSeed.current = true;
        setAnswers(answersFromSourceData(editing.source_data));
        setFiles({});
    }, [editing?.name]);   // eslint-disable-line react-hooks/exhaustive-deps

    const handleSubmit = useCallback(async () => {
        if (!canSubmit) return;
        setSubmitting(true);
        try {
            // Upload now, so nothing is orphaned by a cancelled dialog. The file is stored as
            // a URL inside `source_data.attachments`, keyed by SLOT -- which is what lets the
            // backend find the slot declaring `maps_to: invoice_attachment` and carry that one
            // file onto the ledger row at approval.
            const attachments: Record<string, string[]> = {};
            for (const [slotKey, file] of Object.entries(files)) {
                if (!file) continue;
                const uploaded = await upload(file, {
                    doctype: "Expense Request", fieldname: "source_data", isPrivate: true,
                });
                attachments[slotKey] = [uploaded.file_url];
            }

            const submit = isEdit ? updateRequest : createRequest;
            const res = await submit({
                ...(isEdit ? { name: editing!.name } : {}),
                expense_type: form.expense_type,
                amount: amountValue,
                // ⚠️ NEVER send a hidden value. Someone can type a description and THEN pick
                // a type that has a format -- the field disappears but the text is still in
                // state, and submitting it would file an answer the requester can no longer
                // see. The state is kept (so switching back restores their typing); only the
                // PAYLOAD is gated.
                comment: form.comment || undefined,
                // Only ever send a project the type actually allows.
                projects: showProject && form.projects ? form.projects : undefined,
                // Same gate as the project, plus the sentinel: "Others (No Vendor)" is a
                // deliberate "no vendor on record", so it sends NOTHING rather than an
                // empty Link. The server refuses a vendor without a project, so the
                // `showVendor` half is what keeps a hidden value from ever reaching it.
                vendor:
                    showVendor && form.vendor && form.vendor !== OTHERS_VENDOR_VALUE
                        ? form.vendor
                        : undefined,
                // Wrapped in the `responses` envelope the backend flattener reads. Omitted
                // entirely when the type has no format, so a format-less request stores NULL
                // and converts exactly as it would have before formats existed.
                // `source_data` is the ONLY home for the requester's detail. With a format
                // that is the answers; without one it is the typed description, under the
                // synthetic `detail.description` key. The doctype carries no `description`
                // field at all, so there is exactly one place every later reader looks and
                // nothing that can hold a second, disagreeing copy.
                source_data: parsedFormat
                    ? {
                        templateId: parsedFormat.templateId,
                        templateVersion: parsedFormat.templateVersion,
                        responses: toResponses(answers),
                        ...(Object.keys(attachments).length ? { attachments } : {}),
                    }
                    : form.description.trim()
                        ? { responses: { detail: { description: form.description.trim() } } }
                        : undefined,
            });
            const created = (res as any)?.message;
            toast({
                title: "Sent for approval",
                description: `${created?.name} is now pending review.`,
                variant: "success",
            });
            close();
            onSuccess?.();
        } catch (e: any) {
            // ⚠️ Frappe puts the useful text in `_server_messages` / `exception`, NEVER in
            // `message` -- so `e?.message` rendered the duplicate refusal as the entirely
            // uninformative "There was an error." `getFrappeError` is the shared reader.
            toast({
                title: isEdit ? "Could not save the changes" : "Could not raise the request",
                description: getFrappeError(e),
                variant: "destructive",
            });
        } finally {
            setSubmitting(false);
        }
    }, [canSubmit, createRequest, updateRequest, isEdit, editing, upload, files, form,
        amountValue, showProject, showVendor,
        showDescription, parsedFormat, answers, toast, close, onSuccess]);

    return (
        <AlertDialog
            open={newExpenseRequestDialog || isEdit}
            onOpenChange={(o) => { if (!o) close(); else setNewExpenseRequestDialog(true); }}
        >
            <AlertDialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
                <AlertDialogHeader>
                    <AlertDialogTitle>{isEdit ? `Edit ${editing!.name}` : "Raise Expense Request"}</AlertDialogTitle>
                </AlertDialogHeader>
                <Separator />

                <div className="space-y-4 py-2">
                    <div className="space-y-1.5">
                        <Label>Expense Type <span className="text-destructive">*</span></Label>
                        <Select value={form.expense_type} onValueChange={handleTypeChange}>
                            <SelectTrigger>
                                <SelectValue placeholder={catalogLoading ? "Loading…" : "Select a type"} />
                            </SelectTrigger>
                            <SelectContent>
                                {categories.filter((c) => c.types.length > 0).map((c) => (
                                    <SelectGroup key={c.category}>
                                        <SelectLabel>{c.category}</SelectLabel>
                                        {c.types.map((t) => (
                                            <SelectItem key={t.expense_type} value={t.expense_type}>
                                                {t.expense_type}
                                            </SelectItem>
                                        ))}
                                    </SelectGroup>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {showProject && (
                        <div className="space-y-1.5">
                            <Label>
                                Project {projectRequired && <span className="text-destructive">*</span>}
                            </Label>
                            {chosenProjectLabel ? (
                                // ⚠️ `ProjectSelect` keeps its selection in INTERNAL state and
                                // takes no `value`, so it CANNOT display a project the user did
                                // not pick in this session -- on an edit it renders its
                                // placeholder over a required field that IS set, which reads as
                                // unset. It is shared across many screens, so the fix stays
                                // HERE: show what the request already carries, and mount the
                                // untouched picker only once the requester asks to change it.
                                <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                                    <span className="truncate text-sm">{chosenProjectLabel}</span>
                                    <Button
                                        type="button" variant="ghost" size="sm"
                                        className="h-7 shrink-0 text-xs"
                                        onClick={() => setChangingProject(true)}
                                    >
                                        Change
                                    </Button>
                                </div>
                            ) : (
                                <ProjectSelect
                                    universal={false}
                                    usePortal
                                    onChange={(o) => handleProjectChange(o?.value ?? "")}
                                />
                            )}
                            {!projectRequired && (
                                <p className="text-xs text-muted-foreground">
                                    Optional. Pick a project to charge it there; leave blank for a
                                    company-wide expense.
                                </p>
                            )}
                        </div>
                    )}

                    {showVendor && (
                        <div className="space-y-1.5">
                            <Label>Vendor</Label>
                            <VendorSelect
                                usePortal
                                value={form.vendor}
                                onChange={(o) => set("vendor", o?.value ?? "")}
                            />
                            <p className="text-xs text-muted-foreground">
                                Optional. Choose "Others (No Vendor)" if the payee is not on record.
                            </p>
                        </div>
                    )}

                    <div className="space-y-1.5">
                        <Label>Amount <span className="text-destructive">*</span></Label>
                        <Input
                            type="number" placeholder="0" value={form.amount}
                            onChange={(e) => set("amount", e.target.value)}
                        />
                        {amountValue > 0 && (
                            <p className="text-xs text-muted-foreground">
                                {formatToRoundedIndianRupee(amountValue)}
                            </p>
                        )}
                    </div>

                    {showDescription && (
                        <div className="space-y-1.5">
                            <Label>Description</Label>
                            <Textarea
                                placeholder="What is this for?"
                                value={form.description}
                                onChange={(e) => set("description", e.target.value)}
                            />
                        </div>
                    )}

                    {parsedFormat && (
                        <FormatFieldsRenderer
                            format={parsedFormat}
                            answers={answers}
                            onChange={(k, v) => setAnswers((a) => ({ ...a, [k]: v }))}
                            files={files}
                            onFileChange={(slotKey, file) =>
                                setFiles((f) => {
                                    if (!file) { const { [slotKey]: _drop, ...rest } = f; return rest; }
                                    return { ...f, [slotKey]: file };
                                })
                            }
                            onFileError={(message) =>
                                toast({ title: "Attachment", description: message, variant: "destructive" })
                            }
                            disabled={submitting}
                        />
                    )}

                    <div className="space-y-1.5">
                        <Label>Comment</Label>
                        <Input
                            placeholder="Anything the reviewer should know"
                            value={form.comment}
                            onChange={(e) => set("comment", e.target.value)}
                        />
                    </div>
                </div>

                {(duplicates?.overlapping?.length ?? 0) > 0 && (
                    <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-900 dark:bg-amber-950/30">
                        <p className="flex items-center gap-1.5 font-medium text-amber-800 dark:text-amber-300">
                            <AlertTriangle className="h-4 w-4 shrink-0" />
                            {duplicates!.subject} already has a {form.expense_type} for this period
                        </p>
                        <ul className="mt-1 space-y-0.5 pl-5.5 text-amber-900/90 dark:text-amber-200/90">
                            {duplicates!.overlapping.map((d) => (
                                <li key={d.name}>
                                    {formatDate(d.period_from)}
                                    {d.period_to !== d.period_from && ` – ${formatDate(d.period_to)}`}
                                    {" · "}{formatToRoundedIndianRupee(d.amount)}
                                    {" · "}{d.name}{" · "}{d.status}
                                    {d.context && <span className="text-xs"> ({d.context})</span>}
                                </li>
                            ))}
                        </ul>
                        {/* Informational ONLY -- `canSubmit` is untouched, so this never blocks. */}
                        <p className="mt-1 text-xs text-amber-800/80 dark:text-amber-300/80">
                            You can still send this for approval.
                        </p>
                    </div>
                )}

                <Separator />
                <AlertDialogFooter className="gap-2">
                    <AlertDialogCancel onClick={close} disabled={submitting}>Cancel</AlertDialogCancel>
                    <Button onClick={handleSubmit} disabled={!canSubmit}>
                        {submitting
                            ? <TailSpin color="white" height={20} width={20} />
                            : isEdit ? "Save changes" : "Send for Approval"}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};

export default NewExpenseRequestDialog;
