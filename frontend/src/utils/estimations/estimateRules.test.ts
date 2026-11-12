import { describe, expect, it } from "vitest";

import {
  duplicateProblem, gridRows, itemRowProblem, lineGroups, materialTotals, projectAllowsEstimateEdits, rowTypeLabel,
} from "./estimateRules";
import type { EstimateEntry, SheetRow } from "./estimateTypes";

const row = (over: Partial<SheetRow>): SheetRow => ({
  name: "N", row_index: 0, effective_parent_index: null, source_row_number: null, classification: "line_item",
  sl_no_value: null, description: "", unit: null, qty_total: null, rate_supply: null, rate_install: null,
  amount_total: null, ...over,
});

const sheet: SheetRow[] = [
  row({ name: "H1", row_index: 0, source_row_number: 9, classification: "preamble", description: "MADE-UP SYSTEM" }),
  row({ name: "NT", row_index: 1, source_row_number: 10, classification: "note", effective_parent_index: 0 }),
  row({ name: "L1", row_index: 2, source_row_number: 15, effective_parent_index: 0, description: "Made-up plenum" }),
  row({ name: "L2", row_index: 3, source_row_number: 16, effective_parent_index: 0, description: "Made-up diffuser" }),
  row({ name: "ST", row_index: 4, source_row_number: 17, classification: "subtotal_marker" }),
  row({ name: "H2", row_index: 5, source_row_number: 19, classification: "preamble", description: "MADE-UP DUCTS" }),
  row({ name: "L3", row_index: 6, source_row_number: 20, effective_parent_index: 5, description: "Made-up sheet" }),
];

const all = { showNotes: true, showSubtotals: true, showSpacers: true, search: "" };

describe("row types", () => {
  it("labels rows as the sheet viewer does", () => {
    expect(["line_item", "preamble", "note", "subtotal_marker", "spacer"].map(rowTypeLabel))
      .toEqual(["Item", "Preamble", "Note", "Subtotal", "Spacer"]);
  });
});

describe("gridRows", () => {
  it("keeps every row and resolves each parent's Excel row", () => {
    const out = gridRows(sheet, all);
    expect(out.map((r) => r.name)).toEqual(["H1", "NT", "L1", "L2", "ST", "H2", "L3"]);
    expect(out.find((r) => r.name === "L3")?.parentExcelRow).toBe(19);
  });

  it("hides notes and subtotals when switched off", () => {
    const out = gridRows(sheet, { ...all, showNotes: false, showSubtotals: false });
    expect(out.map((r) => r.name)).toEqual(["H1", "L1", "L2", "H2", "L3"]);
  });

  it("searches descriptions but keeps headings", () => {
    expect(gridRows(sheet, { ...all, search: "DIFFUSER" }).map((r) => r.name)).toEqual(["H1", "L2", "H2"]);
  });
});

describe("lineGroups", () => {
  it("puts each line item under the heading above it", () => {
    const groups = lineGroups(sheet, () => true);
    expect(groups.map((g) => [g.heading?.name, g.lines.map((l) => l.name)])).toEqual([["H1", ["L1", "L2"]], ["H2", ["L3"]]]);
  });

  it("drops a heading left with no line item", () => {
    const groups = lineGroups(sheet, (r) => r.name === "L3");
    expect(groups.map((g) => g.heading?.name)).toEqual(["H2"]);
  });
});

const entry = (node: string, items: EstimateEntry["items"]): EstimateEntry => ({
  name: `E-${node}`, modified: "", boq_node: node, item_count: items.length, items,
  line: { sheet_name: "S", excel_row: 1, sl_no: null, description: null, unit: null, qty: null, is_current: true },
});

describe("materialTotals", () => {
  const entries = [
    entry("L1", [
      { item_type: "Normal", item_id: "I1", item_name: "Made-up frame", make: "Make A", unit: "rmt", quantity: 220 },
      { item_type: "Custom", item_name: "Spacer Clip", unit: "pkt", quantity: 4 },
    ]),
    entry("L2", [
      { item_type: "Normal", item_id: "I1", item_name: "Made-up frame", make: "Make A", unit: "rmt", quantity: 64 },
      { item_type: "Normal", item_id: "I1", item_name: "Made-up frame", make: "Make B", unit: "rmt", quantity: 10 },
      { item_type: "Custom", item_name: "  spacer clip ", unit: "PKT", quantity: 6 },
    ]),
  ];

  it("adds the same item + make + unit across lines, keeping makes apart", () => {
    const totals = materialTotals(entries);
    const frameA = totals.find((t) => t.make === "Make A");
    expect([frameA?.quantity, frameA?.lines]).toEqual([284, 2]);
    expect(totals.find((t) => t.make === "Make B")?.quantity).toBe(10);
  });

  it("groups custom items by name + unit, ignoring case and spaces", () => {
    const clips = materialTotals(entries, "Custom");
    expect(clips.map((t) => [t.quantity, t.lines])).toEqual([[10, 2]]);
  });
});

describe("form checks", () => {
  it("refuses what the server refuses", () => {
    expect(itemRowProblem({ item_type: "Normal", item_id: "", quantity: 1 })).toMatch(/Pick an item/);
    expect(itemRowProblem({ item_type: "Normal", item_id: "I1", unit: "NOS", quantity: 1.5 })).toMatch(/whole numbers/);
    expect(itemRowProblem({ item_type: "Custom", item_name: "x", unit: "pkt", category: "", quantity: 1 })).toMatch(/category/);
    expect(itemRowProblem({ item_type: "Normal", item_id: "I1", unit: "sqm", quantity: 0 })).toMatch(/above 0/);
    expect(itemRowProblem({ item_type: "Normal", item_id: "I1", unit: "sqm", quantity: 1.5 })).toBeNull();
  });

  it("refuses the same item + make twice, allows another make", () => {
    const a = { item_type: "Normal" as const, item_id: "I1", make: "Make A", quantity: 1 };
    expect(duplicateProblem([a, { ...a }])).toMatch(/twice/);
    expect(duplicateProblem([a, { ...a, make: "Make B" }])).toBeNull();
  });

  it("is read-only on Completed and Handover projects only", () => {
    expect(["Completed", "Handover", "WIP", "CEO Hold"].map(projectAllowsEstimateEdits)).toEqual([false, false, true, true]);
  });
});

describe("form checks: edges the server also refuses", () => {
  const normal = (quantity: number, unit = "sqm") => ({ item_type: "Normal" as const, item_id: "I1", unit, quantity });

  it("refuses an endless or non-numeric quantity instead of letting it through", () => {
    for (const q of [Infinity, -Infinity, NaN, -1]) expect(itemRowProblem(normal(q)), String(q)).toMatch(/above 0/);
  });

  it("counts NOS and SET in whole pieces whatever the case and spaces, and nothing else", () => {
    expect(itemRowProblem(normal(1.5, " nos "))).toMatch(/whole numbers/);
    expect(itemRowProblem(normal(1.5, "Set"))).toMatch(/whole numbers/);
    expect(itemRowProblem(normal(1.5, "kg"))).toBeNull();
    expect(itemRowProblem(normal(2, "NOS"))).toBeNull();
  });

  it("asks a custom item for its name and unit too", () => {
    expect(itemRowProblem({ item_type: "Custom", item_name: "  ", unit: "pkt", category: "C", quantity: 1 })).toMatch(/name/);
    expect(itemRowProblem({ item_type: "Custom", item_name: "x", unit: "", category: "C", quantity: 1 })).toMatch(/unit/);
  });

  it("never lets a custom row clash with a normal one, and repeats a custom name only in another unit", () => {
    const custom = { item_type: "Custom" as const, item_name: "Clip", unit: "pkt", category: "C", quantity: 1 };
    expect(duplicateProblem([{ item_type: "Normal", item_id: "Clip", item_name: "Clip", quantity: 1 }, custom])).toBeNull();
    expect(duplicateProblem([custom, { ...custom, item_name: " clip ", unit: "PKT" }])).toMatch(/custom item/);
    expect(duplicateProblem([custom, { ...custom, unit: "nos" }])).toBeNull();
  });

  it("treats a missing or padded project status as its plain value", () => {
    expect([null, undefined, "", " Completed "].map(projectAllowsEstimateEdits)).toEqual([true, true, true, false]);
  });
});

describe("materialTotals: the type filter and units", () => {
  const e = entry("L1", [
    { item_type: "Normal", item_id: "I1", item_name: "Made-up frame", make: null, unit: "rmt", quantity: 2 },
    { item_type: "Normal", item_id: "I1", item_name: "Made-up frame", make: null, unit: "nos", quantity: 3 },
    { item_type: "Custom", item_name: "Spacer Clip", unit: "pkt", quantity: 4 },
  ]);

  it("Normal leaves custom items out, and different units are never added together", () => {
    expect(materialTotals([e], "Normal").map((t) => [t.unit, t.quantity])).toEqual([["nos", 3], ["rmt", 2]]);
  });

  it("is empty with no estimates", () => {
    expect(materialTotals([])).toEqual([]);
  });
});
