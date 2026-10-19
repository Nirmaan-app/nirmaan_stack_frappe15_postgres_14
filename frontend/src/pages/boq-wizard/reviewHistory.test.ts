import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { describeRevertEntry, reasonWithExcelRows } from "./reviewHistory";

// S5's BOQ-26-00649 / HVAC: row index 5 = Excel 9 (parsed Preamble, parent index 2 = Excel 6),
// its children index 6-9 = Excel 10-13.
const EXCEL: Record<number, number> = { 2: 6, 5: 9, 6: 10, 7: 11, 8: 12, 9: 13, 11: 15 };
const parentLabel = (v: unknown) => {
  const n = Number(v);
  if (v === null || v === undefined || !Number.isFinite(n) || n < 0) return "root";
  return EXCEL[n] !== undefined ? `row ${EXCEL[n]}` : String(n);
};
const ctx = { parsedClassification: "preamble", parentLabel, parsedParent: 2 };

describe("revert history wording (S6 F7 / U6, Q-h)", () => {
  it("a type revert names the type the row went back to (was 'Note → —')", () => {
    const entry = { field: "human_classification", from: "note", to: null, reason: "reverted to parser" };
    expect(describeRevertEntry(entry, ctx)).toEqual({ verb: "Reverted", detail: "Note → Preamble", showField: false });
  });

  it("a parent revert names the parent the row went back to (was '→ root')", () => {
    const entry = { field: "human_parent", from: 11, to: null, reason: "reverted to parser" };
    expect(describeRevertEntry(entry, ctx)).toEqual({ verb: "Reverted parent", detail: "→ row 6", showField: false });
    const child = { field: "human_parent", from: null, to: null, reason: "reverted with row 5 (parent restore)" };
    expect(describeRevertEntry(child, ctx)?.detail).toBe("→ row 6");
    expect(describeRevertEntry(child, { ...ctx, parsedParent: -1 })?.detail).toBe("→ root");
  });

  it("is not a revert -> null (the caller describes it as before)", () => {
    expect(describeRevertEntry({ field: "human_classification", from: "preamble", to: "note", reason: null }, ctx)).toBeNull();
    expect(describeRevertEntry({ field: "human_parent", from: 5, to: null, reason: "parent moved: row 5 reclassified to note" }, ctx)).toBeNull();
    expect(describeRevertEntry({ field: "human_classification", from: null, to: null, reason: "reverted to parser" }, ctx)).toBeNull();
    expect(describeRevertEntry({ field: "qty_total", from: 3, to: null, reason: "reverted to parser" }, ctx)).toBeNull();
  });

  it("ReviewTree asks it first and keeps every other wording (source)", () => {
    const tree = readFileSync(join(__dirname, "ReviewTree.tsx"), "utf8");
    expect(tree).toContain("const reverted = describeRevertEntry(entry, {");
    expect(tree).toContain('verb: "Reclassified"');
    expect(tree).toContain('verb: "Moved parent"');
  });
});

describe("history reasons show the Excel row (S6 F13 / U11)", () => {
  const excelOf = (i: number) => EXCEL[i];

  it("translates every 'row N' from the internal index to the Excel row", () => {
    expect(reasonWithExcelRows("parent moved: row 5 reclassified to note", excelOf)).toBe("parent moved: row 9 reclassified to note");
    expect(reasonWithExcelRows("row moved: row 8 reclassified to line_item", excelOf)).toBe("row moved: row 12 reclassified to line_item");
    expect(reasonWithExcelRows("reverted with row 5 (parent restore)", excelOf)).toBe("reverted with row 9 (parent restore)");
  });

  it("leaves other text alone, and keeps a number that is not on the sheet", () => {
    expect(reasonWithExcelRows("reverted to parser", excelOf)).toBe("reverted to parser");
    expect(reasonWithExcelRows("parent moved: row 99 reclassified to note", excelOf)).toBe("parent moved: row 99 reclassified to note");
    expect(reasonWithExcelRows("rows 5 and borrow 5", excelOf)).toBe("rows 5 and borrow 5");
  });

  it("ReviewTree shows the translated reason, never the stored one raw (source)", () => {
    const tree = readFileSync(join(__dirname, "ReviewTree.tsx"), "utf8");
    expect(tree).toContain("reason: {reasonText(entry.reason)}");
    expect(tree).not.toContain("reason: {entry.reason}");
  });
});
