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

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useFrappeFileUpload, useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
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

import { useDialogStore } from "@/zustand/useDialogStore";
import { useUserData } from "@/hooks/useUserData";
import { parseNumber } from "@/utils/parseNumber";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import type {
    GetRequestCatalogResponse, RequestCatalogType,
} from "@/types/NirmaanStack/ExpenseRequest";
import { parseFormat, seedAnswers } from "@/utils/expenseFormat";
import FormatFieldsRenderer, {
    FormatAnswers, FormatFiles, requiredKeys, toResponses,
} from "./FormatFieldsRenderer";

interface Props { onSuccess?: () => void }

interface FormState {
    expense_type: string;
    projects: string;
    amount: string;
    description: string;
    comment: string;
}

const EMPTY: FormState = {
    expense_type: "", projects: "", amount: "", description: "", comment: "",
};

export const NewExpenseRequestDialog: React.FC<Props> = ({ onSuccess }) => {
    const { newExpenseRequestDialog, setNewExpenseRequestDialog } = useDialogStore();
    const { toast } = useToast();
    const { full_name, user_id } = useUserData();

    const [form, setForm] = useState<FormState>(EMPTY);
    const [answers, setAnswers] = useState<FormatAnswers>({});
    // Files are held, not uploaded, until submit -- a cancelled dialog then cannot orphan one.
    const [files, setFiles] = useState<FormatFiles>({});
    const [submitting, setSubmitting] = useState(false);

    const { data: catalogRes, isLoading: catalogLoading } =
        useFrappeGetCall<{ message: GetRequestCatalogResponse }>(
            "nirmaan_stack.api.expense_requests.read.get_request_catalog",
            undefined,
            "expense_request_catalog"
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

    const categories = catalogRes?.message?.categories ?? [];

    const typesById = useMemo(() => {
        const m = new Map<string, RequestCatalogType>();
        categories.forEach((c) => c.types.forEach((t) => m.set(t.expense_type, t)));
        return m;
    }, [categories]);

    // Seed bound + default answers once a format is chosen. Keyed on the format's identity,
    // and it runs only after `handleTypeChange` has already cleared `answers` -- so it fills a
    // blank form and never overwrites something the requester typed.
    useEffect(() => {
        if (!parsedFormat) return;
        setAnswers(seedAnswers(parsedFormat, { userFullName: full_name, userEmail: user_id }));
    }, [parsedFormat, full_name, user_id]);

    const selected = form.expense_type ? typesById.get(form.expense_type) : undefined;
    const showProject = !!selected?.project_allowed;
    const projectRequired = !!selected?.project_required;

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
        // refused by the server, which reads as the form ignoring what was typed.
        setForm((f) => ({ ...f, expense_type: value, projects: "" }));
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
        setAnswers({});
        setFiles({});
        setNewExpenseRequestDialog(false);
    }, [setNewExpenseRequestDialog]);

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

            const res = await createRequest({
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
            toast({
                title: "Could not raise the request",
                description: e?.message || "Something went wrong.",
                variant: "destructive",
            });
        } finally {
            setSubmitting(false);
        }
    }, [canSubmit, createRequest, upload, files, form, amountValue, showProject,
        showDescription, parsedFormat, answers, toast, close, onSuccess]);

    return (
        <AlertDialog open={newExpenseRequestDialog} onOpenChange={setNewExpenseRequestDialog}>
            <AlertDialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
                <AlertDialogHeader>
                    <AlertDialogTitle>Raise Expense Request</AlertDialogTitle>
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
                            <ProjectSelect
                                universal={false}
                                usePortal
                                onChange={(o) => set("projects", o?.value ?? "")}
                            />
                            {!projectRequired && (
                                <p className="text-xs text-muted-foreground">
                                    Optional. Pick a project to charge it there; leave blank for a
                                    company-wide expense.
                                </p>
                            )}
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

                <Separator />
                <AlertDialogFooter className="gap-2">
                    <AlertDialogCancel onClick={close} disabled={submitting}>Cancel</AlertDialogCancel>
                    <Button onClick={handleSubmit} disabled={!canSubmit}>
                        {submitting ? <TailSpin color="white" height={20} width={20} /> : "Send for Approval"}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};

export default NewExpenseRequestDialog;
