// src/pages/outflow-import/components/ImportSummaryPanel.tsx

import { useMemo } from "react";
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
    SOURCE_OPTIONS,
    importOptionLabel,
    importsCoveredLabel,
    importsForSource,
    openImports,
    rematchReachLabel,
    rematchWarning,
    sourceSelectorValue,
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
    /**
     * The screen's source scope (slice CF/S2). The FUNNEL'S shape, a list — see `SOURCE_COLUMN_ID`
     * on why the multi-select shape is the stored one and the dropdown is the lossy editor.
     */
    sources: readonly string[];
    onSourcesChange: (values: string[]) => void;
    loading?: boolean;
    matching?: boolean;
    onConfirmAllMatched: () => void;
    onRunMatch: () => void;
    /** Open the Skipped dialog. Absent for a panel with nothing to open. */
    onShowSkipped?: () => void;
}

/** The selector's "no import chosen" option. A Radix `Select` cannot take `""` as an item value. */
const ALL_IMPORTS = "__all__";

/** The Source selector's "every source" option, for the same Radix reason. */
const ALL_SOURCES = "all";

/**
 * The Source selector's read-only state when the funnel holds more than one source.
 *
 * ⚠️ IT IS AN ITEM, NOT A PLACEHOLDER, BECAUSE A RADIX `Select` BOUND TO A VALUE IT CANNOT OFFER
 * RENDERS BLANK AND THEN OVERWRITES IT ON THE FIRST INTERACTION. That trapdoor is documented in
 * `frontend/CLAUDE.md` against the Rate Master type picker, which lost four `number_choice`
 * definitions to exactly this. Here the value being silently overwritten would be a filter over the
 * whole screen. Choosing it explicitly means "every source", which is the only thing widening from
 * a mixed selection can honestly mean.
 */
const MIXED_SOURCES = "mixed";

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
    sources,
    onSourcesChange,
    loading,
    matching,
    onConfirmAllMatched,
    onRunMatch,
    onShowSkipped,
}: Props) => {
    const totals = summary?.totals;
    const imports: SummaryImport[] = summary?.imports ?? [];
    const warning = rematchWarning(imports);
    // ⚠️ ONE SOURCE FOR THE COUNT, THE CAPTION AND THE DISABLED STATE (slice CF/S5). All three
    // answer "what will this button touch?", and `openImports` reads the server's own `is_open` —
    // the same flag `match_period` filters on — so the number shown and the set acted on cannot
    // drift apart.
    const openCount = openImports(imports).length;
    const reach = rematchReachLabel(imports);
    const pinned = Boolean(selectedImport);
    const sourceValue = sourceSelectorValue(sources);

    /**
     * What the Source trigger is BOUND to, which is not always what is stored.
     *
     * ⚠️ A PINNED IMPORT READS "All sources" BECAUSE THE SCOPE IS GENUINELY NOT APPLIED — see the
     * withhold in `useOutflowRows`. Rendering the stored value greyed would say "applied, just not
     * editable", which is the opposite of the truth and the exact mistake the period control's own
     * comment warns about.
     */
    const sourceTriggerValue = pinned
        ? ALL_SOURCES
        : sourceValue === "mixed"
          ? MIXED_SOURCES
          : sourceValue === "all"
            ? ALL_SOURCES
            : sourceValue;

    /**
     * ⚠️ THE OPTIONS ARE NARROWED, NOT THE SELECTION (owner ask). Choosing a source filters WHICH
     * statements are on offer here; it never silently changes which one is chosen. A pinned import
     * outside the current source keeps its place in the list for that reason — dropping it would
     * make the selector render a value it cannot offer, which is the trapdoor `MIXED_SOURCES`
     * exists to avoid, pointing at the wider control.
     */
    const offeredImports = useMemo(() => {
        const narrowed = importsForSource(importOptions, pinned ? undefined : sources);
        if (!selectedImport || narrowed.some((o) => o.name === selectedImport)) return narrowed;
        const chosen = importOptions.find((o) => o.name === selectedImport);
        return chosen ? [chosen, ...narrowed] : narrowed;
    }, [importOptions, sources, pinned, selectedImport]);

    return (
        <Card>
            <CardContent className="space-y-4 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                        {/* ⚠️ SOURCE COMES FIRST BECAUSE IT NARROWS WHAT THE NEXT CONTROL OFFERS
                            (slice CF/S2). Reading left to right: what KIND of transfer, then which
                            STATEMENT, then — where it still applies — which WINDOW inside it. A
                            source chosen after an import would be a control acting on a list that
                            had already been reduced to one.

                            ⚠️ DISABLED, NOT HIDDEN, WHILE AN IMPORT IS SELECTED — the same rule and
                            the same reasoning as the period beside it. A statement has ONE source,
                            so a scope left set could only empty the screen; and a control that
                            VANISHES leaves the reader unable to tell "no source scope applies" from
                            "one applies and I cannot see it". */}
                        <div className="flex items-center gap-2">
                            <span className="whitespace-nowrap text-sm font-medium">Source</span>
                            <Select
                                value={sourceTriggerValue}
                                disabled={pinned}
                                onValueChange={(next) =>
                                    onSourcesChange(
                                        next === ALL_SOURCES || next === MIXED_SOURCES ? [] : [next]
                                    )
                                }
                            >
                                <SelectTrigger className="h-8 w-[150px]">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {/* Named, not blank — the same reason the Import selector names
                                        its own catch-all. */}
                                    <SelectItem value={ALL_SOURCES}>All sources</SelectItem>
                                    {SOURCE_OPTIONS.map((option) => (
                                        <SelectItem key={option} value={option}>
                                            {option}
                                        </SelectItem>
                                    ))}
                                    {/* Only offered while it is the truth. Picking it again means
                                        "every source", which is what widening from a mixed funnel
                                        selection can honestly mean. */}
                                    {sourceValue === "mixed" && (
                                        <SelectItem value={MIXED_SOURCES}>
                                            Mixed (from the column filter)
                                        </SelectItem>
                                    )}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* ⚠️ THE IMPORT SELECTOR COMES NEXT, AND THE ORDER IS THE MEANING. It is
                            the WIDER of the remaining two controls: choosing a statement replaces
                            the period entirely rather than narrowing within it (owner ruling
                            2026-08-12), so reading left to right gives the scope and then, only
                            where it still applies, the window inside it. */}
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
                                    {offeredImports.map((option) => (
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

                    <div className="flex items-start gap-2">
                        {/* ⚠️ RE-RUNNING REACHES FURTHER THAN THE PERIOD, AND IT SAYS SO. Matching is
                            per BATCH — `match_batch`'s four global passes reason over a whole
                            import at once — so a batch that straddles the window is re-matched in
                            full. The tooltip names the batches and the overspill rather than
                            letting somebody discover it afterwards.

                            ⚠️ THE COUNT CAME OFF THE BUTTON AND BECAME THE CAPTION BELOW IT (owner
                            ruling, slice CF/S5), AND THAT CAPTION IS NOW LOAD-BEARING. Two things
                            used to state this action's reach: this count, and the filename list at
                            the foot of the card. The list moved behind the History icon in the same
                            change, so `rematchReachLabel` is the ONLY pre-click statement of scope
                            left on the screen. It counts OPEN imports, because `match_period` skips
                            the finished ones.

                            ⚠️ DISABLED WHEN NOTHING IN VIEW IS STILL OPEN. Every transfer settled or
                            skipped means there is nothing left to match, so the button would run,
                            report success, and have done nothing. */}
                        <div className="flex flex-col items-end gap-1">
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        {/* A disabled button swallows pointer events, so the
                                            tooltip would disappear exactly when it has the most to
                                            explain. The wrapper keeps it reachable. */}
                                        <span tabIndex={0}>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                disabled={!openCount || matching}
                                                onClick={onRunMatch}
                                            >
                                                {matching ? (
                                                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                                ) : (
                                                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                                                )}
                                                Re-run match
                                            </Button>
                                        </span>
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-xs">{warning}</TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                            {reach && (
                                <span className="whitespace-nowrap text-[11px] text-muted-foreground">
                                    {reach}
                                </span>
                            )}
                        </div>
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
                            {/* ⚠️ THE SUB-LINE SAYS HOW MANY THE MATCHER FOUND (slice Q1), and
                                until then nothing on this screen could answer it: every settlement
                                record was stamped "Manual", so the money record claimed a person
                                had found all of them when the machine had found 99%.

                                It reports the AUTO half and lets the reader subtract, rather than
                                printing both -- two numbers that must sum to `settled_rows` are two
                                chances to disagree with it. Silent when nothing is settled, and
                                when the count is absent (an older payload), so the tile degrades to
                                exactly what it said before rather than reading "0 from a
                                suggestion" on data that simply predates the field. */}
                            <Figure
                                label="Settled"
                                value={formatToRoundedIndianRupee(totals.settled_value)}
                                sub={
                                    totals.settled_rows > 0 &&
                                    totals.settled_from_suggestion != null
                                        ? `${totals.settled_rows} recorded · ${totals.settled_from_suggestion} auto-matched`
                                        : `${totals.settled_rows} recorded`
                                }
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

                        {/* ⚠️ THE FILENAME LIST MOVED TO THE HISTORY DIALOG (owner ruling, slice
                            CF/S4), AND ITS REAL JOB DID NOT MOVE WITH IT. That line listed the
                            statements in scope with their row counts, and it was not a caption: it
                            named the set "Re-run match" acts on, IN FULL, including each batch's
                            transfers outside the period. Behind an icon, that is no longer a
                            pre-click statement of scope.

                            So the job was handed to the caption under the Re-run button, which
                            states the same fact in the place the action is. If BOTH ever go, the
                            overspill becomes something a reviewer discovers afterwards -- which is
                            what the P1 ruling was written to prevent. `summary.imports` is still
                            read: `rematchWarning` and that caption are built from it. */}

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
