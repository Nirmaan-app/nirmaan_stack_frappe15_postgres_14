/**
 * bcsColumns.test.ts -- the BCS two-column confirmation rules (slice BCS-S2).
 *
 * WHAT THESE TESTS ARE FOR. The card lets a human pick which columns hold the row's Total
 * Quantity and its Amount (Combined). The SERVER decides what a valid pick is
 * (`services/boq_bcs/sources.py`, slices S1a-S1c) and REFUSES the rest. This module mirrors
 * those refusals so the card can never say "looks fine" about something the server will throw
 * on -- so every test below names the server rule it pins, and the ORDER of the refusals is
 * itself under test, because the server's order decides WHICH message a bad pick gets.
 *
 * The wording is deliberately friendlier than the server's; the CONDITIONS are identical.
 */
import { describe, expect, it } from "vitest";
import type { ColumnDescriptor } from "./boqTypes";
import {
  bcsChipLabel,
  bcsColumnLabel,
  bcsSelectionSaveable,
  bcsSetupReason,
  bcsSourceCols,
  buildBcsDescriptorIndex,
  eligibleBcsColumns,
  isBcsAmountColumn,
  isBcsQtyColumn,
  validateBcsPicks,
} from "./bcsColumns";

// ── A committed sheet's descriptor set, in the exact shape review_screen
// ._build_column_descriptors emits (the resolver `_committed_descriptors` feeds the server). ──
function desc(
  col: string,
  role: string,
  value_field: string,
  area: string | null = null,
  rate_subkey: string | null = null,
): ColumnDescriptor {
  return { col, role, area, value_field, value_key: area, rate_subkey };
}

/** A scalar descriptor: value_key is null even when it is not area-bound. */
function scalar(col: string, role: string, value_field: string): ColumnDescriptor {
  return { col, role, area: null, value_field, value_key: null, rate_subkey: null };
}

const SHEET: ColumnDescriptor[] = [
  scalar("A", "description", "description"),
  desc("B", "qty", "qty_by_area", "Zone A"),
  desc("C", "qty", "qty_by_area", "Zone B"),
  scalar("D", "qty_total", "qty_total"),
  // E aliases B: review_screen imposes NO uniqueness on (role, area) across columns, so a
  // sheet really can map Zone A quantity twice (the S1c defect).
  desc("E", "qty", "qty_by_area", "Zone A"),
  scalar("F", "amount_total", "amount_total"),
  desc("G", "amount_total_by_area", "amount_by_area", "Zone A", "total"),
  desc("H", "amount_total_by_area", "amount_by_area", "Zone B", "total"),
  // The per-area SUPPLY half -- refused: it is a fraction of what we charge the client.
  desc("I", "amount_supply_by_area", "amount_by_area", "Zone A", "supply"),
  // The scalar supply half -- refused for the same reason.
  scalar("J", "amount_supply", "amount_supply"),
  scalar("K", "rate_combined", "rate_combined"),
  // A second scalar total quantity (a sheet can map the role twice).
  scalar("L", "qty_total", "qty_total"),
];

const INDEX = buildBcsDescriptorIndex(SHEET);

// ===========================================================================
// Group 1: which columns each side may offer at all
// ===========================================================================
describe("eligibility -- what the card is allowed to offer", () => {
  it("counts the scalar total and the per-area quantity columns as quantity", () => {
    expect(isBcsQtyColumn(scalar("D", "qty_total", "qty_total"))).toBe(true);
    expect(isBcsQtyColumn(desc("B", "qty", "qty_by_area", "Zone A"))).toBe(true);
  });

  it("does not count an amount, a rate or a description as quantity", () => {
    expect(isBcsQtyColumn(scalar("F", "amount_total", "amount_total"))).toBe(false);
    expect(isBcsQtyColumn(scalar("K", "rate_combined", "rate_combined"))).toBe(false);
    expect(isBcsQtyColumn(scalar("A", "description", "description"))).toBe(false);
  });

  it("counts only COMBINED amounts -- the scalar total and the per-area 'total' subkey", () => {
    expect(isBcsAmountColumn(scalar("F", "amount_total", "amount_total"))).toBe(true);
    expect(
      isBcsAmountColumn(desc("G", "amount_total_by_area", "amount_by_area", "Zone A", "total")),
    ).toBe(true);
  });

  it("rejects the supply/install HALF of an amount, per-area and scalar alike", () => {
    // The half is a FRACTION of what we charge the client -- accepting it would silently
    // compare our cost against part of the charged amount.
    expect(
      isBcsAmountColumn(desc("I", "amount_supply_by_area", "amount_by_area", "Zone A", "supply")),
    ).toBe(false);
    expect(
      isBcsAmountColumn(desc("X", "amount_install_by_area", "amount_by_area", "Zone A", "install")),
    ).toBe(false);
    expect(isBcsAmountColumn(scalar("J", "amount_supply", "amount_supply"))).toBe(false);
    expect(isBcsAmountColumn(scalar("Y", "amount_install", "amount_install"))).toBe(false);
  });

  it("rejects a rate column as an amount (a rate is not what we charge)", () => {
    expect(isBcsAmountColumn(scalar("K", "rate_combined", "rate_combined"))).toBe(false);
  });

  it("offers exactly the eligible columns for each side, in sheet order", () => {
    expect(eligibleBcsColumns("qty", SHEET).map((d) => d.col)).toEqual(["B", "C", "D", "E", "L"]);
    expect(eligibleBcsColumns("amount", SHEET).map((d) => d.col)).toEqual(["F", "G", "H"]);
  });

  it("offers nothing when the sheet maps nothing relevant", () => {
    const bare = [scalar("A", "description", "description")];
    expect(eligibleBcsColumns("qty", bare)).toEqual([]);
    expect(eligibleBcsColumns("amount", bare)).toEqual([]);
  });
});

// ===========================================================================
// Group 2: how a column is named on a chip (AmountFormulaBuilder's convention)
// ===========================================================================
describe("column labels", () => {
  it("names a scalar column by its role alone", () => {
    expect(bcsColumnLabel(scalar("D", "qty_total", "qty_total"))).toBe("Total Quantity");
  });

  it("names a per-area column Role · Area", () => {
    expect(bcsColumnLabel(desc("B", "qty", "qty_by_area", "Zone A"))).toBe("Quantity · Zone A");
  });

  it("falls back to the raw role when there is no friendly label", () => {
    expect(bcsColumnLabel(scalar("Z", "some_new_role", "qty_total"))).toBe("some_new_role");
  });

  it("omits the area when an area-bound column carries none", () => {
    expect(bcsColumnLabel(desc("B", "qty", "qty_by_area", null))).toBe("Quantity");
  });
});

// ===========================================================================
// Group 3: the refusals -- one per server rule, in the server's own precedence
// ===========================================================================
describe("quantity picks -- mirroring build_qty_source", () => {
  it("refuses an empty pick", () => {
    const v = validateBcsPicks("qty", [], INDEX);
    expect(v.ok).toBe(false);
    expect(!v.ok && v.message).toMatch(/pick/i);
  });

  it("refuses a column the sheet does not have", () => {
    const v = validateBcsPicks("qty", ["ZZ"], INDEX);
    expect(v.ok).toBe(false);
    expect(!v.ok && v.message).toMatch(/ZZ/);
  });

  it("reports an unknown column as UNKNOWN even when it is also repeated", () => {
    // Server ordering promise: the resolve loop runs BEFORE the duplicate rule, so the more
    // fundamental fact about the column wins.
    const v = validateBcsPicks("qty", ["ZZ", "ZZ"], INDEX);
    expect(v.ok).toBe(false);
    expect(!v.ok && v.message).toMatch(/mapped column/i);
  });

  it("refuses the same column picked twice", () => {
    const v = validateBcsPicks("qty", ["D", "D"], INDEX);
    expect(v.ok).toBe(false);
    expect(!v.ok && v.message).toMatch(/twice|more than once/i);
  });

  it("refuses two DIFFERENT columns that resolve to the same number", () => {
    // B and E are both Zone A quantity. Summing them would count Zone A twice -- the S1c fix.
    const v = validateBcsPicks("qty", ["B", "E"], INDEX);
    expect(v.ok).toBe(false);
    expect(!v.ok && v.message).toMatch(/same/i);
  });

  it("refuses a column that is not a quantity column", () => {
    const v = validateBcsPicks("qty", ["F"], INDEX);
    expect(v.ok).toBe(false);
    expect(!v.ok && v.message).toMatch(/quantity/i);
    expect(!v.ok && v.message).toMatch(/F/);
  });

  it("refuses a scalar total MIXED with its own per-area parts", () => {
    const v = validateBcsPicks("qty", ["D", "B"], INDEX);
    expect(v.ok).toBe(false);
    expect(!v.ok && v.message).toMatch(/twice/i);
  });

  it("lets the duplicate-value rule SHADOW the too-many-totals rule, exactly as the server does", () => {
    // D and L are both scalar qty_total, so they share a resolved identity. The server's
    // duplicate rule precedes the per-source rules, so "Too many total-quantity columns" is
    // unreachable -- and the client must not invent a different message than the server would.
    const v = validateBcsPicks("qty", ["D", "L"], INDEX);
    expect(v.ok).toBe(false);
    expect(!v.ok && v.message).toMatch(/same/i);
  });

  it("accepts the lone scalar total and reports the scalar mode", () => {
    const v = validateBcsPicks("qty", ["D"], INDEX);
    expect(v.ok).toBe(true);
    expect(v.ok && v.mode).toBe("qty_total");
    expect(v.ok && v.summary).toMatch(/D/);
  });

  it("accepts several per-area columns and says they are added up", () => {
    const v = validateBcsPicks("qty", ["B", "C"], INDEX);
    expect(v.ok).toBe(true);
    expect(v.ok && v.mode).toBe("qty_by_area");
    expect(v.ok && v.summary).toMatch(/B/);
    expect(v.ok && v.summary).toMatch(/C/);
  });

  it("accepts a single per-area column (one area is still the per-area shape)", () => {
    const v = validateBcsPicks("qty", ["B"], INDEX);
    expect(v.ok).toBe(true);
    expect(v.ok && v.mode).toBe("qty_by_area");
  });
});

describe("amount picks -- mirroring build_amount_source", () => {
  it("refuses an empty pick", () => {
    const v = validateBcsPicks("amount", [], INDEX);
    expect(v.ok).toBe(false);
    expect(!v.ok && v.message).toMatch(/pick/i);
  });

  it("refuses a column the sheet does not have", () => {
    const v = validateBcsPicks("amount", ["QQ"], INDEX);
    expect(v.ok).toBe(false);
    expect(!v.ok && v.message).toMatch(/QQ/);
  });

  it("refuses the supply HALF of an amount", () => {
    const v = validateBcsPicks("amount", ["J"], INDEX);
    expect(v.ok).toBe(false);
    expect(!v.ok && v.message).toMatch(/J/);
  });

  it("refuses the per-area supply half", () => {
    const v = validateBcsPicks("amount", ["I"], INDEX);
    expect(v.ok).toBe(false);
    expect(!v.ok && v.message).toMatch(/I/);
  });

  it("refuses a rate column", () => {
    const v = validateBcsPicks("amount", ["K"], INDEX);
    expect(v.ok).toBe(false);
    expect(!v.ok && v.message).toMatch(/K/);
  });

  it("refuses a quantity column on the amount side", () => {
    const v = validateBcsPicks("amount", ["D"], INDEX);
    expect(v.ok).toBe(false);
  });

  it("refuses the scalar amount MIXED with its own per-area parts", () => {
    const v = validateBcsPicks("amount", ["F", "G"], INDEX);
    expect(v.ok).toBe(false);
    expect(!v.ok && v.message).toMatch(/twice/i);
  });

  it("checks the column CLASS before the mixed rule, as the server does", () => {
    // ["F","I"] is both a wrong-class pick (I is a supply half) and a would-be mix. The server
    // runs _is_combined_amount first, so the message must name the half, not the mixing.
    const v = validateBcsPicks("amount", ["F", "I"], INDEX);
    expect(v.ok).toBe(false);
    expect(!v.ok && v.message).toMatch(/I/);
  });

  it("accepts the lone scalar combined amount", () => {
    const v = validateBcsPicks("amount", ["F"], INDEX);
    expect(v.ok).toBe(true);
    expect(v.ok && v.mode).toBe("amount_total");
  });

  it("accepts several per-area combined amounts and says they are added up", () => {
    const v = validateBcsPicks("amount", ["G", "H"], INDEX);
    expect(v.ok).toBe(true);
    expect(v.ok && v.mode).toBe("amount_by_area");
    expect(v.ok && v.summary).toMatch(/G/);
    expect(v.ok && v.summary).toMatch(/H/);
  });
});

// ===========================================================================
// Group 4: the Save gate -- BOTH sides must be valid
// ===========================================================================
describe("the Save gate", () => {
  it("is open only when both sides are valid", () => {
    const good = validateBcsPicks("qty", ["D"], INDEX);
    const bad = validateBcsPicks("amount", [], INDEX);
    const alsoGood = validateBcsPicks("amount", ["F"], INDEX);
    expect(bcsSelectionSaveable(good, alsoGood)).toBe(true);
    expect(bcsSelectionSaveable(good, bad)).toBe(false);
    expect(bcsSelectionSaveable(bad, alsoGood)).toBe(false);
    expect(bcsSelectionSaveable(bad, bad)).toBe(false);
  });
});

// ===========================================================================
// Group 5: the button's disabled reason (greyed with a reason, never hidden)
// ===========================================================================
describe("bcsSetupReason -- why the BCS button is greyed", () => {
  const ready = {
    loading: false,
    error: false,
    committedVersion: 3,
    viewingHistory: false,
    sheetLocked: false,
  };

  it("gives no reason when the sheet is ready for setup", () => {
    expect(bcsSetupReason(ready)).toBeNull();
  });

  it("reports loading first", () => {
    expect(bcsSetupReason({ ...ready, loading: true })).toMatch(/loading/i);
  });

  it("reports a load error", () => {
    expect(bcsSetupReason({ ...ready, error: true })).toBeTruthy();
  });

  it("reports an uncommitted sheet", () => {
    expect(bcsSetupReason({ ...ready, committedVersion: null })).toMatch(/committed/i);
  });

  it("reports history mode -- BCS belongs to the current version", () => {
    expect(bcsSetupReason({ ...ready, viewingHistory: true })).toMatch(/version/i);
  });

  it("reports the deliberate sheet lock, which the server also refuses", () => {
    expect(bcsSetupReason({ ...ready, sheetLocked: true })).toMatch(/lock/i);
  });

  it("prefers the earlier reason when several hold", () => {
    expect(bcsSetupReason({ ...ready, loading: true, sheetLocked: true })).toMatch(/loading/i);
  });
});

// ===========================================================================
// Group 6: reading a stored confirmation back (hydrating the card + the chip)
// ===========================================================================
describe("reading a stored confirmation", () => {
  it("pulls the picked letters out of a stored source", () => {
    expect(
      bcsSourceCols({
        mode: "qty_by_area",
        columns: [
          { col: "B", role: "qty", area: "Zone A", value_field: "qty_by_area", value_key: "Zone A", rate_subkey: null },
          { col: "C", role: "qty", area: "Zone B", value_field: "qty_by_area", value_key: "Zone B", rate_subkey: null },
        ],
      }),
    ).toEqual(["B", "C"]);
  });

  it("reads an absent confirmation as no picks", () => {
    expect(bcsSourceCols(null)).toEqual([]);
    expect(bcsSourceCols(undefined)).toEqual([]);
  });

  it("summarises both confirmations for the chip beside the button", () => {
    const qty = {
      mode: "qty_total",
      columns: [
        { col: "D", role: "qty_total", area: null, value_field: "qty_total", value_key: null, rate_subkey: null },
      ],
    };
    const amount = {
      mode: "amount_by_area",
      columns: [
        { col: "G", role: "amount_total_by_area", area: "Zone A", value_field: "amount_by_area", value_key: "Zone A", rate_subkey: "total" },
        { col: "H", role: "amount_total_by_area", area: "Zone B", value_field: "amount_by_area", value_key: "Zone B", rate_subkey: "total" },
      ],
    };
    const label = bcsChipLabel(qty, amount);
    expect(label).toMatch(/D/);
    expect(label).toMatch(/G/);
    expect(label).toMatch(/H/);
  });

  it("has no chip text until BOTH sides are confirmed", () => {
    const qty = {
      mode: "qty_total",
      columns: [
        { col: "D", role: "qty_total", area: null, value_field: "qty_total", value_key: null, rate_subkey: null },
      ],
    };
    expect(bcsChipLabel(qty, null)).toBe("");
    expect(bcsChipLabel(null, null)).toBe("");
  });
});
