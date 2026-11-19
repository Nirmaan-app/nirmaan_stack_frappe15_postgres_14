/**
 * VAV-2a2 B5 / B6 / B8 + R10 -- the VAV Box Derivation tab on the v78 keys (a scratch copy of the newest asset's config), the stricter
 * reasons check.
 *  B5 (owner 2026-11-19 18:21 "ok b"): the two "quantity per vav item is the count the row names" lines carry the 18 Nov 22:35 / 22:38
 *     rulings, not VAV-1's borrowed-section reason -- pinned by title AND line number.
 *  B6 (same ruling; the rule as chat-Claude's review 2026-11-19 23:45 accepted it): `derivationCoverage(...).wrong` FAILS on a reason that
 *     is present but wrong (ANY other reason matches more of the title than the one shown); `dead` lists a reason no line shows (VAV Box
 *     fails on any; Ducting's 8 are reported); vacuity on a fixture copy: the v77 order goes red, the v78 order green.
 *  R10 (owner 2026-11-15): every rule this slice adds is a line with its OWN reason (lesson (e): first-match checked line by line).
 *  B8 (owner 2026-11-19 18:56 "4 fix in next slice"; QR-C2 (a) 2026-11-20 00:34, the BACnet over IP controller): a row whose own
 *     description names the extra before any box words counts as that extra's own row; a box row, an AHU controller and the integrator
 *     (not ruled yet) never do.
 */
import path from "path";
import { pathToFileURL } from "url";
import { describe, expect, it } from "vitest";
import type { RateCategoryConfig } from "../../pricing/rate-master/rateMasterTypes";
import { readJsonFixture } from "../../pricing/calculatorPanelParity.harness";
import { deadReasons, derivationCoverage, wrongReasons } from "../../pricing/rate-master/derivationCoverage";
import { itemListRuleOrder } from "../../pricing/rate-master/itemListRuleOrder";
import { RATE_MASTER_DISCIPLINES } from "../../pricing/rate-master/rateMasterRegistry";
import { vavSeparateRow } from "./pricingSheetHelper";
import { BY_ID, ITEMS, VAV } from "./vav1Vav.harness";
import { boxItem, vavSheet, withInputs } from "./vav2a.harness";
import { KEYS2, vav78 } from "./vav2a2.harness";

type Cfg = { category_id: string; list_spec: { sections?: Array<{ category_id?: string }>; pricing: Record<string, unknown> & { derivation_reasons?: Array<{ title?: string; why?: string }> } } };
const borrowOnly = RATE_MASTER_DISCIPLINES.flatMap((d) => d.categories.filter((c) => c.fetch_only === true).map((c) => c.category_id));
const secs = (cfg: Cfg): Record<string, unknown> => Object.fromEntries((cfg.list_spec.sections ?? []).map((s) => String(s.category_id ?? ""))
  .filter((id) => id && borrowOnly.includes(id) && BY_ID.get(id)).map((id) => [id, BY_ID.get(id)]));
const linesOf = (cfg: RateCategoryConfig) => itemListRuleOrder(cfg, ITEMS, secs(cfg as unknown as Cfg));
/** the v77 VAV config read from ITS FILE (the newest asset is v78 from K2 on; the "before" comparisons stay on v77) */
const V77 = readJsonFixture<{ category_configs: RateCategoryConfig[] }>(pathToFileURL(path.resolve(__dirname, "../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v77.json")))
  .category_configs.find((c) => c.category_id === VAV)!;
const QTY_TITLE = (sec: string) => `The ${sec} section's quantity per vav item is the count the row names`;
const B7_WHY = KEYS2.derivation_reasons.new.length ? "a borrowed item's quantity is the count the row names: a thermostat -> one, \"two if two\" (owner 2026-11-18 22:35)" : "";

describe("VAV-2a2 B5 - lines 9 and 11 carry the owner's quantity rulings", () => {
  const lines = linesOf(vav78());
  for (const sec of ["misc item", "sensor"]) {
    it(`"${QTY_TITLE(sec)}": the "two if two" / "on either side" reason, not the borrowed-section one`, () => {
      const l = lines.find((x) => x.title === QTY_TITLE(sec))!;
      expect(l, sec).toBeTruthy();
      expect(l.reason).toContain(B7_WHY);
      expect(l.reason).toContain("a piece \"on either side\" -> 2 (22:38 \"option A\")");
      expect(l.reason).not.toMatch(/^borrowed, never copied/);
      expect(l.reason).not.toMatch(/^the CO2 sensor and the differential pressure switch are borrowed/);
    });
  }
  it("pinned by NUMBER too: v77 numbered them 9 and 11; v78's shape-default line (step 5) moves them to 10 and 12", () => {
    expect(lines.find((x) => x.title === QTY_TITLE("misc item"))?.n).toBe(10);
    expect(lines.find((x) => x.title === QTY_TITLE("sensor"))?.n).toBe(12);
    const v77 = linesOf(V77);
    expect(v77.find((x) => x.title === QTY_TITLE("misc item"))?.n).toBe(9);
    expect(v77.find((x) => x.title === QTY_TITLE("sensor"))?.n).toBe(11);
  });
  it("NEGATIVE (the v77 order): the same lines show VAV-1's borrowed-section reasons -- the defect B5 fixes", () => {
    const v77 = linesOf(V77);
    expect(v77.find((x) => x.title === QTY_TITLE("misc item"))?.reason).toMatch(/^borrowed, never copied/);
    expect(v77.find((x) => x.title === QTY_TITLE("sensor"))?.reason).toMatch(/^the CO2 sensor and the differential pressure switch are borrowed/);
  });
});

describe("VAV-2a2 R10 - every rule this slice adds is a line with its OWN reason", () => {
  const lines = linesOf(vav78());
  const want: Array<[RegExp, string]> = [
    [/^A VAV box's airflow band \(cfm\) is worked out from its airflow, never picked$/, "owner ruling 2a \"agree\", 2026-11-18 22:16"],
    [/^With no airflow, the band comes from the inlet size table$/, "the owner's own table of inlet sizes against the sheet's airflow bands"],
    [/^No airflow and no inlet size -> not priced$/, "\"airflow not stated, enter the CFM\""],
    [/^The user types the CFM or the inlet size, and only one of the two is needed$/, "clearly indicated that only one is required"],
    [/^A fact the row does not mention takes its ruled value$/, "shape not stated -> Rectangular"],
  ];
  for (const [title, why] of want) {
    it(`${title.source}: present, with its own reason`, () => {
      const l = lines.find((x) => title.test(x.title));
      expect(l, title.source).toBeTruthy();
      expect(l!.reason).toContain(why);
    });
  }
  it("the band line names the sheet's bands and the edge rule from the config; the inlet line the table", () => {
    const band = lines.find((x) => /airflow band/.test(x.title))!;
    expect(band.detail).toContain("0-450, 450-800, 800-1350, 1350-2100, 2100-3200, 3200-4000, 4000-8000");
    expect(band.detail).toMatch(/a value exactly on an edge takes the (LOWER|UPPER) band/);
    expect(lines.find((x) => /inlet size table/.test(x.title))!.detail).toContain("6 inch -> 0-450");
  });
  it("NEGATIVE: band_from removed -> its four lines go (structural vacuity, as the coverage check reads it)", () => {
    const c = vav78();
    delete (c as unknown as Cfg).list_spec.pricing.band_from;
    expect(linesOf(c).some((x) => /airflow band|inlet size table|types the CFM/.test(x.title))).toBe(false);
  });
});

describe("VAV-2a2 B6 - the stricter reasons check: a present-but-WRONG reason fails", () => {
  it("v78 VAV Box: MISSING / ORPHAN / UNREASONED / WRONG = 0", () => {
    const c = vav78();
    const r = derivationCoverage(c, ITEMS, secs(c as unknown as Cfg));
    expect([r.missing, r.orphan, r.unreasoned, r.wrong]).toEqual([[], [], [], []]);
  });
  it("VACUITY (fixture = v77's own order): the check goes RED on lines 9 and 11, and only there", () => {
    const c = V77;
    const w = derivationCoverage(c, ITEMS, secs(c as unknown as Cfg)).wrong;
    expect(w.map((x) => x.split(":")[0])).toEqual(["line 9", "line 11"]);
  });
  it("VACUITY: a broader reason put BEFORE a specific one on a fixture line goes red; after it, green", () => {
    const lines = [{ n: 1, title: "A row naming two insulations prices the one covering the whole duct" }] as never;
    const specific = { title: "^A row naming two insulations", why: "specific (owner, x)" };
    const broad = { title: "^A row naming", why: "broad (owner, y)" };
    expect(wrongReasons(lines, [broad, specific])).toHaveLength(1);
    expect(wrongReasons(lines, [specific, broad])).toEqual([]);
    // two entries for one rule id: the second is hidden -> wrong
    expect(wrongReasons([{ n: 1, title: "x", rule: "R1" }] as never, [{ rule: "R1", why: "a" }, { rule: "R1", why: "b" }])).toHaveLength(1);
  });
  it("ORDER-FREE (review 23:45 (i)): the broader reason AFTER the specific one is not wrong; BEFORE it, wrong -- whichever index", () => {
    const lines = [{ n: 1, title: "The sensor section's quantity per vav item is the count the row names" }] as never;
    const broad = { title: "^The sensor section", why: "b" }, specific = { title: "^The sensor section's quantity", why: "s" };
    expect(wrongReasons(lines, [specific, { title: "^x", why: "x" }, broad])).toEqual([]);
    expect(wrongReasons(lines, [{ title: "^x", why: "x" }, broad, specific])[0]).toMatch(/^line 1: .* shows reason 1 .* but reason 2 /);
  });
  it("NOT BY ORDER ALONE (review 23:45 (ii)): v78 with the quantity reason put back AFTER the borrowed-section ones still shows it on both lines", () => {
    const c = vav78();
    const rs = (c as unknown as Cfg).list_spec.pricing.derivation_reasons!;
    const q = rs.findIndex((r) => r.title === KEYS2.derivation_reasons.move_first);
    rs.push(...rs.splice(q, 1));
    const lines = linesOf(c);
    for (const sec of ["misc item", "sensor"]) expect(lines.find((x) => x.title === QTY_TITLE(sec))?.reason, sec).toContain(B7_WHY);
    expect(derivationCoverage(c, ITEMS, secs(c as unknown as Cfg)).wrong).toEqual([]);
  });
  it("DEAD reasons (review 23:45 point 2): VAV Box on v78 has none; VAV on v77 has one ([14], hidden on 9 / 11)", () => {
    const c = vav78();
    expect(derivationCoverage(c, ITEMS, secs(c as unknown as Cfg)).dead).toEqual([]);
    const v77 = V77;
    expect(derivationCoverage(v77, ITEMS, secs(v77 as unknown as Cfg)).dead).toEqual(["reason 14 (^The (misc item|sensor) section's quantity per vav item is the count the row names)"]);
    expect(deadReasons([{ n: 1, title: "a" }] as never, [{ title: "^a", why: "x" }, { title: "^b", why: "y" }])).toEqual(["reason 1 (^b)"]);
  });
  it("Ducting's 8 dead reasons are REPORTED, not failed (its config stays byte-identical, R9)", () => {
    const c = BY_ID.get("hvac_ducting")!;
    expect(derivationCoverage(c, ITEMS, secs(c as unknown as Cfg)).dead.map((x) => Number(x.split(" ")[1]))).toEqual([33, 35, 39, 40, 41, 43, 47, 54]);
  });
  it("every guarded category of the newest asset: WRONG = 0 outside VAV Box (Ducting's 10 multi-match lines show the specific reason)", () => {
    for (const id of ["hvac_valve_package", "hvac_misc", "hvac_ducting", "hvac_sensors"]) {
      const c = BY_ID.get(id)!;
      expect(derivationCoverage(c, ITEMS, secs(c as unknown as Cfg)).wrong, id).toEqual([]);
    }
  });
});

describe("VAV-2a2 B8 - a controller row naming the VAV boxes it serves (QR-C2 (a), owner 2026-11-20 00:34: the BACnet over IP controller)", () => {
  const OC = (serves?: Record<string, unknown> | null) =>
    structuredClone((vav78({ serves: serves === undefined ? undefined : serves }) as unknown as Cfg).list_spec.pricing.own_row_check) as Parameters<typeof vavSeparateRow>[0];
  const EX = (oc: Parameters<typeof vavSeparateRow>[0], label: string) => oc.extras.find((e) => e.label === label)!;
  const line = (row: number, text: string, unit = "Nos") => ({ row, text, unit, headings: [] as string[] }) as never;
  const REAL = "Supply, Installation and Testing of controller for BACNet integration above VAV Boxes with BMS. Controller should be suitable to be integrated with minimum 55Nos. of VAV Boxes. Integrator shall be capable of soft integration";
  it("POSITIVE (the real row, BOQ-26-00007 r385, filed Misc): it is the BACnet over IP controller's own row", () => {
    const oc = OC();
    expect(vavSeparateRow(oc, EX(oc, "BACnet over IP controller"), line(385, REAL, "No"))).toBe(true);
    expect(vavSeparateRow(oc, EX(oc, "BACnet over IP controller"), line(42, "BACnet over IP controller for the VAV boxes"))).toBe(true);
  });
  it("NEGATIVE: a true box row (the box named first) still never counts", () => {
    const oc = OC();
    expect(vavSeparateRow(oc, EX(oc, "BACnet over IP controller"), line(45, "Installation of VAV Units with BACnet controller"))).toBe(false);
    expect(vavSeparateRow(oc, EX(oc, "BACnet over IP controller"), line(46, "700 -1000 cfm VAV Boxes with BACnet controller"))).toBe(false);
  });
  it("NEGATIVE: an AHU controller still never counts (artefact words)", () => {
    const oc = OC();
    expect(vavSeparateRow(oc, EX(oc, "BACnet over IP controller"), line(47, "BACnet controller for AHU and VAV boxes"))).toBe(false);
  });
  it("NEGATIVE (the integrator stays as VAV-2a built it until the owner rules it): an integrator row naming the VAV boxes does NOT count", () => {
    const oc = OC();
    expect(vavSeparateRow(oc, EX(oc, "VAV integrator"), line(28, "Supply, Installation and Testing of Integrator for BMS connectivity of all VAV Boxes with neccessary sensors", "No"))).toBe(false);
    // the switch, by config: listed, it would count (the owner's open question; not shipped)
    const on = OC({ item_first: true, extras: ["BACnet over IP controller", "VAV integrator"] });
    expect(vavSeparateRow(on, EX(on, "VAV integrator"), line(28, "Supply, Installation and Testing of Integrator for BMS connectivity of all VAV Boxes with neccessary sensors", "No"))).toBe(true);
  });
  it("NEGATIVE (review 23:56): a BOX LINE whose notes carry an integrator / controller heading (BOQ-26-00185 / 00281 r116) is never the extra's row", () => {
    const r116 = "From 3525 to 4000 As shown on Drg. | INTEGRATOR | Supply, Installation, Testing & Commissioning of integrator/s to allow complete integration of above mentioned VAV Boxes with BM System with Bacnet (Over IP) protocol.";
    const all = OC({ item_first: true });
    for (const label of ["VAV integrator", "BACnet over IP controller"]) expect(vavSeparateRow(all, EX(all, label), line(116, r116)), label).toBe(false);
  });
  it("KEY ABSENT = VAV-2a: without `serves` a row naming VAV boxes is a box row (VAV-2a's pinned blind spot)", () => {
    const oc = OC(null);
    expect(vavSeparateRow(oc, EX(oc, "BACnet over IP controller"), line(385, REAL, "No"))).toBe(false);
  });
  it("panel entry point: box rows with a BACnet controller + the sheet's BMS-integration controller row (qty 0) -> not added, the note names it", () => {
    const box = boxItem({ cfm_range: null, airflow_cfm: "650", inlet_size: "None" });
    const sheet = vavSheet({
      30: { text: "VAV box 650 CFM", qty: 10, items: [box, { vav_item: "BACnet over IP controller", vav_item_as_written: "BACnet controller", qty_per_box: "None", scope: "None" }] },
      385: { text: REAL, qty: 0, unit: "No", category: "hvac_misc" },
    }, { cfg: vav78(), items: withInputs() });
    const s = sheet(30);
    // the row also names an integrator, so VAV-2a's cabling rule adds its 2 m (no VAV cabling row on this sheet) -- unchanged
    expect(s.itemList?.items?.map((b) => b.family)).not.toContain("BACnet over IP controller");
    expect(JSON.stringify(s.itemList)).toContain("BACnet over IP controller is priced on its own row of this sheet (row 385) - not added to this row");
  });
});

describe("VAV-2a2 B8 - the controller's own row decides by PRESENCE (owner 2026-11-20 00:37 \"one controller for many VAVs\")", () => {
  const ROW47 = "Supply, Installation and Testing of controller for BACNet integration above VAV Boxes with BMS. Controller should be suitable to be integrated with minimum 18Nos. of VAV Boxes.";
  const box = () => boxItem({ cfm_range: null, airflow_cfm: "650", inlet_size: "None" });
  const ctl = () => ({ vav_item: "BACnet over IP controller", vav_item_as_written: "BACnet controller", qty_per_box: "None", scope: "None" });
  const sheet355 = (q47: number, cfg = vav78()) => vavSheet({
    13: { text: "VAV box 650 CFM", qty: 1, items: [box(), ctl()] }, 14: { text: "VAV box 650 CFM", qty: 2, items: [box(), ctl()] },
    15: { text: "VAV box 650 CFM", qty: 1, items: [box(), ctl()] }, 16: { text: "VAV box 650 CFM", qty: 1, items: [box(), ctl()] },
    47: { text: ROW47, qty: q47, unit: "No", category: "hvac_misc" },
  }, { cfg, items: withInputs() });
  it("BOQ-26-00355 'VAV BOX' (row 47 quantity 1 against 5 boxes): the controller is NOT added, the note names row 47", () => {
    const s = sheet355(1)(13);
    expect(s.itemList?.items?.map((b) => b.family)).toEqual(["VAV box"]);
    expect(JSON.stringify(s.itemList)).toContain("BACnet over IP controller is priced on its own row of this sheet (row 47) - not added to this row");
  });
  it("BOQ-26-00355 'HVAC -1 Flr' (row 47 quantity 0): the controller is NOT added, the note names row 47", () => {
    const s = sheet355(0)(14);
    expect(s.itemList?.items?.map((b) => b.family)).toEqual(["VAV box"]);
    expect(JSON.stringify(s.itemList)).toContain("(row 47) - not added to this row");
  });
  it("BOTH BEHAVIOURS (one config value): presence_decides off -> the quantity test as VAV-2a (1 of 5 = 20% < 90%: added, 'possible double counting')", () => {
    const off = vav78({ serves: { item_first: true, extras: ["BACnet over IP controller"], presence_decides: false } });
    const s = sheet355(1, off)(13);
    expect(s.itemList?.items?.map((b) => b.family)).toEqual(["VAV box", "BACnet over IP controller"]);
    expect(JSON.stringify(s.itemList)).toContain("BACnet over IP controller added - possible double counting - also priced in row 47.");
  });
  it("NEGATIVE: every other extra keeps the 90% test -- a thermostat row at 8 of 10 boxes still gets 'possible double counting'", () => {
    const s = vavSheet({
      30: { text: "VAV box 650 CFM", qty: 10, items: [box(), { _section: "misc", item: "Digital Thermostat", item_as_written: "digital thermostat", qty_per_box: "None" }] },
      31: { text: "Digital thermostat for VAV", qty: 8, category: "hvac_misc" },
    }, { cfg: vav78(), items: withInputs() })(30);
    expect(JSON.stringify(s.itemList)).toContain("Digital thermostat added - possible double counting - also priced in row 31.");
  });
  it("NEGATIVE: a box row never counts as the controller's row, presence or not", () => {
    const s = vavSheet({
      30: { text: "VAV box 650 CFM", qty: 10, items: [box(), ctl()] },
      31: { text: "Installation of VAV Units with BACnet controller", qty: 10 },
    }, { cfg: vav78(), items: withInputs() })(30);
    expect(s.itemList?.items?.map((b) => b.family)).toEqual(["VAV box", "BACnet over IP controller"]);
  });
  it("the Derivation tab states it, with its own reason (R10)", () => {
    const l = linesOf(vav78()).find((x) => /^A BACnet over IP controller priced on its own row of the sheet is not added to the boxes/.test(x.title));
    expect(l).toBeTruthy();
    expect(l!.reason).toContain("one controller for many VAVs, so the quantity rule is not applied (owner 2026-11-20 00:37)");
  });
});
