// The rate-field set is defined TWICE, and the two copies decide different halves of one rule.
//
// `PricingGrid.RATE_VALUE_FIELDS` decides how a lookup is RESOLVED (draft-aware, priced-marker,
// prepopulated-non-zero). `amountFormula.RATE_VALUE_FIELDS` decides how a MISS is CLASSIFIED --
// "rate" (blank the row) or "value" (may read as 0). They were hand-synced with a comment saying
// "kept in sync, not imported" and nothing holding them to it.
//
// ★ WHY THIS IS PINNED RATHER THAN LEFT TO CARE. Add a rate field to PricingGrid's set and forget
// this one, and the evaluator classifies an UNPRICED RATE as `missing: "value"` -> foldOperands
// substitutes 0 -> the amount prints a confident number that silently omits a price nobody has
// entered. That is the exact failure the whole opt-in zero-fill design exists to prevent, it
// appears as a plausible figure on a tender line, and no other test in the suite can see it.
//
// The repo's own convention for a rule with two homes is a parity test (ADR-0010 F1, as
// `reconcile.ts` / `priceability.ts` are pinned to the backend). This is that test.
import { describe, it, expect } from "vitest";
import { RATE_VALUE_FIELDS as EVALUATOR_RATE_FIELDS } from "./amountFormula";
import { RATE_VALUE_FIELDS as GRID_RATE_FIELDS } from "./PricingGrid";

const sorted = (s: ReadonlySet<string>) => [...s].sort();

describe("RATE_VALUE_FIELDS parity — the evaluator and the grid must agree", () => {
  it("★ the two sets are identical", () => {
    expect(sorted(EVALUATOR_RATE_FIELDS)).toEqual(sorted(GRID_RATE_FIELDS));
  });

  it("neither is empty — an empty set would pass the equality above and zero-fill every rate", () => {
    expect(EVALUATOR_RATE_FIELDS.size).toBeGreaterThan(0);
    expect(GRID_RATE_FIELDS.size).toBeGreaterThan(0);
  });

  it("covers both rate shapes: the three scalar kinds and the per-area one", () => {
    for (const f of ["rate_supply", "rate_install", "rate_combined", "rate_by_area"]) {
      expect(EVALUATOR_RATE_FIELDS.has(f)).toBe(true);
      expect(GRID_RATE_FIELDS.has(f)).toBe(true);
    }
  });

  it("holds nothing but rates — a qty or amount field here would blank rows that should compute", () => {
    for (const f of EVALUATOR_RATE_FIELDS) expect(f.startsWith("rate")).toBe(true);
  });
});
