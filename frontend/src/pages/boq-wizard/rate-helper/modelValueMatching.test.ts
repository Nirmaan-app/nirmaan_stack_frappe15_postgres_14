/**
 * SLICE 12c-F (owner R-B / R-C, 2026-10-06) -- FIX B AND FIX C.
 *
 * FIX B: a value the MODEL read is matched to the dropdown option it means, so the field shows the
 * value the rate was computed from; a value that matches NO option can no longer price the row.
 * FIX C: the calculator's unit picker also offers the units the pricing can CONVERT into one the item
 * is sold in, while `units_not_offered` still decides which CLASSES a family is offered at all.
 *
 * The 12c-P parity cert found fix B's defect on screen: the extraction read "2 slot", the Slots
 * dropdown offers 2 and 3, and the controlled select fell back to its placeholder -- so the field read
 * "- select -" beside a row that had priced 1160 / 352 / 1512 from the raw string.
 */
import { describe, expect, it } from "vitest";
import { matchStatedToOption, type NumberReader } from "./itemListPricing";
import { fieldCannotShowValue, unitChoicesOf } from "./pricingSheetHelper";
import type { ItemListPricingSpec } from "./itemListPricing";

const slots: NumberReader = { from: ["slot_count"], name: "slot count" };
const mm: NumberReader = { from: ["dia_mm"], name: "diameter", unit: "mm" };

describe("fix B -- a model-read value is matched to the option it means", () => {
  it("reads the catalogue's own spelling out of the BoQ's: the case the cert found", () => {
    // the exact values the stored extractions carry on the eight rows this closed
    expect(matchStatedToOption("3 Slot", ["2", "3"], slots)).toBe("3");
    expect(matchStatedToOption("2 slot", ["2", "3"], slots)).toBe("2");
    expect(matchStatedToOption("3 slot", ["2", "3"], slots)).toBe("3");
  });

  it("matches on the number, whatever words the BoQ puts round it", () => {
    expect(matchStatedToOption("200 Dia", ["150", "200", "250"], mm)).toBe("200");
    expect(matchStatedToOption("100 mm dia", ["100", "150"], mm)).toBe("100");
    expect(matchStatedToOption("6mm", ["6", "9", "13"], mm)).toBe("6");
  });

  it("matches the same text written differently -- case and spacing", () => {
    expect(matchStatedToOption("  With  ", ["None", "with", "without"], undefined)).toBe("with");
    expect(matchStatedToOption("GI RECTANGULAR", ["GI rectangular", "GI oval"], undefined)).toBe("GI rectangular");
  });

  it("returns the option's OWN spelling, never the BoQ's", () => {
    // the value must be one the <select> can actually display, or the defect returns
    const picked = matchStatedToOption("3 Slot", ["2", "3"], slots);
    expect(["2", "3"]).toContain(picked);
  });

  // ---- the negative half: it must not invent, substitute or guess -------------------------------

  it("NEVER invents a value: an unstocked size matches nothing and is left for the ladder", () => {
    // 225 against 300/375/450 is exactly the 12c-P cert's size-up row. If this matched anything the
    // ladder would be bypassed and the row would price at a size nobody chose.
    expect(matchStatedToOption("225", ["300", "375", "450"], mm)).toBeNull();
    expect(matchStatedToOption("225 mm", ["300", "375", "450"], mm)).toBeNull();
  });

  it("no options means no match -- a field whose SKUs stock no sizes is an input, not a pick", () => {
    expect(matchStatedToOption("13", [], mm)).toBeNull();
  });

  it("a value that is not a number at all, against numeric options, matches nothing", () => {
    expect(matchStatedToOption("abc", ["2", "3"], slots)).toBeNull();
    expect(matchStatedToOption("", ["2", "3"], slots)).toBeNull();
    expect(matchStatedToOption("   ", ["2", "3"], slots)).toBeNull();
  });

  it("without a reader it falls back to text alone, and does not match a number dressed in words", () => {
    expect(matchStatedToOption("3 Slot", ["2", "3"], undefined)).toBeNull();
    expect(matchStatedToOption("3", ["2", "3"], undefined)).toBe("3");
  });
});

// ── fix C ────────────────────────────────────────────────────────────────────────────────────────

function spec(partial: Partial<ItemListPricingSpec>): ItemListPricingSpec {
  return {
    kind: "k",
    unit_class_attr: "unit_class",
    unit_classes: { count: ["nos"], area: ["sqm", "sq.m"], length: ["rmt"] },
    families: {},
    numbers: {},
    choice_attrs: [],
    ...partial,
  } as ItemListPricingSpec;
}

const FAMILIES = {
  grille: { needs: [], units: { count: {}, area: {} } },
  plenum: { needs: [], units: { area: {} }, units_not_offered: ["count"] },
  perMetre: { needs: [], units: { length: {} } },
} as unknown as ItemListPricingSpec["families"];

const FACTORS = {
  sqft: { class: "area", factor: 0.0929, word: "sq.ft" },
  "sq ft": { class: "area", factor: 0.0929, word: "sq.ft" },
  "sq.ft": { class: "area", factor: 0.0929, word: "sq.ft" },
} as unknown as ItemListPricingSpec["unit_factors"];

describe("fix C -- the picker also offers the units the pricing can convert", () => {
  it("offers a convertible unit beside the class it converts into", () => {
    const s = spec({ families: FAMILIES, unit_factors: FACTORS });
    expect(unitChoicesOf(s, ["grille"])).toEqual(["nos", "sqm", "sqft"]);
  });

  it("ONE spelling per unit, so four spellings of a square foot are not four options", () => {
    const s = spec({ families: FAMILIES, unit_factors: FACTORS });
    const out = unitChoicesOf(s, ["grille"]);
    expect(out.filter((u) => /sq\s*\.?\s*ft/i.test(u))).toHaveLength(1);
  });

  it("units_not_offered still decides the CLASSES -- a plenum gains sq.ft but never Nos", () => {
    // owner R-C as ruled on 2026-10-06: sq.ft is an area spelling, and the ruling was
    // "priced by area, never by number". So the test is the absence of `nos`, not of `sqft`.
    const s = spec({ families: FAMILIES, unit_factors: FACTORS });
    const out = unitChoicesOf(s, ["plenum"]);
    expect(out).not.toContain("nos");
    expect(out).toContain("sqm");
    expect(out).toContain("sqft");
  });

  it("a family that prices in no area class is offered no area conversion", () => {
    const s = spec({ families: FAMILIES, unit_factors: FACTORS });
    expect(unitChoicesOf(s, ["perMetre"])).toEqual(["rmt"]);
  });

  it("no unit_factors at all leaves the list byte-identical to before the fix", () => {
    const s = spec({ families: FAMILIES });
    expect(unitChoicesOf(s, ["grille"])).toEqual(["nos", "sqm"]);
    expect(unitChoicesOf(s, ["plenum"])).toEqual(["sqm"]);
  });

  it("a factor pointing at a class the spec does not declare is ignored, never offered", () => {
    const s = spec({
      families: FAMILIES,
      unit_factors: { acre: { class: "nosuchclass", factor: 4047, word: "acre" } } as unknown as ItemListPricingSpec["unit_factors"],
    });
    expect(unitChoicesOf(s, ["grille"])).toEqual(["nos", "sqm"]);
  });
});

// ── fix B, the second half: a priced row may not rest on a value its field cannot show ───────────

describe("fix B -- the row refuses when the field cannot show what priced it", () => {
  const nothing = { hopped: false, supplied: false };

  it("a value outside a non-empty option list cannot be shown", () => {
    expect(fieldCannotShowValue("2 slot", ["2", "3"], nothing)).toBe(true);
    expect(fieldCannotShowValue("7", ["2", "3"], nothing)).toBe(true);
  });

  it("an option, or a blank, is fine", () => {
    expect(fieldCannotShowValue("2", ["2", "3"], nothing)).toBe(false);
    expect(fieldCannotShowValue("", ["2", "3"], nothing)).toBe(false);
    expect(fieldCannotShowValue("   ", ["2", "3"], nothing)).toBe(false);
  });

  it("a LADDER hop answers it -- the field shows the rung that was bought", () => {
    // the 12c-P cert's size-up row: the BoQ said 225, the sheet stocks 300, the field shows 300
    expect(fieldCannotShowValue("225", ["300", "375", "450"], { hopped: true, supplied: false })).toBe(false);
  });

  it("a ruled DEFAULT or a config OVERRIDE answers it -- the field shows what they decided", () => {
    expect(fieldCannotShowValue("None", ["with", "without"], { hopped: false, supplied: true })).toBe(false);
  });

  it("no options at all is not a refusal -- such a field is an input to a formula, not a pick", () => {
    // a cladding-only row carries no geometry on its SKUs; its size IS used, there is just nothing to pick
    expect(fieldCannotShowValue("13", [], nothing)).toBe(false);
  });
});
