// Unit tests for the formula builder's OPERAND PALETTE (the two-quantity-columns fix).
//
// WHY THIS FILE EXISTS. A sheet mapped E = Quantity · 7f and F = Quantity · office cfm, with a
// plain scalar `amount_total` in H. The palette ran `tokenRefForMode(d, mode)` with the
// BUILDER's mode -- "default" for every scalar target -- so BOTH quantity columns turned into
// the SAME wildcard ref and deduped down to ONE chip reading "Quantity". Two failures at once:
//   1. column F was unreachable -- no chip anywhere could name it;
//   2. the one chip that existed inserted `qty_by_area[null]`, which a scalar target has no
//      area to bind, so PricingGrid's dangling-ref gate blanked every amount cell.
// Nothing threw, nothing failed to compile, and the builder said "Well-formed."
//
// This repo has NO DOM test environment, so the render cannot be asserted -- extracting the
// decisions into pure functions is what makes this failure class testable at all.
import { describe, it, expect } from "vitest";
import { columnChipLabel } from "./boqTypes";
// The resolver the leftover/live distinction is defined against -- asserted side by side with
// storedDefaultFormula so the two can never drift into disagreeing about one record.
import { pickFormula } from "./amountFormula";
import {
  buildOperandPalette,
  storedDefaultFormula,
  operandGroup,
  targetBindsArea,
  unbindableOperands,
  wouldCreateCycle,
  type FormulaToken,
} from "./formulaTokens";
import type { ColumnDescriptor, ColumnFormula } from "./boqTypes";

/** A per-area column (role `qty` / an amount or rate role carrying an area). */
const area = (
  col: string,
  role: string,
  value_field: string,
  areaName: string | null,
  rate_subkey: string | null = null,
): ColumnDescriptor => ({ col, role, area: areaName, value_field, value_key: areaName, rate_subkey });

/** A scalar column (no area dimension). */
const scalar = (col: string, role: string, value_field: string): ColumnDescriptor => ({
  col, role, area: null, value_field, value_key: null, rate_subkey: null,
});

// The owner's real sheet (BOQ-26-00185 / "247 - VRF System"): TWO quantity columns, one scalar
// combined rate, one scalar total amount.
const D = scalar("D", "unit", "unit");
const E = area("E", "qty", "qty_by_area", "7f");
const F = area("F", "qty", "qty_by_area", "office cfm");
const G = scalar("G", "rate_combined", "rate_combined");
const H = scalar("H", "amount_total", "amount_total");
const VRF_SHEET = [D, E, F, G, H];

/** The builder's own resolver, in miniature: concrete -> the shared chip name, wildcard -> role. */
const labelFor = (descs: ColumnDescriptor[]) => (r: { value_field: string; value_key: string | null; rate_subkey: string | null }) => {
  const wildcard = r.value_key === null && r.value_field.endsWith("_by_area");
  const m = descs.find(
    (d) => d.value_field === r.value_field && d.rate_subkey === r.rate_subkey && (wildcard || d.value_key === r.value_key),
  );
  if (!m) return r.value_field;
  return wildcard ? "Quantity" : columnChipLabel(m);
};

const chip = (t: FormulaToken & { kind: "column" }) => t;

describe("targetBindsArea", () => {
  it("a per-area amount column binds its own area", () => {
    expect(targetBindsArea(area("H", "amount_total_by_area", "amount_by_area", "7f", "total"))).toBe(true);
  });
  it("a scalar amount column binds nothing", () => {
    expect(targetBindsArea(H)).toBe(false);
  });
  it("an area-bound column that was mapped WITHOUT an area binds nothing", () => {
    expect(targetBindsArea(area("H", "amount_total_by_area", "amount_by_area", null, "total"))).toBe(false);
  });
});

describe("buildOperandPalette -- the scalar target (the bug)", () => {
  const palette = buildOperandPalette(H, VRF_SHEET, labelFor(VRF_SHEET));

  it("★ OFFERS BOTH QUANTITY COLUMNS, not one collapsed chip", () => {
    expect(palette.filter((p) => p.group === "Quantity").map((p) => p.label)).toEqual([
      "E — Quantity · 7f",
      "F — Quantity · office cfm",
    ]);
  });

  it("★ inserts CONCRETE area refs, so the amount cell can actually resolve them", () => {
    expect(palette.filter((p) => p.group === "Quantity").map((p) => p.ref.value_key)).toEqual([
      "7f",
      "office cfm",
    ]);
  });

  it("offers the rate column and skips the non-operand ones (unit, and itself)", () => {
    expect(palette.map((p) => p.label)).toEqual([
      "E — Quantity · 7f",
      "F — Quantity · office cfm",
      "G — Rate (Combined)",
    ]);
  });

  it("keeps the sheet's own column order", () => {
    expect(palette.map((p) => p.ref.value_key)).toEqual(["7f", "office cfm", null]);
  });
});

describe("buildOperandPalette -- the per-area target", () => {
  const AE = area("E", "qty", "qty_by_area", "7f");
  const AF = area("F", "qty", "qty_by_area", "office cfm");
  const AG = area("G", "rate_combined_by_area", "rate_by_area", "7f", "combined");
  const AH = area("H", "amount_total_by_area", "amount_by_area", "7f", "total");
  const AI = area("I", "amount_total_by_area", "amount_by_area", "office cfm", "total");
  const sheet = [AE, AF, AG, AH, AI];

  it("★ NO CHIP IS EVER A WILDCARD -- every area-bound ref carries a concrete area", () => {
    // The collapse-to-wildcard branch is GONE, not merely unused: `buildOperandPalette` no longer
    // takes a mode, so no argument exists that could bring it back.
    const p = buildOperandPalette(AH, sheet, labelFor(sheet));
    const areaBound = p.filter((c) => c.ref.value_field.endsWith("_by_area"));
    expect(areaBound.length).toBeGreaterThan(0);
    expect(areaBound.every((c) => c.ref.value_key !== null)).toBe(true);
  });

  it("OVERRIDE mode names each concrete column by its letter", () => {
    const p = buildOperandPalette(AH, sheet, labelFor(sheet));
    expect(p.filter((c) => c.group === "Quantity").map((c) => c.label)).toEqual([
      "E — Quantity · 7f",
      "F — Quantity · office cfm",
    ]);
    // the OTHER area's amount column is offerable; only the literal self-ref is withheld
    expect(p.filter((c) => c.group === "Amount").map((c) => c.ref.value_key)).toEqual(["office cfm"]);
  });
});

// ===========================================================================
// EVERY operand column the sheet has is offered, other areas' included.
//
// This block asserted the OPPOSITE for one turn -- a per-area column was narrowed to its own
// area, on the evidence that all 6 stored per-area formulas use only their own. The owner
// reversed it: that evidence says what people HAD done, not what they are allowed to do, and a
// shared item apportioned across floors needs the other floor's column. The only operand still
// withheld is the trivial self-reference.
// ===========================================================================
describe("a per-area target offers EVERY area's operands", () => {
  const qF = area("F", "qty", "qty_by_area", "4th Floor");
  const qG = area("G", "qty", "qty_by_area", "5th Floor");
  const rE = scalar("E", "rate_combined", "rate_combined");
  const qT = scalar("C", "qty_total", "qty_total");
  const aH = area("H", "amount_total_by_area", "amount_by_area", "4th Floor", "total");
  const aI = area("I", "amount_total_by_area", "amount_by_area", "5th Floor", "total");
  const aJ = scalar("J", "amount_total", "amount_total");
  const sheet = [qT, rE, qF, qG, aH, aI, aJ];
  const labels = (t: ColumnDescriptor) =>
    buildOperandPalette(t, sheet, labelFor(sheet)).map((c) => c.label);

  it("★ column H (4th Floor) offers BOTH floors' quantity columns", () => {
    expect(labels(aH)).toContain("F — Quantity · 4th Floor");
    expect(labels(aH)).toContain("G — Quantity · 5th Floor");
  });

  it("★ and the other floor's AMOUNT column too", () => {
    expect(labels(aH)).toContain("I — Amount Total (per area) · 5th Floor");
  });

  it("the ONLY thing withheld is the column itself", () => {
    expect(labels(aH)).toEqual([
      "C — Total Quantity",
      "E — Rate (Combined)",
      "F — Quantity · 4th Floor",
      "G — Quantity · 5th Floor",
      "I — Amount Total (per area) · 5th Floor",
      "J — Amount (Total)",
    ]);
    expect(labels(aH)).not.toContain("H — Amount Total (per area) · 4th Floor");
  });

  it("symmetric -- column I withholds only I", () => {
    expect(labels(aI)).toContain("F — Quantity · 4th Floor");
    expect(labels(aI)).toContain("H — Amount Total (per area) · 4th Floor");
    expect(labels(aI)).not.toContain("I — Amount Total (per area) · 5th Floor");
  });

  it("a SCALAR target is unchanged -- it never had an area to narrow to", () => {
    expect(labels(aJ)).toEqual([
      "C — Total Quantity",
      "E — Rate (Combined)",
      "F — Quantity · 4th Floor",
      "G — Quantity · 5th Floor",
      "H — Amount Total (per area) · 4th Floor",
      "I — Amount Total (per area) · 5th Floor",
    ]);
  });

  it("a cross-area formula is still cycle-checked -- the real boundary, not the palette", () => {
    // H may name I. H = I and I = H would be circular, and wouldCreateCycle catches it at save.
    const iRef = { value_field: "amount_by_area", value_key: "5th Floor", rate_subkey: "total" };
    const hRef = { value_field: "amount_by_area", value_key: "4th Floor", rate_subkey: "total" };
    const existing: ColumnFormula[] = [{
      target_value_field: "amount_by_area", target_value_key: "5th Floor",
      target_rate_subkey: "total", target_col: null,
      formula: { ref: hRef } as ColumnFormula["formula"],
    }];
    expect(wouldCreateCycle(hRef, { ref: iRef }, existing)).toBe(true);
  });
});

describe("operandGroup", () => {
  it("routes qty / rate / amount value_fields to their headings", () => {
    expect(operandGroup("qty_by_area")).toBe("Quantity");
    expect(operandGroup("qty_total")).toBe("Quantity");
    expect(operandGroup("rate_combined")).toBe("Rate");
    expect(operandGroup("amount_total")).toBe("Amount");
  });
});

describe("unbindableOperands -- the already-stored formulas", () => {
  const wildcardQty = chip({ kind: "column", ref: { value_field: "qty_by_area", value_key: null, rate_subkey: null }, label: "Quantity" });
  const concreteQty = chip({ kind: "column", ref: { value_field: "qty_by_area", value_key: "7f", rate_subkey: null }, label: "E — Quantity · 7f" });
  const rate = chip({ kind: "column", ref: { value_field: "rate_combined", value_key: null, rate_subkey: null }, label: "G — Rate (Combined)" });
  const times: FormulaToken = { kind: "op", op: "*" };

  it("★ catches the wildcard a scalar target can never bind", () => {
    expect(unbindableOperands(H, VRF_SHEET, [wildcardQty, times, rate])).toEqual([wildcardQty]);
  });

  it("passes a formula built from the concrete chips", () => {
    expect(unbindableOperands(H, VRF_SHEET, [concreteQty, times, rate])).toEqual([]);
  });

  it("does NOT flag a scalar rate operand -- a null key there means scalar, not wildcard", () => {
    expect(unbindableOperands(H, VRF_SHEET, [rate])).toEqual([]);
  });

  it("does NOT flag a wildcard when the sheet really has a null-key qty column", () => {
    // An area-bound role mapped with NO area: `{qty_by_area, null}` IS that concrete column.
    const noAreaSheet = [area("E", "qty", "qty_by_area", null), G, H];
    expect(unbindableOperands(H, noAreaSheet, [wildcardQty, times, rate])).toEqual([]);
  });

  it("stays silent for a per-area target -- there a wildcard is the intended spelling", () => {
    const AH = area("H", "amount_total_by_area", "amount_by_area", "7f", "total");
    expect(unbindableOperands(AH, [E, F, AH], [wildcardQty])).toEqual([]);
  });
});

// ===========================================================================
// The tier follows the COLUMN -- there is no Default/This-area tab any more.
// What is left to detect is a LEFTOVER default from before that rule.
// ===========================================================================
describe("storedDefaultFormula -- the leftover 'all areas' record", () => {
  const aH = area("H", "amount_total_by_area", "amount_by_area", "4th Floor", "total");
  const tree = { ref: { value_field: "qty_by_area", value_key: "4th Floor", rate_subkey: null } };
  const cf = (key: string | null, formula: unknown = tree): ColumnFormula => ({
    target_value_field: "amount_by_area", target_value_key: key,
    target_rate_subkey: "total", target_col: null,
    formula: formula as ColumnFormula["formula"],
  });

  it("★ BOQ-26-00184 column H: an override AND a byte-identical default -> the default is found", () => {
    // Exactly what the owner's sheet holds, and how it got there: the builder used to open on
    // the Default tab, so the first save landed in the wrong tier and the rebuilt override
    // shadowed it.
    expect(storedDefaultFormula(aH, [cf("4th Floor"), cf(null)])).toEqual(cf(null));
  });

  it("nothing stored on the default tier -> null, no notice to show", () => {
    expect(storedDefaultFormula(aH, [cf("4th Floor"), cf("5th Floor")])).toBeNull();
  });

  it("a CLEARED default does not count -- there is nothing left to remove", () => {
    // The override is present so the SHADOW test passes and the cleared-default rule is what
    // is actually under test here (without it this would pass for the wrong reason).
    expect(storedDefaultFormula(aH, [cf("4th Floor"), cf(null, null)])).toBeNull();
  });

  it("only its OWN axis counts -- a supply default is not a total default", () => {
    expect(
      storedDefaultFormula(aH, [cf("4th Floor"), { ...cf(null), target_rate_subkey: "supply" }]),
    ).toBeNull();
  });

  // ── ★ THE SHADOW TEST: a default with NO override is LIVE, not leftover ──────
  //
  // ⚠️ THE REGRESSION THIS BLOCK EXISTS FOR. `storedDefaultFormula` used to answer "is there a
  // null-key record?", which is not the question -- a null-key record is dead only because an
  // override OUTRANKS it (pickFormula: override, else default). Unshadowed, the identical record
  // is what COMPUTES the column, and the builder offered to remove it as an unused leftover.
  //
  // The blast radius is why this is tested rather than merely noted: target_col is not part of
  // the identity, so there is ONE default record per axis shared by every per-area column. One
  // click blanked every area relying on it and dropped the sheet below _sheet_formulas_complete,
  // which blocks rate editing.
  //
  // And this is the COMMON state, not an edge: the old toggle OPENED on "Default (all areas)",
  // so "built one formula, never touched the tab" -- the normal history of every sheet predating
  // the change -- lands exactly here.
  describe("a default with NO override is the LIVE formula, never a leftover", () => {
    it("★ the legacy sheet: only an all-areas formula stored -> nothing to remove", () => {
      expect(storedDefaultFormula(aH, [cf(null)])).toBeNull();
    });

    it("proof it is live: pickFormula resolves that same record for this column", () => {
      // The two halves side by side -- the record storedDefaultFormula must NOT report is
      // exactly the record the evaluator runs. Anchors the rule to real behaviour, not a flag.
      const set = [cf(null)];
      const col = { value_field: "amount_by_area", value_key: "4th Floor", rate_subkey: "total" };
      expect(pickFormula(col, set)).toEqual(cf(null));
      expect(storedDefaultFormula(aH, set)).toBeNull();
    });

    it("ANOTHER area's override does not shadow THIS column -- H is still live on the default", () => {
      // The near miss: the sheet has overrides, just not for H. Matching on "any override on the
      // axis" would call H's live formula a leftover.
      expect(storedDefaultFormula(aH, [cf("5th Floor"), cf(null)])).toBeNull();
    });

    it("a CLEARED override does not shadow either -- it governs nothing", () => {
      expect(storedDefaultFormula(aH, [cf("4th Floor", null), cf(null)])).toBeNull();
    });

    it("the moment THIS column gets its own override, the default becomes a leftover", () => {
      // The transition, in one assertion pair: same default record, opposite verdict.
      expect(storedDefaultFormula(aH, [cf(null)])).toBeNull();
      expect(storedDefaultFormula(aH, [cf(null), cf("4th Floor")])).toEqual(cf(null));
    });

    it("a SCALAR target is self-gated -- its null-key record is its OWN formula", () => {
      // Not a leftover under any circumstance, and no longer relying on the caller to know that.
      const scalarAmount = scalar("H", "amount_total", "amount_total");
      expect(
        storedDefaultFormula(scalarAmount, [
          { ...cf(null), target_value_field: "amount_total", target_rate_subkey: null },
        ]),
      ).toBeNull();
    });
  });

  it("★ ONE default per axis, shared by every per-area column -- H and I find the SAME record", () => {
    // target_col is a stored guard, NOT part of the identity, so there is only ever one.
    const aI = area("I", "amount_total_by_area", "amount_by_area", "5th Floor", "total");
    const set = [cf("4th Floor"), cf("5th Floor"), cf(null)];
    expect(storedDefaultFormula(aH, set)).toBe(storedDefaultFormula(aI, set));
  });
});

describe("columnChipLabel -- the ONE name a column has", () => {
  it("names a per-area column letter, role and area", () => {
    expect(columnChipLabel(E)).toBe("E — Quantity · 7f");
  });
  it("names a scalar column letter and role", () => {
    expect(columnChipLabel(G)).toBe("G — Rate (Combined)");
  });
  it("falls back to the raw role when there is no friendly label", () => {
    expect(columnChipLabel(scalar("Z", "some_new_role", "qty_total"))).toBe("Z — some_new_role");
  });
});
