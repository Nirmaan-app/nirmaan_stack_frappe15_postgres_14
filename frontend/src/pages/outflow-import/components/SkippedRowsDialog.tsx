// src/pages/outflow-import/components/SkippedRowsDialog.tsx

import { useCallback, useMemo, useState } from "react";
import { Loader2, RotateCcw, Search, X } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUserData } from "@/hooks/useUserData";
import type { OutflowImportRow } from "@/types/NirmaanStack/OutflowImportBatch";
import { exportToCsv } from "@/utils/exportToCsv";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import { ExportButton } from "./ExportButton";
import {
    ClearFiltersButton,
    OutflowRowsTable,
    TablePagination,
    type TableActionColumn,
} from "./OutflowRowsTable";
import { useOutflowRows } from "../useOutflowRows";
import { canUndoOutflow } from "../outflowImportStatus";
import { unskipBlockReason, unskipNotice, type UnskipNotice, type UnskipResult } from "../unskipView";
import { exportFileBase, toExportColumns } from "../outflowExport";
import {
    OUTFLOW_COLUMNS,
    SKIPPED_BY_HAND_FILTER,
    SKIPPED_BY_HAND_LABEL,
    SKIPPED_ON_PURPOSE_LABEL,
    SKIPPED_ON_PURPOSE_PHRASE,
    describeFrappeError,
} from "../outflowTableModel";

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
    /** `get_outflow_summary.skipped_by_hand_rows` -- the count the "Skipped by hand" filter returns. */
    skippedByHandRows?: number;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /**
     * Called after an Unskip succeeds (#1274), so the page behind refreshes its worklist and its
     * counts -- the line is back in the worklist, and the Skipped chip is one lower.
     */
    onChanged?: () => Promise<void> | void;
}

/**
 * Which slice of `Skipped` is on screen. `""` is all of it. `manual` (#1273) is a subset of `recorded`
 * -- the lines a person skipped -- offered as its own segment so they can be found fast.
 */
type BankFilter = "" | "recorded" | "failed" | typeof SKIPPED_BY_HAND_FILTER;

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
 * ⚠️ NOTHING HERE IS SELECTABLE. `Skipped` is terminal, so `OutflowRowsTable` renders no Outcome
 * action for it, and passing an empty `selectableRowNames` removes the checkbox column entirely
 * (`selectable = names.length > 0`).
 *
 * ⚠️ THE ONE ACTION IS UNSKIP, ONE LINE AT A TIME, FOR ADMIN AND ACCOUNTANT LEAD (#1274, ADR-0022). It
 * rides the table's `actionColumn`, live only for a hand skip (`unskipBlockReason`); every other line
 * shows the button disabled with its reason in words. "Skips are final" still holds for system skips.
 *
 * ⚠️ THE REASON IS IN THE OUTCOME COLUMN, NOT IN `skip_reason`. 20 of the 47 skipped rows on the
 * first real statement carry no `skip_reason` at all -- the already-Paid duplicates record it as
 * "Already recorded as Paid on Project Payment PAY-…" in the note, exactly as the Mismatched causes do. The table's
 * terminal cell already falls back `outcome_note || skip_reason`, which is why this dialog needs no
 * column of its own.
 */
export const SkippedRowsDialog = ({
    batch,
    skippedRows,
    failedRows,
    skippedByHandRows,
    open,
    onOpenChange,
    onChanged,
}: Props) => {
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

    // --- Unskip (#1274, mockup scenes 5 and 6) -------------------------------------------------------
    // ⚠️ THE COLUMN IS FOR THE UNDO ROLES ONLY. A plain Accountant sees the popup as before; hiding it is
    // convenience, and `review.unskip_row` refuses them anyway.
    const { role, user_id } = useUserData();
    const canUnskip = canUndoOutflow(role, user_id);
    const [unskipping, setUnskipping] = useState<OutflowImportRow | null>(null);
    const [notice, setNotice] = useState<UnskipNotice | null>(null);

    // ⚠️ MEMOIZED: every memoized table row receives this object (see `TableActionColumn`).
    const actionColumn = useMemo<TableActionColumn | undefined>(
        () =>
            canUnskip
                ? {
                      title: "Unskip",
                      render: (row) => (
                          <UnskipCell
                              row={row}
                              onUnskip={(target) => {
                                  setNotice(null);
                                  setUnskipping(target);
                              }}
                          />
                      ),
                  }
                : undefined,
        [canUnskip]
    );

    const mutateRows = table.mutate;
    const { call: callUnskip } = useFrappePostCall<{ message: UnskipResult }>(
        "nirmaan_stack.api.outflow_import.review.unskip_row"
    );
    const handleUnskip = useCallback(
        async (row: OutflowImportRow, reason: string) => {
            const response = await callUnskip({ row: row.name, reason });
            setUnskipping(null);
            // Built from the server's re-check, never from what was clicked (`unskipNotice`).
            setNotice(unskipNotice(response.message));
            // ⚠️ NOT AWAITED. The unskip has committed; a failed refresh must not reach the confirm's
            // catch and read as "The transfer was not unskipped."
            void Promise.resolve(mutateRows()).catch(() => undefined);
            void Promise.resolve(onChanged?.()).catch(() => undefined);
        },
        [callUnskip, mutateRows, onChanged]
    );

    // ⚠️ THE NOTICE BELONGS TO ONE VISIT. This dialog stays mounted for the whole session, so without
    // this a closed-and-reopened popup still said "Unskipped…" about a line from minutes ago -- on a
    // different source, even (found on the #1274 browser walk).
    const handleOpenChange = useCallback(
        (next: boolean) => {
            if (!next) {
                setNotice(null);
                setUnskipping(null);
            }
            onOpenChange(next);
        },
        [onOpenChange]
    );

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
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
                                were {SKIPPED_ON_PURPOSE_PHRASE} (the Outcome column says why) and{" "}
                                <strong className="font-medium text-foreground">
                                    {failedRows}
                                </strong>{" "}
                                were refused by the bank. The summary&rsquo;s Skipped figure counts
                                only the first {skippedRows} — money the bank never moved is left out
                                of every figure up there.
                            </>
                        )}
                        {canUnskip && (
                            <>
                                {" "}
                                Transfers skipped by hand can be unskipped. Transfers skipped by the
                                system stay skipped, and each one says why.
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
                                ["recorded", SKIPPED_ON_PURPOSE_LABEL, skippedRows],
                                ["failed", "Bank refused", failedRows],
                                [SKIPPED_BY_HAND_FILTER, SKIPPED_BY_HAND_LABEL, skippedByHandRows],
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

                {notice && (
                    <div
                        role="status"
                        className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${
                            notice.tone === "warn"
                                ? "border-amber-200 bg-amber-50 text-amber-900"
                                : "border-emerald-200 bg-emerald-50 text-emerald-900"
                        }`}
                    >
                        <span className="flex-1">
                            <strong className="font-semibold">{notice.title}</strong> {notice.body}
                        </span>
                        <button
                            type="button"
                            aria-label="Dismiss"
                            className="opacity-70 hover:opacity-100"
                            onClick={() => setNotice(null)}
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    </div>
                )}

                {unskipping && (
                    <UnskipConfirm
                        row={unskipping}
                        onCancel={() => setUnskipping(null)}
                        onConfirm={handleUnskip}
                    />
                )}

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
                            actionColumn={actionColumn}
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

/**
 * A live Unskip for a hand skip; for every other line a disabled button with the reason IN WORDS beside
 * it, never only in a tooltip, so it reads on any device (story 63).
 */
const UnskipCell = ({
    row,
    onUnskip,
}: {
    row: OutflowImportRow;
    onUnskip: (row: OutflowImportRow) => void;
}) => {
    const blocked = unskipBlockReason(row);
    return (
        <div className="flex w-[180px] flex-col items-start gap-1">
            <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={blocked !== null}
                onClick={() => onUnskip(row)}
            >
                <RotateCcw className="mr-1 h-3.5 w-3.5" />
                Unskip
            </Button>
            {blocked && <span className="text-[11px] leading-snug text-muted-foreground">{blocked}</span>}
        </div>
    );
};

/**
 * The small confirm an Unskip opens: a required reason, then the re-check.
 *
 * ⚠️ THE SERVER'S REFUSAL IS SHOWN HERE, not left to an unhandled rejection -- someone may have unskipped
 * the line a moment ago, or a role was changed. The confirm closes only on success.
 */
const UnskipConfirm = ({
    row,
    onCancel,
    onConfirm,
}: {
    row: OutflowImportRow;
    onCancel: () => void;
    onConfirm: (row: OutflowImportRow, reason: string) => Promise<void>;
}) => {
    const [reason, setReason] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const trimmed = reason.trim();

    const submit = async () => {
        setBusy(true);
        setError(null);
        try {
            await onConfirm(row, trimmed);
        } catch (err) {
            setError(describeFrappeError(err, "The transfer was not unskipped."));
            setBusy(false);
        }
    };

    return (
        <Dialog open onOpenChange={(next) => !next && !busy && onCancel()}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Unskip this transfer?</DialogTitle>
                    <DialogDescription>
                        {formatToRoundedIndianRupee(row.amount)}
                        {row.beneficiary_name ? ` to ${row.beneficiary_name}` : ""} goes back to matching
                        and is checked again straight away. If its money has been recorded since, it is
                        skipped again with that reason.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-1.5">
                    <Label htmlFor="unskip-transfer-reason" className="text-xs">
                        Reason (required)
                    </Label>
                    <Input
                        id="unskip-transfer-reason"
                        value={reason}
                        autoFocus
                        placeholder="Why should this transfer come back?"
                        onChange={(e) => {
                            setReason(e.target.value);
                            setError(null);
                        }}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && trimmed && !busy) submit();
                        }}
                    />
                    {error && <p className="text-xs text-destructive">{error}</p>}
                </div>
                <div className="flex justify-end gap-2">
                    <Button variant="outline" disabled={busy} onClick={onCancel}>
                        Cancel
                    </Button>
                    <Button disabled={!trimmed || busy} onClick={submit}>
                        {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                        Unskip
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};
