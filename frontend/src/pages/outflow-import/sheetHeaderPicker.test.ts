// src/pages/outflow-import/sheetHeaderPicker.test.ts

/**
 * ⚠️ EVERY FIXTURE IN THIS FILE IS FABRICATED. The statements this feature was measured against are
 * real company bank downloads that live outside the repo, and none of their contents may be copied
 * in. The SHAPES here match what was measured — a sixteen-row preamble, a header on row 17, a
 * trailer of totals and legends — but every name, id and figure is invented.
 */

import { describe, expect, it } from "vitest";

import type {
    StatementSheetColumnRead,
    StatementSheetInfo,
} from "@/types/NirmaanStack/OutflowImportBatch";
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
    sheetTableRowSpan,
    sheetTableSummary,
} from "./sheetHeaderPicker";

/** The measured ICICI shape, with fabricated cells. */
const sheet = (over: Partial<StatementSheetInfo> = {}): StatementSheetInfo => ({
    detected_header_row: 17,
    header_row_used: 17,
    was_overridden: false,
    total_sheet_rows: 1450,
    table_start_row: 18,
    table_end_row: 1412,
    trailing_rows_ignored: 36,
    grid_truncated: true,
    grid: Array.from({ length: 60 }, () => ["", "", "", ""]),
    columns_read: [],
    ...over,
});

describe("sheetRowKind — preamble, header, data, and the rows below the table", () => {
    it("names each band of the measured ICICI shape", () => {
        const s = sheet();
        expect(sheetRowKind(1, s)).toBe("preamble");
        expect(sheetRowKind(16, s)).toBe("preamble");
        expect(sheetRowKind(17, s)).toBe("header");
        expect(sheetRowKind(18, s)).toBe("data");
        expect(sheetRowKind(1412, s)).toBe("data");
        expect(sheetRowKind(1413, s)).toBe("below-table");
        expect(sheetRowKind(1450, s)).toBe("below-table");
    });

    it("classifies the header row as the header even when the table below it is EMPTY", () => {
        // ⚠️ A header picked one row too low leaves `table_start_row` ABOVE `table_end_row`, so the
        // data range is empty and inverted. The header test runs first precisely so the header row
        // cannot fall through to a range that can never match it.
        const s = sheet({ header_row_used: 20, table_start_row: 21, table_end_row: 20 });
        expect(sheetRowKind(20, s)).toBe("header");
        expect(sheetRowKind(21, s)).toBe("below-table");
        expect(sheetRowKind(19, s)).toBe("preamble");
    });

    it("puts a sheet with no preamble straight into header-then-data", () => {
        // The gateway shape, for which `sheet` is absent entirely — but the classification must
        // still be sane if a source ever reports a table starting at row 1.
        const s = sheet({
            detected_header_row: 1,
            header_row_used: 1,
            table_start_row: 2,
            table_end_row: 90,
            trailing_rows_ignored: 0,
        });
        expect(sheetRowKind(1, s)).toBe("header");
        expect(sheetRowKind(2, s)).toBe("data");
        expect(sheetRowKind(91, s)).toBe("below-table");
    });
});

describe("sheetTableRowSpan — a span of sheet rows, never a count of transfers", () => {
    it("counts the rows the table covers, inclusive of both ends", () => {
        expect(sheetTableRowSpan(sheet())).toBe(1395);
        expect(sheetTableRowSpan(sheet({ table_start_row: 18, table_end_row: 18 }))).toBe(1);
    });

    it("is 0, never negative, when the table is empty", () => {
        // A negative span would flow into the summary sentence and print "Rows 21 to 20".
        expect(sheetTableRowSpan(sheet({ table_start_row: 21, table_end_row: 20 }))).toBe(0);
        expect(sheetTableRowSpan(sheet({ table_start_row: 30, table_end_row: 1 }))).toBe(0);
    });
});

describe("sheetTableSummary — the plain sentence of what the server decided", () => {
    it("names the header row and the span of transactions", () => {
        expect(sheetTableSummary(sheet())).toBe(
            "Reading the table from row 17. Rows 18 to 1412 are transactions."
        );
    });

    it("prints row numbers UNGROUPED so they match Excel's own gutter", () => {
        // ⚠️ `1,412` and `1412` are different names for the same row as far as a reader matching
        // the screen against a spreadsheet is concerned, and only one of them is Excel's.
        expect(sheetTableSummary(sheet())).toContain("1412");
        expect(sheetTableSummary(sheet())).not.toContain("1,412");
    });

    it("says the table is EMPTY rather than printing an inverted range", () => {
        // "Rows 21 to 20 are transactions" reads as a rendering bug instead of as the mis-picked
        // header row it actually is.
        const s = sheet({ header_row_used: 20, table_start_row: 21, table_end_row: 20 });
        expect(sheetTableSummary(s)).toBe(
            "Reading the table from row 20. No transaction rows were found below it."
        );
    });

    it("gets the singular right on a one-row table", () => {
        const s = sheet({ table_start_row: 18, table_end_row: 18 });
        expect(sheetTableSummary(s)).toBe(
            "Reading the table from row 17. Row 18 is the only transaction."
        );
    });
});

describe("ignoredRowsSentence — the dropped trailer is never silent", () => {
    it("states the count when rows below the table were skipped", () => {
        // ⚠️ The table ends at the first blank row, so this count is the ONLY place a truncation
        // becomes visible. 400 would be wrong, and the reader can only see that if the number is
        // on screen.
        //
        // 36 is the MEASURED trailer of both real ICICI downloads: a `Page Total` line, four
        // balance lines, the `Legends Used in Account Statement` heading and thirty legend
        // entries. It is deliberately not 37 -- the trailer holds TWO blank rows, one before the
        // balances and one before the legends heading, and counting the second as content is the
        // exact off-by-one this fixture now pins against.
        expect(ignoredRowsSentence(sheet())).toBe(
            "36 rows below the table were ignored (totals and legends)."
        );
    });

    it("is silent only when nothing was ignored", () => {
        expect(ignoredRowsSentence(sheet({ trailing_rows_ignored: 0 }))).toBe("");
    });

    it("gets the singular right", () => {
        expect(ignoredRowsSentence(sheet({ trailing_rows_ignored: 1 }))).toBe(
            "1 row below the table was ignored (totals and legends)."
        );
    });
});

describe("gridTruncationNote — the preview is only the top of the sheet", () => {
    it("says how much of the sheet is on screen when the grid is capped", () => {
        // Without it a 1,450-row statement previews as 60 rows ending mid-January, and a reader has
        // every reason to think detection truncated the table there.
        expect(gridTruncationNote(sheet())).toBe(
            "Preview shows the first 60 of 1450 sheet rows."
        );
    });

    it("says nothing when the grid holds the whole sheet", () => {
        const s = sheet({
            grid_truncated: false,
            total_sheet_rows: 40,
            grid: Array.from({ length: 40 }, () => ["", ""]),
        });
        expect(gridTruncationNote(s)).toBe("");
    });
});

describe("headerChoiceNote / canRevertToDetected — detection versus a person", () => {
    it("names detection when nobody overrode it", () => {
        expect(headerChoiceNote(sheet())).toBe("Row 17 was detected automatically.");
        expect(canRevertToDetected(sheet())).toBe(false);
    });

    it("names BOTH rows when a person picked a different one", () => {
        // ⚠️ A manual choice is always named as one — it is the case that wants a second look
        // before the import is written, and `was_overridden` is the only thing that reveals it.
        const s = sheet({ was_overridden: true, header_row_used: 20, detected_header_row: 17 });
        expect(headerChoiceNote(s)).toBe(
            "You picked row 20. Row 17 was detected automatically."
        );
        expect(canRevertToDetected(s)).toBe(true);
    });

    it("offers no way back when the picked row IS the detected row", () => {
        // A "go back to row 17" button while row 17 is already in use is a control that visibly
        // does nothing.
        const s = sheet({ was_overridden: true, header_row_used: 17, detected_header_row: 17 });
        expect(headerChoiceNote(s)).toBe(
            "You picked row 17, which is also the detected row."
        );
        expect(canRevertToDetected(s)).toBe(false);
    });
});

describe("canPickRow — what a click is allowed to launch", () => {
    it("does nothing on the row that is already the header", () => {
        // Re-posting the file to ask for the row already in use costs a full re-parse of a
        // 1,450-row statement and can only return the same answer.
        expect(canPickRow(17, sheet(), false)).toBe(false);
    });

    it("allows any other row while idle", () => {
        expect(canPickRow(16, sheet(), false)).toBe(true);
        expect(canPickRow(18, sheet(), false)).toBe(true);
        expect(canPickRow(1450, sheet(), false)).toBe(true);
    });

    it("blocks EVERY row while a re-read is in flight", () => {
        // A second re-read launched over the first can land out of order, and the later answer is
        // the one that would be discarded.
        expect(canPickRow(16, sheet(), true)).toBe(false);
        expect(canPickRow(17, sheet(), true)).toBe(false);
        expect(canPickRow(18, sheet(), true)).toBe(false);
    });
});

describe("columnLetter — the strip that makes `columns_read` findable in the grid", () => {
    it("maps the 0-based grid index onto the Excel letter", () => {
        expect(columnLetter(0)).toBe("A");
        expect(columnLetter(1)).toBe("B");
        expect(columnLetter(3)).toBe("D");
        expect(columnLetter(11)).toBe("L");
        expect(columnLetter(25)).toBe("Z");
    });

    it("keeps working past Z, because a twelve-column cap is a thing that gets raised", () => {
        expect(columnLetter(26)).toBe("AA");
        expect(columnLetter(27)).toBe("AB");
        expect(columnLetter(51)).toBe("AZ");
        expect(columnLetter(52)).toBe("BA");
    });

    it("returns an empty string rather than junk on a nonsense index", () => {
        expect(columnLetter(-1)).toBe("");
        expect(columnLetter(Number.NaN)).toBe("");
    });
});

describe("columnReadSources / columnReadLine — the read-only columns list", () => {
    const transferId: StatementSheetColumnRead = {
        label: "Transfer id",
        columns: [{ header: "Tran. Id", letter: "B" }],
    };
    const date: StatementSheetColumnRead = {
        label: "Date",
        columns: [
            { header: "Transaction Date", letter: "D" },
            { header: "Value Date", letter: "C" },
        ],
        note: "the first one that has a value",
    };

    it("renders a plain single-column field as letter and header", () => {
        expect(columnReadSources(transferId)).toBe('B "Tran. Id"');
        expect(columnReadLine(transferId)).toBe('Transfer id — B "Tran. Id"');
    });

    it("keeps the parser's consultation order and never sorts it", () => {
        // ⚠️ The ORDER is the whole meaning of a multi-column entry: Transaction Date then Value
        // Date is a different rule from the reverse, and the two genuinely disagree on real rows.
        expect(columnReadSources(date)).toBe('D "Transaction Date", C "Value Date"');
        expect(columnReadSources(date).indexOf("Transaction Date")).toBeLessThan(
            columnReadSources(date).indexOf("Value Date")
        );
    });

    it("appends the note, and only when there is one", () => {
        expect(columnReadLine(date)).toBe(
            'Date — D "Transaction Date", C "Value Date" (the first one that has a value)'
        );
        expect(columnReadLine(transferId)).not.toContain("(");
    });

    it("names a blank header instead of rendering an empty pair of quotes", () => {
        // `B ""` reads as a rendering fault; "a column with no name" is the fact.
        const unnamed: StatementSheetColumnRead = {
            label: "Reference",
            columns: [{ header: "   ", letter: "F" }],
        };
        expect(columnReadSources(unnamed)).toBe("F (unnamed column)");
    });

    it("says so when a field arrived with no columns at all", () => {
        // Returning "" would render `Reference — ` and read as a broken row rather than as an
        // adapter that mapped nothing.
        const empty: StatementSheetColumnRead = { label: "Reference", columns: [] };
        expect(columnReadSources(empty)).toBe("(no column)");
        expect(columnReadLine(empty)).toBe("Reference — (no column)");
    });
});
