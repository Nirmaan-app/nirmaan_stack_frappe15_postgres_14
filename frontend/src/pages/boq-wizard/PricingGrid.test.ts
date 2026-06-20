// Unit tests for the pure priced-marker helpers in PricingGrid (BoQ Phase 5 Slice 3a).
//
// These pin the marker-derivation logic: a rate cell is "priced" SOLELY from the overlay's
// priced_* markers, NEVER from a zero-check on the value (the load-bearing correctness rule
// -- a committed 0.0 rate can be a valid priced value). The JSX grid itself is manual-cert
// (no jsdom / @testing-library added); only these pure functions are unit-tested.
import { describe, it, expect } from "vitest";
import { isRateDescriptor, isCellPriced } from "./PricingGrid";
import type { ColumnDescriptor, PricedRow } from "./boqTypes";

function desc(
  value_field: string,
  value_key: string | null = null,
  rate_subkey: string | null = null,
): ColumnDescriptor {
  return { col: "X", role: "r", area: value_key, value_field, value_key, rate_subkey };
}

describe("isRateDescriptor", () => {
  it("is true for the per-area rate field and the three scalar rate fields", () => {
    expect(isRateDescriptor(desc("rate_by_area", "Phase 1", "combined_rate"))).toBe(true);
    expect(isRateDescriptor(desc("rate_supply"))).toBe(true);
    expect(isRateDescriptor(desc("rate_install"))).toBe(true);
    expect(isRateDescriptor(desc("rate_combined"))).toBe(true);
  });

  it("is false for qty / amount / identity descriptors", () => {
    expect(isRateDescriptor(desc("qty_by_area", "Phase 1"))).toBe(false);
    expect(isRateDescriptor(desc("amount_by_area", "Phase 1", "total"))).toBe(false);
    expect(isRateDescriptor(desc("amount_total"))).toBe(false);
    expect(isRateDescriptor(desc("sl_no_value"))).toBe(false);
  });
});

describe("isCellPriced", () => {
  it("per-area: true when the priced_by_area marker is set", () => {
    const row = {
      rate_by_area: { "Phase 1": { combined_rate: 150 } },
      priced_by_area: { "Phase 1": { combined_rate: true } },
    } as unknown as PricedRow;
    expect(isCellPriced(row, desc("rate_by_area", "Phase 1", "combined_rate"))).toBe(true);
  });

  it("per-area: false when no priced_by_area marker exists (un-priced)", () => {
    const row = { rate_by_area: { "Phase 1": { combined_rate: 150 } } } as unknown as PricedRow;
    expect(isCellPriced(row, desc("rate_by_area", "Phase 1", "combined_rate"))).toBe(false);
  });

  it("per-area: false when the area is marked but not this rate kind", () => {
    const row = {
      priced_by_area: { "Phase 1": { supply_rate: true } },
    } as unknown as PricedRow;
    expect(isCellPriced(row, desc("rate_by_area", "Phase 1", "combined_rate"))).toBe(false);
  });

  it("ZERO-RATE IS PRICED: a 0.0 rate with the marker set is priced (no zero-check)", () => {
    const row = {
      rate_by_area: { "Phase 1": { combined_rate: 0 } },
      priced_by_area: { "Phase 1": { combined_rate: true } },
    } as unknown as PricedRow;
    expect(isCellPriced(row, desc("rate_by_area", "Phase 1", "combined_rate"))).toBe(true);
  });

  it("scalar: true when priced_rate_combined is set; false when absent", () => {
    const priced = { priced_rate_combined: true } as unknown as PricedRow;
    const unpriced = {} as unknown as PricedRow;
    expect(isCellPriced(priced, desc("rate_combined"))).toBe(true);
    expect(isCellPriced(unpriced, desc("rate_combined"))).toBe(false);
  });

  it("non-rate descriptor is never priced (even if a stray marker exists)", () => {
    const row = {
      priced_by_area: { "Phase 1": { combined_rate: true } },
    } as unknown as PricedRow;
    expect(isCellPriced(row, desc("amount_by_area", "Phase 1", "total"))).toBe(false);
    expect(isCellPriced(row, desc("qty_by_area", "Phase 1"))).toBe(false);
  });
});
