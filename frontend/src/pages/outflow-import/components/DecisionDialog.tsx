// src/pages/outflow-import/components/DecisionDialog.tsx

import { useEffect, useMemo, useState } from "react";
import { useFrappeGetCall, useFrappeGetDocList } from "frappe-react-sdk";
import { AlertTriangle, Check, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import type {
    OutflowImportRow,
    OutflowRowCandidates,
} from "@/types/NirmaanStack/OutflowImportBatch";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import {
    amountVerdict,
    orderBySuggestion,
    solePreselection,
    type DecisionTarget,
    type RowDecision,
} from "../outflowTableModel";

const PAYMENT = "Project Payments";
const PROJECT_EXPENSE = "Project Expenses";
const NON_PROJECT_EXPENSE = "Non Project Expenses";

/** The four choices, always in this order, so the shape is learnable across rows. */
const TARGETS: { id: DecisionTarget; label: string; hint: string }[] = [
    { id: PAYMENT, label: "Link to an approved Project Payment", hint: "money against a PO or SR that is already approved" },
    { id: PROJECT_EXPENSE, label: "Link to an approved Project Expense", hint: "project spend with no PO behind it" },
    { id: NON_PROJECT_EXPENSE, label: "Link to an approved Non Project Expense", hint: "office and company overheads" },
    { id: "new", label: "Create a new expense", hint: "nothing to link to — record it here, already Paid" },
];

interface Props {
    row: OutflowImportRow | null;
    decision: RowDecision | undefined;
    onChange: (decision: RowDecision) => void;
    onConfirm: () => Promise<void> | void;
    onSkip: (reason: string) => Promise<void> | void;
    onRerun: () => Promise<void> | void;
    onClose: () => void;
    busy?: boolean;
}

/**
 * The decision dialog: why the system suggests what it does, and the four ways to resolve the row.
 *
 * ⚠️ THE DIALOG OWNS ITS OWN SCROLLBAR. Header and footer are pinned and only the BODY scrolls.
 * Letting the scrim scroll instead pushes Confirm off-screen -- the one control the dialog exists
 * for -- which is a defect the prototype's live walk found and no unit test could have.
 *
 * ⚠️ MISMATCHED ROWS GET THIS SAME FULL DIALOG. Reporting a disagreement with no way to act on it
 * was the defect the owner named, so there is deliberately no read-only variant.
 *
 * ⚠️ EVERY OPTION OPENS IN PLACE, with everything it needs inside it. Nothing floats outside the
 * option it belongs to, so it is never ambiguous which control belongs to which choice.
 */
export const DecisionDialog = ({
    row,
    decision,
    onChange,
    onConfirm,
    onSkip,
    onRerun,
    onClose,
    busy = false,
}: Props) => {
    const [skipReason, setSkipReason] = useState("");
    const [skipping, setSkipping] = useState(false);

    /**
     * ⚠️ TWO DIFFERENT QUESTIONS, TWO DIFFERENT ENDPOINTS, and conflating them was the bug.
     *
     *   `get_row_candidates`        -> what the MATCHER suggests. Used ONLY to seed the decision,
     *                                  which is what makes a Matched row open with its record
     *                                  already chosen.
     *   `search_settleable_records` -> what you may BROWSE, per ledger, inside `RecordPicker`.
     *
     * The dialog originally built its dropdowns from the first. That is why they were empty
     * whenever the matcher found nothing -- exactly when hand-linking is most needed.
     */
    const { data: suggestion } = useFrappeGetCall<{ message: OutflowRowCandidates }>(
        "nirmaan_stack.api.outflow_import.review.get_row_candidates",
        { row: row?.name },
        row?.name ? undefined : null
    );

    useEffect(() => {
        setSkipReason("");
    }, [row?.name]);

    /**
     * Open a matched row with its record ALREADY SELECTED.
     *
     * ⚠️ WITHOUT THIS, NOTHING IS EVER PRE-SELECTED, because `RecordPicker` only mounts once the
     * reviewer has clicked a target -- so its own pre-selection could never fire on open. A row the
     * matcher resolved confidently should take one click to confirm, not three.
     *
     * ⚠️ ONLY WHEN THERE IS EXACTLY ONE candidate across every ledger (owner ruling: the screen
     * never guesses between two real records). Two suggestions, or a group covering several
     * payments, seeds nothing and the reviewer chooses.
     */
    useEffect(() => {
        if (!row || decision || !suggestion?.message) return;
        const groups = suggestion.message.payment_groups ?? [];
        const expenses = suggestion.message.expense_candidates ?? [];
        const soleGroup =
            groups.length === 1 && groups[0].targets.length === 1 ? groups[0].targets[0] : null;
        if (soleGroup && !expenses.length) {
            onChange({ target: PAYMENT, linkTo: soleGroup.name });
            return;
        }
        if (!groups.length && expenses.length === 1) {
            const only = expenses[0];
            onChange({ target: only.doctype as DecisionTarget, linkTo: only.name });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [row?.name, suggestion]);

    if (!row) return null;

    return (
        <Dialog open={Boolean(row)} onOpenChange={(open) => !open && onClose()}>
            {/* grid-rows-[auto_1fr_auto] + min-h-0 on the body is what pins header and footer and
                gives the BODY the scrollbar. `max-h-[85vh]` bounds the whole thing to the
                viewport; without the bound the scrim scrolls instead. */}
            <DialogContent className="grid max-h-[85vh] w-[min(92vw,860px)] grid-rows-[auto_1fr_auto] gap-0 overflow-hidden p-0 sm:max-w-none">
                <header className="border-b px-6 py-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <h2 className="text-base font-semibold">{row.beneficiary_name}</h2>
                        <span className="text-lg font-semibold tabular-nums">
                            {formatToRoundedIndianRupee(row.amount)}
                        </span>
                    </div>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                        {row.added_on ? formatDate(row.added_on.split(/[ T]/)[0]) : "no date"}
                        {row.bank_reference_no ? ` · ref ${row.bank_reference_no}` : ""}
                        {row.bank_account ? ` · a/c ${row.bank_account}` : ""}
                    </p>
                    {row.remarks && (
                        <p className="mt-1 text-sm text-muted-foreground">“{row.remarks}”</p>
                    )}
                </header>

                <div className="min-h-0 space-y-4 overflow-y-auto px-6 py-4">
                    <WhyThisSuggestion row={row} />

                    {TARGETS.map((target) => (
                        <TargetOption
                            key={target.id}
                            target={target}
                            row={row}
                            decision={decision}
                            onChange={onChange}
                        />
                    ))}
                </div>

                <footer className="flex flex-wrap items-center gap-2 border-t bg-muted/30 px-6 py-3">
                    <Button variant="ghost" size="sm" onClick={() => onRerun()} disabled={busy}>
                        Re-run match
                    </Button>
                    <div className="flex-1" />
                    {skipping ? (
                        <div className="flex w-full items-center gap-2 sm:w-auto">
                            <Input
                                autoFocus
                                value={skipReason}
                                placeholder="Why is this row being skipped?"
                                onChange={(e) => setSkipReason(e.target.value)}
                                className="h-8 w-full sm:w-72"
                            />
                            <Button
                                size="sm"
                                variant="outline"
                                disabled={!skipReason.trim() || busy}
                                onClick={() => onSkip(skipReason.trim())}
                            >
                                Skip
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setSkipping(false)}>
                                Cancel
                            </Button>
                        </div>
                    ) : (
                        <>
                            {/* A skip is a DECISION, which is why it requires a typed reason. */}
                            <Button size="sm" variant="outline" onClick={() => setSkipping(true)}>
                                Skip this row
                            </Button>
                            <Button size="sm" onClick={() => onConfirm()} disabled={busy}>
                                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Confirm → Paid
                            </Button>
                        </>
                    )}
                </footer>
            </DialogContent>
        </Dialog>
    );
};

/**
 * Why the system suggests this, in plain English (owner ruling).
 *
 * Derived from the row's own status and note rather than a second copy of the matching rules --
 * `status.py` already wrote the sentence a reviewer needs, and re-deriving it here would give the
 * screen an opinion the server does not share.
 */
const WhyThisSuggestion = ({ row }: { row: OutflowImportRow }) => {
    const bullets: string[] = [];
    if (row.bank_reference_no) {
        bullets.push(
            `The bank reference ${row.bank_reference_no} is not recorded on any payment yet.`
        );
    }
    if (row.outcome_note) bullets.push(row.outcome_note);
    if (row.row_status === "Unmatched") {
        bullets.push("Only approved records are ever offered here.");
    }
    if (!bullets.length) return null;

    return (
        <div className="rounded-md border bg-muted/30 p-3">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Why the system suggests this
            </p>
            <ul className="list-inside list-disc space-y-1 text-sm">
                {bullets.map((b) => (
                    <li key={b}>{b}</li>
                ))}
            </ul>
        </div>
    );
};

const TargetOption = ({
    target,
    row,
    decision,
    onChange,
}: {
    target: { id: DecisionTarget; label: string; hint: string };
    row: OutflowImportRow;
    decision: RowDecision | undefined;
    onChange: (decision: RowDecision) => void;
}) => {
    const chosen = decision?.target === target.id;

    return (
        <div
            className={`rounded-md border transition-colors ${
                chosen ? "border-primary bg-primary/5" : "border-muted-foreground/20"
            }`}
        >
            <button
                type="button"
                className="flex w-full items-start gap-3 px-3 py-2.5 text-left"
                onClick={() =>
                    onChange(
                        target.id === "new"
                            ? {
                                  target: "new",
                                  newExpense: decision?.newExpense ?? {
                                      doctype: PROJECT_EXPENSE,
                                      description: row.remarks || "",
                                  },
                              }
                            : { target: target.id, linkTo: null }
                    )
                }
            >
                <span
                    className={`mt-1 h-3.5 w-3.5 shrink-0 rounded-full border-2 ${
                        chosen ? "border-primary bg-primary" : "border-muted-foreground/40"
                    }`}
                />
                <span>
                    <span className="block text-sm font-medium">{target.label}</span>
                    <span className="block text-xs text-muted-foreground">{target.hint}</span>
                </span>
            </button>

            {chosen && (
                <div className="border-t px-3 py-3">
                    {target.id === "new" ? (
                        <NewExpenseForm row={row} decision={decision!} onChange={onChange} />
                    ) : (
                        <RecordPicker
                            row={row}
                            doctype={target.id}
                            decision={decision!}
                            onChange={onChange}
                        />
                    )}
                </div>
            )}
        </div>
    );
};

/**
 * A DROPDOWN, not radios (owner ruling), that loads the chosen record's details beneath it.
 *
 * ⚠️ PRE-SELECTED ONLY WHEN EXACTLY ONE RECORD IS SUGGESTED by the server. Two suggestions is
 * ambiguity, and the screen never guesses between two real records -- `solePreselection` is the one
 * place that rule lives and it is unit-tested. It keys on the server's flag, not on exact equality,
 * so the Re 1 rounding tolerance is applied in one place only.
 */
interface SettleableRecord {
    name: string;
    amount: number;
    detail: string;
    suggested: boolean;
    /** The four facts a reviewer picks a payment BY (owner ruling 2026-08-06). */
    vendor_name: string;
    project_name: string;
    document_name: string;
    approved_on: string;
}

/**
 * ⚠️ THIS BROWSES APPROVED RECORDS. IT DOES NOT SHOW THE MATCHER'S OUTPUT, and the difference is
 * the whole point of this component.
 *
 * It used to read `get_row_candidates`, which is the MATCHER's result. When the matcher found
 * nothing the dropdown was EMPTY -- so "link one by hand", the escape hatch for everything the
 * matcher cannot see, could not be used at all. Found on the owner's first real import.
 *
 * The tolerance does not fix that case either: a TDS payment differs by thousands and will never
 * match, and a beneficiary that resolves to no vendor never reaches Pass B. Those are exactly the
 * rows a person has to resolve by hand.
 *
 * ⚠️ RECORDS OUTSIDE THE TOLERANCE ARE SHOWN, NOT HIDDEN, and marked. Someone hunting a TDS payment
 * needs to SEE the one that differs by 2,000 to learn it cannot be settled here -- silently
 * filtering it out looks like the record does not exist.
 */
const RecordPicker = ({
    row,
    doctype,
    decision,
    onChange,
}: {
    row: OutflowImportRow;
    doctype: DecisionTarget;
    decision: RowDecision;
    onChange: (decision: RowDecision) => void;
}) => {
    const [search, setSearch] = useState("");

    const { data, isLoading } = useFrappeGetCall<{ message: SettleableRecord[] }>(
        "nirmaan_stack.api.outflow_import.review.search_settleable_records",
        { row: row.name, target_doctype: doctype, search },
        `settleable-${row.name}-${doctype}-${search}`
    );

    const options = useMemo(
        () => orderBySuggestion(data?.message ?? [], row.amount),
        [data, row.amount]
    );

    // Pre-select the SOLE suggestion, once, when nothing is chosen yet. Keyed on the server's
    // flag, not on exact equality -- see `solePreselection`.
    useEffect(() => {
        if (decision.linkTo || !options.length || search) return;
        const sole = solePreselection(options);
        if (sole) onChange({ ...decision, linkTo: sole.name });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [options]);

    const selected = options.find((o) => o.name === decision.linkTo);

    return (
        <div className="space-y-3">
            <div className="space-y-1.5">
                <Label className="text-xs">Find an approved record</Label>
                <Input
                    className="h-8"
                    placeholder="Search by id, vendor, PO number or project…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
            </div>

            {isLoading ? (
                <p className="text-sm text-muted-foreground">Loading records…</p>
            ) : !options.length ? (
                <p className="text-sm text-muted-foreground">
                    {search
                        ? "No approved record matches that search."
                        : "There are no approved records in this ledger to link to."}
                </p>
            ) : (
                <Select
                    value={decision.linkTo ?? ""}
                    onValueChange={(value) => onChange({ ...decision, linkTo: value })}
                >
                    <SelectTrigger className="h-auto min-h-9 py-1.5">
                        <SelectValue placeholder="Choose a record…" />
                    </SelectTrigger>
                    <SelectContent className="max-w-[min(90vw,640px)]">
                        {options.map((option) => (
                            <SelectItem key={option.name} value={option.name}>
                                <OptionLine option={option} />
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            )}

            {selected && <RecordDetail record={selected} bankAmount={row.amount} />}

            {/* ⚠️ CLEARING IS A SEPARATE ACT FROM CHOOSING. A Radix Select cannot return to "no
                value" through the dropdown -- every item sets one -- so without this a reviewer who
                picked the wrong record could never get back to undecided, only to a different
                wrong record. It clears the LINK and keeps the ledger, which is the common case
                (right ledger, wrong row). */}
            {decision.linkTo && (
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => onChange({ ...decision, linkTo: null })}
                >
                    <X className="mr-1 h-3 w-3" />
                    Clear selection
                </Button>
            )}
        </div>
    );
};

/**
 * One dropdown line: project, vendor, amount and approval date (owner ruling 2026-08-06).
 *
 * ⚠️ THE ID ALONE IS NOT ENOUGH TO CHOOSE BY. `PAY-00105-034` says nothing about whose money it is
 * -- a reviewer with three approved payments in front of them picks by vendor and project, and
 * scanning them meant opening each one to find out. The four facts go on the line itself.
 */
const OptionLine = ({ option }: { option: SettleableRecord }) => (
    <span className="flex w-full min-w-0 flex-col gap-0.5 py-0.5">
        <span className="flex min-w-0 items-baseline gap-2">
            <span className="truncate font-medium">{option.vendor_name || option.name}</span>
            <span className="ml-auto shrink-0 tabular-nums">
                {formatToRoundedIndianRupee(option.amount)}
            </span>
            <span className="shrink-0">{option.suggested ? "✓" : "⚠"}</span>
        </span>
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[11px] text-muted-foreground">
            <span className="font-mono">{option.name}</span>
            {option.project_name && <span className="truncate">{option.project_name}</span>}
            {option.document_name && (
                <span className="truncate font-mono">{option.document_name}</span>
            )}
            {option.approved_on && <span>approved {formatDate(option.approved_on)}</span>}
        </span>
    </span>
);

/**
 * The chosen record's details plus an explicit amount verdict.
 *
 * ⚠️ THREE STATES, NOT TWO. Exact / within the tolerance / outside it. Two states would have to
 * call a 31-paise difference either "same" (untrue) or a warning (misleading, since the system
 * settles it happily) -- and the bank rounds to the rupee on about a third of all payments, so
 * that middle case is the common one, not the rare one.
 *
 * The tolerance's VALUE is deliberately not named here: it lives on the server, and a number
 * repeated in the client would drift the moment the owner changed it.
 */
const RecordDetail = ({
    record,
    bankAmount,
}: {
    record: SettleableRecord;
    bankAmount: number;
}) => {
    const verdict = amountVerdict(record.amount, bankAmount);
    const settleable = record.suggested;
    return (
        <div className="rounded-md border bg-background p-3 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-mono text-xs">{record.name}</span>
                <span className="tabular-nums">
                    {formatToRoundedIndianRupee(record.amount)}
                </span>
            </div>
            {record.detail && (
                <p className="mt-1 text-xs text-muted-foreground">{record.detail}</p>
            )}
            <p
                className={`mt-2 flex items-center gap-1.5 text-xs ${
                    settleable ? "text-emerald-700" : "text-amber-700"
                }`}
            >
                {verdict.same ? (
                    <>
                        <Check className="h-3.5 w-3.5" /> Same amount as the bank row
                    </>
                ) : settleable ? (
                    <>
                        <Check className="h-3.5 w-3.5" />
                        Differs by {formatToRoundedIndianRupee(Math.abs(verdict.difference))} —
                        within the accepted rounding tolerance, so this can be settled
                    </>
                ) : (
                    <>
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Differs by {formatToRoundedIndianRupee(Math.abs(verdict.difference))} — too
                        far apart to settle here. A deduction such as TDS looks like this; settle it
                        in the payments screen
                    </>
                )}
            </p>
        </div>
    );
};

/**
 * The whole new-expense form, in place.
 *
 * ⚠️ THE PROJECT LIST IS `tendering_status = "Won"`, WHICH IS A DIFFERENT FIELD FROM `status`.
 * ⚠️ A CEO-HOLD PROJECT IS SHOWN, DISABLED, WITH THE REASON. CEO Hold blocks every expense
 * operation, and silently hiding those projects would make their absence inexplicable to whoever
 * goes looking for one.
 * ⚠️ Amount, payment date and reference are READ-ONLY from the bank row: the statement is the
 * source of truth for all three.
 */
const NewExpenseForm = ({
    row,
    decision,
    onChange,
}: {
    row: OutflowImportRow;
    decision: RowDecision;
    onChange: (decision: RowDecision) => void;
}) => {
    const form = decision.newExpense ?? { doctype: PROJECT_EXPENSE };
    const isProject = form.doctype === PROJECT_EXPENSE;

    const { data: projects } = useFrappeGetDocList<{
        name: string;
        project_name: string;
        status: string;
    }>(
        "Projects",
        {
            fields: ["name", "project_name", "status"],
            filters: [["tendering_status", "=", "Won"]],
            limit: 0,
            orderBy: { field: "project_name", order: "asc" },
        },
        isProject ? undefined : null
    );

    const { data: typesData } = useFrappeGetCall<{ message: { name: string }[] }>(
        "nirmaan_stack.api.outflow_import.expenses.get_expense_types",
        { doctype: form.doctype },
        form.doctype ? `expense-types-${form.doctype}` : null
    );

    const patch = (over: Partial<NonNullable<RowDecision["newExpense"]>>) =>
        onChange({ ...decision, newExpense: { ...form, ...over } });

    return (
        <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs">Kind</Label>
                <Select
                    value={form.doctype}
                    // ⚠️ Expense Type is SCOPED -- project=1 and non_project=1 are disjoint sets --
                    // so switching ledger MUST clear the chosen type or it carries a type the
                    // server will refuse.
                    onValueChange={(value) =>
                        patch({
                            doctype: value as "Project Expenses" | "Non Project Expenses",
                            expenseType: null,
                            project: value === PROJECT_EXPENSE ? form.project : null,
                        })
                    }
                >
                    <SelectTrigger className="h-9">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={PROJECT_EXPENSE}>Project expense</SelectItem>
                        <SelectItem value={NON_PROJECT_EXPENSE}>Non project expense</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            {isProject && (
                <div className="space-y-1.5">
                    <Label className="text-xs">Project</Label>
                    <Select
                        value={form.project ?? ""}
                        onValueChange={(value) => patch({ project: value })}
                    >
                        <SelectTrigger className="h-9">
                            <SelectValue placeholder="Choose a project…" />
                        </SelectTrigger>
                        <SelectContent>
                            {(projects ?? []).map((project) => {
                                const onHold = project.status === "CEO Hold";
                                return (
                                    <SelectItem
                                        key={project.name}
                                        value={project.name}
                                        disabled={onHold}
                                    >
                                        {project.project_name}
                                        {onHold && (
                                            <span className="ml-2 text-xs text-muted-foreground">
                                                — on CEO Hold, expenses blocked
                                            </span>
                                        )}
                                    </SelectItem>
                                );
                            })}
                        </SelectContent>
                    </Select>
                </div>
            )}

            <div className="space-y-1.5">
                <Label className="text-xs">Expense type</Label>
                <Select
                    value={form.expenseType ?? ""}
                    onValueChange={(value) => patch({ expenseType: value })}
                >
                    <SelectTrigger className="h-9">
                        <SelectValue placeholder="Choose a type…" />
                    </SelectTrigger>
                    <SelectContent>
                        {(typesData?.message ?? []).map((type) => (
                            <SelectItem key={type.name} value={type.name}>
                                {type.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs">Description</Label>
                <Input
                    className="h-9"
                    value={form.description ?? ""}
                    placeholder="What was this for?"
                    onChange={(e) => patch({ description: e.target.value })}
                />
            </div>

            {/* Read-only from the bank row -- the statement is the source of truth. */}
            <ReadOnlyField label="Amount" value={formatToRoundedIndianRupee(row.amount)} />
            <ReadOnlyField
                label="Payment date"
                value={row.added_on ? formatDate(row.added_on.split(/[ T]/)[0]) : "—"}
            />
            <ReadOnlyField
                label="Payment reference"
                value={row.bank_reference_no || "—"}
                className="sm:col-span-2"
            />
        </div>
    );
};

const ReadOnlyField = ({
    label,
    value,
    className = "",
}: {
    label: string;
    value: string;
    className?: string;
}) => (
    <div className={`space-y-1.5 ${className}`}>
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <Input className="h-9 bg-muted/50" value={value} readOnly tabIndex={-1} />
    </div>
);
