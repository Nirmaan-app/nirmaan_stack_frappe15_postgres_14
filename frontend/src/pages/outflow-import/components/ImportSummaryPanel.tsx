// src/pages/outflow-import/components/ImportSummaryPanel.tsx

import { CheckCircle2, Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import type { DateFilterValue } from "@/components/data-table/date-filter-popover";
import type {
    OutflowImportOption,
    OutflowImportSummary,
} from "@/types/NirmaanStack/OutflowImportBatch";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import {
    importOptionLabel,
    importsCoveredLabel,
    rematchWarning,
    summaryTiles,
    type SummaryImport,
    type SummaryTile,
} from "../outflowTableModel";
import { OutflowPeriodFilter } from "./OutflowPeriodFilter";

interface Props {
    summary?: OutflowImportSummary;
    period: DateFilterValue | null;
    onPeriodChange: (value: DateFilterValue | undefined | null) => void;
    /** Every import, for the selector. Newest first — `list_imports` is ordered for it. */
    imports: OutflowImportOption[];
    /**
     * The selected import, or `undefined` for ALL of them.
     *
     * ⚠️ EMPTY IS THE DEFAULT AND MEANS "EVERY IMPORT", not "none chosen yet" (owner, 2026-08-12).
     * The screen is system-wide by default and narrows to one statement only when asked — the
     * reverse of the pre-P1 shape, where one import was the only thing the panel could describe.
     */
    selectedImport?: string;
    onSelectImport: (batch?: string) => void;
    loading?: boolean;
    matching?: boolean;
    onConfirmAllMatched: () => void;
    onRunMatch: () => void;
    /** Open the Skipped dialog. Absent for a panel with nothing to open. */
    onShowSkipped?: () => void;
}

/** The selector's "no import chosen" option. A Radix `Select` cannot take `""` as an item value. */
const ALL_IMPORTS = "__all__";

/**
 * The summary of every transfer in the current PERIOD, above the master table (X2 + X3, P1).
 *
 * ⚠️ THE SCOPE REVERSED AT P1, AND THE OLD SHAPE IS WORTH STATING SO THE CHANGE IS LEGIBLE. This
 * panel used to summarise ONE import chosen from a picker, while the table beneath it spanned every
 * import — and the domain doc recorded that mismatch as the DESIGN (owner ruling 2026-08-10): "how
 * did that statement go?" and "what do I still owe a decision on?" are different questions. The
 * owner reversed it on 2026-08-12. The panel and the table now describe the SAME population, and a
 * period selector scopes both at once.
 *
 * ⚠️ THE OTHER HALF OF THE 2026-08-10 RULING STILL STANDS AND IS DELIBERATELY KEPT. That ruling had
 * two objections. The first was a POPULATION mismatch, which this change dissolves rather than
 * overrides — there is only one population now. The second was that clicking a figure MOVED THE TAB
 * as a side effect, so reading a number navigated away from the work in progress. That is still
 * true and still forbidden: the status figures REPORT, `SummaryTile.statuses` and `tabForStatus`
 * stay deleted, and changing the period never changes the tab.
 *
 * ⚠️ EVERY NUMBER COMES FROM THE SERVER (`get_outflow_summary`), under the SAME `_row_filters` the
 * table's own query and its tab counts run. Nothing here counts anything. `status.py` is the only
 * deriver in this feature, and a panel that added up its own rows could disagree with the table
 * directly beneath it — which is worse than showing no panel at all, and is exactly what the
 * reversed ruling was protecting against.
 */
export const ImportSummaryPanel = ({
    summary,
    period,
    onPeriodChange,
    imports: importOptions,
    selectedImport,
    onSelectImport,
    loading,
    matching,
    onConfirmAllMatched,
    onRunMatch,
    onShowSkipped,
}: Props) => {
    const totals = summary?.totals;
    const imports: SummaryImport[] = summary?.imports ?? [];
    const warning = rematchWarning(imports);
    const pinned = Boolean(selectedImport);

    return (
        <Card>
            <CardContent className="space-y-4 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                        {/* ⚠️ THE IMPORT SELECTOR COMES FIRST, AND THE ORDER IS THE MEANING. It is
                            the WIDER of the two controls: choosing a statement replaces the period
                            entirely rather than narrowing within it (owner ruling 2026-08-12), so
                            reading left to right gives the scope and then, only where it still
                            applies, the window inside it. */}
                        <div className="flex items-center gap-2">
                            <span className="whitespace-nowrap text-sm font-medium">Import</span>
                            <Select
                                value={selectedImport ?? ALL_IMPORTS}
                                onValueChange={(next) =>
                                    onSelectImport(next === ALL_IMPORTS ? undefined : next)
                                }
                            >
                                <SelectTrigger className="h-8 w-[300px] max-w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {/* ⚠️ NAMED, NOT BLANK. An empty row reads as "nothing chosen
                                        yet" — a state this screen does not have — where the truth is
                                        that every import is in view. */}
                                    <SelectItem value={ALL_IMPORTS}>All imports</SelectItem>
                                    {importOptions.map((option) => (
                                        <SelectItem key={option.name} value={option.name}>
                                            {importOptionLabel(option)}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* ⚠️ DISABLED, NOT HIDDEN, WHILE AN IMPORT IS SELECTED (owner ruling
                            2026-08-12: the period is IGNORED then, not ANDed). A control that
                            vanishes leaves the reader wondering whether a period is still secretly
                            applied — which is exactly the invisible-filter defect the deep link
                            shipped with this morning. Greyed and captioned, it says plainly that the
                            whole statement is in view and why the window is not in play. */}
                        <OutflowPeriodFilter
                            value={period}
                            onChange={onPeriodChange}
                            disabled={pinned}
                            caption={
                                pinned ? "whole statement" : importsCoveredLabel(imports)
                            }
                        />
                        {loading && (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        {/* ⚠️ RE-RUNNING REACHES FURTHER THAN THE PERIOD, AND IT SAYS SO. Matching is
                            per BATCH — `match_batch`'s four global passes reason over a whole
                            import at once — so a batch that straddles the window is re-matched in
                            full. The tooltip names the batches and the overspill rather than
                            letting somebody discover it afterwards. */}
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        disabled={!imports.length || matching}
                                        onClick={onRunMatch}
                                    >
                                        {matching ? (
                                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                        ) : (
                                            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                                        )}
                                        Re-run match
                                        {imports.length > 1 ? ` (${imports.length} imports)` : ""}
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs">{warning}</TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                        {/* ⚠️ "CONFIRM", NEVER "APPROVE" (owner ruling 2026-08-09). This feature
                            never approves anything -- it records that already-approved money left
                            the bank. A button here saying Approve would tell an accountant they are
                            approving payments, which is false. */}
                        <Button
                            size="sm"
                            disabled={!totals?.confirmable_rows}
                            onClick={onConfirmAllMatched}
                        >
                            <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                            Confirm {totals?.confirmable_rows ?? 0} matched
                        </Button>
                    </div>
                </div>

                {summary && totals && (
                    <>
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            {/* The sub-label says "successful" only when some transfer was not,
                                so the word earns its place instead of being noise on the ~95% of
                                imports where the bank moved everything. */}
                            <Figure
                                label="Total outflow"
                                value={formatToRoundedIndianRupee(totals.total_value)}
                                sub={`${totals.total_rows} ${
                                    totals.failed_rows > 0 ? "successful " : ""
                                }transfer${totals.total_rows === 1 ? "" : "s"}`}
                            />
                            <Figure
                                label="Settled"
                                value={formatToRoundedIndianRupee(totals.settled_value)}
                                sub={`${totals.settled_rows} recorded`}
                                tone="emerald"
                            />
                            {/* ⚠️ THE ONE FIGURE THAT SAYS WHETHER THE WORK IS FINISHED. Counts
                                tell you how much is left to click; this tells you how much money is
                                still unaccounted for, which is the question being asked. */}
                            <Figure
                                label="Still open"
                                value={formatToRoundedIndianRupee(totals.open_value)}
                                sub={`${totals.open_rows} undecided`}
                                tone={totals.open_rows ? "amber" : undefined}
                            />
                            <Figure
                                label="Decided"
                                value={`${totals.decided_percent}%`}
                                sub={`${totals.decided_rows} of ${totals.total_rows}`}
                            />
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            {summaryTiles(totals).map((tile) => (
                                <StatusChip
                                    key={tile.id}
                                    tile={tile}
                                    // ⚠️ ONE CHIP OPENS SOMETHING, AND ONLY ONE. The figures are
                                    // read-only because clicking one used to move the tab as a side
                                    // effect -- the surviving half of the 2026-08-10 ruling. This is
                                    // not that: Skipped rows have no tab at all, so the chip is the
                                    // only route to them, and it opens a DIALOG rather than
                                    // rewriting the filters behind it.
                                    onOpen={
                                        tile.id === "skipped" && tile.count > 0
                                            ? onShowSkipped
                                            : undefined
                                    }
                                />
                            ))}
                        </div>

                        {/* ⚠️ THE IMPORTS ARE LISTED, NOT SUMMED (slice P1). The panel used to name
                            one statement -- its file, its uploader, its declared period -- because
                            it described exactly one. A period can span several, and which ones is a
                            real question: it is the set "Re-run match" acts on, in full.

                            ⚠️ DERIVED FROM THE ROWS, NEVER FROM `period_from`/`period_to` ON THE
                            BATCH. Three different "periods" exist in this schema and they do not
                            coincide; the server reads these back off the same rows it counted, so
                            this line and the figures above it cannot disagree. */}
                        {!pinned && imports.length > 0 && (
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                {imports.slice(0, 4).map((batch) => (
                                    <span key={batch.name}>
                                        {batch.original_filename || batch.name}
                                        <span className="text-muted-foreground/70">
                                            {" "}
                                            · {batch.row_count}
                                            {batch.total_rows > batch.row_count
                                                ? ` of ${batch.total_rows}`
                                                : ""}
                                        </span>
                                    </span>
                                ))}
                                {imports.length > 4 && <span>+{imports.length - 4} more</span>}
                            </div>
                        )}

                        {pinned && summary.import && (
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                <span>
                                    Period{" "}
                                    {summary.import.period_from
                                        ? formatDate(summary.import.period_from)
                                        : "—"}{" "}
                                    –{" "}
                                    {summary.import.period_to
                                        ? formatDate(summary.import.period_to)
                                        : "—"}
                                </span>
                                <span>
                                    Uploaded{" "}
                                    {summary.import.uploaded_at
                                        ? formatDate(summary.import.uploaded_at.split(/[ T]/)[0])
                                        : "—"}{" "}
                                    by {summary.import.uploaded_by || "—"}
                                </span>
                            </div>
                        )}
                    </>
                )}

                {!summary && !loading && (
                    <p className="text-sm text-muted-foreground">
                        No imports yet. Upload a bank statement to get started.
                    </p>
                )}

                {/* ⚠️ AN EMPTY PERIOD IS NOT AN EMPTY SYSTEM, and saying so is the difference between
                    "narrow your period" and "this feature is broken". The old copy above fires only
                    when the server returned nothing at all. */}
                {summary && totals && totals.total_rows === 0 && !imports.length && (
                    <p className="text-sm text-muted-foreground">
                        No transfers in this period. Widen it, or pick <strong>All time</strong>.
                    </p>
                )}
            </CardContent>
        </Card>
    );
};

const Figure = ({
    label,
    value,
    sub,
    tone,
}: {
    label: string;
    value: string;
    sub: string;
    tone?: "emerald" | "amber";
}) => (
    <div
        className={`rounded-md border p-3 ${
            tone === "emerald"
                ? "border-emerald-200 bg-emerald-50/50"
                : tone === "amber"
                  ? "border-amber-200 bg-amber-50/50"
                  : ""
        }`}
    >
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
        <div className="text-xs text-muted-foreground">{sub}</div>
    </div>
);

/**
 * A figure. See the panel docstring for why these are not filters.
 *
 * ⚠️ `onOpen` IS NOT A RETURN OF THE OLD CLICK. That one re-scoped the table below to the chip's
 * status and moved the tab while it did. This opens a dialog and changes nothing behind it. A chip
 * without `onOpen` renders exactly as it always has, as a `<span>`, so the read-only ones cannot
 * acquire a focus ring or a pointer cursor by accident.
 */
const StatusChip = ({ tile, onOpen }: { tile: SummaryTile; onOpen?: () => void }) => {
    const className = `flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${tile.tone}`;
    // The split behind a count that is not simply its own status figure. See `summaryTiles`.
    const title = tile.hint;
    const body = (
        <>
            <span className="font-medium tabular-nums">{tile.count}</span>
            <span>{tile.label}</span>
        </>
    );
    if (!onOpen)
        return (
            <span className={className} title={title}>
                {body}
            </span>
        );
    return (
        <button
            type="button"
            onClick={onOpen}
            title={title ? `${title} — click to see them` : "Show the skipped transfers"}
            className={`${className} underline-offset-2 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
        >
            {body}
        </button>
    );
};
