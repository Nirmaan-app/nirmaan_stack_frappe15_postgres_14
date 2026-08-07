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
import type { OutflowImportRow } from "@/types/NirmaanStack/OutflowImportBatch";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import {
    amountVerdict,
    isConfirmable,
    orderBySuggestion,
    type DecisionTarget,
    type RowDecision,
} from "../outflowTableModel";

const PAYMENT = "Project Payments";
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

/**
 * How each ledger is named ON A RECORD LINE (owner wording, slice R2). Singular, because it labels
 * one record rather than a table.
 */
const LEDGER_LABEL: Record<string, string> = {
    [PAYMENT]: "Project Payment",
    [PROJECT_EXPENSE]: "Project Expense",
    [NON_PROJECT_EXPENSE]: "Non Project Expense",
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
 * A DROPDOWN, not radios (owner ruling), that loads the chosen record's details beneath it.
 *
 * ⚠️ IT PRE-SELECTS NOTHING, AND THAT IS DELIBERATE (slice R1). It used to tick the sole record
 * whose amount matched. The only rows that still reach this picker with nothing chosen are rows the
 * MATCHER DECLINED -- unmatched, mismatched, or one of several candidates -- so an auto-tick here
 * would be the screen overruling the matcher on the weakest signal it has: amount alone, no vendor,
 * no date, and once this list spans all three ledgers, not even the right kind of record. The one
 * pre-selection in this feature comes from `sole_suggestion` on the server, via the page.
 */
interface SettleableRecord {
    /** Which ledger this record lives in. It arrives WITH the record; the reviewer never picks it. */
    target_doctype: DecisionTarget;
    name: string;
    amount: number;
    detail: string;
    suggested: boolean;
    /** The facts a reviewer picks a record BY (owner ruling 2026-08-06). */
    vendor_name: string;
    project_name: string;
    document_name: string;
    /**
     * ⚠️ TWO DATE KEYS, NEVER ONE. Only `Project Payments` records an approval date -- neither
     * expense doctype has the field at all. The expense's last-changed timestamp is real and useful
     * for judging how stale a record is, but it is NOT an approval date, so it travels under its own
     * name and is labelled differently on screen (owner ruling 2026-08-06). Merging them into one
     * key would make a modification look like an approval on two thirds of the list.
     */
    approved_on: string;
    updated_on: string;
}

/** `<doctype>|<name>` -- unique across ledgers, which a bare record name is not guaranteed to be. */
const optionValue = (record: { target_doctype: string; name: string }) =>
    `${record.target_doctype}|${record.name}`;

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
                <Select
                    value={
                        decision.target && decision.linkTo
                            ? optionValue({
                                  target_doctype: decision.target,
                                  name: decision.linkTo,
                              })
                            : ""
                    }
                    // ⚠️ THE LEDGER COMES FROM THE RECORD. It used to come from the card clicked
                    // beforehand; with one list there is no such card, so picking a record is what
                    // decides which table gets written.
                    onValueChange={(value) => {
                        const [target, ...rest] = value.split("|");
                        onChange({
                            ...decision,
                            target: target as DecisionTarget,
                            linkTo: rest.join("|"),
                        });
                    }}
                >
                    <SelectTrigger className="h-auto min-h-9 py-1.5">
                        <SelectValue placeholder="Choose a record…" />
                    </SelectTrigger>
                    <SelectContent className="max-w-[min(90vw,640px)]">
                        {options.map((option) => (
                            <SelectItem key={optionValue(option)} value={optionValue(option)}>
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
 * One record line: payment type, vendor, project, amount and a date (owner ruling, slice R2).
 *
 * ⚠️ THE ID ALONE IS NOT ENOUGH TO CHOOSE BY. `PAY-00105-034` says nothing about whose money it is
 * -- a reviewer with three approved records in front of them picks by vendor and project, and
 * scanning them meant opening each one to find out. The facts go on the line itself.
 *
 * ⚠️ THE TYPE BADGE IS NOT DECORATION. One list now holds all three ledgers, so it is the only
 * thing on the line saying whether this is a payment against a PO or an expense somebody booked --
 * which is what the three separate cards used to say by existing.
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
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-medium text-foreground/70">
                {LEDGER_LABEL[option.target_doctype] ?? option.target_doctype}
            </span>
            <span className="font-mono">{option.name}</span>
            {option.project_name && <span className="truncate">{option.project_name}</span>}
            {option.document_name && (
                <span className="truncate font-mono">{option.document_name}</span>
            )}
            <RecordDate option={option} />
        </span>
    </span>
);

/**
 * The record's date, saying WHICH date it is.
 *
 * ⚠️ AN EXPENSE HAS NO APPROVAL DATE -- neither expense doctype carries the field, and only
 * `Project Payments` records one. So a payment reads "approved 12-Jul-2026" and an expense reads
 * "updated 12-Jul-2026" (owner ruling 2026-08-06). The two words are the guard: presenting a
 * modification timestamp under the word "approved" would be a confident lie on two thirds of the
 * list, and a reviewer settling by approval date would have no way to see it.
 */
const RecordDate = ({ option }: { option: SettleableRecord }) => {
    if (option.approved_on) return <span>approved {formatDate(option.approved_on)}</span>;
    if (option.updated_on) return <span>updated {formatDate(option.updated_on)}</span>;
    return null;
};

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
                <span className="flex min-w-0 items-baseline gap-2">
                    {/* Repeated from the dropdown line because this panel is what stays on screen
                        after the list closes -- and "which ledger am I about to write to" is the
                        one fact the reviewer no longer chose explicitly. */}
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium">
                        {LEDGER_LABEL[record.target_doctype] ?? record.target_doctype}
                    </span>
                    <span className="truncate font-mono text-xs">{record.name}</span>
                </span>
                <span className="tabular-nums">
                    {formatToRoundedIndianRupee(record.amount)}
                </span>
            </div>
            {record.detail && (
                <p className="mt-1 text-xs text-muted-foreground">{record.detail}</p>
            )}
            <p className="mt-1 text-[11px] text-muted-foreground">
                <RecordDate option={record} />
            </p>
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
