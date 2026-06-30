// Unit tests for reconcile.ts -- the PURE formula-vs-document reconciliation leaf (Cluster B).
import { describe, it, expect } from "vitest";
import {
  RECON_EPSILON_ABS,
  RECON_EPSILON_REL,
  amountsEqual,
  amountsDiffer,
  reconChoiceKey,
  buildReconChoiceMap,
  resolveDivergence,
} from "./reconcile";
import type { ReconciliationChoiceRef } from "./boqTypes";

describe("amountsEqual (the shared reconciliation tolerance)", () => {
  it("exposes the SAME epsilon constants the rollup guard used (0.01 abs, 1e-9 rel)", () => {
    expect(RECON_EPSILON_ABS).toBe(0.01);
    expect(RECON_EPSILON_REL).toBe(1e-9);
  });

  it("treats sub-cent dust as equal, whole-cent gaps as different", () => {
    expect(amountsEqual(100, 100.005)).toBe(true); // <= 0.01 abs floor
    expect(amountsEqual(100, 100.02)).toBe(false); // > 0.01
  });

  it("scales by the relative term on large magnitudes (no false-fire on float dust)", () => {
    // tol = max(0.01, 1e-9 * 1e12) = 1000 -> a 1-rupee diff on a trillion is 'equal'.
    expect(amountsEqual(1e12, 1e12 + 1)).toBe(true);
  });
});

describe("amountsDiffer (the divergence test -- both numbers must exist)", () => {
  it("is false when either side is null / undefined / NaN (no comparable number)", () => {
    expect(amountsDiffer(null, 5)).toBe(false);
    expect(amountsDiffer(5, undefined)).toBe(false);
    expect(amountsDiffer(NaN, 5)).toBe(false);
    expect(amountsDiffer(5, NaN)).toBe(false);
  });

  it("is false for equal-within-tolerance and true for a real difference", () => {
    expect(amountsDiffer(100, 100.005)).toBe(false);
    expect(amountsDiffer(100, 120)).toBe(true);
  });

  it("treats a real 0 as a value (0 vs 5 diverges)", () => {
    expect(amountsDiffer(0, 5)).toBe(true);
  });
});

describe("reconChoiceKey + buildReconChoiceMap", () => {
  it("keys by <excelRow>:<colLetter>", () => {
    expect(reconChoiceKey(34, "F")).toBe("34:F");
  });

  it("builds an O(1) lookup map from the flat per-cell list", () => {
    const choices: ReconciliationChoiceRef[] = [
      { excel_row: 34, col_letter: "F", choice: "keep_document" },
      { excel_row: 34, col_letter: "I", choice: "take_formula" },
    ];
    const m = buildReconChoiceMap(choices);
    expect(m.get("34:F")).toBe("keep_document");
    expect(m.get("34:I")).toBe("take_formula");
    expect(m.get("35:F")).toBeUndefined();
  });
});

describe("resolveDivergence (D1 -- the single resolution rule)", () => {
  it("reports no divergence when the numbers agree (or one is missing)", () => {
    expect(resolveDivergence(100, 100, undefined).diverges).toBe(false);
    expect(resolveDivergence(100, null, undefined).diverges).toBe(false);
  });

  it("DEFAULTS to the DOCUMENT value when unset (D1)", () => {
    const r = resolveDivergence(100, 120, undefined);
    expect(r).toEqual({ diverges: true, resolved: "unset", value: 100 });
  });

  it("keep_document -> the document value", () => {
    const r = resolveDivergence(100, 120, "keep_document");
    expect(r).toEqual({ diverges: true, resolved: "keep_document", value: 100 });
  });

  it("take_formula -> the formula value", () => {
    const r = resolveDivergence(100, 120, "take_formula");
    expect(r).toEqual({ diverges: true, resolved: "take_formula", value: 120 });
  });
});

describe("resolveDivergence -- DOC-0 exception (formula wins silently when document ~= 0)", () => {
  it("doc ~= 0 + a real formula -> NOT a divergence (so no badge / strip / chooser)", () => {
    // diverges:false makes every consumer fall through to the formula value (no per-consumer code).
    expect(resolveDivergence(0, 120, undefined)).toEqual({ diverges: false });
  });

  it("doc ~= 0 within the epsilon (abs 0.01 floor) is treated as zero", () => {
    expect(resolveDivergence(0.004, 120, undefined)).toEqual({ diverges: false });
    expect(resolveDivergence(-0.004, 120, undefined)).toEqual({ diverges: false }); // negative-near-zero
  });

  it("doc ~= 0 IGNORES any stored choice -- the formula always wins on the zero case", () => {
    // No keep-document path for doc-0: a stale keep_document must NOT pin it to 0.
    expect(resolveDivergence(0, 120, "keep_document")).toEqual({ diverges: false });
    expect(resolveDivergence(0, 120, "take_formula")).toEqual({ diverges: false });
  });

  it("doc ~= 0 AND formula ~= 0 -> already non-divergent (unchanged, never reaches the rule)", () => {
    expect(resolveDivergence(0, 0, undefined)).toEqual({ diverges: false });
  });

  it("doc small but OUTSIDE the epsilon (0.5) is NOT zero -> UNCHANGED (document default, divergent)", () => {
    const r = resolveDivergence(0.5, 120, undefined);
    expect(r).toEqual({ diverges: true, resolved: "unset", value: 0.5 });
  });

  it("a NON-zero document divergence is UNCHANGED by the doc-0 rule", () => {
    expect(resolveDivergence(100, 120, undefined)).toEqual({ diverges: true, resolved: "unset", value: 100 });
    expect(resolveDivergence(100, 120, "keep_document")).toEqual({ diverges: true, resolved: "keep_document", value: 100 });
  });

  it("doc ~= 0 + null/NaN formula -> not divergent anyway (formula must be real)", () => {
    expect(resolveDivergence(0, null, undefined)).toEqual({ diverges: false });
    expect(resolveDivergence(0, NaN, undefined)).toEqual({ diverges: false });
  });
});
