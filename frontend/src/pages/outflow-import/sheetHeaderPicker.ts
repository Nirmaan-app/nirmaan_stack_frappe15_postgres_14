// src/pages/outflow-import/sheetHeaderPicker.ts

/**
 * The presentational decisions behind the Check step's header picker, as pure functions.
 *
 * ⚠️ THEY LIVE HERE BECAUSE THERE IS NO DOM TEST ENVIRONMENT. `frontend/vitest.config.ts` sets
 * `environment: "node"` deliberately — no jsdom, no @testing-library — so anything left inside
 * `SheetHeaderPicker.tsx` is structurally untestable. Every decision that can be phrased as
 * "given this payload, what does the screen SAY / which kind of row is this" belongs in this file;
 * the component keeps only markup and Tailwind.
 *
 * ⚠️ NOTHING HERE RE-DERIVES A ROW NUMBER. The server owns where the table starts and ends
 * (`services/outflow_import` header detection); these functions read `header_row_used`,
 * `table_start_row` and `table_end_row` and never recompute one from another. A client that worked
 * out its own table span would be a second opinion about the rows the parser is going to read, and
 * the whole point of this screen is that the person is looking at the parser's own answer.
 *
 * ⚠️ ROW NUMBERS ARE PRINTED UNGROUPED — `1412`, never `1,412`. They are Excel's own gutter
 * numbers, and the person is expected to match them against a spreadsheet that prints them plainly.
 * A thousands separator here would make the screen and the spreadsheet disagree about the name of
 * the same row.
 */

import type {
    StatementSheetColumnRead,
    StatementSheetInfo,
} from "@/types/NirmaanStack/OutflowImportBatch";

/**
 * What one sheet row is, relative to the chosen header.
 *
 * `below-table` covers BOTH the trailer (`Page Total`, `Legends`) and every row of a sheet whose
 * table turned out to be empty. They are the same thing to a reader: rows the parser will not read.
 */
export type SheetRowKind = "preamble" | "header" | "data" | "below-table";

/**
 * Which kind a given 1-based sheet row is.
 *
 * ⚠️ THE HEADER IS TESTED FIRST, ON PURPOSE. When a sheet has no transactions at all the server
 * still sends `table_start_row = header + 1` with a `table_end_row` BELOW it, so the data range is
 * empty-and-inverted. Ordering the checks any other way would leave the header row itself falling
 * through to a range test that cannot match it.
 */
export const sheetRowKind = (row: number, sheet: StatementSheetInfo): SheetRowKind => {
    if (row === sheet.header_row_used) return "header";
    if (row < sheet.header_row_used) return "preamble";
    if (row >= sheet.table_start_row && row <= sheet.table_end_row) return "data";
    return "below-table";
};

/**
 * How many sheet rows the table spans.
 *
 * ⚠️ THIS IS A SPAN OF SHEET ROWS, NOT A COUNT OF TRANSFERS THE IMPORT WILL CREATE. The parser
 * drops rows inside the span (a blank `Tran. Id` line, a bank-refused transfer), so quoting this
 * figure as a row count would put a number on this screen that the very next screen contradicts.
 * It exists so the summary sentence can say "rows 18 to 1412" and get the plural right — nothing
 * more. `preview.total_rows` is the number of transfers, and it comes from the parse.
 */
export const sheetTableRowSpan = (sheet: StatementSheetInfo): number =>
    Math.max(0, sheet.table_end_row - sheet.table_start_row + 1);

/**
 * The plain sentence of what the server decided, in the person's own words.
 *
 * ⚠️ THE EMPTY CASE IS SAID OUT LOUD RATHER THAN RENDERED AS AN ODD RANGE. A header picked one row
 * too low leaves nothing below it, and "Rows 18 to 17 are transactions" reads as a rendering bug
 * instead of as the mistake it actually is.
 */
export const sheetTableSummary = (sheet: StatementSheetInfo): string => {
    const opening = `Reading the table from row ${sheet.header_row_used}.`;
    const span = sheetTableRowSpan(sheet);
    if (span === 0) return `${opening} No transaction rows were found below it.`;
    if (span === 1) return `${opening} Row ${sheet.table_start_row} is the only transaction.`;
    return `${opening} Rows ${sheet.table_start_row} to ${sheet.table_end_row} are transactions.`;
};

/**
 * What was dropped below the table, or `""` when nothing was.
 *
 * ⚠️ THIS MUST NEVER BE SILENT WHEN IT IS NON-ZERO. The table ends at the first wholly-blank row,
 * and a rule that ends a table is a rule that can TRUNCATE one — a stray blank line in the middle
 * of a statement would leave hundreds of real transfers sitting under this count, unimported and
 * unmentioned. Printing the number is what turns a silent truncation into a visible one.
 *
 * The parenthetical names the rows we EXPECT to be down there, so a count far larger than a totals
 * block plus thirty legend lines reads as wrong at a glance.
 */
export const ignoredRowsSentence = (sheet: StatementSheetInfo): string => {
    const n = sheet.trailing_rows_ignored;
    if (!n || n <= 0) return "";
    if (n === 1) return "1 row below the table was ignored (totals and legends).";
    return `${n} rows below the table were ignored (totals and legends).`;
};

/**
 * A note saying the grid is only the top of the sheet, or `""` when it shows all of it.
 *
 * ⚠️ WITHOUT IT THE GRID LIES BY OMISSION. A 1,450-row statement previews as 60 rows that end
 * mid-January, and a reader with no note has every reason to think the table ends there and the
 * detection truncated it. The server guarantees the chosen header is always inside the preview, so
 * this note never has to apologise for hiding the row that matters.
 */
export const gridTruncationNote = (sheet: StatementSheetInfo): string => {
    if (!sheet.grid_truncated) return "";
    return `Preview shows the first ${sheet.grid.length} of ${sheet.total_sheet_rows} sheet rows.`;
};

/**
 * Where the header row came from — detection, or a person.
 *
 * ⚠️ A MANUAL CHOICE IS ALWAYS NAMED AS ONE. `was_overridden` is the only thing that distinguishes
 * "the software found this" from "somebody typed this", and the second is the one that wants a
 * second pair of eyes before an import is written.
 */
export const headerChoiceNote = (sheet: StatementSheetInfo): string => {
    if (!sheet.was_overridden) {
        return `Row ${sheet.header_row_used} was detected automatically.`;
    }
    if (sheet.detected_header_row === sheet.header_row_used) {
        return `You picked row ${sheet.header_row_used}, which is also the detected row.`;
    }
    return `You picked row ${sheet.header_row_used}. Row ${sheet.detected_header_row} was detected automatically.`;
};

/**
 * Whether to offer a way back to the detected row.
 *
 * ⚠️ ONLY WHEN THE TWO ACTUALLY DIFFER. Offering "go back to row 17" while row 17 is already in use
 * is a button that visibly does nothing, which reads as the screen being out of step with itself.
 */
export const canRevertToDetected = (sheet: StatementSheetInfo): boolean =>
    sheet.was_overridden && sheet.detected_header_row !== sheet.header_row_used;

/**
 * Whether clicking a given row should do anything.
 *
 * ⚠️ THE CURRENT HEADER IS NOT PICKABLE. Re-posting the file to ask for the row it is already using
 * costs a full re-parse of a 1,450-row statement and can only return the same answer. `busy` blocks
 * every row for the same reason one level up: a second re-read launched over the first would land
 * out of order, and the later answer would be the one discarded.
 */
export const canPickRow = (
    row: number,
    sheet: StatementSheetInfo,
    busy: boolean
): boolean => !busy && row !== sheet.header_row_used;

/**
 * A 0-based column index as its Excel letter — `0` → `A`, `25` → `Z`, `26` → `AA`.
 *
 * ⚠️ THE GRID SHOWS THESE SO THE LETTERS IN `columns_read` CAN BE FOUND. That list names columns as
 * `D "Transaction Date"`; without a letter strip above the grid the reader has to count columns by
 * hand to check whether D really is the transaction date. It is spelt generally even though the
 * grid is capped at twelve columns, because a cap is a thing that gets raised.
 */
export const columnLetter = (index: number): string => {
    if (!Number.isFinite(index) || index < 0) return "";
    let n = Math.floor(index);
    let letters = "";
    while (n >= 0) {
        letters = String.fromCharCode(65 + (n % 26)) + letters;
        n = Math.floor(n / 26) - 1;
    }
    return letters;
};

/**
 * The columns one field is read from, as `D "Transaction Date", C "Value Date"`.
 *
 * ⚠️ THE ORDER IS THE PARSER'S CONSULTATION ORDER AND IS NEVER SORTED. The whole meaning of a
 * multi-column entry is which column is tried first — `Transaction Date` then `Value Date` is a
 * different rule from the reverse, and on eleven of the measured 1,395 rows the two disagree.
 *
 * ⚠️ A BLANK HEADER IS NAMED, NOT LEFT AS AN EMPTY PAIR OF QUOTES. A sheet whose header cell is
 * empty would otherwise render `B ""`, which reads as a rendering fault rather than as a column
 * with no name. Same for a field that arrived with no columns at all: it says so.
 */
export const columnReadSources = (entry: StatementSheetColumnRead): string => {
    if (!entry.columns || entry.columns.length === 0) return "(no column)";
    return entry.columns
        .map((column) => {
            const header = (column.header ?? "").trim();
            return header ? `${column.letter} "${header}"` : `${column.letter} (unnamed column)`;
        })
        .join(", ");
};

/**
 * One whole line of the read-only columns list, label and note included.
 *
 * The component renders the three parts separately so it can style them; this is the same text as
 * one string, for the `title` tooltip that recovers a line the layout had to truncate.
 *
 * ⚠️ READ-ONLY, BY OWNER RULING. There is no column-mapping UI and none is to be built — this list
 * STATES what the parser will do, derived server-side from the adapter's own column map. A second,
 * editable list would be free to disagree with the parser about the file being imported.
 */
export const columnReadLine = (entry: StatementSheetColumnRead): string => {
    const note = entry.note ? ` (${entry.note})` : "";
    return `${entry.label} — ${columnReadSources(entry)}${note}`;
};
