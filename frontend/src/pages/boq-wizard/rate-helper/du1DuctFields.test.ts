/**
 * DU-1 PART B -- THE DUCTING PANEL'S FIELDS (feature standard v1.1 field audit; DR17 + NOTE 3), on the newest HVAC asset.
 *  - the audit (`auditPanelFields`, every family x its own unit): no typed + mandatory field without a note (MISSING NOTES = 0);
 *    the gauge is a dropdown of the stocked thicknesses with "Other..." and its note; Insulated is a two-way dropdown;
 *  - a per-metre row (the `convert` classes the audit does not walk): Round's Diameter is a dropdown of the sheet's round diameters
 *    with "Other..." and its note; Rectangular / Oval per metre ask the width and height, typed, each with its note;
 *  - the gauge options read as gauges ("24G (0.6 mm)") on the panel; Misc (borrowed) has no field missing a note either.
 */
import { describe, expect, it } from "vitest";
import { auditPanelFields, missingNotes } from "./panelFieldAudit";
import { itemFieldDefs, itemListPricingSpec, listSpecDefs } from "./itemListPricing";
import { CFG, ITEMS, LATEST } from "./du1Duct.harness";

const DUCT = CFG.get("hvac_ducting");
const spec = itemListPricingSpec(DUCT as never)!;
const defs = listSpecDefs(DUCT as never);
const fieldsOf = (family: string, cls: string) => itemFieldDefs(spec, defs, family, cls, { items: ITEMS as never, answers: {} });

describe(`DU-1 Ducting panel fields (${LATEST})`, () => {
  it("the audit: every field the panel renders per family x unit, and MISSING NOTES = 0 (Ducting and its borrowed Misc)", () => {
    const a = auditPanelFields(DUCT, ITEMS as never);
    expect(a.map((f) => [f.attr, f.control, f.mandatory])).toEqual([["insulated", "dropdown", true], ["thickness_mm", "dropdown + other", true]]);
    expect(a.find((f) => f.attr === "thickness_mm")?.note).toMatch(/^Type the gauge the BoQ states/);
    expect(missingNotes(DUCT, ITEMS as never)).toEqual([]);
    expect(missingNotes(CFG.get("hvac_misc"), ITEMS as never)).toEqual([]);
  });
  it("the gauge: the stocked thicknesses of the family, Other... beside them", () => {
    const g = fieldsOf("Rectangular (GI)", "area").find((f) => f.skuAttr === "thickness_mm")!;
    expect(g.options).toEqual(["0.5", "0.6", "0.8", "1", "1.2"]);
    expect(g.allowOther).toBe(true);
    const pir = fieldsOf("PIR (Pre Insulated Duct)", "area").find((f) => f.skuAttr === "thickness_mm")!;
    expect(pir.options).toEqual(["20", "30"]);
  });
  it("a round duct per metre: Diameter is a dropdown of the sheet's diameters + Other..., with its note (DR17, NOTE 3)", () => {
    // the offered alias "Round (GI) - per metre" prices as Spiral / Oval (GI): the panel asks that family's per-metre fields
    const d = fieldsOf("Spiral / Oval (GI)", "length").find((f) => f.skuAttr === "dia_mm");
    expect(d?.options).toEqual(["80", "100", "150", "200", "250", "300"]);
    expect(d?.allowOther).toBe(true);
    expect(d?.control).toBe("dropdown_or_other");
    expect(d?.typedNote ?? "").not.toBe("");
    // NEGATIVE: a per-sq.m row never asks a diameter
    expect(fieldsOf("Spiral / Oval (GI)", "area").some((f) => f.skuAttr === "dia_mm")).toBe(false);
  });
  it("a rectangular duct per metre (G-5): the width and height are typed boxes, each with its note", () => {
    const fs = fieldsOf("Rectangular (GI)", "length");
    const w = fs.find((f) => f.skuAttr === "duct_w_mm"), h = fs.find((f) => f.skuAttr === "duct_h_mm");
    expect([w?.control, h?.control]).toEqual(["text", "text"]);
    expect(w?.typedNote ?? "").not.toBe("");
    expect(h?.typedNote ?? "").not.toBe("");
  });
});
