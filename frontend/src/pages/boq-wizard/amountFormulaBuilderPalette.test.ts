// Unit tests for the amount/BCS formula builder's PALETTE GROUPING (BCS-S9-fix).
//
// WHY THIS FILE EXISTS. The group headings were a hardcoded ["Quantity","Rate","Amount"] inline
// at the render site. When the BCS Total builder introduced a fourth group, its chips were
// built into the palette correctly and then never rendered -- the BCS builder opened offering
// only Total Quantity, with no way to name a cost. Nothing threw, nothing failed to compile,
// and the "empty palette" message did not fire because the palette was not empty.
//
// This repo has NO DOM test environment, so the render itself cannot be asserted. Extracting
// the ordering decision into a pure function is what makes the failure class testable at all.
import { describe, it, expect } from "vitest";
import { paletteGroupOrder } from "./AmountFormulaBuilder";

const chips = (...groups: string[]) => groups.map((group) => ({ group }));

describe("paletteGroupOrder", () => {
  it("keeps the canonical three, in order, for an amount column", () => {
    expect(paletteGroupOrder(chips("Rate", "Quantity", "Amount"))).toEqual([
      "Quantity",
      "Rate",
      "Amount",
    ]);
  });

  it("emits the canonical three even when the palette is empty", () => {
    // The caller skips groups with no items, so emitting them unconditionally is what keeps an
    // amount column's rendering byte-identical to before the fix.
    expect(paletteGroupOrder([])).toEqual(["Quantity", "Rate", "Amount"]);
  });

  it("★ INCLUDES A GROUP OUTSIDE THE CANONICAL THREE -- the bug this fixes", () => {
    // "BCS Rate" is the group the BCS Total builder's cost chips carry. Before the fix it was
    // absent from the render list, so those chips existed and were invisible.
    expect(paletteGroupOrder(chips("Quantity", "BCS Rate"))).toContain("BCS Rate");
  });

  it("puts a new group AFTER the canonical three, in first-appearance order", () => {
    expect(paletteGroupOrder(chips("BCS Rate", "Quantity", "Zeta"))).toEqual([
      "Quantity",
      "Rate",
      "Amount",
      "BCS Rate",
      "Zeta",
    ]);
  });

  it("never repeats a group, however many chips carry it", () => {
    const order = paletteGroupOrder(chips("BCS Rate", "BCS Rate", "BCS Rate", "Quantity"));
    expect(order).toEqual([...new Set(order)]);
    expect(order.filter((g) => g === "BCS Rate")).toHaveLength(1);
  });

  it("the BCS palette's own two groups both survive", () => {
    // Exactly the shape PricingGrid builds: cost chips then the quantity chip.
    const order = paletteGroupOrder(chips("BCS Rate", "BCS Rate", "Quantity"));
    expect(order).toContain("Quantity");
    expect(order).toContain("BCS Rate");
  });
});
