/**
 * VAV-FIX (2026-11-25; the six findings of chat-Claude's VAV-2c3 review, S1 - S6): each positive AND negative, on scratch copies of the v87 FILE with
 * the v88 edits (vavfix.harness), so they run the same before the v88 mint and after it. The v87 side of each is the vacuity check where the fix is a
 * rate-file text; a code fix's vacuity is a run with its line disabled (the slice's vacuity logs). Every defaulted field has a SILENT-BoQ case (the
 * model left the field out), the owner's 2026-11-24 17:02 lesson.
 */
import { describe, expect, it } from "vitest";
import { ITEM_LIST_OVERRIDE_KEY, type ItemBlockView, type ItemListSuggestion, type ItemListView } from "./pricingSheetHelper";
import { blk } from "./vav1Vav.harness";
import { box86 } from "./vav2c3c.harness";
import { EDITS88, VAV, calc88, cfg87, cfg88, sheet88, type Row86 } from "./vavfix.harness";

type Field = { id: string; value: string; defaulted?: boolean; rule?: string; note?: string; required?: true };
const C88 = cfg88(VAV), C87 = cfg87(VAV);
const field = (v: ItemListView, id: string, i = 0) => (v.items[i].fields as Field[]).find((f) => f.id === id)!;
const DEFAULTED = ["shape", "vav_type", "integrator_included"] as const;
const NOTES: Record<string, string> = {
  shape: "Shape not stated - priced as Rectangular (assumed).",
  vav_type: "Type not named - priced as Nothing specific mentioned (assumed).",
  integrator_included: "Integrator not mentioned in the BoQ - priced without it (assumed).",
};
const VALUES: Record<string, string> = { shape: "Rectangular", vav_type: "Nothing specific mentioned", integrator_included: "No" };
/** a box reading with the three defaulted fields LEFT OUT (the model said nothing: a silent BoQ) */
const silentBox = (over: Record<string, string | null> = {}) => {
  const b = box86(over) as Record<string, string | number | null>;
  for (const k of DEFAULTED) if (!(k in over)) delete b[k];
  return b;
};
const HEAD: Row86 = { node: "Preamble", text: "VAV System", qty: null, category: VAV };
const one = (row: Row86, cfg = C88, er = 10, more: Record<number, Row86> = {}, ov: Record<string, string> = {}): ItemListView =>
  sheet88({ 5: HEAD, [er]: { parent: 5, ...row }, ...more }, cfg)(er, ov).itemList!;
const calcView = (attrs: Record<string, string> = {}, cfg = C88): ItemListView => (calc88({ items: [blk("VAV box", attrs)] }, cfg) as ItemListSuggestion).itemList!;

describe("the v88 edits file: 5 edits, VAV Box only, no item", () => {
  it("S1 boq_rows_only x 3, S3 the bar's line, S4 rules page line 52; nothing else", () => {
    expect(EDITS88.configs.map((e) => `${e.c}:${e.p.slice(-2).join(".")}`)).toEqual([
      "hvac_vav_box:shape.boq_rows_only", "hvac_vav_box:integrator_included.boq_rows_only", "hvac_vav_box:vav_type.boq_rows_only",
      "hvac_vav_box:blank_unit_bar.line", "hvac_vav_box:50.why"]);
    expect(EDITS88.pricing_inputs).toEqual({});
  });
});

describe("T1 S1 - the VAV Box Calculator starts blank (owner 2026-11-20 17:53 'a'; 2026-11-25 00:37); BoQ rows keep the ruled defaults", () => {
  it("a fresh VAV box in the Calculator: Shape, Type, Integrator blank, no 'default' tag, no 'assumed' note, each needed ('*'), no price", () => {
    const v = calcView();
    for (const id of DEFAULTED) {
      const f = field(v, id);
      expect(f.value, id).toBe("");
      expect(f.defaulted, id).toBe(false);
      expect(f.rule, id).toBeUndefined();
      expect(f.note ?? "", id).not.toContain("(assumed)");
      expect(f.required, id).toBe(true);
    }
    expect(v.items[0].state).toBe("blank");
    expect(v.totals?.supply_rate).toBeUndefined();
    expect(v.rowPriced).toBe(false);
  });
  it("VACUITY: the same Calculator on v87 (700 CFM typed) pre-fills all three with the default tag and the assumed note, and prices", () => {
    const v = calcView({ airflow_cfm: "700" }, C87);
    expect(v.items[0].state).toBe("priced");
    for (const id of DEFAULTED) {
      expect(field(v, id).value, id).toBe(VALUES[id]);
      expect(field(v, id).defaulted, id).toBe(true);
      expect(field(v, id).note, id).toBe(NOTES[id]);
    }
  });
  it("a blank withholds the price: with the airflow typed but one of the three still blank, no price", () => {
    const all = { shape: "Rectangular", vav_type: "Nothing specific mentioned", integrator_included: "No", airflow_cfm: "700" };
    for (const id of DEFAULTED) {
      const { [id]: _drop, ...rest } = all;
      const v = calcView(rest);
      expect(v.totals?.supply_rate, id).toBeUndefined();
      expect(v.items[0].state, id).toBe("blank");
      expect(field(v, id).required, id).toBe(true);
    }
  });
  it("each filled (700 CFM + Rectangular + Nothing specific + No) -> priced exactly as on v87", () => {
    const all = { shape: "Rectangular", vav_type: "Nothing specific mentioned", integrator_included: "No", airflow_cfm: "700" };
    const v = calcView(all), w = calcView(all, C87);
    expect(v.items[0].state).toBe("priced");
    expect(v.totals).toEqual(w.totals);
    expect(v.totals?.supply_rate).toBeGreaterThan(0);
  });
  it("the VAV Integrator item in the Calculator: Type starts blank too (the same default)", () => {
    const v = (calc88({ items: [blk("VAV Integrator")] }) as ItemListSuggestion).itemList!;
    expect(field(v, "vav_type").value).toBe("");
    expect(field(v, "vav_type").defaulted).toBe(false);
  });
  it("NEGATIVE (BoQ row, SILENT BoQ): the model left all three out -> the ruled defaults with their notes, priced exactly as on v87", () => {
    const v = one({ text: "VAV box 501-800 CFM", items: [silentBox()] }), w = one({ text: "VAV box 501-800 CFM", items: [silentBox()] }, C87);
    for (const id of DEFAULTED) {
      expect(field(v, id).value, id).toBe(VALUES[id]);
      expect(field(v, id).defaulted, id).toBe(true);
      expect(field(v, id).note, id).toBe(NOTES[id]);
    }
    expect(v.items[0].state).toBe("priced");
    expect(v.totals).toEqual(w.totals);
  });
  it("NEGATIVE (BoQ row): the model's 'None' for all three -> the same defaults (v87 behaviour kept)", () => {
    const v = one({ text: "VAV box 501-800 CFM", items: [box86({ shape: "None", vav_type: "None", integrator_included: "None" })] });
    for (const id of DEFAULTED) expect(field(v, id).value, id).toBe(VALUES[id]);
    expect(v.items[0].state).toBe("priced");
  });
  it("NEGATIVE: every other category's Calculator is untouched -- no default outside VAV Box carries boq_rows_only", () => {
    for (const cat of [VAV, "hvac_adp", "hvac_vrf", "hvac_valve_package", "hvac_insulation"]) {
      const c = cfg88(cat) as unknown as { list_spec: { pricing: { defaults?: Record<string, { boq_rows_only?: boolean }> } } };
      const ds = c.list_spec.pricing.defaults ?? {};
      const flagged = Object.entries(ds).filter(([, d]) => d.boq_rows_only).map(([k]) => k).sort();
      expect(flagged, cat).toEqual(cat === VAV ? ["integrator_included", "shape", "vav_type"] : []);
    }
  });
});

describe("T2 S2 - a defaulted field says its reason once: the blue box (chat-Claude's call under the owner's 2026-11-23 13:46 word)", () => {
  it("SILENT BoQ: each defaulted field shows the blue note and NO amber rule line", () => {
    const v = one({ text: "VAV box 501-800 CFM", items: [silentBox()] });
    for (const id of DEFAULTED) {
      expect(field(v, id).note, id).toBe(NOTES[id]);
      expect(field(v, id).rule, id).toBeUndefined();
    }
  });
  it("NEGATIVE: a field whose ONLY note is the amber line keeps it (VRF: no brand stated - priced as Blue Star)", () => {
    const vrf = cfg88("hvac_vrf") as unknown as { list_spec: { pricing: { defaults: Record<string, { rule: string; note?: string }> } } };
    expect(vrf.list_spec.pricing.defaults.brand.note).toBeUndefined();
    expect(vrf.list_spec.pricing.defaults.brand.rule).toBe("no brand stated - priced as Blue Star");
  });
  it("NEGATIVE: a value the BoQ STATED is no default -- no tag, no amber rule, no assumed note", () => {
    const v = one({ text: "VAV box 501-800 CFM", items: [silentBox({ shape: "Rectangular" })] });
    expect(field(v, "shape").defaulted).toBe(false);
    expect(field(v, "shape").rule).toBeUndefined();
    expect(Object.values(NOTES)).not.toContain(field(v, "shape").note);
  });
  it("NEGATIVE: the fold reads the default's own note -- a default with no note keeps its amber rule (ADP: UL not mentioned = non-UL)", () => {
    const adp = cfg88("hvac_adp") as unknown as { list_spec: { pricing: { defaults: Record<string, { rule: string; note?: string }> } } };
    expect(Object.values(adp.list_spec.pricing.defaults).every((d) => d.note === undefined && d.rule.length > 0)).toBe(true);
  });
});

describe("T3 S3 - a no-unit row carries ONE warning: the bar's title and one sentence, no yellow line", () => {
  it("a no-unit VAV row: the orange bar, title + the one sentence; no 'No unit on the BoQ row' line", () => {
    const v = one({ text: "VAV box 501-800 CFM", unit: "", items: [silentBox()] });
    expect(v.unitBar).toEqual({ tone: "orange", title: "Warning: no unit on this row",
      lines: ["The BoQ gives no unit for this row. It is priced per number (Nos). Check the unit before using this rate."] });
    expect(v.unitNote).toBeUndefined();
    expect(JSON.stringify(v)).not.toContain("No unit on the BoQ row");
    expect(v.items[0].state).toBe("priced");
  });
  it("VACUITY: v87's bar line repeats WARNING", () => {
    expect(one({ text: "VAV box 501-800 CFM", unit: "", items: [silentBox()] }, C87).unitBar?.lines[0]).toMatch(/^WARNING: /);
  });
  it("NEGATIVE: a row with a unit has no bar", () => {
    const v = one({ text: "VAV box 501-800 CFM", unit: "Nos", items: [silentBox()] });
    expect(v.unitBar).toBeUndefined();
  });
});

describe("T5 S5 - a refused VAV box shows the ruled defaults too, and stays refused (inside the owner's 2026-11-24 16:52 / 16:58 rulings)", () => {
  const ABOVE = { text: "VAV box 15000-16900 CFM", items: [silentBox({ airflow_cfm: "15000 -16900 CFM", cfm_range: "None" })] };
  it("SILENT BoQ, 16,900 CFM (above the largest box): Type and Integrator show their defaults with the notes; the reason stays", () => {
    const v = one(ABOVE);
    expect(v.items[0].state).toBe("blank");
    expect(v.items[0].reason).toBe("16900 CFM is above the largest box on the sheet");
    for (const id of DEFAULTED) {
      expect(field(v, id).value, id).toBe(VALUES[id]);
      expect(field(v, id).defaulted, id).toBe(true);
      expect(field(v, id).note, id).toBe(NOTES[id]);
    }
    expect(v.totals?.supply_rate).toBeUndefined();
  });
  it("typing a valid airflow then prices it with no other pick", () => {
    const v = one(ABOVE, C88, 10, {}, { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: [{ base: 0, family: null, attrs: { airflow_cfm: "700" } }] }) });
    expect(v.items[0].state).toBe("priced");
    expect(v.totals?.supply_rate).toBeGreaterThan(0);
  });
  it("NEGATIVE: a refused item of a family with no band (the Misc section's) keeps its defaults held, as before", () => {
    const v = one(ABOVE);
    const blocks = v.items as ItemBlockView[];
    expect(blocks.filter((b) => b.family !== "VAV box").every((b) => (b.fields as Field[]).every((f) => !f.defaulted || b.state === "priced"))).toBe(true);
  });
});

describe("T6 S6 - a helper-added item does not claim to be 'as written (BoQ)'", () => {
  const rows: Record<number, Row86> = { 5: HEAD, 10: { parent: 5, text: "VAV box 501-800 CFM", items: [box86()] },
    20: { parent: 5, text: "VAV integrator for BMS", qty: 1, unit: "Nos", category: "hvac_misc" } };
  it("the integrator cabling the helper adds: no read-only 'as written' line; its heading still says added by the helper", () => {
    const v = sheet88(rows)(10).itemList!;
    const added = (v.items as ItemBlockView[]).find((b) => b.helperAdded);
    expect(added).toBeDefined();
    expect(added!.source).toBe("helper");
    expect(added!.readOnly).toEqual([]);
  });
  it("NEGATIVE: the box the model read keeps its line", () => {
    const v = sheet88(rows)(10).itemList!;
    const box = (v.items as ItemBlockView[]).find((b) => b.source === "model")!;
    expect(box.readOnly).toEqual([{ id: "vav_item_as_written", label: "VAV item as written", value: "VAV box" }]);
  });
});
