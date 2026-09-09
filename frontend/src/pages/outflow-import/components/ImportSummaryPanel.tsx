// src/pages/outflow-import/components/ImportSummaryPanel.tsx

import { useMemo, type ReactNode } from "react";
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
    importsCoveredLabel,
    importsForSource,
    openImports,
    rematchReachLabel,
    rematchWarning,
    sourceSelectorValue,
    summaryTiles,
    type SettledLedgerSplit,
    type SummaryImport,
    type SummaryTile,
} from "../outflowTableModel";
import {
    SETTLED_BLOCK_PAID,
    SETTLED_BLOCK_RECEIVED,
    settledBlockLabel,
    settledBlockSubLine,
    settledDirectionBlocks,
} from "../settledDirectionBlocks";
import { ImportSelect } from "./ImportSelect";
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

/**
 * The Source selector's "every source" option.
 *
 * A Radix `Select` cannot take `""` as an item value. (The Import selector carried the same
 * sentinel until it became a `Command` combobox; its own copy, and the reason it is NAMED rather
 * than blank, moved into `ImportSelect` with it.)
 */
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
 * How many columns the figure row gets, keyed by how many tiles are in it.
 *
 * ⚠️ THE CLASS STRINGS ARE LITERAL SO TAILWIND EMITS THEM ALL. An interpolated `lg:grid-cols-${n}`
 * is invisible to the scanner and ships as no class at all, which is why the four-vs-five choice
 * this replaces was already written out longhand.
 *
 * ⚠️ COUNTING THE TILES IS A LAYOUT FACT, NOT A FIGURE. Nothing here adds up rows or money — see
 * the panel docstring on why a panel that totalled its own numbers would be worse than no panel.
 */
const TILE_COLUMNS: Record<number, string> = {
    3: "lg:grid-cols-3",
    4: "lg:grid-cols-4",
    5: "lg:grid-cols-5",
    6: "lg:grid-cols-6",
};

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
     * The settled money, as the server split it: one block per direction (slice B8b).
     *
     * ⚠️ READ STRAIGHT OFF THE PAYLOAD, NEVER DERIVED HERE. Which side a settled row belongs to is
     * a fact about the ROW's `direction`, which the client never sees — and it could not be guessed
     * from the ledger even if it did, because a non-project RECEIPT is stored as a NEGATIVE
     * `Non Project Expense` and so appears in both blocks.
     */
    const settledBlocks = settledDirectionBlocks(summary?.settled_by_direction);

    /**
     * The statement total, cut by direction — the server's four figures, or NOTHING (slice B8c).
     *
     * ⚠️ ALL FOUR KEYS ARE OPTIONAL, AND ABSENT MEANS THE OLD SINGLE TILE, NEVER A CONFIDENT ZERO.
     * A client running against a server that predates the cut would otherwise render "Total paid
     * out ₹0" over a statement that moved crores — the same call `settledDirectionBlocks` and
     * `settled_from_suggestion` already make one level down.
     *
     * ⚠️ TESTED FOR `undefined`, NEVER FOR FALSINESS. A real 0 is an answer — a period that
     * received nothing — and must render as ₹0; an unsent key is not, and must fall back. `!x`
     * cannot tell the two apart, and the type declaring these says so in as many words.
     *
     * ⚠️ IT IS A PASS-THROUGH, NOT A DERIVATION. The four figures are read as sent; the panel never
     * subtracts one from the total to obtain the other. They partition `total_rows` / `total_value`
     * exactly, which is the server's guarantee and pinned on its side.
     */
    const directionSplit =
        totals &&
        totals.paid_rows !== undefined &&
        totals.paid_value !== undefined &&
        totals.received_rows !== undefined &&
        totals.received_value !== undefined
            ? {
                  paidRows: totals.paid_rows,
                  paidValue: totals.paid_value,
                  receivedRows: totals.received_rows,
                  receivedValue: totals.received_value,
              }
            : undefined;

    /**
     * ⚠️ RECEIVED RENDERS ONLY WHEN IT HOLDS ROWS, AND IT IS APPENDED SO PAID NEVER MOVES — the
     * same rule, for the same reason, as the settled blocks below (`derive_settled_direction_blocks`
     * decides it there; here the count does). Cashfree and Cashbook are single-direction sources, so
     * a zero-filled Received tile would sit on every gateway import forever claiming receipts were
     * possible where none can occur.
     */
    const showReceived = Boolean(directionSplit && directionSplit.receivedRows > 0);

    /**
     * How many tiles the figure row holds: the paid (or fallback) tile, the received tile where it
     * applies, the server's settled blocks, then Still open. Clamped because the block list is the
     * server's and an unrecognised direction is rendered rather than dropped.
     *
     * ⚠️ THE TRAILING TERM IS `+ 1`, NOT `+ 2` — Decided was REMOVED (owner ruling 2026-09-09, for
     * a cleaner panel) and this count moved with it. A stale `+ 2` would not error; it would ask
     * for one more column than there are tiles and stretch the row, which is exactly the kind of
     * drift a literal-arithmetic tile count invites.
     */
    const tileColumns =
        TILE_COLUMNS[Math.min(Math.max(1 + (showReceived ? 1 : 0) + settledBlocks.length + 1, 3), 6)];

    /**
     * What is STILL OPEN, cut by direction — the third figure each band needs, and the only one the
     * server did not already send (slice D12).
     *
     * ⚠️ FOUR MORE OPTIONAL KEYS, CHECKED FOR `undefined` AND NEVER FOR FALSINESS, exactly as
     * `directionSplit` above. A real 0 is an answer — that side has nothing left undecided — and
     * must render as ₹0; an unsent key is not, and falls back to the flat row. `!x` cannot tell the
     * two apart.
     *
     * ⚠️ A PASS-THROUGH, LIKE EVERY OTHER FIGURE HERE. The panel never subtracts one half from
     * `open_value` to obtain the other; `status.py` guarantees they partition it, and pins that on
     * every input.
     */
    const openSplit =
        totals &&
        totals.open_paid_rows !== undefined &&
        totals.open_paid_value !== undefined &&
        totals.open_received_rows !== undefined &&
        totals.open_received_value !== undefined
            ? {
                  paidRows: totals.open_paid_rows,
                  paidValue: totals.open_paid_value,
                  receivedRows: totals.open_received_rows,
                  receivedValue: totals.open_received_value,
              }
            : undefined;

    /**
     * ⚠️ THE BANDS APPEAR ONLY WHEN BOTH DIRECTIONS HOLD ROWS. WITH ONE DIRECTION THE PANEL RENDERS
     * TODAY'S FLAT ROW, UNCHANGED (owner ruling). Every import staged to date is debit-only, so
     * this is the COMMON case and not an edge case: a `PAID OUT` heading over the only band is
     * noise, and a heading implies a sibling section the reader then goes looking for.
     *
     * ⚠️ IT ALSO FALLS BACK WHEN THE SERVER CANNOT FILL A BAND. Three ways that happens, and each
     * one would otherwise put a card on screen the payload does not support:
     *
     *   * the four `open_*` keys are absent (an older server) — no Still open figure per side;
     *   * `settled_by_direction` is absent (an older server still) — `settledBlocks` is then `[]`,
     *     which means "we do not know", NOT "nothing settled", and a band would have to say which;
     *   * a settled block names a direction this screen does not know. `settledBlockLabel` renders
     *     such a block VERBATIM in the flat row rather than guessing; a band layout looks blocks up
     *     BY NAME, so an unknown one would be silently dropped. Falling back keeps it visible.
     */
    const bandsApply = Boolean(
        directionSplit &&
            openSplit &&
            directionSplit.paidRows > 0 &&
            directionSplit.receivedRows > 0 &&
            settledBlocks.length > 0 &&
            settledBlocks.every(
                (block) =>
                    block.direction === SETTLED_BLOCK_PAID ||
                    block.direction === SETTLED_BLOCK_RECEIVED
            )
    );

    /**
     * A band's Settled card: the server's block for that direction, rendered exactly as the flat
     * row renders it — same value, same sub-line, same tone, and the SAME `breakdown` ledger lines.
     *
     * ⚠️ IT READS `settled_by_direction` AND NEVER RE-DERIVES THE FIGURE FROM THE TALLIES. That
     * block is computed by a different query over the same rows and carries the per-ledger lines
     * this card renders; a second settled-per-direction figure would be two keys totalling the same
     * money, which is two chances to disagree about it. The band still adds up — checked live,
     * whole-system and per import: paid `3,798,616.00 + 5,853,190.00 = 9,651,806.00`, received
     * `0 + 4,268,880.20 = 4,268,880.20`.
     *
     * ⚠️ A MISSING BLOCK RENDERS AN ABSENCE, NEVER A CONFIDENT `₹0`. The server suppresses a
     * direction's block when it holds no rows, so on the one live import with receipts the Received
     * band has a Total and a Still open and no settled block at all. The panel MUST NOT COUNT, so
     * it does not manufacture the zero — it says plainly that nothing has been settled on that side,
     * and Total equalling Still open is the reader's own proof of it.
     */
    const settledFigureFor = (direction: string): ReactNode => {
        const block = settledBlocks.find((entry) => entry.direction === direction);
        if (!block) return <Figure label="Settled" value="—" sub="nothing settled yet" />;
        return (
            <Figure
                label="Settled"
                value={formatToRoundedIndianRupee(block.value)}
                sub={settledBlockSubLine(block, {
                    fromSuggestion: totals?.settled_from_suggestion,
                    describesEverySettledRow: settledBlocks.length === 1,
                })}
                tone={block.direction === SETTLED_BLOCK_RECEIVED ? "sky" : "emerald"}
                breakdown={block.ledgers}
            />
        );
    };

    /**
     * ⚠️ THE `Decided` TILE IS GONE (owner ruling 2026-09-09, for a cleaner panel), and this note
     * stands in its place so it is not re-added as an obvious omission.
     *
     * It rendered `decided_percent` over `decided_rows of total_rows settled` — a ratio across the
     * WHOLE statement, so it belonged to neither band and was built once and shared by both
     * layouts. Nothing replaced it: the same fact is legible from the tiles that remain, since
     * Settled and Still open are the two halves of that ratio and sit side by side.
     *
     * ⚠️ `decided_rows` / `decided_percent` ARE STILL DERIVED AND STILL ON THE WIRE, deliberately.
     * They carry their own load-bearing rule in `status.derive_import_summary` — Skipped rows leave
     * `total_rows`, so `decided_rows` is SETTLED ONLY or the percentage could exceed 100 — and that
     * rule is worth keeping proven whether or not a tile shows it. A screen dropping a figure is
     * not a reason to stop computing it; deleting the keys would take their tests with them.
     */

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
                            where it still applies, the window inside it.

                            ⚠️ IT IS A SEARCHABLE COMBOBOX, NOT A `Select`, AND IT IS NOT DISABLED
                            WHILE AN IMPORT IS PINNED — unlike the two controls either side of it.
                            Both facts live in `ImportSelect`, with the reasoning. */}
                        <div className="flex items-center gap-2">
                            <span className="whitespace-nowrap text-sm font-medium">Import</span>
                            <ImportSelect
                                options={offeredImports}
                                value={selectedImport}
                                onChange={onSelectImport}
                            />
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
                        {/* ⚠️ TWO LABELLED BANDS WHEN BOTH DIRECTIONS HOLD ROWS, AND TODAY'S FLAT
                            ROW OTHERWISE (owner ruling). Each band holds the same three figures
                            over ONE direction — Total, Settled, Still open — and they reconcile:
                            the Total is the whole statement on that side, the Settled card is the
                            server's own block for it, and Still open is the rest. Three figures per
                            band and nothing shared beneath them since Decided was removed (owner
                            ruling 2026-09-09).

                            ⚠️ THE SINGLE-DIRECTION FALLBACK IS THE COMMON CASE, NOT AN EDGE CASE.
                            Every import staged to date is debit-only, so a `PAID OUT` heading would
                            sit alone over the only band on almost every statement — noise that
                            implies a second section the reader then goes hunting for. See
                            `bandsApply` for the three further ways the payload can fail to support
                            a band, each of which falls back here too. */}
                        {bandsApply && directionSplit && openSplit ? (
                            <>
                                <DirectionBand heading="Paid out">
                                    {/* ⚠️ UNTONED, DELIBERATELY, and it is the same call the flat
                                        row's own "Total paid out" tile makes. Emerald means SETTLED
                                        on this panel — the card immediately to its right — and this
                                        one spans every row on this side including every undecided
                                        one, so a green tile here would claim the money is recorded
                                        when the card beside it says how much of it is not. */}
                                    <Figure
                                        label="Total"
                                        value={formatToRoundedIndianRupee(directionSplit.paidValue)}
                                        sub={`${directionSplit.paidRows} ${
                                            totals.failed_rows > 0 ? "successful " : ""
                                        }transfer${directionSplit.paidRows === 1 ? "" : "s"}`}
                                    />
                                    {settledFigureFor(SETTLED_BLOCK_PAID)}
                                    <Figure
                                        label="Still open"
                                        value={formatToRoundedIndianRupee(openSplit.paidValue)}
                                        sub={`${openSplit.paidRows} undecided`}
                                        tone={openSplit.paidRows ? "amber" : undefined}
                                    />
                                </DirectionBand>
                                {/* ⚠️ APPENDED, SO THE PAID BAND NEVER MOVES — the rule the received
                                    tile and the received settled block already follow, one level up.
                                    Sky throughout: it is this screen's inbound colour, and "deposits"
                                    is the word for money arriving. */}
                                <DirectionBand heading="Received">
                                    <Figure
                                        label="Total"
                                        value={formatToRoundedIndianRupee(
                                            directionSplit.receivedValue
                                        )}
                                        sub={`${directionSplit.receivedRows} ${
                                            totals.failed_rows > 0 ? "successful " : ""
                                        }deposit${directionSplit.receivedRows === 1 ? "" : "s"}`}
                                        tone="sky"
                                    />
                                    {settledFigureFor(SETTLED_BLOCK_RECEIVED)}
                                    <Figure
                                        label="Still open"
                                        value={formatToRoundedIndianRupee(openSplit.receivedValue)}
                                        sub={`${openSplit.receivedRows} undecided`}
                                        tone={openSplit.receivedRows ? "amber" : undefined}
                                    />
                                </DirectionBand>
                                {/* The shared Decided tile sat here, in its own grid beneath the two
                                    bands. Removed with the tile (owner ruling 2026-09-09); the
                                    wrapper went with it rather than being left as an empty row. */}
                            </>
                        ) : (
                        <>
                        {/* ⚠️ ONE COLUMN PER TILE, AND THE COUNT IS NOW TWO CONDITIONALS DEEP: the
                            received tile appears only on a period that holds receipts, and the
                            settled block list is the server's (one direction or two). With no
                            receipts — every Cashfree and Cashbook import — the grid is the four
                            columns it has always been, in the same positions, so a gateway
                            statement renders exactly as it does today. See `TILE_COLUMNS` for why
                            the class strings are literal. */}
                        <div className={`grid gap-3 sm:grid-cols-2 ${tileColumns}`}>
                            {/* ⚠️ THE ONE "TOTAL TRANSFERRED" TILE IS NOW TWO — "Total paid out" and
                                "Total received" (owner ruling Q14, the same ruling the settled
                                blocks below already follow). It summed both directions because
                                `derive_import_summary` had no direction axis; it now has one, and
                                the four figures it sends PARTITION the total exactly, so the two
                                tiles add back to the statement without either being derived from
                                the other. NEITHER IS EVER NETTED AGAINST THE OTHER: money in and
                                money out are two totals, not one difference.

                                ⚠️ THE FIGURES ARE READ AS SENT. The panel does not obtain paid by
                                subtracting received from the total, or the reverse — see the panel
                                docstring. And they are not signed: an amount is stored as the
                                positive figure the statement printed, on both sides.

                                ⚠️ AN OLDER SERVER FALLS BACK TO THE SINGLE TILE IT ALWAYS SENT,
                                labelled as before. A tile reading "Total paid out" over a
                                both-directions sum would be a quiet lie, and a zero-filled pair
                                would be a loud one; the old label over the old figure is neither.

                                The sub-label says "successful" only when some transfer was not, so
                                the word earns its place instead of being noise on the ~95% of
                                imports where the bank moved everything. `failed_rows` carries no
                                direction of its own, so it QUALIFIES each tile's own rows — those
                                rows are the ones the bank moved — and the failed count itself is
                                never printed here; the Skipped chip's hint names it. */}
                            {directionSplit ? (
                                <Figure
                                    label="Total paid out"
                                    value={formatToRoundedIndianRupee(directionSplit.paidValue)}
                                    sub={`${directionSplit.paidRows} ${
                                        totals.failed_rows > 0 ? "successful " : ""
                                    }transfer${directionSplit.paidRows === 1 ? "" : "s"}`}
                                />
                            ) : (
                                <Figure
                                    label="Total transferred"
                                    value={formatToRoundedIndianRupee(totals.total_value)}
                                    sub={`${totals.total_rows} ${
                                        totals.failed_rows > 0 ? "successful " : ""
                                    }transfer${totals.total_rows === 1 ? "" : "s"}`}
                                />
                            )}
                            {/* ⚠️ APPENDED, AND ONLY WHEN IT HOLDS ROWS — see `showReceived`. "Paid
                                out" therefore never moves off the left of the row.

                                ⚠️ SKY, AND PAID IS LEFT UNTONED. Sky is already this screen's
                                inbound colour, so it marks the direction. Emerald is NOT its
                                opposite here: on this panel emerald means SETTLED (the block
                                below), and these two tiles span the whole statement including
                                every undecided row — a green "Total paid out" would claim the
                                money is recorded when the tile beside it says how much still is
                                not. "Deposits", not "transfers": the word for money arriving. */}
                            {directionSplit && showReceived && (
                                <Figure
                                    label="Total received"
                                    value={formatToRoundedIndianRupee(directionSplit.receivedValue)}
                                    sub={`${directionSplit.receivedRows} ${
                                        totals.failed_rows > 0 ? "successful " : ""
                                    }deposit${directionSplit.receivedRows === 1 ? "" : "s"}`}
                                    tone="sky"
                                />
                            )}
                            {/* ⚠️ THE SETTLED TILE IS NOW ONE TILE PER DIRECTION (owner ruling Q14,
                                option a) — Received and Paid, EACH RECONCILING TO ITS OWN TOTAL,
                                never netted. A single net figure hides both halves; folding
                                receipts into the paid total would add money in to money out; and
                                leaving receipts out would make the money this screen ingested
                                invisible on the screen that ingested it.

                                ⚠️ THE BLOCKS ARE THE SERVER'S LIST, RENDERED VERBATIM — the split,
                                the order, the zero-fill, which side a blank direction lands on, and
                                whether an empty received block exists at all are all decided by the
                                one `GROUP BY` (`derive_settled_direction_blocks`). Nothing here
                                sorts, totals, partitions or drops a zero; see the panel docstring
                                on why a panel that added up its own rows is worse than one that
                                shows nothing. An ABSENT key renders NO block at all, which is the
                                whole reason `settledDirectionBlocks` exists.

                                ⚠️ THE SUB-LINE'S AUTO-MATCHED CLAUSE (slice Q1) IS A WHOLE-SETTLED
                                FIGURE, so it is quoted only where it provably describes the block
                                it sits on — see `settledBlockSubLine`. Until Q1 nothing on this
                                screen could answer it at all: every settlement record was stamped
                                "Manual", so the money record claimed a person had found all of them
                                when the machine had found 99%. */}
                            {settledBlocks.map((block) => (
                                <Figure
                                    key={block.direction}
                                    label={settledBlockLabel(block.direction)}
                                    value={formatToRoundedIndianRupee(block.value)}
                                    sub={settledBlockSubLine(block, {
                                        fromSuggestion: totals.settled_from_suggestion,
                                        describesEverySettledRow: settledBlocks.length === 1,
                                    })}
                                    tone={
                                        block.direction === SETTLED_BLOCK_RECEIVED
                                            ? "sky"
                                            : "emerald"
                                    }
                                    breakdown={block.ledgers}
                                />
                            ))}
                            {/* ⚠️ THE ONE FIGURE THAT SAYS WHETHER THE WORK IS FINISHED. Counts
                                tell you how much is left to click; this tells you how much money is
                                still unaccounted for, which is the question being asked. */}
                            <Figure
                                label="Still open"
                                value={formatToRoundedIndianRupee(totals.open_value)}
                                sub={`${totals.open_rows} undecided`}
                                tone={totals.open_rows ? "amber" : undefined}
                            />
                            {/* The Decided tile sat here in the flat layout, and beneath the bands in
                                the other. Removed from both (owner ruling 2026-09-09) — see the note
                                where it was built for why the payload keys stay. */}
                        </div>
                        </>
                        )}

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

/**
 * One direction's band: a heading, then the three figures for that side.
 *
 * ⚠️ IT STAYS DUMB, EXACTLY AS `Figure` DOES. It renders a heading and whatever it is handed; it
 * decides nothing about which figures those are, what they say, or how many there are. The rule
 * about when a band exists at all lives at the call site (`bandsApply`), where the payload is.
 *
 * ⚠️ THE HEADING IS A RULE, NOT A CARD LABEL, WHICH IS WHY IT IS A RULED LINE RATHER THAN ANOTHER
 * TILE. It has to read as a section marker over the three cards beneath it — a boxed heading would
 * read as a fourth figure with no number in it. The cards below it are then labelled plainly
 * (`Total` / `Settled` / `Still open`): repeating the direction on each one would say the same
 * thing four times in one band.
 *
 * ⚠️ THE GRID IS A LITERAL CLASS STRING, like `TILE_COLUMNS`. An interpolated `lg:grid-cols-${n}`
 * is invisible to Tailwind's scanner and ships as no class at all. A band is always exactly three
 * cards wide, so there is nothing here to compute: an absent settled block renders an ABSENCE card
 * rather than a gap, which is what keeps the row square.
 */
const DirectionBand = ({ heading, children }: { heading: string; children: ReactNode }) => (
    <div className="space-y-2">
        <div className="flex items-center gap-2">
            <span className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {heading}
            </span>
            <span className="h-px flex-1 bg-border" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </div>
);

/**
 * One figure.
 *
 * ⚠️ IT STAYS DUMB. It renders a label, a value, a sub-line and — where one is handed to it — a
 * breakdown of the figure ABOVE. It decides nothing about any of them: the sub-line's wording is
 * the caller's, and so is the breakdown's order, contents and length.
 *
 * ⚠️ THE TILES SHARE A ROW OF CSS GRID, SO THEY SHARE A HEIGHT. A breakdown on one of them
 * therefore grows them all, which is accepted — a fixed height, or padding on the others to
 * compensate, would be several lies to make one truth fit. Since B8b/B8c the row holds anywhere
 * from three tiles to six, depending on whether the period holds any receipts at all.
 */
const Figure = ({
    label,
    value,
    sub,
    tone,
    breakdown,
}: {
    label: string;
    value: string;
    sub: string;
    /**
     * ⚠️ `sky` IS THE RECEIVED BLOCK'S TONE, AND IT HAD TO BE A NEW ONE. Emerald means "settled,
     * money out" everywhere else on this screen, so reusing it for receipts would say the two
     * blocks are the same kind of figure at a glance — which is the one thing a reviewer must not
     * conclude. Amber is taken (still open), and `sky` is already this app's provenance/inbound
     * colour (the carried-category verdict in the pricing grid).
     */
    tone?: "emerald" | "amber" | "sky";
    /** Rendered VERBATIM, in the order given. An empty list renders nothing at all. */
    breakdown?: readonly SettledLedgerSplit[];
}) => (
    <div
        className={`rounded-md border p-3 ${
            tone === "emerald"
                ? "border-emerald-200 bg-emerald-50/50"
                : tone === "sky"
                  ? "border-sky-200 bg-sky-50/50"
                  : tone === "amber"
                    ? "border-amber-200 bg-amber-50/50"
                    : ""
        }`}
    >
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
        <div className="text-xs text-muted-foreground">{sub}</div>
        {/* ⚠️ THE LEFT RULE IS WHAT MAKES THESE A BREAKDOWN RATHER THAN THREE MORE FIGURES. Without
            it the lines read as siblings of the tile — three further numbers on the panel — instead
            of as the parts of the one directly above them. It is the only new decoration this block
            gets, deliberately.

            ⚠️ ROUNDED RUPEES, NOT THE EXACT FORM. These are plain amounts; the exact
            `formatToIndianRupee` is reserved for DIFFERENCES on this screen. */}
        {breakdown && breakdown.length > 0 && (
            <div
                className={`mt-2 space-y-0.5 border-l-2 pl-2 ${
                    tone === "sky"
                        ? "border-sky-200 dark:border-sky-800"
                        : "border-emerald-200 dark:border-emerald-800"
                }`}
            >
                {breakdown.map((entry) => (
                    <div
                        key={entry.ledger}
                        className="flex items-center justify-between text-[11px] leading-tight"
                    >
                        <span className="truncate">
                            {entry.ledger}{" "}
                            <span className="text-muted-foreground tabular-nums">{entry.rows}</span>
                        </span>
                        <span className="shrink-0 pl-2 tabular-nums">
                            {formatToRoundedIndianRupee(entry.value)}
                        </span>
                    </div>
                ))}
            </div>
        )}
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
