/**
 * DU-2 K1 -- the DU-1 cert fixes and the 23:57 row-ruling mechanisms, each with a positive AND a negative case, from the panel's entry
 * point (`makePricingSheetHelper(...).compute`) or the calculator, on the newest HVAC asset. The Ducting config keys the mechanisms read
 * (`family_alias_needs`, `no_sku_refuse_default`, the re-file entries) are added here to a COPY of the asset's Ducting config exactly as
 * the v72 mint adds them, so the mechanism is proven with and without its key whatever the newest asset is.
 *
 *   C8 (owner 2026-11-15 23:29 "1b")      Pricing Inputs "used by" counts a pricing-level scope's installation-only uplift.
 *   finding a ("fix in DU 2")             a round duct per metre shows no Width / Height boxes, and is never priced by them.
 *   finding b ("fix in DU 2")             no 'BoQ says ... (your rule)' line under a kind the pricer picked.
 *   finding c ("fix in DU 2")             a typed diameter's note names the dropdown's sizes.
 *   R-NOTE-ORDER (owner 23:57)            a non-duct filed Ducting refuses with its re-file note before the unit check (no lot bar).
 *   R-TYPO (owner 23:57 "yes")            "24 gause" reads as 24G; SWG reads as its gauge (owner: 18 SWG = 18G).
 */
import { chai, describe, expect, it } from "vitest"; chai.config.truncateThreshold = 0;
import { ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, buildExtractionByRow, makePricingSheetHelper, type ItemListSuggestion, type ItemListView } from "./pricingSheetHelper";
import { calculatorCtx } from "../../pricing/PricingCalculator";
import { pricingInputUsedBy, pricingInputUsedByText } from "../../pricing/rate-master/rateMasterSpec";
import { CFG, ITEMS, LATEST } from "./du1Duct.harness";

const DUCT = "hvac_ducting", VALVE = "hvac_valve_package";
const KINDS = ["supply_rate", "install_rate", "combined_rate"];
const RECT = "Rectangular (GI)", SPIRAL = "Spiral / Oval (GI)", ROUND = "Round (GI) - per metre";
type Refusal = { words: string[]; refuse: string };
/** the parts of a config these cases read or change */
type Json = { category_id?: string; list_spec: { pricing: { family_alias_needs?: Record<string, string[]>; no_sku_refuse_default?: string;
  no_sku_refusals: Refusal[]; scope?: { uplift_input: string }; extras?: { scope?: { uplift_input?: string } } } } };
const clone = <T,>(x: T): T => structuredClone(x);

/** the asset's Ducting config WITH the DU-2 keys (as the v72 mint writes them) and WITHOUT them */
const WITH: Json = (() => {
  const c = clone(CFG.get(DUCT) as unknown as Json);
  const pr = c.list_spec.pricing;
  pr.family_alias_needs = { [ROUND]: ["thickness_mm", "dia_mm"] };
  const first = [
    { words: ["valve"], refuse: "Reads as a valve, not a duct - re-file this row under Valve Package" },
    { words: ["copper", "hard drawn", "refrigerant pipe", "refrigerant piping"], refuse: "Reads as a copper / refrigerant pipe, not a duct - re-file this row under Piping" },
    { words: ["outdoor unit", "indoor unit", "cassette", "vrv", "vrf", "hi wall", "high wall", "ductable unit"], refuse: "Reads as a VRF / AC unit, not a duct - re-file this row under VRF" },
  ];
  pr.no_sku_refusals = [...first, ...pr.no_sku_refusals.filter((r: Refusal) => !first.some((f) => f.refuse === r.refuse))];
  pr.no_sku_refuse_default = "Reads as '{named}', not a duct - re-file this row under its own category";
  return c;
})();
const WITHOUT: Json = (() => {
  const c = clone(CFG.get(DUCT) as unknown as Json);
  const pr = c.list_spec.pricing;
  delete pr.family_alias_needs; delete pr.no_sku_refuse_default;
  pr.no_sku_refusals = pr.no_sku_refusals.filter((r: Refusal) => !/re-file this row under (Valve Package|Piping|VRF)$/.test(r.refuse));
  return c;
})();
const cfgs = (duct: Json) => new Map([...CFG.entries()].map(([k, v]) => [k, k === DUCT ? duct : v]));

type Item = Record<string, string | null> & { _section?: string };
const mi = (a: Item) => {
  const { _section, ...attrs } = a;
  return { ...(_section ? { section: _section } : {}), attributes: Object.fromEntries(Object.entries(attrs).filter(([, v]) => v !== undefined).map(([k, v]) => [k, { value: v, confidence: 0.9 }])) };
};
const D = (type: string | null, gauge: string | null, more: Item = {}): Item => ({ duct_type: type, duct_type_as_written: type, gauge_as_written: gauge, insulated: "No", ...more });
const panel = (duct: Json, items: Item[], unit = "Sqm", text = "duct row", category = DUCT, ov: Record<string, string> = {}): ItemListView => {
  const rows = [{ excel_row: 9, description: text, category_id: category, attributes: {}, items: items.map(mi) }];
  const h = makePricingSheetHelper({ configsByCategory: cfgs(duct) as never, items: ITEMS as never, extractionByRow: buildExtractionByRow(rows as never) });
  return (h.compute({ excelRow: 9, description: text, nodeType: "Line Item", category, discipline: "HVAC", rateKinds: KINDS, unit,
    headings: [], ownNotes: [], headingNotes: [] } as never, ov) as unknown as ItemListSuggestion).itemList!;
};
const calc = (duct: Json, blocks: unknown[], unit = "mts"): ItemListView => {
  const h = makePricingSheetHelper({ configsByCategory: cfgs(duct) as never, items: ITEMS as never, extractionByRow: new Map() });
  return (h.compute(calculatorCtx("HVAC", DUCT), { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: blocks }), [ROW_UNIT_OVERRIDE_KEY]: unit }) as unknown as ItemListSuggestion).itemList!;
};
const fieldIds = (v: ItemListView) => (v.items[0]?.fields ?? []).map((f) => (f as { id: string }).id);
const tot = (v: ItemListView) => [v.totals?.supply_rate, v.totals?.install_rate];

describe(`DU-2 K1 fixes on ${LATEST}`, () => {
  // ── C8 ─────────────────────────────────────────────────────────────────────────────────────────────
  it("C8 pos: Pricing Inputs 'used by' counts the Valve Package and Ducting installation-only uplift (one use each)", () => {
    const v = CFG.get(VALVE) as unknown as Json, d = CFG.get(DUCT) as unknown as Json;
    const vi = v.list_spec.pricing.scope!.uplift_input, di = d.list_spec.pricing.scope!.uplift_input;
    const u = pricingInputUsedBy([v, d] as never);
    expect(u[vi]).toEqual({ sites: 1, categories: [VALVE] });
    expect(u[di]).toEqual({ sites: 1, categories: [DUCT] });
    expect(pricingInputUsedByText(u[di], (c) => (c === DUCT ? "Ducting" : c))).toBe("Ducting (1 use)");
  });
  it("C8 neg: a config without a pricing-level scope adds no use; a config with extras is not counted twice", () => {
    const d = clone(CFG.get(DUCT) as unknown as Json); const di = d.list_spec.pricing.scope!.uplift_input; delete d.list_spec.pricing.scope;
    expect(pricingInputUsedBy([d] as never)[di]).toBeUndefined();
    const vrf = CFG.get("hvac_vrf") as unknown as Json;
    const before = pricingInputUsedBy([vrf] as never);
    const vrfUplift = vrf.list_spec.pricing.extras?.scope?.uplift_input;
    if (vrfUplift) expect(before[vrfUplift]?.sites).toBe(1);
  });

  // ── finding a ──────────────────────────────────────────────────────────────────────────────────────
  it("finding a pos: 'Round (GI) - per metre' shows the diameter box and no Width / Height boxes", () => {
    const v = calc(WITH, [{ base: null, family: ROUND, attrs: { gauge_as_written: "24G" }, other: [] }]);
    expect(fieldIds(v)).toContain("dia_mm");
    expect(fieldIds(v)).not.toContain("duct_w_mm");
    expect(fieldIds(v)).not.toContain("duct_h_mm");
  });
  it("finding a neg: Spiral / Oval per metre keeps both ways (diameter OR Width / Height); without the key the round alias shows them", () => {
    const v = calc(WITH, [{ base: null, family: SPIRAL, attrs: { gauge_as_written: "24G" }, other: [] }]);
    expect(fieldIds(v)).toEqual(expect.arrayContaining(["dia_mm", "duct_w_mm", "duct_h_mm"]));
    const w = calc(WITHOUT, [{ base: null, family: ROUND, attrs: { gauge_as_written: "24G" }, other: [] }]);
    expect(fieldIds(w)).toEqual(expect.arrayContaining(["duct_w_mm", "duct_h_mm"]));
  });
  it("finding a pricing: a round duct per metre with only W x H is not priced as an oval duct (needs its diameter); with a diameter it prices", () => {
    const noDia = panel(WITH, [D(ROUND, "24G", { size_as_written: "600 x 400" })], "Rmt", "round duct per metre");
    expect(noDia.rowPriced).toBe(false);
    const was = panel(WITHOUT, [D(ROUND, "24G", { size_as_written: "600 x 400" })], "Rmt", "round duct per metre");
    expect(was.rowPriced).toBe(true);
    const dia = panel(WITH, [D(ROUND, "24G", { size_as_written: "150 mm dia" })], "Rmt", "round duct per metre");
    expect(dia.rowPriced).toBe(true);
    expect(tot(dia)).toEqual([670, 130]);
  });

  // ── finding b ──────────────────────────────────────────────────────────────────────────────────────
  it("finding b pos: a kind PICKED by the pricer carries no 'BoQ says' alias line (familyRaw empty)", () => {
    const v = calc(WITH, [{ base: null, family: ROUND, attrs: { gauge_as_written: "24G", dia_mm: "100" }, other: [] }]);
    expect(v.items[0].family).toBe(SPIRAL);
    expect(v.items[0].familyRaw).toBeNull();
  });
  it("finding b neg: the model's answer of the alias keeps its line (familyRaw = the answer)", () => {
    const v = panel(WITH, [D(ROUND, "24G", { size_as_written: "100 mm dia" })], "Rmt", "round duct per metre");
    expect(v.items[0].family).toBe(SPIRAL);
    expect(v.items[0].familyRaw).toBe(ROUND);
  });

  // ── finding c ──────────────────────────────────────────────────────────────────────────────────────
  it("finding c pos: a typed diameter not in the list names the dropdown's sizes, never 'the sheet stocks no sizes'", () => {
    const v = calc(WITH, [{ base: null, family: ROUND, attrs: { gauge_as_written: "24G", dia_mm: "175" }, other: ["dia_mm"] }]);
    const s = JSON.stringify(v.items[0].fields);
    expect(v.rowPriced).toBe(true);
    expect(s).toContain("a typed size - the list offers 80, 100, 150, 200, 250, 300 mm; any size is priced");
    expect(s).not.toContain("the sheet stocks no sizes");
  });
  it("finding c neg: a diameter from the list carries no typed-size note", () => {
    const v = calc(WITH, [{ base: null, family: ROUND, attrs: { gauge_as_written: "24G", dia_mm: "150" }, other: [] }]);
    expect(JSON.stringify(v.items[0].fields)).not.toContain("a typed size");
  });

  // ── R-NOTE-ORDER ───────────────────────────────────────────────────────────────────────────────────
  it("R-NOTE-ORDER pos: a VRF outdoor unit filed Ducting (unit Nos) says re-file under VRF, not the unit line, and shows no lot bar", () => {
    const v = panel(WITH, [{ duct_type: "none of these", duct_type_as_written: "4 HP-side discharge outdoor unit", insulated: null }], "Nos", "4 HP-side discharge outdoor unit");
    expect(v.rowPriced).toBe(false);
    expect(JSON.stringify(v)).toContain("Reads as a VRF / AC unit, not a duct - re-file this row under VRF");
    expect(JSON.stringify(v)).not.toContain("is not a duct unit");
    expect(v.unitBar).toBeUndefined();
  });
  it("R-NOTE-ORDER pos: a lot-unit thermostat and a blank-unit valve say re-file (default sentence; Valve Package)", () => {
    const t = panel(WITH, [{ duct_type: "none of these", duct_type_as_written: "Electronic Thermostat", insulated: null }], "Lot", "Electronic Thermostat BMS compatible");
    expect(JSON.stringify(t)).toContain("Reads as 'Electronic Thermostat', not a duct - re-file this row under its own category");
    const b = panel(WITH, [{ duct_type: "none of these", duct_type_as_written: "Butterfly valves-100 mm NB", insulated: null }], "", "Butterfly valves-100 mm NB");
    expect(JSON.stringify(b)).toContain("Reads as a valve, not a duct - re-file this row under Valve Package");
  });
  it("R-NOTE-ORDER neg: a DUCT on a Nos row keeps the unit line and the lot bar; the Valve Package (no re-file sentences) is unchanged", () => {
    const v = panel(WITH, [D(RECT, "24G")], "Nos", "GI duct");
    expect(JSON.stringify(v)).toContain("Unit \\\"Nos\\\" is not a duct unit");
    expect(v.unitBar?.tone).toBe("red");
    const valve = panel(WITH, [{ valve_type: "none of these", valve_type_as_written: "4 HP outdoor unit" }], "Lot", "4 HP outdoor unit", VALVE);
    expect(JSON.stringify(valve)).not.toContain("re-file this row under VRF");
  });
  it("R-NOTE-ORDER: without the default sentence the old no-SKU sentence stands", () => {
    const v = panel(WITHOUT, [{ duct_type: "none of these", duct_type_as_written: "Electronic Thermostat", insulated: null }], "Lot", "Electronic Thermostat");
    expect(JSON.stringify(v)).toContain("No SKU in the catalogue for Electronic Thermostat - price this row by hand");
  });

  // ── R-TYPO / SWG ───────────────────────────────────────────────────────────────────────────────────
  it("R-TYPO pos: '24 gause' reads as 24G; '18 SWG' reads as 18G", () => {
    expect(tot(panel(WITH, [D(RECT, "24 gause")]))).toEqual([1080, 260]);
    expect(tot(panel(WITH, [D(RECT, "18 SWG")]))).toEqual([1800, 260]);
  });
  // ── K1b ────────────────────────────────────────────────────────────────────────────────────────────
  it("K1b PIR pos: a PIR row whose gauge answer is blank takes the row's own '20mm thick' words (owner R-DOUBT 'PIR ducts')", () => {
    const v = panel(WITH, [D("PIR (Pre Insulated Duct)", null)], "Sqm", "SITC of 20mm thick PIR Panels with 80-80 micron embossed aluminium");
    expect(v.rowPriced).toBe(true);
    expect(tot(v)).toEqual([1280, 340]);
    expect(JSON.stringify(v)).toContain("the row's own words say \\\"20mm thick\\\" -> 20 mm");
  });
  it("K1b PIR neg: no thickness words -> still refused; a GI row's blank gauge never reads 'mm thick' words", () => {
    expect(panel(WITH, [D("PIR (Pre Insulated Duct)", null)], "Sqm", "SITC of PIR Panels").rowPriced).toBe(false);
    const gi = panel(WITH, [D(RECT, null)], "Sqm", "GI duct with 25 mm thick insulation");
    expect(JSON.stringify(gi)).not.toContain("thickness not in the gauge answer");
  });
  it("K1b labour pos: 'Labour Charges for GI Duct Erections' read Installation only -> the duct installation only, with the owner's note", () => {
    const v = panel(WITH, [D(RECT, "24G", { scope: "Installation only" })], "Sqm", "Labour Charges for GI Duct Erections , Thermal insulation, Accoustic");
    expect(v.rowPriced).toBe(true);
    expect(tot(v)).toEqual([0, 260]);
    expect(JSON.stringify(v)).toContain("labour only - duct installation priced");
  });
  it("K1b labour neg: installation wording without labour words keeps O10 (iii) supply + installation", () => {
    const v = panel(WITH, [D(RECT, "24G", { scope: "Installation only" })], "Sqm", "Installation of GI ducts");
    expect(tot(v)).toEqual([1080, 260]);
    expect(JSON.stringify(v)).not.toContain("labour only");
  });
  // QR-4 Q1 (a): DR7 reads every heading of a separate insulation row's chain
  const sheetPanel = (chain: string[]) => {
    const duct = { excel_row: 9, description: "GI duct", category_id: DUCT, attributes: {}, items: [mi(D(RECT, "24G", { insulated: "Yes" })),
      mi({ _section: "insulation", item: "Thermal Nitrile Insulation", thickness_mm: "9 mm", cladding: "None" })] };
    const ins = { excel_row: 40, description: "9 mm thick", category_id: "hvac_insulation", attributes: {}, items: [] };
    const h = makePricingSheetHelper({ configsByCategory: cfgs(WITH) as never, items: ITEMS as never, extractionByRow: buildExtractionByRow([duct, ins] as never) });
    return (h.compute({ excelRow: 9, description: "GI duct", nodeType: "Line Item", category: DUCT, discipline: "HVAC", rateKinds: KINDS, unit: "Sqm",
      headings: [], ownNotes: [], headingNotes: [],
      sheetLines: [{ row: 9, text: "GI duct", unit: "Sqm" }, { row: 40, text: "9 mm thick", unit: "Sqm", heading: chain[chain.length - 1], headings: chain }],
      sheetCategories: { 9: DUCT, 40: "hvac_insulation" }, rowQuantities: { 9: 100, 40: 100 } } as never, {}) as unknown as ItemListSuggestion).itemList!;
  };
  it("QR-4 Q1 (a) pos: an insulation row under 'Insulation' within 'Duct insulation works' is the sheet's own duct insulation -> not priced again", () => {
    const v = sheetPanel(["Duct insulation works", "Insulation"]);
    expect(JSON.stringify(v)).toContain("Duct insulation is quoted on its own row");
    expect(tot(v)).toEqual([1080, 260]);
  });
  it("QR-4 Q1 (a) neg: under 'Pipe insulation' > 'Insulation' (no duct word anywhere) the duct's insulation line is priced", () => {
    const v = sheetPanel(["Pipe insulation", "Insulation"]);
    expect(JSON.stringify(v)).not.toContain("Duct insulation is quoted on its own row");
    expect((v.totals?.supply_rate ?? 0) > 1080).toBe(true);
  });
  it("R-TYPO neg: a word that is no gauge spelling ('24 gaus') is not read as a gauge", () => {
    const v = panel(WITH, [D(RECT, "24 gaus")]);
    expect(v.rowPriced).toBe(false);
  });
});
