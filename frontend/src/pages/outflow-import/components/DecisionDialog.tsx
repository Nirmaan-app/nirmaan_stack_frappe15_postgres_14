// src/pages/outflow-import/components/DecisionDialog.tsx

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useFrappeGetCall, useFrappeGetDocList } from "frappe-react-sdk";
import { AlertTriangle, Check, ExternalLink, Loader2, X } from "lucide-react";

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
import type { OutflowImportRow } from "@/types/NirmaanStack/OutflowImportBatch";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import {
    amountVerdict,
    isConfirmable,
    orderBySuggestion,
    parseRecordKey,
    recordKey,
    settlementLink,
    type DecisionTarget,
    type RowDecision,
    type SettleableRecord,
} from "../outflowTableModel";
import { SettleableRecordTable } from "./SettleableRecordTable";

const PROJECT_EXPENSE = "Project Expenses";
const NON_PROJECT_EXPENSE = "Non Project Expenses";

/**
 * ⚠️ HIDDEN, NOT DELETED (owner, slice R2). "Create a new expense" is off this dialog for now, so
 * linking an approved record and skipping are the only two ways to resolve a row. Everything behind
 * it is intact -- the form below, `RowDecision.newExpense`, the `new` branch of `isConfirmable`, and
 * the `create_expense` endpoint -- so bringing it back is this one line. Deleting any of that is
 * what would make it expensive to reverse.
 */
const SHOW_CREATE_NEW_EXPENSE = false;

const CREATE_NEW_TARGET: { id: DecisionTarget; label: string; hint: string } = {
    id: "new",
    label: "Create a new expense",
    hint: "nothing to link to — record it here, already Paid",
};

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
 *
 * ⚠️ THIS DIALOG NO LONGER PRE-SELECTS ANYTHING, AND MUST NOT START AGAIN (slice R1). The match
 * run now writes its single pick onto the row itself, and the PAGE seeds every row's decision from
 * that when the batch loads. Pre-selecting here could only ever work once a reviewer had already
 * opened the row -- which is exactly why a matched transfer could not read as ready in the table,
 * and why confirming twenty of them meant opening twenty dialogs. It also re-derived the
 * "exactly one candidate" rule from a DIFFERENT candidate list than the row's own note counted, so
 * the two could disagree about the same row. One rule, on the server, in `sole_suggestion`.
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

    useEffect(() => {
        setSkipReason("");
    }, [row?.name]);

    if (!row) return null;

    return (
        <Dialog open={Boolean(row)} onOpenChange={(open) => !open && onClose()}>
            {/* grid-rows-[auto_1fr_auto] + min-h-0 on the body is what pins header and footer and
                gives the BODY the scrollbar. `max-h-[85vh]` bounds the whole thing to the
                viewport; without the bound the scrim scrolls instead.
                ⚠️ 860px -> 960px WITH THE RECORD TABLE. Seven columns of real facts need the room;
                at 860 the vendor and project columns truncate on almost every row, which defeats
                the reason those facts became columns. */}
            <DialogContent className="grid max-h-[85vh] w-[min(92vw,960px)] grid-rows-[auto_1fr_auto] gap-0 overflow-hidden p-0 sm:max-w-none">
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

                    {/* ⚠️ ONE SECTION, ALWAYS OPEN. It replaced three cards -- one per ledger --
                        that made the reviewer say WHICH KIND of record this was before they were
                        shown any. That is a question the bank statement does not answer: a transfer
                        to a vendor may have been raised as a Project Payment or booked as a Project
                        Expense, and the only way to find out was to open each card in turn. With
                        one list there is nothing to choose first, so there is no card to click. */}
                    <LinkPaymentSection
                        row={row}
                        decision={decision}
                        onChange={onChange}
                        dimmed={decision?.target === "new"}
                    />

                    {SHOW_CREATE_NEW_EXPENSE && (
                        <TargetOption
                            target={CREATE_NEW_TARGET}
                            row={row}
                            decision={decision}
                            onChange={onChange}
                        />
                    )}
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
                            {/* ⚠️ GATED ON THE SAME `isConfirmable` THE BULK BAR COUNTS WITH, so
                                the two surfaces can never disagree about whether a row is ready.
                                It also closes a real hole: the ledger now arrives with the chosen
                                record rather than from a card clicked first, so a cleared selection
                                leaves no target at all -- and this button would have posted a
                                settle with an undefined doctype. */}
                            <Button
                                size="sm"
                                onClick={() => onConfirm()}
                                disabled={busy || !isConfirmable(row, decision)}
                            >
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

/**
 * The one way to resolve a row: find the approved record this transfer paid, in any ledger.
 *
 * ⚠️ IT IS A SECTION, NOT A SELECTABLE CARD, because it is the only option. A radio with nothing
 * to choose against is a control that cannot be wrong, and asking for a click before showing the
 * list would put a step in front of the only thing this dialog does.
 */
const LinkPaymentSection = ({
    row,
    decision,
    onChange,
    dimmed,
}: {
    row: OutflowImportRow;
    decision: RowDecision | undefined;
    onChange: (decision: RowDecision) => void;
    dimmed: boolean;
}) => (
    <div className={`rounded-md border border-muted-foreground/20 ${dimmed ? "opacity-40" : ""}`}>
        <div className="px-3 py-2.5">
            <p className="text-sm font-medium">Link payment</p>
            <p className="text-xs text-muted-foreground">
                the approved record this transfer paid — payment or expense
            </p>
        </div>
        <div className="border-t px-3 py-3">
            <RecordPicker row={row} decision={decision ?? {}} onChange={onChange} />
        </div>
    </div>
);

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
                    onChange({
                        target: "new",
                        newExpense: decision?.newExpense ?? {
                            doctype: PROJECT_EXPENSE,
                            description: row.remarks || "",
                        },
                    })
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
                    <NewExpenseForm row={row} decision={decision!} onChange={onChange} />
                </div>
            )}
        </div>
    );
};

/**
 * A search box over a RADIO TABLE of approved records (owner ruling 2026-08-07, replacing the
 * dropdown), with a verdict line for whichever one is chosen.
 *
 * ⚠️ IT PRE-SELECTS NOTHING, AND THAT IS DELIBERATE (slice R1). It used to tick the sole record
 * whose amount matched. The only rows that still reach this picker with nothing chosen are rows the
 * MATCHER DECLINED -- unmatched, mismatched, or one of several candidates -- so an auto-tick here
 * would be the screen overruling the matcher on the weakest signal it has: amount alone, no vendor,
 * no account, and across all three ledgers not even the right kind of record. The one pre-selection
 * in this feature comes from `sole_suggestion` on the server, via the page.
 *
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
    decision,
    onChange,
}: {
    row: OutflowImportRow;
    decision: RowDecision;
    onChange: (decision: RowDecision) => void;
}) => {
    const [search, setSearch] = useState("");

    // ⚠️ NO `target_doctype`, WHICH IS WHAT MAKES THIS ONE LIST. A blank one means all three
    // ledgers, merged and ordered server-side by how close the amount is -- so the reviewer
    // recognises a record instead of first classifying the transfer.
    const { data, isLoading } = useFrappeGetCall<{ message: SettleableRecord[] }>(
        "nirmaan_stack.api.outflow_import.review.search_settleable_records",
        { row: row.name, search },
        `settleable-${row.name}-${search}`
    );

    const options = useMemo(
        () => orderBySuggestion(data?.message ?? [], row.amount),
        [data, row.amount]
    );

    // Matched on BOTH halves: a bare name is not unique across three ledgers.
    const selected = options.find(
        (o) => o.name === decision.linkTo && o.target_doctype === decision.target
    );

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
                        : "There are no approved payments or expenses to link to."}
                </p>
            ) : (
                <SettleableRecordTable
                    records={options}
                    bankAmount={row.amount}
                    selected={
                        decision.target && decision.linkTo
                            ? recordKey({
                                  target_doctype: decision.target,
                                  name: decision.linkTo,
                              })
                            : ""
                    }
                    // ⚠️ THE LEDGER COMES FROM THE RECORD. It used to come from the card clicked
                    // beforehand; with one list there is no such card, so picking a record is what
                    // decides which table gets written.
                    onSelect={(value) => {
                        const picked = parseRecordKey(value);
                        if (!picked) return;
                        onChange({ ...decision, target: picked.target, linkTo: picked.name });
                    }}
                />
            )}

            {selected && <RecordVerdict record={selected} bankAmount={row.amount} />}

            {/* ⚠️ CLEARING IS A SEPARATE ACT FROM CHOOSING. A Radix Select cannot return to "no
                value" through the dropdown -- every item sets one -- so without this a reviewer who
                picked the wrong record could never get back to undecided, only to a different
                wrong record.
                ⚠️ IT NOW CLEARS THE LEDGER TOO. It used to keep it, because the ledger was a
                separate earlier choice worth preserving; with one list the ledger is part of the
                record, and leaving it behind would strand a target with no record under it. */}
            {decision.linkTo && (
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => onChange({ ...decision, target: undefined, linkTo: null })}
                >
                    <X className="mr-1 h-3 w-3" />
                    Clear selection
                </Button>
            )}
        </div>
    );
};

/**
 * What choosing THIS record means, in one line under the table.
 *
 * ⚠️ IT SHRANK FROM A FULL DETAIL CARD WHEN THE LIST BECAME A TABLE, and the deletion is the point.
 * That card repeated the ledger, the id, the vendor, the project, the date and the amount -- every
 * one of which is now a COLUMN the reviewer can read on the chosen row itself. What a column cannot
 * carry is the sentence explaining what the amount difference MEANS, and the way out to the record,
 * so those are what is left.
 *
 * ⚠️ THREE STATES, NOT TWO. Exact / within the tolerance / outside it. Two states would have to call
 * a 31-paise difference either "same" (untrue) or a warning (misleading, since the system settles it
 * happily) -- and the bank rounds to the rupee on about a third of all payments, so that middle case
 * is the common one, not the rare one.
 *
 * The tolerance's VALUE is deliberately not named here: it lives on the server, and a number
 * repeated in the client would drift the moment the owner changed it -- which has happened twice.
 */
const RecordVerdict = ({
    record,
    bankAmount,
}: {
    record: SettleableRecord;
    bankAmount: number;
}) => {
    const verdict = amountVerdict(record.amount, bankAmount);
    const settleable = record.suggested;
    const link = settlementLink(record.target_doctype, record.name);
    return (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background px-3 py-2">
            <p
                className={`flex items-center gap-1.5 text-xs ${
                    settleable ? "text-emerald-700" : "text-amber-700"
                }`}
            >
                {verdict.same ? (
                    <>
                        <Check className="h-3.5 w-3.5 shrink-0" />
                        <span>
                            <span className="font-mono">{record.name}</span> is the same amount as
                            the bank row
                        </span>
                    </>
                ) : settleable ? (
                    <>
                        <Check className="h-3.5 w-3.5 shrink-0" />
                        <span>
                            <span className="font-mono">{record.name}</span> differs by{" "}
                            {formatToRoundedIndianRupee(Math.abs(verdict.difference))} — within the
                            accepted rounding tolerance, so this can be settled
                        </span>
                    </>
                ) : (
                    <>
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        <span>
                            <span className="font-mono">{record.name}</span> differs by{" "}
                            {formatToRoundedIndianRupee(Math.abs(verdict.difference))} — too far
                            apart to settle here. A deduction such as TDS looks like this; settle it
                            in the payments screen
                        </span>
                    </>
                )}
            </p>
            {/* Opening the record is a READ, and it navigates away from a dialog holding an
                unconfirmed decision -- so it is a quiet link, never a button competing with
                Confirm. */}
            {link && (
                <Link
                    to={link.href}
                    title={link.title}
                    className="flex shrink-0 items-center gap-1 text-xs text-primary hover:underline"
                >
                    Open <ExternalLink className="h-3.5 w-3.5" />
                </Link>
            )}
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
