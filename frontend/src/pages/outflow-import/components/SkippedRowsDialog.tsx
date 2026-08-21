// src/pages/outflow-import/components/SkippedRowsDialog.tsx

import { useCallback, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { useFrappePostCall } from "frappe-react-sdk";
import { TailSpin } from "react-loader-spinner";

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { OutflowImportRow } from "@/types/NirmaanStack/OutflowImportBatch";
import { exportToCsv } from "@/utils/exportToCsv";

import { ExportButton } from "./ExportButton";
import { ClearFiltersButton, OutflowRowsTable, TablePagination } from "./OutflowRowsTable";
import { useOutflowRows } from "../useOutflowRows";
import { exportFileBase, toExportColumns } from "../outflowExport";
import { OUTFLOW_COLUMNS, describeFrappeError } from "../outflowTableModel";

interface Props {
    /**
     * The import to scope to, when the screen is pinned to one by a deep link.
     *
     * ⚠️ ABSENT MEANS "THE CURRENT PERIOD", NOT "EVERY IMPORT". Undefined lets `useOutflowRows` apply
     * the shared period, which is what the Skipped chip counted; a deep-linked page passes the batch
     * so this dialog and that chip keep describing the same rows. What they must never do is differ.
     */
    batch?: string;
    /**
     * The SAME figures the chip that opened this dialog is showing.
     *
     * ⚠️ PASSED IN RATHER THAN COUNTED HERE, so the two can never disagree. The gap this dialog
     * shipped with -- a chip reading 20 opening a list of 47 -- was not a wrong number anywhere; it
     * was two right numbers over different populations with nothing on screen saying so.
     */
    skippedRows?: number;
    failedRows?: number;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

/** Which half of `Skipped` is on screen. `""` is both. */
type BankFilter = "" | "recorded" | "failed";

/** Nothing here is selectable, so the shared empty set is passed rather than a new one per render. */
const NOTHING: ReadonlySet<string> = new Set();
const NO_ORIGINS = new Map();

/**
 * The transfers this import skipped, reached from the Skipped chip on the summary.
 *
 * ⚠️ IT IS A DIALOG AND NOT A TAB, AND THE DISTINCTION IS AN OWNER RULING (2026-08-10, confirmed
 * 2026-08-11). "All" means everything a person might still act on, not every row -- so no tab
 * reaches a skipped transfer, and `test_no_tab_scope_will_show_a_skipped_row` pins it. This screen
 * does not put them back into the worklist; you come looking for them, from a chip that already
 * told you how many there were. Out of the way was the ruling. Invisible was not.
 *
 * ⚠️ IT SCOPES TO THE SCREEN'S PERIOD, because the chip it opens from does (slice P1). It used to
 * scope to ONE IMPORT for exactly the same reason -- the panel described one statement then. What
 * the chip counts and what this dialog lists must be the same population, whatever that population
 * currently is; that is the whole lesson of the "chip reading 20 opening a list of 47" defect. It
 * needs no prop for it: the period lives in `useOutflowPeriodStore` and `useOutflowRows` reads it
 * directly, so this dialog's table and the page's table cannot be looking at different windows.
 *
 * ⚠️ READ-ONLY BY CONSTRUCTION RATHER THAN BY A FLAG. `Skipped` is terminal, so `OutflowRowsTable`
 * already renders no action for it, and passing an empty `selectableRowNames` removes the checkbox
 * column entirely (`selectable = names.length > 0`). No new mode, no new branch to keep honest.
 *
 * ⚠️ THE REASON IS IN THE OUTCOME COLUMN, NOT IN `skip_reason`. 20 of the 47 skipped rows on the
 * first real statement carry no `skip_reason` at all -- the already-Paid duplicates record it as
 * "Already recorded as Paid on PAY-…" in the note, exactly as the Mismatched causes do. The table's
 * terminal cell already falls back `outcome_note || skip_reason`, which is why this dialog needs no
 * column of its own.
 */
export const SkippedRowsDialog = ({ batch, skippedRows, failedRows, open, onOpenChange }: Props) => {
    // ⚠️ `enabled` MATTERS HERE. A dialog that is mounted but closed must not query -- this one sits
    // in the page's tree for the whole session and would otherwise fetch on every filter change
    // behind it.
    const table = useOutflowRows({
        scope: "skipped",
        batch,
        enabled: open,
        // ⚠️ THE IMPORT COLUMN IS NOW SHOWN (slice P1). It was hidden because every row carried the
        // same filename -- true when the dialog was one import's, false now that a period can span
        // several, where "which statement did this come from" is a real question. Outcome keeps its
        // width; the Columns menu is still there for anyone who wants it back.
    });

    const bank = (String(table.filters.failed ?? "") as BankFilter) || "";
    const setBank = (next: BankFilter) => table.setFilter("failed", next || undefined);

    const empty = useMemo(
        () => !table.loading && table.rows.length === 0,
        [table.loading, table.rows.length]
    );

    const [exportError, setExportError] = useState<string | null>(null);
    const { call: callExport } = useFrappePostCall<{
        message: { rows: OutflowImportRow[]; total: number };
    }>("nirmaan_stack.api.outflow_import.review.export_outflow_rows");

    /**
     * ⚠️ IT SENDS **THIS** TABLE'S QUERY, NOT THE PAGE'S. This dialog holds its own `useOutflowRows`
     * instance — fixed to the `skipped` scope, carrying its own search and its own Already-paid /
     * Bank-refused split — and exporting the page's query here would download the worklist from
     * behind the dialog under a filename saying `outflow-skipped`. The scope in `exportQuery` names
     * the file and selects the rows, so the two cannot come apart.
     */
    const handleExport = useCallback(async () => {
        setExportError(null);
        try {
            const response = await callExport({
                ...table.exportQuery,
                facets: JSON.stringify(table.exportQuery.facets ?? {}),
            });
            exportToCsv(
                exportFileBase(table.exportQuery.scope),
                response?.message?.rows ?? [],
                // See `toExportColumns` — this is the shape `exportToCsv` reads, which TanStack's
                // `ColumnDef` cannot express without augmenting `ColumnMeta` app-wide.
                toExportColumns(OUTFLOW_COLUMNS) as any
            );
        } catch (err) {
            setExportError(describeFrappeError(err, "The export failed."));
        }
    }, [callExport, table.exportQuery]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            {/* ⚠️ WIDER THAN THE OTHER DIALOGS ON PURPOSE. This one renders the SAME table as the
                page, and that table's columns are sized for a full-width screen — at `max-w-6xl` the
                Outcome column fell off the right edge, which on this screen is the only column that
                says why a row was skipped. */}
            <DialogContent className="max-w-[95vw]">
                <DialogHeader>
                    <DialogTitle>Skipped transfers</DialogTitle>
                    {/* ⚠️ THE SENTENCE THAT RECONCILES THE CHIP WITH THIS LIST. The chip says 20,
                        this list holds 47, and both are right: a transfer the bank refused is money
                        that never left the account, so it is excluded from every figure the summary
                        reports. Saying so here, with the two numbers side by side, is what stops the
                        transition from reading as a bug. */}
                    <DialogDescription>
                        Bookkeeping from this statement — nothing here needs a decision.
                        {skippedRows != null && failedRows != null && (
                            <>
                                {" "}
                                <strong className="font-medium text-foreground">
                                    {skippedRows}
                                </strong>{" "}
                                were already recorded as Paid by hand and{" "}
                                <strong className="font-medium text-foreground">
                                    {failedRows}
                                </strong>{" "}
                                were refused by the bank. The summary&rsquo;s Skipped figure counts
                                only the first {skippedRows} — money the bank never moved is left out
                                of every figure up there.
                            </>
                        )}
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-wrap items-center gap-2">
                    <div className="relative max-w-sm flex-1">
                        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            className="h-8 pl-8 pr-8"
                            placeholder="Search remarks, reference or beneficiary…"
                            value={table.search}
                            onChange={(e) => table.setSearch(e.target.value)}
                        />
                        {table.search && (
                            <button
                                type="button"
                                aria-label="Clear search"
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                                onClick={() => table.setSearch("")}
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        )}
                    </div>
                    {/* Three buttons over ONE filter, so the split is reachable rather than merely
                        explained. The counts come from the summary, not from this page of rows. */}
                    <div className="flex items-center gap-1 rounded-md border p-0.5">
                        {(
                            [
                                ["", "All", (skippedRows ?? 0) + (failedRows ?? 0)],
                                ["recorded", "Already paid", skippedRows],
                                ["failed", "Bank refused", failedRows],
                            ] as [BankFilter, string, number | undefined][]
                        ).map(([value, label, count]) => (
                            <button
                                key={value || "all"}
                                type="button"
                                onClick={() => setBank(value)}
                                className={`rounded px-2 py-1 text-xs transition-colors ${
                                    bank === value
                                        ? "bg-primary/10 font-medium text-primary"
                                        : "text-muted-foreground hover:bg-muted"
                                }`}
                            >
                                {label}
                                {count != null && (
                                    <span className="ml-1 tabular-nums">{count}</span>
                                )}
                            </button>
                        ))}
                    </div>
                    <ClearFiltersButton count={table.filterCount} onClear={table.clearFilters} />
                    {/* Export rides with the COUNT, not with the filters — the count says what you
                        are looking at and this says "give me that". Same grouping as the master
                        table's toolbar, for the same reason. */}
                    <div className="ml-auto flex items-center gap-2">
                        <ExportButton total={table.total} onExport={handleExport} />
                        <span className="text-xs text-muted-foreground">
                            {table.total.toLocaleString()}{" "}
                            {table.total === 1 ? "transfer" : "transfers"}
                        </span>
                    </div>
                </div>

                {/* The server's own sentence, unrewritten — see the master page's copy of this. */}
                <AlertDialog
                    open={exportError !== null}
                    onOpenChange={(next) => !next && setExportError(null)}
                >
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Could not export</AlertDialogTitle>
                            <AlertDialogDescription>{exportError}</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogAction onClick={() => setExportError(null)}>
                                Close
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>

                {/* ⚠️ BOTH AXES. The table is wider than a dialog, and without the horizontal scroll the
                    Status and Outcome columns fall off the right edge — Outcome being the one that
                    carries the reason, which is the whole point of this screen. */}
                <div className="max-h-[55vh] overflow-auto">
                    {table.loading && !table.rows.length ? (
                        <div className="flex h-40 items-center justify-center">
                            <TailSpin color="#D03B45" height={30} width={30} />
                        </div>
                    ) : empty ? (
                        <p className="py-10 text-center text-sm text-muted-foreground">
                            Nothing was skipped in this import.
                        </p>
                    ) : (
                        <OutflowRowsTable
                            rows={table.rows}
                            loadFacetValues={table.loadFacetValues}
                            query={table.search}
                            filters={table.filters}
                            sort={table.sort}
                            hiddenColumns={table.hidden}
                            selected={NOTHING}
                            decidedRowNames={NOTHING}
                            originByRow={NO_ORIGINS}
                            // Empty: `Skipped` is terminal, so nothing here may be ticked and the
                            // checkbox column does not render at all.
                            selectableRowNames={NOTHING}
                            onSort={table.toggleSort}
                            onFilter={table.setFilter}
                            onToggleRow={() => undefined}
                            onToggleAll={() => undefined}
                            onOpenDecision={() => undefined}
                        />
                    )}
                </div>

                {!empty && (
                    <TablePagination
                        total={table.total}
                        limit={table.pageSize}
                        offset={table.page * table.pageSize}
                        busy={table.loading}
                        onPage={table.setPage}
                    />
                )}
            </DialogContent>
        </Dialog>
    );
};
