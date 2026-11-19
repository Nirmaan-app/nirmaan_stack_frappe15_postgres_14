/**
 * VAV-1 (HVAC v76) -- the VAV Box price sheet in the Calculator, on the newest HVAC asset, through the calculator's own construction.
 *  T1 PARITY 86 / 86: every line of the workbook's VAV Box tab (pinned from the workbook at mint time: __fixtures__/vav1VavBoxTab.json)
 *     re-priced by the PRODUCT from the loaded item = the tab's BoQ supply and installation rounded to the rupee; + the 5 other VAV items
 *     (owner 2026-11-18 22:30 / 23:14 / 23:24 / 23:27; 2026-11-19 01:23).
 *  T3 CALCULATOR CASES: the VAV-D0 D2 case (BOQ-26-00383 r30) and its add / remove variants; the two integrator lines; installation.
 *  T4 LIVE BORROW (block 85, owner 2026-11-13 00:19 "... read these directly ... and not keep a second copy"): a Misc and a Sensors rate
 *     changed in the items -> the VAV section follows with no VAV change; VAV holds no figure of the five borrowed items.
 *  T6 NEGATIVES: "none of these" refuses by name; Lot / Job refuses; a blank unit refuses; a box missing a fact refuses (never a pick);
 *     a map without hvac_sensors breaks the Sensors cases.
 */
import { describe, expect, it } from "vitest";
import { BY_ID, D2, D2_BOX, ITEMS, LATEST, TAB, VAV, VAV_ITEMS, blk, calc, surfaceMap, tabEntry, tot, view } from "./vav1Vav.harness";

describe(`VAV-1 T1 parity on ${LATEST}: the VAV Box tab, 86 lines, product = tab rounded`, () => {
  it("the fixture is the workbook's 86 lines (rows 2-87): 84 box lines + 2 VAV Integrator lines", () => {
    expect(TAB.workbook_sha256.startsWith("a801d027")).toBe(true);
    expect(TAB.vav_box_tab.map((r) => r.row)).toEqual(Array.from({ length: 86 }, (_, i) => i + 2));
    expect(TAB.vav_box_tab.filter((r) => r.item === "VAV Integrator").map((r) => r.row)).toEqual([44, 45]);
  });
  for (const r of TAB.vav_box_tab) {
    it(`tab row ${r.row}: ${r.item} / ${r.type} / ${r.integrator} / ${r.cfm}`, () => {
      const s = calc({ items: [tabEntry(r)] });
      expect(view(s)?.rowPriced, JSON.stringify(view(s)?.items?.map((b) => b.reason ?? null))).toBe(true);
      expect(tot(s)).toEqual([Math.round(r.boq_supply), Math.round(r.boq_install)]);
    });
  }
  it("the 26 non-whole tab BoQ cells are the product's whole rupee (the tab has no rounding; the product's ROUNDUP does it)", () => {
    const odd = TAB.vav_box_tab.filter((r) => !Number.isInteger(r.boq_supply) || !Number.isInteger(r.boq_install));
    expect(odd.length).toBe(26);
    for (const r of odd) expect(tot(calc({ items: [tabEntry(r)] }))).toEqual([Math.round(r.boq_supply), Math.round(r.boq_install)]);
    // NEGATIVE: a tab cell taken as stored is NOT a whole rupee, so a parity that compared the raw cell would fail on these rows
    expect(odd.some((r) => tot(calc({ items: [tabEntry(r)] }))[0] === r.boq_supply)).toBe(false);
  });
  it("the loaded items carry the CLEAN BCS values (the tab's float noise removed) and 'AHRI Certified' spelled right", () => {
    const tabNoise = TAB.vav_box_tab.filter((r) => !Number.isInteger(r.bcs_supply) || !Number.isInteger(r.bcs_install));
    expect(tabNoise.length).toBe(7);
    for (const it of VAV_ITEMS) {
      expect(Number.isInteger(it.rates.cost_supply)).toBe(true);
      expect(Number.isInteger(it.rates.cost_install)).toBe(true);
    }
    expect(VAV_ITEMS.some((i) => /Certfied/.test(JSON.stringify(i.attributes)))).toBe(false);
  });
  it("the 5 other VAV items: 46,200 + 3,200; 1,680 + 0; 1,680 + 0; 196 + 0 per metre; 0 + 2,400", () => {
    expect(tot(calc({ items: [blk("BACnet over IP controller")] }))).toEqual([46200, 3200]);
    expect(tot(calc({ items: [blk("Duct connection")] }))).toEqual([1680, 0]);
    expect(tot(calc({ items: [blk("Conical piece")] }))).toEqual([1680, 0]);
    expect(tot(calc({ items: [blk("Integrator cabling")] }))).toEqual([196, 0]);
    expect(tot(calc({ items: [blk("VAV installation - any size")] }))).toEqual([0, 2400]);
    expect(VAV_ITEMS.length).toBe(91);
    expect(VAV_ITEMS.find((i) => i.attributes.vav_item === "Integrator cabling")?.unit).toBe("Mtr");
  });
});

describe(`VAV-1 T3 calculator cases on ${LATEST}`, () => {
  it("D2: box Rect / AHRI Certified / Integrator Yes / 450-800 + Conical piece x2 + Digital Thermostat (Misc) = 34,720 + 2,900", () => {
    const s = calc(D2);
    expect(tot(s)).toEqual([34720, 2900]);
    expect(view(s)?.items?.map((b) => [b.family, b.figures?.supply_rate, b.figures?.install_rate])).toEqual([["VAV box", 27160, 2400], ["Conical piece", 3360, 0]]);
  });
  it("+ Integrator cabling qty 2 (392) + Differential Pressure Switch (Sensors, 2,170 + 900) = 37,282 + 3,800", () => {
    expect(tot(calc({ items: [...D2.items, blk("Integrator cabling", {}, "2")], sections: { ...D2.sections, sensors: [blk("Differential Pressure Switch")] } })))
      .toEqual([37282, 3800]);
  });
  it("the conical piece removed from D2 = 31,360 + 2,900", () => {
    expect(tot(calc({ items: [D2_BOX], sections: D2.sections }))).toEqual([31360, 2900]);
  });
  it("the VAV Integrator lines: 49,000 + 8,000; Imported 140,000 + 24,000; installation - any size 0 + 2,400", () => {
    expect(tot(calc({ items: [blk("VAV Integrator", { vav_type: "Nothing specific mentioned" })] }))).toEqual([49000, 8000]);
    expect(tot(calc({ items: [blk("VAV Integrator", { vav_type: "Imported" })] }))).toEqual([140000, 24000]);
    expect(tot(calc({ items: [blk("VAV installation - any size")] }))).toEqual([0, 2400]);
  });
  it("the borrowed five price at their own category's figures: thermometer 2,175 + 500, transformation piece 1,280 + 250, CO2 11,130 + 900", () => {
    expect(tot(calc({ items: [], sections: { misc: [blk("Temperature Gauge / Thermometer")] } }))).toEqual([2175, 500]);
    expect(tot(calc({ items: [], sections: { misc: [blk("Transformation Pieces")] } }))).toEqual([1280, 250]);
    expect(tot(calc({ items: [], sections: { misc: [blk("Digital Thermostat")] } }))).toEqual([4200, 500]);
    expect(tot(calc({ items: [], sections: { sensors: [blk("CO2 Sensor")] } }))).toEqual([11130, 900]);
    expect(tot(calc({ items: [], sections: { sensors: [blk("Differential Pressure Switch")] } }))).toEqual([2170, 900]);
  });
  it("scope: supply only -> install 0; installation only -> supply 0, install x (1 + 0) (owner ruling D, 2026-11-18 22:16)", () => {
    expect(tot(calc(D2, surfaceMap(), ITEMS, "Nos", "Supply only"))).toEqual([34720, 0]);
    expect(tot(calc(D2, surfaceMap(), ITEMS, "Nos", "Installation only"))).toEqual([0, 2900]);
    expect(tot(calc(D2, surfaceMap(), ITEMS, "Nos", "Supply + installation"))).toEqual([34720, 2900]);
  });
});

describe(`VAV-1 T4 live borrow on ${LATEST}: no second copy`, () => {
  it("a Misc and a Sensors rate changed in the items -> the VAV sections follow; VAV's config and items unchanged", () => {
    const bumped = ITEMS.map((i) => (i.kind === "hvac_misc_item" && i.attributes.item === "Digital Thermostat") ? { ...i, rates: { ...i.rates, cost_supply: 4000 } }
      : (i.kind === "hvac_sensor_item" && i.attributes.sensor === "Differential Pressure Switch") ? { ...i, rates: { ...i.rates, cost_install: 1000 } } : i);
    const state = { items: [D2_BOX], sections: { misc: [blk("Digital Thermostat")], sensors: [blk("Differential Pressure Switch")] } };
    expect(tot(calc(state))).toEqual([27160 + 4200 + 2170, 2400 + 500 + 900]);
    expect(tot(calc(state, surfaceMap(), bumped))).toEqual([27160 + 5600 + 2170, 2400 + 500 + 1800]);
  });
  it("VAV's config and the 91 VAV items hold no figure and no name of the five borrowed items", () => {
    const vavText = JSON.stringify(VAV_ITEMS);
    for (const name of ["Digital Thermostat", "Temperature Gauge", "Transformation Pieces", "CO2 Sensor", "Differential Pressure Switch"]) expect(vavText).not.toContain(name);
    const cfg = BY_ID.get(VAV)!;
    const pricing = JSON.stringify((cfg as unknown as { list_spec: { pricing: unknown } }).list_spec.pricing);
    for (const fig of ["3000", "4200", "1450", "2175", "800", "1280", "7950", "11130", "1550", "2170"]) expect(pricing).not.toMatch(new RegExp(`\\b${fig}\\b`));
    // the borrowed items are the Misc / Sensors items themselves
    expect(ITEMS.filter((i) => i.kind === "hvac_misc_item").length).toBe(24);
    expect(ITEMS.filter((i) => i.kind === "hvac_sensor_item").length).toBe(2);
  });
});

describe(`VAV-1 T6 negatives on ${LATEST}`, () => {
  it("'none of these' refuses by name (the item as written)", () => {
    const v = view(calc({ items: [blk("none of these", { vav_item_as_written: "VAV software" })] }));
    expect(v?.rowPriced).toBe(false);
  });
  it("Lot / Job refuses; a blank unit refuses", () => {
    // the calculator's unit choices for VAV Box are Nos and Lot (the lot units' representative): Lot refuses with the config's sentence
    const lot = view(calc(D2, surfaceMap(), ITEMS, "Lot"));
    expect(lot?.rowPriced).toBe(false);
    expect(lot?.reason).toBe("Unit \"Lot\" is not a VAV unit: VAV items are priced per Nos. A Lot or a job is priced by hand.");
    // a Job row is a lot unit by the config (the BoQ row's refusal; the calculator cannot pick it)
    const lu = (BY_ID.get(VAV) as unknown as { list_spec: { pricing: { lot_units: { units: string[] } } } }).list_spec.pricing.lot_units.units;
    expect(lu).toEqual(expect.arrayContaining(["Lot", "Job", "LS", "Lumpsum"]));
    // a blank unit and a unit VAV does not stock refuse on a BoQ row (the calculator offers neither): the config says so
    const pr = (BY_ID.get(VAV) as unknown as { list_spec: { pricing: { blank_unit_refuses: boolean; unit_classes: Record<string, string[]>; unit_refusal: string } } }).list_spec.pricing;
    expect(pr.blank_unit_refuses).toBe(true);
    expect(Object.keys(pr.unit_classes)).toEqual(["count"]);
    expect(pr.unit_refusal).toMatch(/is not a VAV unit/);
  });
  it("a box missing a match fact refuses, naming it -- never a pick among the 84", () => {
    for (const k of ["shape", "vav_type", "integrator_included", "cfm_range"]) {
      const attrs = { ...D2_BOX.attrs }; delete (attrs as Record<string, string>)[k];
      const v = view(calc({ items: [blk("VAV box", attrs)] }));
      expect(v?.rowPriced, k).toBe(false);
      expect(v?.items?.[0]?.figures?.supply_rate ?? null, k).toBeNull();
    }
  });
  it("VACUITY (a surface without hvac_sensors): the Sensors cases break; with it they price", () => {
    const state = { items: [D2_BOX], sections: { sensors: [blk("CO2 Sensor")] } };
    expect(tot(calc(state))).toEqual([27160 + 11130, 2400 + 900]);
    expect(view(calc(state, surfaceMap(["hvac_sensors"])))?.rowPriced).toBe(false);
  });
});
