// U1 -- the pricing grid's header column filters. The popover's RENDER is unreachable in this
// repo's node-env vitest (no jsdom, by deliberate config), so the RULES are pinned here: the
// composition law, the pass-through-when-empty guarantee, and the label/id split.
import { describe, it, expect } from "vitest";
import {
  passesColumnFilter,
  BLANKS_FILTER_ID,
  BLANKS_FILTER_LABEL,
  type ColumnFilterOption,
} from "./GridColumnFilter";

describe("passesColumnFilter -- the per-column predicate", () => {
  it("an EMPTY selection is a PASS-THROUGH, never 'hide everything'", () => {
    const none = new Set<string>();
    expect(passesColumnFilter(none, "line_item")).toBe(true);
    expect(passesColumnFilter(none, null)).toBe(true);
    expect(passesColumnFilter(none, undefined)).toBe(true);
    expect(passesColumnFilter(none, "")).toBe(true);
  });

  it("OR within a column: any selected id matches", () => {
    const sel = new Set(["note", "spacer"]);
    expect(passesColumnFilter(sel, "note")).toBe(true);
    expect(passesColumnFilter(sel, "spacer")).toBe(true);
  });

  it("(negative) an unselected value is excluded while the filter is active", () => {
    const sel = new Set(["note"]);
    expect(passesColumnFilter(sel, "line_item")).toBe(false);
    expect(passesColumnFilter(sel, "preamble")).toBe(false);
  });

  it("null/undefined fold onto the (Blanks) sentinel, so a blank row is still reachable", () => {
    const blanksOnly = new Set([BLANKS_FILTER_ID]);
    expect(passesColumnFilter(blanksOnly, null)).toBe(true);
    expect(passesColumnFilter(blanksOnly, undefined)).toBe(true);
    expect(passesColumnFilter(blanksOnly, "")).toBe(true);
    // ...and a real value is NOT swept into (Blanks)
    expect(passesColumnFilter(blanksOnly, "line_item")).toBe(false);
  });

  it("the (Blanks) sentinel is the empty string -- it can never collide with a real id", () => {
    expect(BLANKS_FILTER_ID).toBe("");
    expect(BLANKS_FILTER_LABEL).toBe("(Blanks)");
  });
});

// "Filter on the label, match on the id": display/search/sort use `label`, the predicate uses `id`.
// This is what stops a catalog LABEL edit from silently breaking a live filter selection.
describe("the label/id split", () => {
  const opts: ColumnFilterOption[] = [
    { id: "wiring_cabling", label: "Wiring, Cabling & Termination" },
    { id: "db_switchgear", label: "DB & Switchgear" },
  ];

  it("a selection is stored as IDS, so it survives a label change", () => {
    const sel = new Set(["wiring_cabling"]);
    expect(passesColumnFilter(sel, "wiring_cabling")).toBe(true);
    // the operator renames the category in the catalog -- the option's label moves...
    const renamed: ColumnFilterOption[] = [
      { id: "wiring_cabling", label: "Cabling (renamed)" },
      ...opts.slice(1),
    ];
    expect(renamed[0].label).not.toBe(opts[0].label);
    // ...and the SAME selection still matches, because it never held the label
    expect(passesColumnFilter(sel, "wiring_cabling")).toBe(true);
  });

  it("(negative) selecting by LABEL text would not match -- ids are the only key", () => {
    const wrong = new Set(["Wiring, Cabling & Termination"]);
    expect(passesColumnFilter(wrong, "wiring_cabling")).toBe(false);
  });

  it("sorting is by LABEL, which is not the id order", () => {
    const sorted = [...opts].sort((a, b) => a.label.localeCompare(b.label));
    expect(sorted.map((o) => o.id)).toEqual(["db_switchgear", "wiring_cabling"]);
  });
});

// The composition law the page implements in passesViewFilter: AND across columns.
describe("composition -- AND across columns", () => {
  const passes = (
    rowType: string | null,
    categoryId: string | null,
    rowTypeSel: Set<string>,
    catSel: Set<string>,
  ) => passesColumnFilter(rowTypeSel, rowType) && passesColumnFilter(catSel, categoryId);

  it("both columns filtered: a row must satisfy BOTH", () => {
    const rt = new Set(["line_item"]);
    const cat = new Set(["wiring_cabling"]);
    expect(passes("line_item", "wiring_cabling", rt, cat)).toBe(true);
    expect(passes("line_item", "db_switchgear", rt, cat)).toBe(false);
    expect(passes("note", "wiring_cabling", rt, cat)).toBe(false);
  });

  it("one column filtered, the other empty: only the active axis bites", () => {
    const rt = new Set(["line_item"]);
    const none = new Set<string>();
    expect(passes("line_item", "anything", rt, none)).toBe(true);
    expect(passes("note", "anything", rt, none)).toBe(false);
  });
});
