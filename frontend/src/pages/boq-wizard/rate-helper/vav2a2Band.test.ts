/**
 * VAV-2a2 B1 / B2 / B3 / B4 -- the band worked out from the airflow or the inlet size, the CFM-or-inlet entry, the source tags.
 * Every case runs through the PANEL'S ENTRY POINT (`makePricingSheetHelper(...).compute`): the calculator's own construction, or a BoQ
 * sheet with the `calculator_only` switch removed ON A SCRATCH COPY (vav2a.harness `boqMap`). The v78 keys come from the ONE keys file
 * (vav2a2.harness `withV78Keys`), applied to a scratch copy of the newest asset's VAV config.
 * Owner: R1 2026-11-18 22:16 "2a agree" / 23:53; R2 22:18 / 22:21; QR-3c (a) 2026-11-19 00:57; R3 13:31 / 13:46; R4 mockup 00:12, 22:16 "2b".
 */
import { describe, expect, it } from "vitest";
import { bandForCfm, bandOf, readAirflowCfm, readInletSize, type BandFrom } from "./itemListPricing";
import { TAB, blk, tabEntry } from "./vav1Vav.harness";
import { boxItem, calcWith, tot as sheetTot, vavSheet } from "./vav2a.harness";
import { KEYS2, cfmInside, tabEntryTyped, vav78 } from "./vav2a2.harness";

const BF = KEYS2.pricing.band_from as unknown as BandFrom;
const L = BF.lines;
const calc78 = (items: ReturnType<typeof blk>[], sections?: Record<string, ReturnType<typeof blk>[]>, cfg = vav78()) =>
  calcWith(cfg, { items, ...(sections ? { sections } : {}) });
const box = (attrs: Record<string, string>) => blk("VAV box", { shape: "Rectangular", vav_type: "Nothing specific mentioned", integrator_included: "No", ...attrs });
const tot = (s: ReturnType<typeof calc78>) => [s.itemList?.totals?.supply_rate ?? null, s.itemList?.totals?.install_rate ?? null];
const field = (s: ReturnType<typeof calc78>, id: string) => s.itemList?.items?.[0]?.fields.find((f) => f.id === id);
const reason = (s: ReturnType<typeof calc78>) => s.itemList?.items?.[0]?.reason;
/** the 450-800 / Rect / Nothing specific / No line of the sheet (the VAV-1 / VAV-2a "box" case): 22,400 + 2,400 */
const LINE_450_800 = [22400, 2400];

describe("VAV-2a2 B1 - the readers (pure)", () => {
  it("POSITIVE: the airflow as written -> the maximum (a range's low end kept for the crossing line); no unit = CFM", () => {
    expect(readAirflowCfm("650")).toEqual({ high: 650, low: null });
    expect(readAirflowCfm("Up to 650 CFM")).toEqual({ high: 650, low: null });
    expect(readAirflowCfm("500-650 CFM")).toEqual({ high: 650, low: 500 });
    expect(readAirflowCfm("15000 -16900 CFM")).toEqual({ high: 16900, low: 15000 });
    expect(readAirflowCfm("8,000 cfm")).toEqual({ high: 8000, low: null });
    expect(readAirflowCfm(1350)).toEqual({ high: 1350, low: null });
  });
  it("NEGATIVE: nothing stated -> null; another airflow unit -> 'unit' (not converted)", () => {
    for (const v of ["", "None", "not stated", null, undefined, 0]) expect(readAirflowCfm(v)).toBeNull();
    expect(readAirflowCfm("300 l/s")).toBe("unit");
    expect(readAirflowCfm("1000 CMH")).toBe("unit");
  });
  it("EDGE (both rules, one config value): lower -> 450 is 0-450, 8,000 is 4000-8000; upper -> 450 is 450-800, 8,000 still 4000-8000", () => {
    const lower = { bands: BF.bands, edge: "lower" as const }, upper = { bands: BF.bands, edge: "upper" as const };
    const edges: Array<[number, string, string]> = [[450, "0-450", "450-800"], [800, "450-800", "800-1350"], [1350, "800-1350", "1350-2100"],
      [2100, "1350-2100", "2100-3200"], [3200, "2100-3200", "3200-4000"], [4000, "3200-4000", "4000-8000"], [8000, "4000-8000", "4000-8000"]];
    for (const [cfm, lo, up] of edges) {
      expect(bandForCfm(lower, cfm), `lower ${cfm}`).toBe(lo);
      expect(bandForCfm(upper, cfm), `upper ${cfm}`).toBe(up);
    }
    for (const r of [lower, upper]) {
      expect(bandForCfm(r, 449)).toBe("0-450");
      expect(bandForCfm(r, 451)).toBe("450-800");
      expect(bandForCfm(r, 8001)).toBeNull();
      expect(bandForCfm(r, 9000)).toBeNull();
    }
  });
  it("POSITIVE: an inlet size in inches or mm; NEGATIVE: a tag number or two sizes is not a size", () => {
    expect(readInletSize("8 inch", 25.4)).toEqual({ inches: 8, mm: null });
    expect(readInletSize("16 inch dia", 25.4)).toEqual({ inches: 16, mm: null });
    expect(readInletSize("7", 25.4)).toEqual({ inches: 7, mm: null });
    expect(readInletSize('10"', 25.4)).toEqual({ inches: 10, mm: null });
    expect(readInletSize("200 mm", 25.4)).toEqual({ inches: 200 / 25.4, mm: 200 });
    expect(readInletSize("Ø 250 mm", 25.4)).toEqual({ inches: 250 / 25.4, mm: 250 });
    expect(readInletSize("VAV-PID-150", 25.4)).toBe("not_size");
    expect(readInletSize("8 x 8", 25.4)).toBe("not_size");
    expect(readInletSize("None", 25.4)).toBeNull();
  });
});

describe("VAV-2a2 B1 - the band from the airflow, on a BoQ row (the panel's compute, switch off on the copy)", () => {
  const row = (airflow: string | null, over: Record<string, string | number | null> = {}) =>
    vavSheet({ 30: { text: "VAV box", qty: 5, items: [boxItem({ cfm_range: null, airflow_cfm: airflow, inlet_size: "None", ...over })] } }, { cfg: vav78() })(30);
  const fld = (s: ReturnType<typeof row>, id: string) => s.itemList?.items?.[0]?.fields.find((f) => f.id === id);
  it("POSITIVE: 'Up to 650 CFM' -> 450-800 'from BoQ', priced on the sheet's line 22,400 + 2,400", () => {
    const s = row("Up to 650 CFM");
    expect(sheetTot(s.itemList)).toEqual(LINE_450_800);
    expect(fld(s, "cfm_range")).toMatchObject({ value: "450-800", readOnly: true, sourceTag: BF.tags.boq });
    expect(fld(s, "cfm_range")?.note).toBeUndefined();
  });
  it("POSITIVE: a range inside one band -> 'from the maximum of the range', no crossing line", () => {
    const f = fld(row("500-650 CFM"), "cfm_range");
    expect(f).toMatchObject({ value: "450-800", sourceTag: BF.tags.range_max });
    expect(f?.note).toBeUndefined();
  });
  it("POSITIVE (owner 2a): a range crossing bands -> the band of the MAXIMUM, with the line", () => {
    const s = row("400-650 CFM");
    expect(sheetTot(s.itemList)).toEqual(LINE_450_800);
    expect(fld(s, "cfm_range")).toMatchObject({ value: "450-800", sourceTag: BF.tags.range_max,
      note: "400-650 CFM crosses two bands (0-450 and 450-800) - priced on the band of the maximum, 650 CFM" });
  });
  it("NEGATIVE (owner 23:53): F13 '15000 -16900 CFM' -> not priced, 'above the largest box on the sheet'; the model's own band answer is NOT read", () => {
    const s = row("15000 -16900 CFM", { cfm_range: "4000-8000" });
    expect(s.itemList?.rowPriced).toBe(false);
    expect(s.itemList?.items?.[0]?.reason).toContain("16900 CFM is above the largest box on the sheet");
  });
  it("NEGATIVE (owner 23:53): no airflow and no size -> not priced 'airflow not stated, enter the CFM' -- even with a band answered", () => {
    const s = row("None", { cfm_range: "450-800" });
    expect(s.itemList?.rowPriced).toBe(false);
    expect(s.itemList?.items?.[0]?.reason).toContain(L.none_row);
  });
  it("NEGATIVE: an airflow in l/s is not converted -> not priced, naming it", () => {
    expect(row("300 l/s").itemList?.items?.[0]?.reason).toContain("'300 l/s' is not in CFM");
  });
  it("POSITIVE (R2): no airflow, '8 inch dia' -> 450-800 'from the inlet size table' with its line", () => {
    const s = row("None", { inlet_size: "8 inch dia" });
    expect(sheetTot(s.itemList)).toEqual(LINE_450_800);
    expect(fld(s, "cfm_range")).toMatchObject({ value: "450-800", sourceTag: BF.tags.inlet, note: "Band from the inlet size table: 8 inch -> 450-800 CFM" });
  });
  it("the model's 'None' in the CFM / inlet box shows as 'not stated', not the word", () => {
    const f = fld(row("Up to 650 CFM"), "inlet_size");
    expect(f).toMatchObject({ value: "", placeholder: "not stated" });
  });
  it("R2: the airflow wins over an inlet size stated beside it", () => {
    expect(fld(row("1000 CFM", { inlet_size: "8 inch" }), "cfm_range")).toMatchObject({ value: "800-1350", sourceTag: BF.tags.boq });
  });
});

describe("VAV-2a2 B2 - the inlet size table (calculator, typed)", () => {
  const typed = (inlet: string) => calc78([box({ inlet_size: inlet })]);
  it("each table size -> its band (6 -> 0-450 ... 24 -> 4000-8000), tag 'from the inlet size you typed'", () => {
    for (const r of KEYS2.pricing.band_from.inlet_table) {
      const f = field(typed(String(r.inch)), "cfm_range");
      expect(f, String(r.inch)).toMatchObject({ value: r.band, sourceTag: BF.tags.typed_inlet });
    }
  });
  it("in-between sizes take the NEXT SIZE UP (owner 22:21): 4 and 5 -> 6; 7 -> 8; 9 -> 10; 18 -> 24", () => {
    for (const [inch, band] of [["4", "0-450"], ["5", "0-450"], ["7", "450-800"], ["9", "800-1350"], ["18", "4000-8000"]]) {
      expect(field(typed(inch), "cfm_range")?.value, inch).toBe(band);
    }
    expect(field(typed("7"), "cfm_range")?.note).toBe("Band from the inlet size table: 8 inch -> 450-800 CFM");
  });
  it("QR-3c (a): '200 mm' -> 7.87 inch -> 8 inch -> 450-800, with the conversion line; priced = the sheet line", () => {
    const s = typed("200 mm");
    expect(tot(s)).toEqual(LINE_450_800);
    expect(field(s, "cfm_range")?.note).toBe("200 mm = 200 mm / 25.4 = 7.87 inch -> the next size up, 8 inch Band from the inlet size table: 8 inch -> 450-800 CFM");
  });
  it("NEGATIVE: 'VAV-PID-150' is not a size; 26 inch is above the largest box (24 inch) -> not priced", () => {
    expect(reason(typed("VAV-PID-150"))).toContain("'VAV-PID-150' is not an inlet size");
    expect(reason(typed("26"))).toContain("inlet size 26 inch is above the largest box on the sheet (24 inch)");
  });
});

describe("VAV-2a2 B3 - the CFM-or-inlet entry in the calculator (the panel's shared fields)", () => {
  it("the two typed boxes in place of the band picker, one either-or group saying only one is needed; the band read-only", () => {
    const s = calc78([box({})]);
    const fs = s.itemList!.items![0].fields;
    const ids = fs.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(["airflow_cfm", "inlet_size", "cfm_range"]));
    for (const id of ["airflow_cfm", "inlet_size"]) {
      const f = fs.find((x) => x.id === id)!;
      expect(f.control).toBe("text");
      expect(f.group).toBe(BF.group);
      expect(f.typedNote, id).toMatch(/Only one of the two is needed/);
    }
    const band = fs.find((x) => x.id === "cfm_range")!;
    expect(band.readOnly).toBe(true);
    expect(band.options).toBeUndefined();
    expect(band.required).toBeUndefined();
    // NEGATIVE: the box's other facts keep their dropdowns
    expect(fs.find((x) => x.id === "shape")?.control).toBe("dropdown");
  });
  it("POSITIVE: a CFM typed -> the band, 'from the CFM you typed', the sheet's price", () => {
    const s = calc78([box({ airflow_cfm: "650" })]);
    expect(tot(s)).toEqual(LINE_450_800);
    expect(field(s, "cfm_range")).toMatchObject({ value: "450-800", sourceTag: BF.tags.typed_cfm });
  });
  it("BOTH typed -> the CFM wins and the band field says so", () => {
    const s = calc78([box({ airflow_cfm: "1000", inlet_size: "8" })]);
    expect(field(s, "cfm_range")).toMatchObject({ value: "800-1350", sourceTag: BF.tags.typed_cfm, note: L.both_typed });
  });
  it("NEITHER typed -> not priced, 'enter the CFM or the inlet size', both boxes outlined", () => {
    const s = calc78([box({})]);
    expect(s.itemList?.rowPriced).toBe(false);
    expect(reason(s)).toContain(L.none_typed);
    expect(field(s, "airflow_cfm")?.blank).toBe(true);
    expect(field(s, "inlet_size")?.blank).toBe(true);
  });
  it("9,000 CFM -> not priced, 'above the largest box on the sheet'", () => {
    expect(reason(calc78([box({ airflow_cfm: "9000" })]))).toContain("9000 CFM is above the largest box on the sheet");
  });
  it("C6 through the CFM entry: box + BACnet over IP + thermostat + CO2 = 83,930 + 7,000 with the combination warning", () => {
    const s = calc78([box({ airflow_cfm: "650" }), blk("BACnet over IP controller")], { misc: [blk("Digital Thermostat")], sensors: [blk("CO2 Sensor")] });
    expect(tot(s)).toEqual([83930, 7000]);
    expect(s.itemList?.combinationWarning).toBe("This rate combines the box with 3 extras (Rs 66,130 of Rs 90,930). Review each item before using.");
  });
  it("the D2 case through the CFM entry (Rect / AHRI Certified / Integrator Yes + conical x2 + thermostat) = 34,720 + 2,900", () => {
    const d2 = blk("VAV box", { shape: "Rectangular", vav_type: "AHRI Certified", integrator_included: "Yes", airflow_cfm: "650" });
    expect(tot(calc78([d2, blk("Conical piece", {}, "2")], { misc: [blk("Digital Thermostat")] }))).toEqual([34720, 2900]);
  });
});

describe("VAV-2a2 B4 - the source tags and the shape default", () => {
  const row = (shape: string) => vavSheet({ 30: { text: "VAV box 650 CFM", qty: 5, items: [boxItem({ cfm_range: null, airflow_cfm: "650 CFM", inlet_size: "None", shape })] } },
    { cfg: vav78() })(30);
  it("POSITIVE: a shape the BoQ states -> 'from BoQ'", () => {
    const f = row("Oval").itemList!.items![0].fields.find((x) => x.id === "shape")!;
    expect(f).toMatchObject({ value: "Oval", sourceTag: "from BoQ" });
  });
  it("POSITIVE (owner 2b): shape not stated -> Rectangular in amber with its line, no 'from BoQ'; priced", () => {
    const s = row("None");
    const f = s.itemList!.items![0].fields.find((x) => x.id === "shape")!;
    expect(f).toMatchObject({ value: "Rectangular", defaulted: true, rule: "shape not stated - priced as Rectangular" });
    expect(f.sourceTag).toBeUndefined();
    expect(sheetTot(s.itemList)).toEqual(LINE_450_800);
  });
  it("NEGATIVE: a shape picked in the calculator carries no tag", () => {
    expect(field(calc78([box({ airflow_cfm: "650" })]), "shape")?.sourceTag).toBeUndefined();
  });
});

describe("VAV-2a2 T2 - CALCULATOR = SHEET through the typed entry (owner 2026-11-19 03:00): no price assertion changed", () => {
  it("the fixture is the 86 lines", () => expect(TAB.vav_box_tab.length).toBe(86));
  for (const r of TAB.vav_box_tab) {
    it(`tab row ${r.row}: ${r.item} / ${r.type} / ${r.integrator} / ${r.cfm} via CFM ${r.item === "VAV Integrator" ? "-" : cfmInside(r.cfm)}`, () => {
      const s = calcWith(vav78(), { items: [tabEntryTyped(r)] });
      expect(s.itemList?.rowPriced, JSON.stringify(s.itemList?.items?.map((b) => b.reason ?? null))).toBe(true);
      expect(tot(s)).toEqual([Math.round(r.boq_supply), Math.round(r.boq_install)]);
    });
  }
  it("each inlet table size through the inlet entry = the sheet line of its band (all 84 box lines)", () => {
    const inchOf = new Map(KEYS2.pricing.band_from.inlet_table.map((x) => [x.band, String(x.inch)]));
    const boxes = TAB.vav_box_tab.filter((r) => r.item !== "VAV Integrator");
    expect(boxes.length).toBe(84);
    for (const r of boxes) {
      expect(tot(calcWith(vav78(), { items: [tabEntryTyped(r, { inlet: inchOf.get(r.cfm)! })] })), `row ${r.row}`).toEqual([Math.round(r.boq_supply), Math.round(r.boq_install)]);
    }
  });
});

describe("VAV-2a2 T3 - KEY ABSENT = UNCHANGED", () => {
  it("band_from removed -> the band is picked as at v77 and prices the same; the typed boxes are gone", () => {
    const noKey = vav78();
    delete (noKey as unknown as { list_spec: { pricing: Record<string, unknown> } }).list_spec.pricing.band_from;
    const r = TAB.vav_box_tab.find((x) => x.cfm === "450-800" && x.item.startsWith("Rect") && x.integrator === "No" && x.type === "Nothing specific mentioned")!;
    const s = calcWith(noKey, { items: [tabEntry(r)] });
    expect(tot(s)).toEqual(LINE_450_800);
    const ids = s.itemList!.items![0].fields.map((f) => f.id);
    expect(ids).not.toContain("airflow_cfm");
    expect(s.itemList!.items![0].fields.find((f) => f.id === "cfm_range")?.control).toBe("dropdown");
  });
  it("source_tags removed -> no tag; defaults removed -> shape not stated refuses as at v77", () => {
    const c = vav78();
    const pr = (c as unknown as { list_spec: { pricing: Record<string, unknown> } }).list_spec.pricing;
    delete pr.source_tags; delete pr.defaults;
    const s = vavSheet({ 30: { text: "VAV box", qty: 5, items: [boxItem({ cfm_range: null, airflow_cfm: "650", inlet_size: "None", shape: "None" })] } }, { cfg: c })(30);
    expect(s.itemList?.rowPriced).toBe(false);
    const s2 = vavSheet({ 30: { text: "VAV box", qty: 5, items: [boxItem({ cfm_range: null, airflow_cfm: "650", inlet_size: "None", shape: "Oval" })] } }, { cfg: c })(30);
    expect(s2.itemList!.items![0].fields.find((f) => f.id === "shape")?.sourceTag).toBeUndefined();
  });
  it("bandOf is pure: the same cells give the same band; typed-ness only changes the tag", () => {
    const cells: Record<string, unknown> = { airflow_cfm: "650", inlet_size: null };
    const a = bandOf(BF, (id) => cells[id], () => false, true), b = bandOf(BF, (id) => cells[id], () => true, false);
    expect(a).toMatchObject({ band: "450-800", source: "boq" });
    expect(b).toMatchObject({ band: "450-800", source: "typed_cfm" });
  });
});
