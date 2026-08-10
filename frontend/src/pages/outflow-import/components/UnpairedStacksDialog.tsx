// src/pages/outflow-import/components/UnpairedStacksDialog.tsx

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Layers, Loader2, XCircle } from "lucide-react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee, { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import {
    assignedStackPairs,
    duplicateStackAssignments,
    ledgerLabel,
    proposeStackPairs,
    stackLabel,
    stackPairsAreSubmittable,
    stackIsCrossProject,
    stackProjectSpread,
    stackRecordKey,
    stackSurplusNote,
    type UnpairedStack,
    describeFrappeError,
} from "../outflowTableModel";

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSettled: () => Promise<void> | void;
}

interface Payload {
    stacks: UnpairedStack[];
    total: number;
}

interface Outcome {
    transfer: string;
    record: string;
    ok: boolean;
    error?: string;
}

/**
 * The leftovers of the stack pass: same vendor, same amount, counts that do NOT match (chunk E3).
 *
 * ⚠️ THIS SCREEN EXISTS FOR THE CASE NO RULE CAN SETTLE. A balanced stack is auto-paired and never
 * appears here. What lands here is seven transfers against six approved payments, where SOME
 * transfer settles nothing -- and choosing which is a judgement about money that `pair_stack`
 * deliberately refuses to make. Three such stacks survived the owner's first real statement.
 *
 * ⚠️ IT OPENS WITH A PROPOSAL, NOT AN ANSWER. Transfer i sits beside record i in the server's own
 * deterministic order, and every row is re-pointable. The surplus is left UNASSIGNED and stated in
 * words, because it is the whole reason a person is here -- a dialog that showed only the pairs
 * would let someone close it believing the stack was dealt with.
 *
 * ⚠️ ONE `settle_row` CALL PER PAIR, exactly like "Confirm all matched" and for the same reason:
 * each settle is its own savepoint, so a failure on the third pair leaves the first two written and
 * the rest attemptable. There is no bulk endpoint and there must not be one -- the easy version of
 * it on the server would be a single transaction, and one unsettleable pair would discard the good
 * decisions around it.
 */
export const UnpairedStacksDialog = ({ open, onOpenChange, onSettled }: Props) => {
    const [active, setActive] = useState(0);
    const [pairs, setPairs] = useState<Record<string, string>>({});
    const [running, setRunning] = useState(false);
    const [outcomes, setOutcomes] = useState<Outcome[] | null>(null);

    // Same suspension rule as ConfirmAllMatchedDialog: once there are results, the list is not
    // merely stale but IRRELEVANT, and nothing arriving from the server can improve the report of
    // what was written. A null SWR key means no revalidation can swap the view out from under it.
    const showResults = outcomes !== null;

    const { data, isLoading, mutate } = useFrappeGetCall<{ message: Payload }>(
        "nirmaan_stack.api.outflow_import.review.get_unpaired_stacks",
        {},
        open && !showResults ? "outflow-unpaired-stacks" : null
    );

    const { call: callSettle } = useFrappePostCall(
        "nirmaan_stack.api.outflow_import.expenses.settle_row"
    );

    const stacks = useMemo(() => data?.message?.stacks ?? [], [data]);
    const stack = stacks[active];

    // A dialog is reused; without this the second open shows the first run's results.
    useEffect(() => {
        if (open) return;
        setActive(0);
        setPairs({});
        setOutcomes(null);
        setRunning(false);
    }, [open]);

    // Seed the proposal whenever the visible stack changes -- including on the first load, when
    // `stack` goes from undefined to real.
    useEffect(() => {
        setPairs(stack ? proposeStackPairs(stack) : {});
    }, [stack]);

    const duplicates = useMemo(() => duplicateStackAssignments(pairs), [pairs]);
    const assigned = useMemo(
        () => (stack ? assignedStackPairs(stack, pairs) : []),
        [stack, pairs]
    );
    const submittable = stack ? stackPairsAreSubmittable(stack, pairs) : false;

    const assign = useCallback((transfer: string, value: string) => {
        setPairs((prev) => ({ ...prev, [transfer]: value === CLEARED ? "" : value }));
    }, []);

    const run = useCallback(async () => {
        if (!assigned.length) return;
        setRunning(true);
        const results: Outcome[] = [];
        for (const pair of assigned) {
            try {
                await callSettle({
                    row: pair.transfer.name,
                    target_doctype: pair.target,
                    target_name: pair.name,
                });
                results.push({ transfer: pair.transfer.transfer_id, record: pair.name, ok: true });
            } catch (err: any) {
                results.push({
                    transfer: pair.transfer.transfer_id,
                    record: pair.name,
                    ok: false,
                    error: describeFrappeError(err, "Could not settle this transfer."),
                });
            }
        }
        setOutcomes(results);
        setRunning(false);
        await onSettled();
        await mutate();
    }, [assigned, callSettle, onSettled, mutate]);

    const settled = outcomes?.filter((o) => o.ok).length ?? 0;
    const failed = outcomes?.filter((o) => !o.ok) ?? [];

    return (
        <Dialog open={open} onOpenChange={(next) => (running ? null : onOpenChange(next))}>
            <DialogContent className="max-w-5xl">
                <DialogHeader>
                    <DialogTitle>
                        {outcomes
                            ? "Settlement results"
                            : `Stacks needing a decision${stacks.length ? ` (${stacks.length})` : ""}`}
                    </DialogTitle>
                    <DialogDescription>
                        {outcomes
                            ? "Each pair was settled on its own. A failure left the others untouched."
                            : "These transfers are identical to each other — same account, same amount — and the number of approved records does not match. Pair the ones you can; the rest stay open."}
                    </DialogDescription>
                </DialogHeader>

                {!showResults && isLoading && (
                    <div className="flex items-center justify-center py-10 text-muted-foreground">
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
                    </div>
                )}

                {showResults && outcomes && (
                    <div className="max-h-[55vh] space-y-2 overflow-y-auto">
                        <p className="flex items-center gap-2 text-sm">
                            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                            <span className="font-medium">{settled} settled</span>
                            {failed.length > 0 && (
                                <span className="text-muted-foreground">
                                    · {failed.length} could not be
                                </span>
                            )}
                        </p>
                        {failed.map((outcome) => (
                            <div
                                key={`${outcome.transfer}|${outcome.record}`}
                                className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-sm"
                            >
                                <div className="flex items-center gap-2">
                                    <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                                    <span className="font-mono text-xs">{outcome.record}</span>
                                </div>
                                <p className="pl-5 text-xs text-destructive">{outcome.error}</p>
                            </div>
                        ))}
                    </div>
                )}

                {!showResults && !isLoading && !stacks.length && (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                        Nothing here. Every group of identical transfers has as many approved
                        records as transfers, so they were paired automatically.
                    </p>
                )}

                {!showResults && !isLoading && stack && (
                    <div className="max-h-[55vh] space-y-4 overflow-y-auto">
                        {stacks.length > 1 && (
                            <div className="flex flex-wrap gap-1.5">
                                {stacks.map((s, index) => (
                                    <button
                                        key={`${s.account}|${s.amount}`}
                                        type="button"
                                        onClick={() => setActive(index)}
                                        className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                                            index === active
                                                ? "border-primary bg-primary/10 font-medium text-primary"
                                                : "text-muted-foreground hover:bg-muted"
                                        }`}
                                    >
                                        {stackLabel(s, formatToRoundedIndianRupee)}
                                        {/* A dot, not a word: the chip strip is a picker, and the
                                            full sentence waits inside the stack it belongs to. */}
                                        {stackIsCrossProject(s) && (
                                            <span
                                                aria-hidden="true"
                                                className="ml-1.5 text-amber-600"
                                            >
                                                ●
                                            </span>
                                        )}
                                    </button>
                                ))}
                            </div>
                        )}

                        <div className="flex flex-wrap items-center gap-2">
                            <Layers className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm font-medium">
                                {stackLabel(stack, formatToRoundedIndianRupee)}
                            </span>
                            <Badge variant="outline" className="border-0 bg-muted text-[11px]">
                                {stack.records.length} approved{" "}
                                {stack.records.length === 1 ? "record" : "records"}
                            </Badge>
                        </div>

                        {/* ⚠️ THE SURPLUS IS STATED, NOT IMPLIED. A stack is here BECAUSE the counts
                            do not match, and showing only the pairs would let someone close this
                            believing the whole stack was dealt with. */}
                        {stackSurplusNote(stack) && (
                            <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
                                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                <span>{stackSurplusNote(stack)}</span>
                            </p>
                        )}

                        {/* ⚠️ THE WARNING THAT ONLY APPEARS WHEN IT MEANS SOMETHING. Every stack is
                            ambiguous by construction -- identical transfers, identical records, and
                            a bank statement that says nothing about which paid which. On a
                            single-project stack that ambiguity is free: either way round bills the
                            same job. When the records span projects, the SAME arbitrary pairing
                            bills the WRONG job, silently and permanently.

                            So this is deliberately NOT shown on every stack. A caution printed on
                            the safe ones too is a caution people learn to click past, and the 6
                            here are a mix -- 3 span projects, 3 do not. Naming the projects is the
                            point: it turns "be careful" into something a reader can actually check
                            against the remark on each transfer. */}
                        {stackIsCrossProject(stack) && (
                            <p className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-100/70 p-2.5 text-xs text-amber-900">
                                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                <span>
                                    <strong className="font-semibold">
                                        These records sit on {stackProjectSpread(stack).length}{" "}
                                        different projects
                                    </strong>{" "}
                                    — {stackProjectSpread(stack).join(", ")}. The pairing below is a
                                    proposal, not a finding: nothing in the statement says which
                                    transfer paid which record. Check the project on each line before
                                    settling, or a transfer will be booked against the wrong one.
                                </span>
                            </p>
                        )}

                        <table className="w-full border-collapse text-sm">
                            <thead className="sticky top-0 bg-muted/60 backdrop-blur">
                                <tr className="text-left">
                                    <th className="px-2 py-1.5 text-xs uppercase tracking-wide text-muted-foreground">
                                        Transfer
                                    </th>
                                    <th className="px-2 py-1.5 text-xs uppercase tracking-wide text-muted-foreground">
                                        Settles
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {stack.transfers.map((transfer) => {
                                    const chosen = pairs[transfer.name] ?? "";
                                    const clashes = Boolean(chosen) && duplicates.has(chosen);
                                    return (
                                        <tr key={transfer.name} className="border-t align-top">
                                            <td className="px-2 py-1.5">
                                                <div className="font-medium tabular-nums">
                                                    {formatToIndianRupee(transfer.amount)}
                                                </div>
                                                <div className="text-xs text-muted-foreground">
                                                    {transfer.added_on
                                                        ? formatDate(
                                                              transfer.added_on.split(/[ T]/)[0]
                                                          )
                                                        : "—"}
                                                    {transfer.bank_reference_no
                                                        ? ` · ${transfer.bank_reference_no}`
                                                        : ""}
                                                </div>
                                                {/* Which statement this one came from -- a stack
                                                    spans imports, so it is a real question here. */}
                                                {transfer.import_filename && (
                                                    <div className="truncate text-xs text-muted-foreground">
                                                        {transfer.import_filename}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-2 py-1.5">
                                                <Select
                                                    value={chosen || CLEARED}
                                                    onValueChange={(value) =>
                                                        assign(transfer.name, value)
                                                    }
                                                >
                                                    <SelectTrigger
                                                        className={`h-8 w-full max-w-md ${
                                                            clashes
                                                                ? "border-destructive text-destructive"
                                                                : ""
                                                        }`}
                                                    >
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value={CLEARED}>
                                                            Leave open
                                                        </SelectItem>
                                                        {stack.records.map((record) => (
                                                            <SelectItem
                                                                key={stackRecordKey(record)}
                                                                value={stackRecordKey(record)}
                                                            >
                                                                {ledgerLabel(record.target_doctype)}{" "}
                                                                {record.target_name}
                                                                {record.project_name
                                                                    ? ` · ${record.project_name}`
                                                                    : ""}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                {clashes && (
                                                    <p className="mt-1 text-xs text-destructive">
                                                        Already assigned to another transfer. One
                                                        record can only be settled once.
                                                    </p>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}

                <DialogFooter>
                    {outcomes ? (
                        <Button onClick={() => onOpenChange(false)}>Close</Button>
                    ) : (
                        <>
                            <Button
                                variant="outline"
                                disabled={running}
                                onClick={() => onOpenChange(false)}
                            >
                                Cancel
                            </Button>
                            <Button disabled={!submittable || running} onClick={run}>
                                {running && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                {running
                                    ? "Settling…"
                                    : `Settle ${assigned.length} ${assigned.length === 1 ? "pair" : "pairs"}`}
                            </Button>
                        </>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

/**
 * The "Leave open" option's value.
 *
 * ⚠️ NOT THE EMPTY STRING. Radix's `Select` throws on an empty-string `SelectItem` value -- it
 * reserves it for "nothing selected" -- so the sentinel has to be a real string that no
 * `<doctype>|<name>` key can collide with. `assign` maps it back to "" before it reaches the model,
 * which is the shape `assignedStackPairs` and `duplicateStackAssignments` already skip.
 */
const CLEARED = "__leave_open__";
