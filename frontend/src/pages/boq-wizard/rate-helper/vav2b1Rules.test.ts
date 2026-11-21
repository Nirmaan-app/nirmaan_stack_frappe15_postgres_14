/**
 * VAV-2b1 T3 / T4 / T5 -- KEY ABSENT = UNCHANGED (the new keys removed, VAV prices exactly as on v78), the Derivation tab (R16 every rule
 * with its "-- why:"; MISSING / ORPHAN / UNREASONED / WRONG / DEAD = 0; every NEW line shows its OWN reason -- lesson (e); line 19
 * rewritten for R7), the three Pricing Inputs reached ("used by VAV Box"), and `calculator_only` holding (a VAV-filed BoQ row is
 * still "coming soon"). Scratch copies of the newest asset only.
 */
import { describe, expect, it } from "vitest";
import { parseJson } from "@/lib/parseJson";
import { derivationCoverage } from "../../pricing/rate-master/derivationCoverage";
import { scopeUses, vavSheetInputIds } from "../../pricing/rate-master/pricingInputReach";
import { BY_ID, ITEMS, LATEST, VAV, blk } from "./vav1Vav.harness";
import { boxItem, boqMap, vavSheet } from "./vav2a.harness";
import { KEYS3, V79, box, calc79, itemsV79, other, vav78file, vav79 } from "./vav2b1.harness";
import { COMING_SOON_REASON, makePricingSheetHelper, buildExtractionByRow } from "./pricingSheetHelper";

type Json = Record<string, unknown>;
const ALL_DROP = { drop: ["withdrawn_families", "serves_also", "heading", "lower_limit", "sheet_shares", "zero_rows"] as Array<"withdrawn_families" | "serves_also" | "heading" | "lower_limit" | "sheet_shares" | "zero_rows"> };
const sections = { hvac_misc: BY_ID.get("hvac_misc"), hvac_sensors: BY_ID.get("hvac_sensors") } as Record<string, unknown>;
const strip = (x: unknown) => parseJson(JSON.stringify(x, (k, v) => (k === "shares" ? undefined : v)));

describe("T3 KEY ABSENT = UNCHANGED: with the new keys removed VAV prices as on v78", () => {
  const ROWS = { 10: box(30, { controller: "bacnet", dp: true }), 11: box(50, { controller: "ddc_inclusive" }, { integrator_included: "Yes" }),
    12: box(null, { controller: "controller" }, { airflow_cfm: "Above 3200 CFM", cfm_range: null as never }),
    50: other("Supply, Installation and Testing of Integrator for BMS connectivity of all VAV Boxes", 1),
    13: { qty: 4, items: [boxItem(), { vav_item: "BACnet over IP controller", vav_item_as_written: "controller", qty_per_box: "None", scope: "None" },
      { _section: "sensors", sensor: "Differential Pressure Switch", sensor_as_written: "DP switch", qty_per_box: "None" }] } };
  it.each([10, 11, 12, 13])("BoQ row %i: figures, items, notes and fields identical to v78", (r) => {
    const v78 = vavSheet(ROWS, { cfg: vav78file(), items: itemsV79() })(r);
    const off = vavSheet(ROWS, { cfg: vav79(ALL_DROP), items: itemsV79() })(r);
    expect(strip(off)).toEqual(strip(v78));
    expect(off.itemList!.shares).toBeUndefined();
  });
  it("the Calculator: the C4 case (box + BACnet over IP + thermostat + CO2) = v78's figures with the keys removed", () => {
    const C4 = { items: [blk("VAV box", { shape: "Rectangular", vav_type: "Nothing specific mentioned", integrator_included: "No", airflow_cfm: "650" }),
      blk("BACnet over IP controller")], sections: { misc: [blk("Digital Thermostat")], sensors: [blk("CO2 Sensor")] } };
    expect(strip(calc79(C4, {}, vav79(ALL_DROP)))).toEqual(strip(calc79(C4, {}, vav78file())));
  });
  it("MINT PARITY: the v79 FILE's VAV config IS the v78 file's + the keys file (TS = the Python mint)", () => {
    // VAV-2b1 K2 (v80 loaded): BEFORE the newest file was compared (v79 then); v80's own parity is in vav2b1V80
    if (Number(LATEST.match(/v(\d+)/)![1]) >= 79) expect(V79.byId.get(VAV)).toEqual(vav79());
    // NEGATIVE: the v78 file itself differs (the keys are not already in it)
    expect(vav78file()).not.toEqual(vav79());
  });
});

describe("T4 THE DERIVATION TAB: every rule with its reason, coverage 0 / 0 / 0 / 0, dead 0, each new line its OWN reason", () => {
  const cfg = vav79();
  const r = derivationCoverage(cfg, itemsV79(), sections);
  it("MISSING / ORPHAN / UNREASONED / WRONG / DEAD = 0 for VAV Box on the next file's keys", () => {
    expect(r.missing).toEqual([]);
    expect(r.orphan).toEqual([]);
    expect(r.unreasoned).toEqual([]);
    expect(r.wrong).toEqual([]);
    expect(r.dead).toEqual([]);
  });
  it("each NEW line shows ITS OWN reason (the owner's words), not a broader one (lesson e: the reasons list is first-match)", () => {
    for (const nr of KEYS3.derivation_reasons.new) {
      const re = new RegExp(String(nr.title), "i");
      const lines = r.lines.filter((l) => re.test(l.title));
      expect(lines.length, String(nr.title)).toBeGreaterThan(0);
      for (const l of lines) expect(l.reason, l.title).toBe(nr.why);
    }
  });
  it("line 19 rewritten for R7: the per-sheet first match, with its reason; the per-box controller's own-row line is gone", () => {
    const l19 = r.lines.find((l) => l.n === 19)!;
    expect(l19.title).toBe("Per sheet, the first match decides which controller share the VAV boxes carry");
    expect(l19.reason).toBe(Object.values(KEYS3.derivation_reasons.replace)[0].why);
    expect(r.lines.some((l) => /BACnet over IP controller priced on its own row/.test(l.title))).toBe(false);
  });
  it("the lines name the live figures: 32 / 30 / 200 from the Pricing Inputs, 46,200 + 3,200 from the SKU, the withdrawn families", () => {
    const text = r.lines.map((l) => `${l.title} :: ${l.detail ?? ""}`).join("\n");
    expect(text).toMatch(/VAV - VAVs per BACnet controller' \(32 today\)/);
    expect(text).toMatch(/VAV - VAVs per DP sensor' \(30 today\)/);
    expect(text).toMatch(/VAV - VAVs per DDC panel' \(200 today\)/);
    expect(text).toMatch(/46200 \+ 3200 quoted/);
    expect(text).toMatch(/The BACnet over IP controller, Differential Pressure Switch are no longer added to each box/);
    expect(text).toMatch(/An airflow written as a lower limit only takes the band above/);
    expect(text).toMatch(/A VAV integrator row naming the boxes it serves is the integrator's own row/);
    expect(text).toMatch(/The combination warning is the 'Review before using' block/);
  });
  it("C (4) (ANSWER 27): on the NEWEST file's VAV config AS IT IS (v79 once loaded; no v78 keys laid over it) the reasons check finds no DEAD, MISSING, ORPHAN, UNREASONED or WRONG, and line 19 as rewritten shows its OWN reason", () => {
    if (Number(LATEST.match(/v(\d+)/)![1]) < 79) return;
    const live = BY_ID.get(VAV)!;
    const c = derivationCoverage(live, ITEMS, sections);
    expect([c.missing, c.orphan, c.unreasoned, c.wrong, c.dead]).toEqual([[], [], [], [], []]);
    const l19 = c.lines.find((l) => l.n === 19)!;
    expect(l19.title).toBe("Per sheet, the first match decides which controller share the VAV boxes carry");
    expect(l19.reason).toBe(Object.values(KEYS3.derivation_reasons.replace)[0].why);
    // VACUITY: a reason no line matches, planted on a copy of the live config -> DEAD names it
    const planted = structuredClone(live) as unknown as { list_spec: { pricing: { derivation_reasons: Array<{ title: string; why: string }> } } };
    planted.list_spec.pricing.derivation_reasons.push({ title: "^A line no rule writes", why: "planted" });
    expect(derivationCoverage(planted as never, ITEMS, sections).dead).toEqual([`reason ${planted.list_spec.pricing.derivation_reasons.length - 1} (^A line no rule writes)`]);   // reasons are numbered from 0
  });
  it("VACUITY (fixture): the sheet_shares key taken out -> its lines leave and line 19 is the v78 line again", () => {
    const off = derivationCoverage(vav79({ drop: ["sheet_shares"] }), itemsV79(), sections);
    expect(off.lines.some((l) => /^The BACnet controller share spreads/.test(l.title))).toBe(false);
    expect(off.lines.find((l) => l.n === 19)!.title).toMatch(/BACnet over IP controller priced on its own row/);
  });
});

describe("T4 the three Pricing Inputs are reached ('used by VAV Box')", () => {
  it("POSITIVE vavSheetInputIds names them; scopeUses reaches every VAV SKU with each", () => {
    const pr = (vav79() as unknown as { list_spec: { pricing: Json } }).list_spec.pricing;
    expect(vavSheetInputIds(pr)).toEqual(expect.arrayContaining(["vav_vavs_per_bacnet_controller", "vav_vavs_per_dp_sensor", "vav_vavs_per_ddc_panel"]));
    const uses = scopeUses(vav79(), itemsV79());
    for (const id of ["vav_vavs_per_bacnet_controller", "vav_vavs_per_dp_sensor", "vav_vavs_per_ddc_panel"]) {
      const u = uses.find((x) => x.input === id);
      expect(u?.skus.length, id).toBeGreaterThan(0);
    }
  });
  it("NEGATIVE (vacuity) the key absent -> none of the three is reached", () => {
    const pr = (vav79({ drop: ["sheet_shares"] }) as unknown as { list_spec: { pricing: Json } }).list_spec.pricing;
    expect(vavSheetInputIds(pr).filter((x) => x.startsWith("vav_vavs_per"))).toEqual([]);
  });
});

describe("T5 calculator_only HOLDS: a VAV-filed BoQ row is still 'coming soon' and out of Suggest", () => {
  it("POSITIVE the next file's VAV config keeps calculator_only = true", () => {
    expect((vav79() as unknown as { calculator_only?: unknown }).calculator_only).toBe(true);
  });
  it("POSITIVE a VAV-filed row on the BoQ page (the switch NOT removed) declines with the coming-soon reason", () => {
    const m = boqMap(vav79());
    m.set(VAV, vav79());
    const ext = buildExtractionByRow([{ excel_row: 10, description: "VAV box", category_id: VAV, attributes: {}, items: [] }] as never);
    const h = makePricingSheetHelper({ configsByCategory: m, items: itemsV79(ITEMS), extractionByRow: ext });
    const out = h.compute({ excelRow: 10, description: "VAV box", nodeType: "Line Item", category: VAV, discipline: "HVAC", rateKinds: ["supply_rate"] } as never, {}) as { kind?: string; reason?: string };
    // VAV-2b2 K2 (R1, owner 2026-11-19 02:55 "removed in VAV-2b"; PIN F5, ANSWER 28): the switch is REMOVED - the client reads no
    // calculator_only, so even the frozen v79 config (which still carries the key; the server refuses it by name) gives the row its item-list
    // view. BEFORE: kind 'none' with the coming-soon reason
    expect(out.kind).toBe("suggestion");
    expect(out.reason).not.toBe(COMING_SOON_REASON);
  });
});
