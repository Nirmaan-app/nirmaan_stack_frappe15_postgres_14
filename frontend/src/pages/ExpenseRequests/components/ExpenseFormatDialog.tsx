// src/pages/ExpenseRequests/components/ExpenseFormatDialog.tsx
//
// Per-Expense-Type editor for the `source_format` JSON. Modelled on the commissioning
// SourceFormatDialog but validating through THIS module's own `validateFormat` -- expenses
// and commissioning do not share a grammar, and the shared parser refused every format
// using `bind: "user.full_name"`. See the validation note in utils/expenseFormat.ts.
//
// The load-bearing behaviour copied from Commission: **an invalid template can never be
// saved**. A broken format would otherwise reach a requester as a blank or crashing form.

import React, { useEffect, useMemo, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
import { AlertTriangle, CheckCircle2, Code2, Loader2 } from "lucide-react";

import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import type { ExpenseType } from "@/types/NirmaanStack/ExpenseType";
import type { FormatValidationError } from "@/utils/expenseFormat";
import { prettyPrintJson, validateFormat } from "@/utils/expenseFormat";

type ValidationState = {
    status: "unchecked" | "empty" | "valid" | "invalid";
    errors: FormatValidationError[];
    warnings: string[];
};

const CLEAN: ValidationState = { status: "unchecked", errors: [], warnings: [] };

interface Props {
    expenseType: ExpenseType | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSaved: () => void;
}

export const ExpenseFormatDialog: React.FC<Props> = ({
    expenseType, open, onOpenChange, onSaved,
}) => {
    const [text, setText] = useState("");
    const [validation, setValidation] = useState<ValidationState>(CLEAN);
    // Posts to an ADMIN-GATED endpoint rather than writing the doc directly: `Expense Type`
    // carries write for ~15 roles, Project Manager included, so a raw client write would let
    // a requester edit the format governing their own requests.
    const { call: saveFormat, loading } = useFrappePostCall(
        "nirmaan_stack.api.expense_requests.masters.save_expense_format"
    );

    useEffect(() => {
        if (open && expenseType) {
            setText(expenseType.source_format || "");
            setValidation(CLEAN);
        }
    }, [open, expenseType]);

    const dirty = useMemo(
        () => (text || "") !== (expenseType?.source_format || ""),
        [text, expenseType]
    );

    const runValidate = (raw: string): ValidationState => {
        const trimmed = raw.trim();
        // EMPTY IS VALID here, unlike Commission: a type with no format is still fully
        // requestable on the native fields alone. Clearing a format must be allowed.
        if (!trimmed) return { status: "empty", errors: [], warnings: [] };
        const result = validateFormat(trimmed);
        return result.ok
            ? { status: "valid", errors: [], warnings: result.warnings }
            : { status: "invalid", errors: result.errors, warnings: [] };
    };

    const handleFormat = () => {
        const pretty = prettyPrintJson(text);
        if (pretty === null) {
            setValidation(runValidate(text));
            return;
        }
        setText(pretty);
        setValidation(runValidate(pretty));
    };

    const handleSave = async () => {
        if (!expenseType) return;
        const v = runValidate(text);
        setValidation(v);
        if (v.status === "invalid") {
            toast({
                title: "Fix the errors first",
                description: `${v.errors.length} validation error(s) — a broken format would reach requesters as a blank form.`,
                variant: "destructive",
            });
            return;
        }
        try {
            await saveFormat({ name: expenseType.name, source_format: text.trim() || null });
            toast({
                title: "Format saved",
                description: v.status === "empty"
                    ? `${expenseType.name} now uses the plain request form.`
                    : `${expenseType.name} will render its custom form.`,
                variant: "success",
            });
            onSaved();
            onOpenChange(false);
        } catch (e) {
            toast({
                title: "Could not save",
                description: (e as Error).message,
                variant: "destructive",
            });
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Source Format — {expenseType?.name}</DialogTitle>
                    <DialogDescription>
                        The JSON form shown when someone raises a request of this type. Leave it
                        empty and the plain form is used instead — that is normal, not a gap.
                    </DialogDescription>
                </DialogHeader>

                <Textarea
                    value={text}
                    onChange={(e) => { setText(e.target.value); setValidation(CLEAN); }}
                    placeholder='{ "templateId": "…", "templateVersion": 1, "title": "…", "sections": [ … ] }'
                    className="font-mono text-xs min-h-[320px]"
                    spellCheck={false}
                />

                {validation.status === "valid" && (
                    <p className="flex items-center gap-1.5 text-sm text-emerald-700">
                        <CheckCircle2 className="h-4 w-4" /> Valid format.
                        {validation.warnings.length > 0 && ` ${validation.warnings.length} warning(s).`}
                    </p>
                )}
                {validation.status === "empty" && (
                    <p className="text-sm text-muted-foreground">
                        Empty — this type will use the plain request form.
                    </p>
                )}
                {validation.status === "invalid" && (
                    <div className="rounded border border-destructive/40 bg-destructive/5 p-3">
                        <p className="flex items-center gap-1.5 text-sm font-medium text-destructive">
                            <AlertTriangle className="h-4 w-4" />
                            {validation.errors.length} error(s)
                        </p>
                        <ul className="mt-1.5 space-y-0.5 pl-5 text-xs text-destructive list-disc">
                            {validation.errors.map((e, i) => (
                                <li key={i}>{e.path ? `${e.path}: ` : ""}{e.message}</li>
                            ))}
                        </ul>
                    </div>
                )}

                <DialogFooter className="gap-2 sm:justify-between">
                    <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => setValidation(runValidate(text))}>
                            Validate
                        </Button>
                        <Button variant="outline" size="sm" onClick={handleFormat}>
                            <Code2 className="mr-1 h-3.5 w-3.5" /> Format JSON
                        </Button>
                    </div>
                    <div className="flex gap-2">
                        <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
                        <Button onClick={handleSave} disabled={!dirty || loading}>
                            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default ExpenseFormatDialog;
