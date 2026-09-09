// src/pages/outflow-import/components/SheetHeaderPicker.tsx

import { useMemo, type KeyboardEvent } from "react";
import { AlertTriangle, Loader2, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { StatementSheetInfo } from "@/types/NirmaanStack/OutflowImportBatch";

import {
    canPickRow,
    canRevertToDetected,
    columnLetter,
    columnReadLine,
    columnReadSources,
    gridTruncationNote,
    headerChoiceNote,
    ignoredRowsSentence,
    sheetRowKind,
    sheetTableSummary,
    type SheetRowKind,
} from "../sheetHeaderPicker";

interface SheetHeaderPickerProps {
    sheet: StatementSheetInfo;
    /** Re-read the sheet using this 1-based header row. Reference-stable; safe to call on click. */
    onPickHeaderRow: (row: number) => void;
    /** True while a re-read is in flight: disable row picking and show that it is working. */
    busy: boolean;
}

/**
 * Where the table sits inside an uploaded bank statement, and the chance to correct it.
 *
 * A raw ICICI download does not put its table at the top of the sheet: sixteen rows of account
 * information sit above the header, and a totals-plus-legends trailer sits below the last
 * transaction. The server detects all of that; this screen SHOWS the person what it decided and
 * lets them move the header before anything is written.
 *
 * ⚠️ PURE PRESENTATION. No fetching, no `useFrappe*` hooks, no page state, no routing. Everything
 * it shows comes out of `sheet`; everything it does goes out through `onPickHeaderRow`. The Check
 * step owns the re-post and owns `busy`, because the re-post is what produces the next `sheet` and
 * a component that fetched its own would be showing an answer the surrounding counts disagree with.
 *
 * ⚠️ THE IGNORED-ROW COUNT IS NEVER SUPPRESSED. The table ends at the first wholly-blank row, and
 * a rule that ends a table is a rule that can TRUNCATE one — a stray blank line mid-statement would
 * leave hundreds of real transfers unimported and unmentioned. Silent loss is the worst failure
 * class in this module, so the count is on screen where a wrong answer is visible.
 *
 * ⚠️ THE COLUMNS LIST IS READ-ONLY, BY OWNER RULING. There is no column-mapping UI here and none is
 * to be built. The list is derived server-side from the adapter's own column map, so the screen and
 * the parser cannot disagree; an editable second list would be free to.
 *
 * ⚠️ EVERY DECISION THAT COULD BE A PURE FUNCTION IS ONE, in `../sheetHeaderPicker`. This repo has
 * NO DOM test environment (`vitest.config.ts`, `environment: "node"`, deliberate), so anything left
 * in this file is untestable by construction — only the markup and the Tailwind belong here.
 */
export const SheetHeaderPicker = ({ sheet, onPickHeaderRow, busy }: SheetHeaderPickerProps) => {
    // The widest row wins: `grid` rows are padded server-side, but a defensive max means a short
    // row can never make the letter strip shorter than the cells beneath it.
    const columnCount = useMemo(
        () => sheet.grid.reduce((widest, row) => Math.max(widest, row.length), 0),
        [sheet.grid]
    );
    const letters = useMemo(
        () => Array.from({ length: columnCount }, (_, index) => columnLetter(index)),
        [columnCount]
    );

    const ignored = ignoredRowsSentence(sheet);
    const truncation = gridTruncationNote(sheet);
    const showRevert = canRevertToDetected(sheet);

    return (
        <div className="space-y-3" aria-busy={busy}>
            <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-1">
                <div className="min-w-0 space-y-0.5">
                    <p className="text-sm font-medium">{sheetTableSummary(sheet)}</p>
                    <p className="text-xs text-muted-foreground">
                        {headerChoiceNote(sheet)}
                        {truncation ? ` ${truncation}` : ""}
                    </p>
                </div>

                <div className="flex shrink-0 items-center gap-3">
                    {/* ⚠️ The answer stays on screen while the next one loads. A spinner that
                        replaced the numbers would hide the very thing the person is checking, and
                        a re-read that comes back identical would look like a screen that flashed
                        for no reason. */}
                    {busy && (
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Re-reading the sheet…
                        </span>
                    )}
                    {showRevert && (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 gap-1.5 text-xs"
                            disabled={busy}
                            onClick={() => onPickHeaderRow(sheet.detected_header_row)}
                        >
                            <Undo2 className="h-3.5 w-3.5" />
                            Use detected row {sheet.detected_header_row}
                        </Button>
                    )}
                </div>
            </div>

            {ignored && (
                <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-500">
                    <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                    <span>{ignored}</span>
                </p>
            )}

            {sheet.grid.length === 0 ? (
                <p className="rounded-md border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
                    No preview of this sheet is available.
                </p>
            ) : (
                <>
                    <p className="text-xs text-muted-foreground">
                        Click a row to use it as the header instead.
                    </p>

                    {/* ⚠️ THE SCROLL LIVES HERE, NOT ON THE PAGE. A statement is ten columns of
                        long remarks; letting it size the dialog would put a horizontal scrollbar
                        on the whole screen, and this component renders inside a step that already
                        scrolls vertically. */}
                    <div className="max-h-[22rem] overflow-auto rounded-md border">
                        <table className="w-max min-w-full border-collapse text-xs">
                            <thead className="sticky top-0 z-10 bg-muted">
                                <tr>
                                    <th
                                        scope="col"
                                        className="w-14 border-b border-r px-2 py-1 text-right font-medium text-muted-foreground"
                                    >
                                        Row
                                    </th>
                                    {/* The Excel letters are what makes the columns list below
                                        checkable — it names columns as `D "Transaction Date"`, and
                                        without a strip the reader counts columns by hand. */}
                                    {letters.map((letter) => (
                                        <th
                                            key={letter}
                                            scope="col"
                                            className="border-b border-r px-2 py-1 text-left font-medium text-muted-foreground last:border-r-0"
                                        >
                                            {letter}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {sheet.grid.map((cells, index) => {
                                    // ⚠️ `grid[0]` IS SHEET ROW 1. The payload carries no offset
                                    // field on purpose — an offset is one more thing that can be
                                    // wrong — so the row number is the index plus one, here and
                                    // nowhere else.
                                    const rowNumber = index + 1;
                                    return (
                                        <SheetGridRow
                                            key={rowNumber}
                                            rowNumber={rowNumber}
                                            cells={cells}
                                            columnCount={columnCount}
                                            kind={sheetRowKind(rowNumber, sheet)}
                                            selectable={canPickRow(rowNumber, sheet, busy)}
                                            onPick={onPickHeaderRow}
                                        />
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </>
            )}

            <div className="rounded-md border bg-muted/20 px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-wide">
                    These are the columns I will read
                </p>
                <ul className="mt-1.5 space-y-1">
                    {sheet.columns_read.map((entry) => (
                        <li
                            key={entry.label}
                            className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs"
                            title={columnReadLine(entry)}
                        >
                            <span className="w-32 shrink-0 font-medium">{entry.label}</span>
                            <span className="font-mono">{columnReadSources(entry)}</span>
                            {/* The note is the RULE — "the first one that has a value" is what
                                makes two listed columns mean a fallback rather than two reads. */}
                            {entry.note && (
                                <span className="text-muted-foreground">({entry.note})</span>
                            )}
                        </li>
                    ))}
                </ul>
                <p className="mt-1.5 text-xs text-muted-foreground">
                    Read straight from the parser's own column map. Nothing here can be re-mapped.
                </p>
            </div>
        </div>
    );
};

/**
 * One sheet row in the preview, and the click that makes it the header.
 *
 * ⚠️ THE INTERACTIVE ELEMENT IS THE `<tr>` ITSELF, not a button inside it. A `<button>` cannot wrap
 * a table row, and a button in the gutter cell would give the person a large obvious target that is
 * NOT the thing that responds — so the row carries `role="button"`, a real `tabIndex` and its own
 * Enter/Space handling, which is what a keyboard user needs to reach every option.
 *
 * ⚠️ WHEN IT IS NOT SELECTABLE IT CARRIES NO ROLE AND NO TAB STOP. The current header row and every
 * row during a re-read are inert, and a `role="button"` that ignores clicks would announce an
 * action to a screen reader that the row cannot perform.
 */
const SheetGridRow = ({
    rowNumber,
    cells,
    columnCount,
    kind,
    selectable,
    onPick,
}: {
    rowNumber: number;
    cells: string[];
    columnCount: number;
    kind: SheetRowKind;
    selectable: boolean;
    onPick: (row: number) => void;
}) => {
    const isHeader = kind === "header";

    const pick = () => {
        if (selectable) onPick(rowNumber);
    };

    const onKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
        if (!selectable) return;
        if (event.key === "Enter" || event.key === " ") {
            // Space scrolls the container otherwise, which moves the grid out from under the
            // person the moment they try to choose a row in it.
            event.preventDefault();
            pick();
        }
    };

    return (
        <tr
            className={cn(
                "border-b last:border-b-0",
                // A preamble row is account information, not data — muted, so the eye lands on
                // the header and the rows below it.
                kind === "preamble" && "text-muted-foreground",
                // Below the table sits the totals-and-legends trailer the count above reports.
                kind === "below-table" && "bg-muted/20 text-muted-foreground",
                isHeader &&
                    "bg-emerald-50 font-medium text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
                selectable && "cursor-pointer hover:bg-accent",
                selectable &&
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            )}
            role={selectable ? "button" : undefined}
            tabIndex={selectable ? 0 : undefined}
            aria-current={isHeader ? "true" : undefined}
            title={selectable ? `Use row ${rowNumber} as the header` : undefined}
            onClick={pick}
            onKeyDown={onKeyDown}
        >
            <td className="w-14 whitespace-nowrap border-r px-2 py-1 text-right tabular-nums">
                {rowNumber}
                {isHeader && (
                    <span className="ml-1 rounded bg-emerald-600 px-1 py-px text-[10px] font-semibold uppercase leading-none text-white">
                        hdr
                    </span>
                )}
            </td>
            {Array.from({ length: columnCount }, (_, column) => (
                <td
                    key={column}
                    className="max-w-[14rem] truncate border-r px-2 py-1 last:border-r-0"
                    title={cells[column] || undefined}
                >
                    {cells[column] ?? ""}
                </td>
            ))}
        </tr>
    );
};
