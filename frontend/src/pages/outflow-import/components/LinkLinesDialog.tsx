// src/pages/outflow-import/components/LinkLinesDialog.tsx
//
// Link the ticked bank lines to one Reconciliation Pending expense (#1298, ADR-0027). Mockup boards 3-4.
// Every sentence and mark comes from the pure `linkLinesView`; this file only lays them out.

import { useMemo, useState } from "react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { AlertTriangle, Check, Link2, Loader2, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { OutflowImportRow } from "@/types/NirmaanStack/OutflowImportBatch";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import {
    afterLinking,
    filterLinkableExpenses,
    fitMark,
    linkActionLabel,
    linkedSoFarNote,
    tickedLines,
    tickedSubline,
    type LinkableExpense,
    type LinkedExpense,
} from "../linkLinesView";
import { describeFrappeError, ledgerLabel, needsRecordAnywayConfirmation } from "../outflowTableModel";

/** Counts dialog openings; each keys its own picker fetch, so a re-open never paints a stale list. */
let openings = 0;

const keyOf = (record: Pick<LinkableExpense, "target_doctype" | "name">) =>
    `${record.target_doctype}::${record.name}`;

export interface LinkLinesResult {
    expense: LinkedExpense;
}

/**
 * ⚠️ `lines` ARE THE TICKED ROWS ON THIS PAGE, AND THE PAGE ONLY OPENS THIS WHEN `linkButtonState` IS
 * ENABLED -- every tick on this page, all money out. The server re-checks all of it under its locks.
 *
 * ⚠️ NOTHING CLOSES UNTIL THE LINK SUCCEEDS. A refusal (someone linked lines to the same expense first,
 * a line settled elsewhere) shows in the error strip, and the picker is re-read so its marks catch up.
 */
export const LinkLinesDialog = ({
    lines,
    open,
    onClose,
    onLinked,
}: {
    lines: OutflowImportRow[];
    open: boolean;
    onClose: () => void;
    onLinked: (result: LinkLinesResult, count: number) => Promise<void> | void;
}) => (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
        <DialogContent className="max-h-[90vh] w-[min(94vw,1000px)] overflow-y-auto sm:max-w-none">
            {open && lines.length > 0 && <LinkLinesBody lines={lines} onClose={onClose} onLinked={onLinked} />}
        </DialogContent>
    </Dialog>
);

const LinkLinesBody = ({
    lines,
    onClose,
    onLinked,
}: {
    lines: OutflowImportRow[];
    onClose: () => void;
    onLinked: (result: LinkLinesResult, count: number) => Promise<void> | void;
}) => {
    const [opening] = useState(() => ++openings);
    const [query, setQuery] = useState("");
    const [pickedKey, setPickedKey] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [askAnyway, setAskAnyway] = useState(false);
    const [busy, setBusy] = useState(false);

    const { data, isLoading, error: listError, mutate } = useFrappeGetCall<{ message: LinkableExpense[] }>(
        "nirmaan_stack.api.outflow_import.link_lines.get_linkable_expenses",
        undefined,
        `linkable-expenses-${opening}`
    );
    const { call } = useFrappePostCall<{ message: LinkLinesResult }>(
        "nirmaan_stack.api.outflow_import.link_lines.link_rows_to_expense"
    );

    const ticked = useMemo(() => tickedLines(lines), [lines]);
    const records = data?.message ?? [];
    const shown = useMemo(() => filterLinkableExpenses(records, query), [records, query]);
    const picked = records.find((r) => keyOf(r) === pickedKey) ?? null;
    const pickedMark = picked ? fitMark(ticked.total, picked) : null;
    // A pick that stopped fitting after a re-read is not linkable; the bar says why.
    const canLink = Boolean(picked && pickedMark?.pickable) && !busy;
    const after = picked ? afterLinking(ticked, picked) : null;

    const link = async (confirmMismatch: boolean) => {
        if (!picked) return;
        setBusy(true);
        setError(null);
        setAskAnyway(false);
        try {
            const response = await call({
                rows: JSON.stringify(lines.map((line) => line.name)),
                target_doctype: picked.target_doctype,
                target_name: picked.name,
                confirm_mismatch: confirmMismatch ? 1 : 0,
            });
            await onLinked(response.message, lines.length);
        } catch (err) {
            setError(describeFrappeError(err, "Nothing was linked."));
            setAskAnyway(needsRecordAnywayConfirmation(err));
            mutate();
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <DialogHeader className="flex-row items-start gap-4 space-y-0 border-b pb-4">
                <div className="min-w-0 flex-1">
                    <DialogTitle>
                        Link {lines.length} bank {lines.length === 1 ? "line" : "lines"} to one expense
                    </DialogTitle>
                    <DialogDescription className="mt-1 font-mono text-xs">{tickedSubline(lines)}</DialogDescription>
                </div>
                <div className="text-right">
                    <p className="text-lg font-semibold tabular-nums">{formatToRoundedIndianRupee(ticked.total)}</p>
                    <p className="text-xs text-muted-foreground">
                        {lines.length} {lines.length === 1 ? "line" : "lines"}, money out
                    </p>
                </div>
            </DialogHeader>

            <details className="rounded-md border">
                <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
                    The {lines.length} {lines.length === 1 ? "line" : "lines"}
                </summary>
                <table className="w-full text-xs">
                    <tbody>
                        {lines.map((line) => (
                            <tr key={line.name} className="border-t">
                                <td className="px-3 py-1.5">{line.beneficiary_name || "—"}</td>
                                <td className="px-3 py-1.5 font-mono text-muted-foreground">
                                    {line.bank_account ? `…${line.bank_account.slice(-9)}` : line.transfer_id}
                                </td>
                                <td className="px-3 py-1.5 text-right tabular-nums">
                                    {formatToRoundedIndianRupee(line.amount)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </details>

            <div className="space-y-1.5">
                <label htmlFor="link-expense-search" className="text-xs font-medium">
                    Find an expense waiting for bank lines
                </label>
                <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        id="link-expense-search"
                        className="h-8 pl-8"
                        placeholder="Search by id, expense type, description or project…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                    />
                </div>
                <div className="flex items-center text-xs text-muted-foreground">
                    <span>
                        {isLoading
                            ? "Loading expenses…"
                            : `${shown.length} ${shown.length === 1 ? "expense" : "expenses"} at Reconciliation Pending with room left`}
                    </span>
                    {query && (
                        <Button variant="ghost" size="sm" className="ml-auto h-6 text-xs" onClick={() => setQuery("")}>
                            Clear search
                        </Button>
                    )}
                </div>
            </div>

            {listError ? (
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {describeFrappeError(listError, "The expenses could not be loaded.")}
                </p>
            ) : (
                <div className="max-h-[40vh] overflow-auto rounded-md border">
                    <table className="w-full table-fixed text-sm">
                        <thead className="sticky top-0 bg-muted text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                            <tr>
                                <th className="w-9 px-2 py-2" />
                                <th className="w-44 px-2 py-2 font-medium">Record</th>
                                <th className="px-2 py-2 font-medium">Description</th>
                                <th className="w-32 px-2 py-2 font-medium">Project</th>
                                <th className="w-28 px-2 py-2 text-right font-medium">Amount</th>
                                <th className="w-28 px-2 py-2 text-right font-medium">Linked so far</th>
                                <th className="w-48 px-2 py-2 text-right font-medium">Left</th>
                            </tr>
                        </thead>
                        <tbody>
                            {shown.map((record) => {
                                const mark = fitMark(ticked.total, record);
                                const key = keyOf(record);
                                const selected = key === pickedKey;
                                return (
                                    <tr
                                        key={key}
                                        className={`border-t align-top ${
                                            selected ? "bg-rose-50 dark:bg-rose-950/30" : ""
                                        } ${mark.pickable ? "cursor-pointer" : "text-muted-foreground"}`}
                                        onClick={() => mark.pickable && setPickedKey(key)}
                                    >
                                        <td className="px-2 py-2.5">
                                            <input
                                                type="radio"
                                                name="link-expense"
                                                className="h-4 w-4 accent-primary"
                                                aria-label={`Pick ${record.name}`}
                                                checked={selected}
                                                disabled={!mark.pickable}
                                                onChange={() => setPickedKey(key)}
                                            />
                                        </td>
                                        <td className="px-2 py-2.5">
                                            <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground/70">
                                                {ledgerLabel(record.target_doctype)}
                                            </span>
                                            <div className="mt-1 font-mono text-xs">{record.name}</div>
                                            <div className="text-[11px] text-muted-foreground">{record.expense_type}</div>
                                        </td>
                                        <td className="break-words px-2 py-2.5">{record.description || "—"}</td>
                                        <td className="break-words px-2 py-2.5">{record.project_name || "—"}</td>
                                        <td className="px-2 py-2.5 text-right tabular-nums">
                                            {formatToRoundedIndianRupee(record.amount)}
                                        </td>
                                        <td className="px-2 py-2.5 text-right tabular-nums">
                                            {formatToRoundedIndianRupee(record.linked_total)}
                                            <div className="text-[11px] text-muted-foreground">{linkedSoFarNote(record)}</div>
                                        </td>
                                        <td className="px-2 py-2.5 text-right font-semibold tabular-nums">
                                            {formatToRoundedIndianRupee(record.remaining)}
                                            <div
                                                className={`mt-0.5 inline-flex items-center gap-1 text-[11px] font-normal ${
                                                    mark.pickable ? "text-emerald-700" : "text-amber-700"
                                                }`}
                                            >
                                                {mark.pickable ? (
                                                    <Check className="h-3 w-3" />
                                                ) : (
                                                    <AlertTriangle className="h-3 w-3" />
                                                )}
                                                {mark.label}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                            {!isLoading && !shown.length && (
                                <tr>
                                    <td colSpan={7} className="px-3 py-6 text-center text-sm text-muted-foreground">
                                        {query
                                            ? "No expense with room matches that search."
                                            : "No expense is waiting for bank lines. Mark the expense as done first."}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}

            {after && (
                <div
                    className={`flex flex-col gap-1 rounded-md border px-3 py-2 text-sm tabular-nums ${
                        after.tone === "over"
                            ? "border-red-300 bg-red-50 text-red-700"
                            : "border-muted-foreground/20 bg-muted/60"
                    }`}
                >
                    <span className={after.tone === "ok" ? "font-medium" : ""}>{after.summary}</span>
                    {after.detail && <span className="text-xs text-muted-foreground">{after.detail}</span>}
                </div>
            )}

            {error && (
                <div className="flex items-start gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
                    <span className="flex-1">
                        <b className="font-semibold">Nothing was linked.</b> {error}
                    </span>
                    {askAnyway && (
                        <Button size="sm" variant="outline" className="h-7" disabled={busy} onClick={() => link(true)}>
                            Link anyway
                        </Button>
                    )}
                </div>
            )}

            <div className="-mx-6 -mb-6 flex justify-end gap-2 border-t bg-muted/40 px-6 py-3">
                <Button variant="outline" onClick={onClose} disabled={busy}>
                    Cancel
                </Button>
                <Button disabled={!canLink} onClick={() => link(false)}>
                    {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Link2 className="mr-1.5 h-4 w-4" />}
                    {linkActionLabel(lines.length, pickedMark?.kind === "fills")}
                </Button>
            </div>
        </>
    );
};
