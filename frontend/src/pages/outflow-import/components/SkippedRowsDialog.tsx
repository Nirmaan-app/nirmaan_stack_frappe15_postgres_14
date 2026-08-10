// src/pages/outflow-import/components/SkippedRowsDialog.tsx

import { useMemo } from "react";
import { Search, X } from "lucide-react";
import { TailSpin } from "react-loader-spinner";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

import { ClearFiltersButton, OutflowRowsTable, TablePagination } from "./OutflowRowsTable";
import { useOutflowRows } from "../useOutflowRows";

interface Props {
    /** The import the summary panel is describing. The dialog never spans imports. */
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
 * ⚠️ IT SCOPES TO ONE IMPORT, because the chip it opens from does. The summary panel describes a
 * single statement while the table behind it spans every one -- a dialog opened from that panel
 * that then showed every import's skipped rows would be answering a question nobody asked.
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
export const SkippedRowsDialog = ({
    batch,
    skippedRows,
    failedRows,
    open,
    onOpenChange,
}: Props) => {
    // ⚠️ `enabled` MATTERS HERE. A dialog that is mounted but closed must not query -- this one sits
    // in the page's tree for the whole session and would otherwise fetch on every filter change
    // behind it.
    const table = useOutflowRows({
        scope: "skipped",
        batch,
        enabled: open && Boolean(batch),
        // Every row carries the same filename here — the dialog is one import's. The width belongs
        // to Outcome, which is the only column that says WHY a row was skipped.
        alsoHidden: ["import_batch"],
    });

    const bank = (String(table.filters.failed ?? "") as BankFilter) || "";
    const setBank = (next: BankFilter) => table.setFilter("failed", next || undefined);

    const empty = useMemo(
        () => !table.loading && table.rows.length === 0,
        [table.loading, table.rows.length]
    );

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
                    <span className="ml-auto text-xs text-muted-foreground">
                        {table.total.toLocaleString()}{" "}
                        {table.total === 1 ? "transfer" : "transfers"}
                    </span>
                </div>

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
