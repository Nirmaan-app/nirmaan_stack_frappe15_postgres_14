// src/pages/outflow-import/components/SettleExpensePanel.tsx

import { useMemo, useState } from "react";
import { useFrappeGetCall, useFrappeGetDocList } from "frappe-react-sdk";
import { AlertTriangle, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FuzzySearchSelect, TokenSearchConfig } from "@/components/ui/fuzzy-search-select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    OutflowImportRow,
    OutflowRowCandidates,
} from "@/types/NirmaanStack/OutflowImportBatch";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

const PROJECT_EXPENSE = "Project Expenses";
const NON_PROJECT_EXPENSE = "Non Project Expenses";

// Same shape the project pickers elsewhere use (components/custom-select/project-select.tsx):
// people search projects by multi-word name, so token scoring beats substring matching.
const PROJECT_SEARCH_CONFIG: TokenSearchConfig = {
    searchFields: ["label", "value"],
    minSearchLength: 1,
    partialMatch: true,
    minTokenLength: 1,
    fieldWeights: { label: 2.0, value: 1.5 },
    minTokenMatches: 1,
};

interface Props {
    row: OutflowImportRow;
    candidates?: OutflowRowCandidates;
    onSettle: (target: { doctype: string; name: string }) => Promise<void>;
    onCreate: (payload: {
        doctype: string;
        expense_type: string;
        project?: string;
        description?: string;
        vendor?: string;
    }) => Promise<void>;
}

/**
 * The only place in Bulk Import Outflow where a reviewer changes something outside the import.
 *
 * Two routes, and which one is right is a real decision rather than a fallback: settle an expense
 * somebody already raised and approved, or record one that was never raised because the spend had
 * no PO behind it -- site rent, accommodation, utilities. Both write; nothing here can reach a
 * payment.
 */
export const SettleExpensePanel = ({ row, candidates, onSettle, onCreate }: Props) => {
    const [mode, setMode] = useState<"idle" | "create">("idle");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [kind, setKind] = useState(PROJECT_EXPENSE);
    const [expenseType, setExpenseType] = useState("");
    const [project, setProject] = useState<string | null>(null);
    const [description, setDescription] = useState(
        [row.beneficiary_name, row.remarks].filter(Boolean).join(" - ")
    );

    const { data: typeData } = useFrappeGetCall<{ message: { name: string }[] }>(
        "nirmaan_stack.api.outflow_import.expenses.get_expense_types",
        { doctype: kind },
        `outflow-expense-types-${kind}`
    );
    const { data: projects } = useFrappeGetDocList("Projects", {
        fields: ["name", "project_name"],
        limit: 0,
    });

    const projectOptions = useMemo(
        () =>
            (projects || []).map((p: any) => ({
                label: `${p.project_name?.trim() || p.name}`,
                value: p.name,
            })),
        [projects]
    );

    const run = async (fn: () => Promise<void>) => {
        setBusy(true);
        setError(null);
        try {
            await fn();
        } catch (e: any) {
            // The service throws NAMED errors (already paid / wrong status / amounts differ) so the
            // reviewer is told which one it was, not just that something failed.
            setError(e?.message || "That did not work.");
        } finally {
            setBusy(false);
        }
    };

    const canCreate =
        !!expenseType && (kind === NON_PROJECT_EXPENSE || !!project) && !busy;

    return (
        <div className="space-y-3 rounded-md border bg-background p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Record this transfer
            </p>

            {candidates?.expense_candidates?.length ? (
                <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                        Approved expenses at exactly {formatToRoundedIndianRupee(row.amount)}:
                    </p>
                    <ul className="space-y-1">
                        {candidates.expense_candidates.map((c) => (
                            <li
                                key={c.name}
                                className="flex items-start justify-between gap-3 rounded border p-2"
                            >
                                <div className="min-w-0">
                                    <p className="text-sm font-medium">{c.name}</p>
                                    <p className="truncate text-xs text-muted-foreground">
                                        {c.description || "no description"}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                        {c.reasons.join(", ")}
                                    </p>
                                </div>
                                <Button
                                    size="sm"
                                    disabled={busy}
                                    onClick={() =>
                                        run(() => onSettle({ doctype: c.doctype, name: c.name }))
                                    }
                                >
                                    Settle
                                </Button>
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}

            {mode === "idle" ? (
                <Button variant="outline" size="sm" onClick={() => setMode("create")}>
                    Record a new expense
                </Button>
            ) : (
                <div className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1">
                            <Label className="text-xs">Kind</Label>
                            <Select
                                value={kind}
                                onValueChange={(v) => {
                                    setKind(v);
                                    // Types are scoped per kind and the server refuses a mismatch,
                                    // so a stale selection must not survive the switch.
                                    setExpenseType("");
                                }}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={PROJECT_EXPENSE}>Project expense</SelectItem>
                                    <SelectItem value={NON_PROJECT_EXPENSE}>
                                        Non-project expense
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-1">
                            <Label className="text-xs">Expense type</Label>
                            <Select value={expenseType} onValueChange={setExpenseType}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select a type" />
                                </SelectTrigger>
                                <SelectContent>
                                    {(typeData?.message || []).map((t) => (
                                        <SelectItem key={t.name} value={t.name}>
                                            {t.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {kind === PROJECT_EXPENSE && (
                        <div className="space-y-1">
                            <Label className="text-xs">Project</Label>
                            {/* FuzzySearchSelect, not a plain select: there are ~180 projects and
                                people search them by multi-word name (repo convention, >50). */}
                            <FuzzySearchSelect
                                allOptions={projectOptions}
                                value={projectOptions.find((o) => o.value === project) || null}
                                tokenSearchConfig={PROJECT_SEARCH_CONFIG}
                                onChange={(opt: any) => setProject(opt?.value ?? null)}
                                placeholder="Search projects..."
                                isClearable
                            />
                        </div>
                    )}

                    <div className="space-y-1">
                        <Label className="text-xs">Description</Label>
                        <Textarea
                            rows={2}
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                        />
                        {kind === NON_PROJECT_EXPENSE && (
                            <p className="text-xs text-muted-foreground">
                                Non-project expenses have no vendor field, so the payee's name
                                belongs here.
                            </p>
                        )}
                    </div>

                    <p className="text-xs text-muted-foreground">
                        Recorded as Paid for {formatToRoundedIndianRupee(row.amount)} on the
                        transfer date, with bank reference {row.bank_reference_no || "--"}.
                    </p>

                    <div className="flex gap-2">
                        <Button
                            size="sm"
                            disabled={!canCreate}
                            onClick={() =>
                                run(async () => {
                                    await onCreate({
                                        doctype: kind,
                                        expense_type: expenseType,
                                        project: kind === PROJECT_EXPENSE ? project! : undefined,
                                        description: description.trim() || undefined,
                                    });
                                    setMode("idle");
                                })
                            }
                        >
                            {busy && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
                            Record expense
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setMode("idle")}>
                            Cancel
                        </Button>
                    </div>
                </div>
            )}

            {error && (
                <div className="flex items-start gap-2 rounded border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>{error}</span>
                </div>
            )}
        </div>
    );
};
