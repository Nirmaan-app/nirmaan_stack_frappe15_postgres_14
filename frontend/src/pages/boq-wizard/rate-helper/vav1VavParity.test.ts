/**
 * VAV-1 (HVAC v76) -- the VAV Box price sheet in the Calculator, on the newest HVAC asset, through the calculator's own construction.
 *  T1 PARITY 86 / 86: every line of the workbook's VAV Box tab (pinned from the workbook at mint time: __fixtures__/vav1VavBoxTab.json)
 *     re-priced by the PRODUCT from the loaded item = the tab's BoQ supply and installation rounded to the rupee; + the 5 other VAV items
 *     (owner 2026-11-18 22:30 / 23:14 / 23:24 / 23:27; 2026-11-19 01:23).
 *  T3 CALCULATOR CASES: the VAV-D0 D2 case (BOQ-26-00383 r30) and its add / remove variants; the two integrator lines; installation.
 *  T4 LIVE BORROW (block 85, owner 2026-11-13 00:19 "... read these directly ... and not keep a second copy"): a Misc and a Sensors rate
 *     changed in the items -> the VAV section follows with no VAV change; VAV holds no figure of the five borrowed items.
 *  T6 NEGATIVES: "none of these" refuses by name; Lot / Job refuses; a blank unit is priced per Nos with the warning (v86); a box missing a fact refuses (never a pick);
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
    // VAV-2b1 K2 (HVAC v79 minted + loaded; mechanical authority): BEFORE 91 -- + the "DDC Panel/ Controller" (owner 2026-11-20 15:23 / 15:24),
    // priced only as the DDC panel share (vav2b1Shares), never per box: its own stored figures 25,000 + 5,000 BCS at 0.4 / 0.6
    expect(VAV_ITEMS.length).toBe(92);
    const ddc = VAV_ITEMS.find((i) => i.attributes.vav_item === "DDC Panel/ Controller");
    expect([ddc?.rates.cost_supply, ddc?.rates.cost_install, ddc?.rates.supply_markup, ddc?.rates.install_markup]).toEqual([25000, 5000, 0.4, 0.6]);
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
    const FIGS = ["3000", "4200", "1450", "2175", "800", "1280", "7950", "11130", "1550", "2170"];
    const pricingOf = (c: unknown) => (c as { list_spec: { pricing: Record<string, unknown> } }).list_spec.pricing;
    /** VAV-2a2 (v78; chat-Claude's review 2026-11-20 00:30 point 1): `band_from` is scanned like every other key EXCEPT the numeric values
     *  at its two declared DATA keys -- the band edges (`bands`) and the inlet-size table (`inlet_table`) -- skipped by key path */
    const scanned = (pr: Record<string, unknown>) => {
      const c = structuredClone(pr) as Record<string, unknown> & { band_from?: Record<string, unknown> };
      if (c.band_from) { c.band_from = { ...c.band_from, bands: "<skipped: the band edges>", inlet_table: "<skipped: the inlet table>" }; }
      return JSON.stringify(c);
    };
    const hits = (text: string) => FIGS.filter((fig) => new RegExp(`\\b${fig}\\b`).test(text));
    expect(hits(scanned(pricingOf(cfg)))).toEqual([]);
    const bf = pricingOf(cfg).band_from as { bands?: Array<{ value: string; max: number }>; inlet_table?: Array<{ inch: number; band: string }> } & Record<string, unknown> | undefined;
    if (bf) {
      // POSITIVE PIN: the skipped values are EXACTLY the owner's table (2026-11-18 22:18) -- edges 0 / 450 / 800 / 1350 / 2100 / 3200 / 4000 /
      // 8000 CFM, inlet sizes 6 / 8 / 10 / 12 / 14 / 16 / 24 inch -- each band named by its own edges
      const edges = [0, 450, 800, 1350, 2100, 3200, 4000, 8000];
      expect(bf.bands!.map((b) => b.max)).toEqual(edges.slice(1));
      expect(bf.bands!.map((b) => b.value)).toEqual(edges.slice(1).map((m, i) => `${edges[i]}-${m}`));
      expect(bf.inlet_table!.map((r) => [r.inch, r.band])).toEqual([6, 8, 10, 12, 14, 16, 24].map((inch, i) => [inch, bf.bands![i].value]));
      // ... and band_from holds no other number than its declared mm per inch, and only its declared keys
      // VAV-2b1 K2 (HVAC v79; mechanical authority): + "lower_limit" (owner 2026-11-20 14:10 "1a"; words / line / tag, no number). BEFORE the 11 keys without it
      expect(Object.keys(bf).sort()).toEqual(["airflow_attr", "attr", "bands", "edge", "families", "group", "inlet_attr", "inlet_table", "lines", "lower_limit", "mm_per_inch", "tags"]);
      const rest = JSON.stringify({ ...bf, bands: null, inlet_table: null, mm_per_inch: null });
      expect(rest.match(/\d+(?:\.\d+)?/g) ?? []).toEqual(["25.4"]);
      expect(bf.mm_per_inch).toBe(25.4);
      // VACUITY (a fixture copy): a borrowed figure put into band_from -> the guard goes red
      const bad = structuredClone(pricingOf(cfg));
      (bad.band_from as { lines: Record<string, string> }).lines.crosses += " 4200";
      expect(hits(scanned(bad))).toEqual(["4200"]);
    }
    // VAV-2b1 K2 (PIN 12, ANSWER 27 condition (ii)): the scan has NO skipped path for the v79 keys -- sheet_shares and withdrawn_families
    // are scanned like every other key (condition (i): the skip list is band_from's two declared data keys only, above). VACUITY x 2:
    // a borrowed figure planted beside a name in withdrawn_families, and one inside a share part's SKU name, each goes red
    const pr79 = pricingOf(cfg) as { withdrawn_families?: string[]; sheet_shares?: { shares: Array<{ parts: Array<{ sku?: { value?: string } }> }> } };
    if (pr79.withdrawn_families && pr79.sheet_shares) {
      const a = structuredClone(pricingOf(cfg)) as typeof pr79;
      a.withdrawn_families!.push("2170");
      expect(hits(scanned(a as Record<string, unknown>))).toEqual(["2170"]);
      const b = structuredClone(pricingOf(cfg)) as typeof pr79;
      const part = b.sheet_shares!.shares.flatMap((s) => s.parts).find((p) => p.sku?.value)!;
      part.sku!.value += " 11130";
      expect(hits(scanned(b as Record<string, unknown>))).toEqual(["11130"]);
      // condition (iii): the three counts are READ from the Pricing Inputs -- each share part names an input id; no 32 / 30 / 200 is held
      const ss = JSON.stringify(pr79.sheet_shares);
      // the NUMBER leaves only (a word table's regex holds quantifiers such as {0,30}, which are not counts -- found on v80's DDC words)
      // ANSWER 45 (a): a NUMBER leaf, or a leaf whose WHOLE string is a bare number ("32", " 200 "), is a count held in the config; a number
      // inside a longer string or a regex is not
      const counts = (root: unknown): number[] => {
        const out: number[] = [];
        const walk = (o: unknown): void => {
          if (typeof o === "number") out.push(o);
          else if (typeof o === "string" && /^\s*\d+(\.\d+)?\s*$/.test(o)) out.push(Number(o));
          else if (o && typeof o === "object") Object.values(o).forEach(walk);
        };
        walk(root);
        return out.filter((x) => x === 32 || x === 30 || x === 200);
      };
      expect(counts(pr79.sheet_shares)).toEqual([]);
      // VACUITY x 2: a number leaf 32 and a string leaf "200" planted in a copy -> both seen
      const plant = structuredClone(pr79.sheet_shares) as unknown as { labels: Record<string, unknown> };
      plant.labels.planted_number = 32;
      plant.labels.planted_string = " 200 ";
      expect(counts(plant).sort()).toEqual([200, 32].sort());
      expect(ss).toContain("vav_vavs_per_bacnet_controller");
      expect(ss).toContain("vav_vavs_per_dp_sensor");
      expect(ss).toContain("vav_vavs_per_ddc_panel");
    }
    // the borrowed items are the Misc / Sensors items themselves
    expect(ITEMS.filter((i) => i.kind === "hvac_misc_item").length).toBe(24);
    // VAV-2b1 K2 (HVAC v79; mechanical authority): BEFORE 2 -- + the Sensors sheet's "Duct Static Pressure Sensor" (Greystone/Honeywell; owner
    // 2026-11-20 14:35), ONE item on the Sensors sheet, read live by the DP sensor share (no VAV copy: VAV_ITEMS hold no sensor item)
    expect(ITEMS.filter((i) => i.kind === "hvac_sensor_item").map((i) => i.attributes.sensor).sort()).toEqual(["CO2 Sensor", "Differential Pressure Switch", "Duct Static Pressure Sensor"]);
    expect(VAV_ITEMS.some((i) => /Static Pressure/i.test(JSON.stringify(i)))).toBe(false);
  });
});

describe(`VAV-1 T6 negatives on ${LATEST}`, () => {
  it("'none of these' refuses by name (the item as written)", () => {
    const v = view(calc({ items: [blk("none of these", { vav_item_as_written: "VAV software" })] }));
    expect(v?.rowPriced).toBe(false);
  });
  // VAV-2c3 FIX-2 (PIN FIX2-D; owner 2026-11-24 20:00 "[no unit] price it by number and mention it clearly in notes. the notes should be a stronger
  // warning"): a blank unit no longer refuses -- HVAC v86 prices it per Nos with the warning bar (`blank_unit_bar`); the Lot / Job half is kept
  it("Lot / Job refuses; a blank unit is priced per Nos with the warning bar", () => {
    // the calculator's unit choices for VAV Box are Nos and Lot (the lot units' representative): Lot refuses with the config's sentence
    const lot = view(calc(D2, surfaceMap(), ITEMS, "Lot"));
    expect(lot?.rowPriced).toBe(false);
    expect(lot?.reason).toBe("Unit \"Lot\" is not a VAV unit: VAV items are priced per Nos. A Lot or a job is priced by hand.");
    // a Job row is a lot unit by the config (the BoQ row's refusal; the calculator cannot pick it)
    const lu = (BY_ID.get(VAV) as unknown as { list_spec: { pricing: { lot_units: { units: string[] } } } }).list_spec.pricing.lot_units.units;
    expect(lu).toEqual(expect.arrayContaining(["Lot", "Job", "LS", "Lumpsum"]));
    // a unit VAV does not stock refuses on a BoQ row (the calculator offers none); a blank unit is priced per Nos with the bar: the config says so
    const pr = (BY_ID.get(VAV) as unknown as { list_spec: { pricing: { blank_unit_refuses?: boolean; blank_unit_bar?: { line: string }; unit_classes: Record<string, string[]>; unit_refusal: string } } }).list_spec.pricing;
    expect(pr.blank_unit_refuses).toBeUndefined();
    // VAV-FIX (PIN VAVFIX F-D (2), ANSWER 5; S3 one warning): BEFORE "WARNING: The BoQ gives no unit for this row. Priced per number (Nos). Check the unit before using this rate."
    expect(pr.blank_unit_bar?.line).toBe("The BoQ gives no unit for this row. It is priced per number (Nos). Check the unit before using this rate.");
    expect(Object.keys(pr.unit_classes)).toEqual(["count"]);
    expect(pr.unit_refusal).toMatch(/is not a VAV unit/);
  });
  // VAV-2c3 FIX (PIN FIX-D; owner 2026-11-24 16:52 "if payload does not me tion integrator - we use integrator = No"; 2026-11-18 23:53 pt 10;
  // 22:16 ruling B): a box missing shape / type / integrator now prices on the ruled default (HVAC v85 `defaults`, marked); a box missing its
  // band (no airflow, no inlet) still refuses (23:53 pt 4) -- never a pick among the 84
  // VAV-FIX (PIN VAVFIX F-D (1), ANSWER 5 - INVERTED, mechanical authority; owner 2026-11-20 17:53 "a", 2026-11-25 00:37: every CALCULATOR field
  // starts blank and a blank withholds the price; the ruled defaults are for BoQ rows only, HVAC v88 `boq_rows_only`). This check prices on the
  // Calculator (calc -> calculatorCtx, no BoQ row). BEFORE: rowPriced true and the field defaulted. The BoQ-row side is vavfix.test.ts (silent BoQ).
  it("INVERTED (VAV-FIX S1): in the CALCULATOR a box missing a fact WITH a ruled default refuses, the field blank and needed; missing the band still refuses -- never a pick among the 84", () => {
    for (const k of ["shape", "vav_type", "integrator_included"]) {
      const attrs = { ...D2_BOX.attrs }; delete (attrs as Record<string, string>)[k];
      const v = view(calc({ items: [blk("VAV box", attrs)] }));
      expect(v?.rowPriced, k).toBe(false);
      const f = (v?.items?.[0]?.fields as Array<{ id: string; value: string; defaulted?: boolean; required?: true }> | undefined)?.find((x) => x.id === k);
      expect(f?.defaulted, k).toBe(false);
      expect(f?.value, k).toBe("");
      expect(f?.required, k).toBe(true);
    }
    const attrs = { ...D2_BOX.attrs }; delete (attrs as Record<string, string>).cfm_range;
    const v = view(calc({ items: [blk("VAV box", attrs)] }));
    expect(v?.rowPriced, "cfm_range").toBe(false);
    expect(v?.items?.[0]?.figures?.supply_rate ?? null, "cfm_range").toBeNull();
  });
  it("VACUITY (a surface without hvac_sensors): the Sensors cases break; with it they price", () => {
    const state = { items: [D2_BOX], sections: { sensors: [blk("CO2 Sensor")] } };
    expect(tot(calc(state))).toEqual([27160 + 11130, 2400 + 900]);
    expect(view(calc(state, surfaceMap(["hvac_sensors"])))?.rowPriced).toBe(false);
  });
});
