/**
 * exportViewerXlsx.test.ts -- the committed-sheet viewer's .xlsx column set + value rules.
 *
 * `buildViewerSheet` is pure (ADR-0010 F4) precisely so it can be pinned here: the download
 * BUTTON is a React render and this repo has NO DOM test environment (frontend/CLAUDE.md), so
 * the click path is structurally untestable. What CAN be pinned is the thing that actually
 * matters -- which columns land in the file, and what each cell holds.
 *
 * The load-bearing case is `the permission gate`: a descriptor list with no rate/amount
 * descriptors must produce a file with no rate/amount columns. That is the whole reason the
 * workbook is built in the browser instead of by `export_priced_workbook`, and a comment
 * asserting it would not survive a refactor.
 */

import { describe, it, expect } from "vitest";
import { buildViewerSheet } from "./exportViewerXlsx";
import type {
  ColumnDescriptor,
  ColumnFormula,
  PricedRow,
  SheetCategoryRow,
} from "./boqTypes";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const desc = (over: Partial<ColumnDescriptor>): ColumnDescriptor =>
  ({
    col: "D",
    role: "qty",
    area: null,
    value_field: "quantities",
    value_key: null,
    rate_subkey: null,
    ...over,
  }) as ColumnDescriptor;

const QTY = desc({ col: "D", role: "qty", value_field: "qty_by_area", value_key: "Area 1" });
const UNIT = desc({ col: "C", role: "unit", value_field: "unit", value_key: null });
const RATE = desc({
  col: "E",
  role: "rate",
  value_field: "rate_by_area",
  value_key: "Area 1",
  rate_subkey: "supply_rate",
});
// ⚠️ rate_subkey "supply", NOT "supply_rate": PER_AREA_AMOUNT_TO_RATE_KIND maps an AMOUNT's
// subkey (total/supply/install) onto the RATE's (combined_rate/supply_rate/install_rate).
const AMOUNT = desc({
  col: "F",
  role: "amount",
  value_field: "amount_by_area",
  value_key: "Area 1",
  rate_subkey: "supply",
});

const row = (over: Partial<PricedRow>): PricedRow =>
  ({
    name: "n1",
    boq: "BOQ-1",
    sheet_name: "S",
    source_row_number: 10,
    row_index: 0,
    classification: "line_item",
    effective_classification: "line_item",
    effective_parent_index: -1,
    level: null,
    parent_index: -1,
    sl_no_value: "1",
    description: "A pipe",
    remark: null,
    ...over,
  }) as unknown as PricedRow;

const build = (
  rows: PricedRow[],
  columnDescriptors: ColumnDescriptor[],
  columnFormulas: ColumnFormula[] = [],
  extra: Partial<Parameters<typeof buildViewerSheet>[0]> = {},
) =>
  buildViewerSheet({
    sheetName: "Sheet A",
    rows,
    columnDescriptors,
    columnFormulas,
    ...extra,
  });

// ── The permission gate ───────────────────────────────────────────────────────

describe("the commercials gate is expressed by the descriptor list", () => {
  it("writes rate + amount columns when they are handed in", () => {
    const { headers } = build([row({})], [UNIT, QTY, RATE, AMOUNT]);
    expect(headers.some((h) => h.startsWith("E —"))).toBe(true);
    expect(headers.some((h) => h.startsWith("F —"))).toBe(true);
  });

  it("writes NO rate or amount column when they are withheld", () => {
    // This is the whole security property: the page filters the descriptor list for a reader
    // without canSeeBoqCommercials, and the builder writes only what it is given -- so a
    // column the grid was never handed cannot reach the file either.
    const { headers, cells } = build([row({})], [UNIT, QTY]);
    expect(headers.some((h) => h.startsWith("E —"))).toBe(false);
    expect(headers.some((h) => h.startsWith("F —"))).toBe(false);
    // And no stray cell is left behind: every row is exactly as wide as the header.
    for (const r of cells) expect(r.length).toBe(headers.length);
  });

  it("never names a cost/BCS column -- that block is deliberately absent", () => {
    // The internal cost workbook is gated to {Admin, Estimates}; canSeeBoqCommercials is
    // wider. Appending a cost column here would widen the audience for a cost-bearing file
    // with no gate, so the module carries none. Mirrors the grep guard on export_writeback.py.
    const { headers } = build([row({})], [UNIT, QTY, RATE, AMOUNT]);
    for (const h of headers) expect(h.toLowerCase()).not.toContain("bcs");
    expect(headers.some((h) => h.toLowerCase().includes("margin"))).toBe(false);
  });
});

// ── Column set + ordering ─────────────────────────────────────────────────────

describe("column set", () => {
  it("leads with the fixed columns and ends with Remarks", () => {
    const { headers } = build([row({})], [UNIT, QTY]);
    expect(headers.slice(0, 8)).toEqual([
      "Sheet Name",
      "Excel Row",
      "Sl.No",
      "Parent Excel Row",
      "Depth",
      "Row Type",
      "Description",
      "Category",
    ]);
    expect(headers[headers.length - 1]).toBe("Remarks");
  });

  it("drops the sl_no + description descriptors -- they have their own fixed columns", () => {
    const slNoDesc = desc({ col: "A", role: "sl_no", value_field: "sl_no_value" });
    const descDesc = desc({ col: "B", role: "description", value_field: "description" });
    const { headers } = build([row({})], [slNoDesc, descDesc, UNIT]);
    expect(headers.some((h) => h.startsWith("A —"))).toBe(false);
    expect(headers.some((h) => h.startsWith("B —"))).toBe(false);
    expect(headers.some((h) => h.startsWith("C —"))).toBe(true);
  });

  it("preserves the payload's descriptor order", () => {
    const { headers } = build([row({})], [UNIT, QTY, RATE]);
    const dataCols = headers.filter((h) => /^[A-Z] —/.test(h));
    expect(dataCols.map((h) => h[0])).toEqual(["C", "D", "E"]);
  });

  it("rows are always exactly as wide as the header", () => {
    const { headers, cells } = build(
      [row({ row_index: 0 }), row({ row_index: 1, source_row_number: 11 })],
      [UNIT, QTY, RATE, AMOUNT],
    );
    expect(cells).toHaveLength(2);
    for (const r of cells) expect(r.length).toBe(headers.length);
  });
});

// ── Cell values ───────────────────────────────────────────────────────────────

describe("cell values", () => {
  it("exports the WHOLE sheet in row_index order, not the caller's array order", () => {
    // A downloaded file outlives the view that made it, so the order must be the sheet's.
    const { cells } = build(
      [
        row({ row_index: 2, source_row_number: 30 }),
        row({ row_index: 0, source_row_number: 10 }),
        row({ row_index: 1, source_row_number: 20 }),
      ],
      [UNIT],
    );
    expect(cells.map((r) => r[1])).toEqual([10, 20, 30]);
  });

  it("keeps the sheet name VERBATIM, trailing spaces intact (#152)", () => {
    const { cells } = buildViewerSheet({
      sheetName: "Electrical ",
      rows: [row({})],
      columnDescriptors: [UNIT],
      columnFormulas: [],
    });
    expect(cells[0][0]).toBe("Electrical ");
  });

  it("writes numbers as NUMBERS and blanks as null", () => {
    const { headers, cells } = build(
      [row({ qty_by_area: { "Area 1": 7 } } as Partial<PricedRow>)],
      [UNIT, QTY],
    );
    const qtyAt = headers.findIndex((h) => h.startsWith("D —"));
    const unitAt = headers.findIndex((h) => h.startsWith("C —"));
    expect(cells[0][qtyAt]).toBe(7);
    expect(typeof cells[0][qtyAt]).toBe("number");
    expect(cells[0][unitAt]).toBeNull(); // absent -> blank, never ""
  });

  it("distinguishes a real 0 from an absent value", () => {
    // A 0 is a claim the sheet makes ("none of this here"); absence is not. Collapsing them
    // would put a number in the file that the sheet never stated.
    const { headers, cells } = build(
      [
        row({ row_index: 0, qty_by_area: { "Area 1": 0 } } as Partial<PricedRow>),
        row({ row_index: 1, source_row_number: 11 }),
      ],
      [QTY],
    );
    const qtyAt = headers.findIndex((h) => h.startsWith("D —"));
    expect(cells[0][qtyAt]).toBe(0);
    expect(cells[1][qtyAt]).toBeNull();
  });

  it("resolves the parent to an EXCEL row, and leaves a root blank", () => {
    const { headers, cells } = build(
      [
        row({ row_index: 0, source_row_number: 10, effective_parent_index: -1 }),
        row({ row_index: 1, source_row_number: 11, effective_parent_index: 0 }),
      ],
      [UNIT],
    );
    const parentAt = headers.indexOf("Parent Excel Row");
    expect(cells[0][parentAt]).toBeNull(); // root
    expect(cells[1][parentAt]).toBe(10); // the PARENT'S excel row, not its row_index
  });

  it("labels the row type, falling back to the raw value", () => {
    const { headers, cells } = build(
      [
        row({ row_index: 0, effective_classification: "line_item" }),
        row({ row_index: 1, source_row_number: 11, effective_classification: "wat" }),
      ],
      [UNIT],
    );
    const typeAt = headers.indexOf("Row Type");
    expect(cells[0][typeAt]).toBe("Item");
    expect(cells[1][typeAt]).toBe("wat");
  });

  it("shows the category LABEL, falling back to the id, else blank", () => {
    const cats = new Map<number, SheetCategoryRow>([
      [10, { effective_category_id: "hvac_ahu" } as SheetCategoryRow],
      [11, { effective_category_id: "not_in_catalog" } as SheetCategoryRow],
    ]);
    const labels = new Map([["hvac_ahu", "AHU"]]);
    const { headers, cells } = build(
      [
        row({ row_index: 0, source_row_number: 10 }),
        row({ row_index: 1, source_row_number: 11 }),
        row({ row_index: 2, source_row_number: 12 }),
      ],
      [UNIT],
      [],
      { categoriesByExcelRow: cats, categoryLabelById: labels },
    );
    const catAt = headers.indexOf("Category");
    expect(cells[0][catAt]).toBe("AHU");
    expect(cells[1][catAt]).toBe("not_in_catalog"); // never vanishes
    expect(cells[2][catAt]).toBeNull(); // no verdict -> blank
  });
});

// ── Amounts ───────────────────────────────────────────────────────────────────

describe("amount columns go through the grid's own evaluator", () => {
  it("writes a resolved amount as a number", () => {
    const r = row({
      qty_by_area: { "Area 1": 4 },
      rate_by_area: { "Area 1": { supply_rate: 25 } },
      priced_by_area: { "Area 1": { supply_rate: true } },
    } as Partial<PricedRow>);
    const { headers, cells } = build([r], [QTY, RATE, AMOUNT]);
    const amtAt = headers.findIndex((h) => h.startsWith("F —"));
    expect(cells[0][amtAt]).toBe(100);
  });

  it("writes a BLANK, never a 0, when the amount cannot resolve", () => {
    // An unpriced rate blanks the cell in the grid; a 0 in the file would assert a total the
    // sheet does not have, and it would look authoritative in Excel.
    const r = row({ qty_by_area: { "Area 1": 4 } } as Partial<PricedRow>);
    const { headers, cells } = build([r], [QTY, RATE, AMOUNT]);
    const amtAt = headers.findIndex((h) => h.startsWith("F —"));
    expect(cells[0][amtAt]).toBeNull();
  });
});
