// src/pages/ExpenseRequests/components/FormatFieldsRenderer.tsx
//
// Renders an Expense Type's `source_format` inside the create dialog.
//
// SCOPE: `fields` sections (text / textarea / number / date / select) and
// `image_attachments` slots. Anything else is reported as unrendered rather than silently
// dropped. The full commissioning renderer handles more section types but drags in wizard
// steps and print concerns an expense request has no use for.
//
// ⚠️ An UNRENDERED section is stated on screen, never swallowed — a required answer that
// silently never appears would be invisible to the requester AND to the reviewer. The notice
// must also never instruct the impossible: there is no attachment field on Expense Request,
// so "attach it afterwards" was a lie and the attachment slot is rendered here instead.

import React, { useMemo } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { CustomAttachment, AcceptedFileType } from "@/components/helpers/CustomAttachment";
import type { ParsedFormat } from "@/utils/expenseFormat";

/** Answers keyed `sectionId.fieldKey` — flat, so React state stays trivial. */
export type FormatAnswers = Record<string, string>;

const FIELDS = "fields";
const ATTACHMENTS = "image_attachments";
const RENDERED = new Set([FIELDS, ATTACHMENTS]);

/** Files chosen per attachment slot key. Uploaded at submit, not on pick, so a cancelled
 *  dialog cannot orphan a file. */
export type FormatFiles = Record<string, File>;

const parseAccept = (accept?: string): AcceptedFileType[] =>
    (accept || "image/*,application/pdf").split(",").map((a) => a.trim()) as AcceptedFileType[];

/** Every `sectionId.fieldKey` the format marks required — the dialog's submit gate. */
export const requiredKeys = (fmt: ParsedFormat | null): string[] =>
    (fmt?.sections ?? [])
        .filter((s) => s.type === FIELDS)
        .flatMap((s) => (s.fields ?? []).filter((f) => f.required).map((f) => `${s.id}.${f.key}`));

/** Attachment slots the format declares, flattened across sections. */
export const attachmentSlots = (fmt: ParsedFormat | null) =>
    (fmt?.sections ?? [])
        .filter((s) => s.type === ATTACHMENTS)
        .flatMap((s) => (s.slots ?? []).map((slot) => ({ ...slot, sectionTitle: s.title })));

/** Flat answers -> the nested `responses` envelope the backend flattener reads. */
export const toResponses = (answers: FormatAnswers): Record<string, Record<string, string>> => {
    const out: Record<string, Record<string, string>> = {};
    for (const [k, v] of Object.entries(answers)) {
        if (v === undefined || v === null || `${v}`.trim() === "") continue;
        const dot = k.indexOf(".");
        if (dot < 0) continue;
        const section = k.slice(0, dot);
        const field = k.slice(dot + 1);
        (out[section] ??= {})[field] = v;
    }
    return out;
};

interface Props {
    format: ParsedFormat;
    answers: FormatAnswers;
    onChange: (key: string, value: string) => void;
    files: FormatFiles;
    onFileChange: (slotKey: string, file: File | null) => void;
    onFileError: (message: string) => void;
    disabled?: boolean;
}

export const FormatFieldsRenderer: React.FC<Props> = ({
    format, answers, onChange, files, onFileChange, onFileError, disabled,
}) => {
    const sections = format.sections ?? [];
    const unrendered = useMemo(
        () => sections.filter((s) => !RENDERED.has(s.type)).map((s) => s.title || s.id),
        [sections]
    );

    return (
        <div className="space-y-4">
            {sections.filter((s) => s.type === FIELDS).map((section) => (
                <div key={section.id} className="space-y-3 rounded border bg-muted/30 p-3">
                    {section.title && (
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {section.title}
                        </p>
                    )}
                    {(section.fields ?? []).map((f) => {
                        const key = `${section.id}.${f.key}`;
                        const value = answers[key] ?? "";
                        return (
                            <div key={key} className="space-y-1.5">
                                <Label className="text-sm">
                                    {f.label}
                                    {f.required && <span className="text-destructive"> *</span>}
                                    {f.unit && (
                                        <span className="ml-1 text-xs text-muted-foreground">({f.unit})</span>
                                    )}
                                </Label>

                                {f.type === "textarea" ? (
                                    <Textarea value={value} disabled={disabled}
                                        onChange={(e) => onChange(key, e.target.value)} />
                                ) : f.type === "select" ? (
                                    <Select value={value} onValueChange={(v) => onChange(key, v)}
                                        disabled={disabled}>
                                        <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                                        <SelectContent>
                                            {(f.options ?? []).map((o) => (
                                                <SelectItem key={o} value={o}>{o}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                ) : (
                                    <Input
                                        type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                                        value={value}
                                        min={f.min}
                                        max={f.max}
                                        disabled={disabled}
                                        onChange={(e) => onChange(key, e.target.value)}
                                    />
                                )}
                            </div>
                        );
                    })}
                </div>
            ))}

            {sections.filter((s) => s.type === ATTACHMENTS).map((section) => (
                <div key={section.id} className="space-y-3 rounded border bg-muted/30 p-3">
                    {section.title && (
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {section.title}
                        </p>
                    )}
                    {(section.slots ?? []).map((slot) => (
                        <div key={slot.key} className="space-y-1.5">
                            <CustomAttachment
                                label={slot.label}
                                selectedFile={files[slot.key] ?? null}
                                onFileSelect={(f: File | null) => onFileChange(slot.key, f)}
                                onError={(e) => onFileError(e.message)}
                                maxFileSize={((slot as any).maxSizeMb ?? 5) * 1024 * 1024}
                                acceptedTypes={parseAccept((slot as any).accept)}
                                disabled={disabled}
                            />
                            {(slot as any).maps_to === "invoice_attachment" && (
                                <p className="text-[11px] text-muted-foreground">
                                    Carried onto the expense once approved.
                                </p>
                            )}
                        </div>
                    ))}
                </div>
            ))}

            {unrendered.length > 0 && (
                <p className="text-xs text-muted-foreground">
                    This form also declares {unrendered.join(", ")}, which this screen cannot
                    show yet — mention anything relevant in the Comment.
                </p>
            )}
        </div>
    );
};

export default FormatFieldsRenderer;
