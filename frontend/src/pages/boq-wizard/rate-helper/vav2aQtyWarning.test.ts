/**
 * VAV-2a B7 + B9 (T1 groups 7 and 9; T4 "B9 shows in the Calculator"). Scratch copies of the newest VAV config only (vav2a.harness).
 *
 * B7 QUANTITY PER BOX FROM THE ROW (owner 2026-11-18 22:35 "two if two"; 22:38 "on either side" -> 2; R7): a borrowed item (a Misc / Sensors
 *    section) takes the count the model read on ITS OWN item in VAV's `qty_per_box` -- the section's `qty_attr` key. An own extra already
 *    reads it through `qty_attribute_id` (v76). Default 1, marked; the pricer's typed count wins; key absent -> 1 as at v76.
 * B9 COMBINATION WARNING (owner 2026-11-19 12:49 "all combination rows should have a warning that the user should review it more carefully";
 *    12:55 "option b is ok"; 12:59 "ok proceed with 50%"): a priced row whose lines other than the box come to MORE than the Pricing Input
 *    share (0.5) x the box's own rate (supply + installation) carries one amber line; no figure moves; the calculator shows it too.
 */
import { describe, expect, it } from "vitest";
import { combinationWarningOf, sectionQtyFromRow, ITEM_LIST_OVERRIDE_KEY } from "./pricingSheetHelper";
import { blk, D2 } from "./vav1Vav.harness";
import { COMBINATION_WARNING, boxItem, calcWith, tot, vavBare, vavSheet, vavWith, withInputs } from "./vav2a.harness";
import { V78 } from "./v78ByName.harness";

const CW = { combination_warning: COMBINATION_WARNING };
const QTY = { misc: { qty_attr: "qty_per_box" }, sensors: { qty_attr: "qty_per_box" } };
const BOX = blk("VAV box", { shape: "Rectangular", vav_type: "Nothing specific mentioned", integrator_included: "No", cfm_range: "450-800" });
/** brief C4 / AC0: the BOQ-26-00318 r173 case -- box 22,400 + 2,400, BACnet over IP 46,200 + 3,200, thermostat 4,200 + 500, CO2 11,130 + 900 */
const C4 = { items: [BOX, blk("BACnet over IP controller")], sections: { misc: [blk("Digital Thermostat")], sensors: [blk("CO2 Sensor")] } };

describe("VAV-2a B9 - the combination warning (calculator = the panel's own compute)", () => {
  it("POSITIVE C4: box + BACnet over IP + thermostat + CO2 = 83,930 + 7,000; extras 66,130 > 50% of 24,800 -> the warning with its figures", () => {
    const v = V78.calcWith(V78.vavWith(CW), C4).itemList!;
    expect(tot(v)).toEqual([83930, 7000]);
    expect(v.combinationWarning).toBe("This rate combines the box with 3 extras (Rs 66,130 of Rs 90,930). Review each item before using.");
  });
  it("NEGATIVE D2: 34,720 + 2,900 -- extras 8,060 are 27% of the box's 29,560 -> no warning, the figures unchanged", () => {
    const v = calcWith(vavWith(CW), D2).itemList!;
    expect(tot(v)).toEqual([34720, 2900]);
    expect(v.combinationWarning).toBeUndefined();
  });
  it("EDGE: exactly the share is not MORE than it -> no warning; one rupee above -> the warning (one-extra wording)", () => {
    // box 24,800 + one BACnet line 49,400: share = 49,400 / 24,800 exactly -> not more
    const st = { items: [BOX, blk("BACnet over IP controller")] };
    expect(calcWith(vavWith(CW), st, withInputs(undefined, { vav_combination_warning_share: 49400 / 24800 })).itemList!.combinationWarning).toBeUndefined();
    expect(calcWith(vavWith(CW), st, withInputs(undefined, { vav_combination_warning_share: 49399 / 24800 })).itemList!.combinationWarning)
      .toBe("This rate combines the box with 1 extra (Rs 49,400 of Rs 74,200). Review each item before using.");
  });
  it("the share is READ LIVE from the Pricing Input: at 0.2 the D2 row warns; the input missing -> the 'not set' line", () => {
    expect(calcWith(vavWith(CW), D2, withInputs(undefined, { vav_combination_warning_share: 0.2 })).itemList!.combinationWarning)
      .toBe("This rate combines the box with 2 extras (Rs 8,060 of Rs 37,620). Review each item before using.");
    expect(calcWith(vavWith(CW), D2, withInputs(undefined, { vav_combination_warning_share: null })).itemList!.combinationWarning)
      .toBe(COMBINATION_WARNING.input_missing);
  });
  it("NEGATIVE: no box on the row (extras only), a box alone, a row not priced -> no warning", () => {
    expect(calcWith(vavWith(CW), { items: [blk("BACnet over IP controller")], sections: { misc: [blk("Digital Thermostat")] } }).itemList!.combinationWarning).toBeUndefined();
    expect(calcWith(vavWith(CW), { items: [BOX] }).itemList!.combinationWarning).toBeUndefined();
    const unpriced = calcWith(vavWith(CW), { items: [blk("VAV box", { shape: "Rectangular" }), blk("BACnet over IP controller")] }).itemList!;
    expect(unpriced.rowPriced).toBe(false);
    expect(unpriced.combinationWarning).toBeUndefined();
  });
  it("KEY ABSENT = UNCHANGED (T3): without combination_warning the C4 view is the v76 view byte for byte (no warning, same figures)", () => {
    const bare = calcWith(vavBare(), C4);
    const withKeyOff = calcWith(vavWith({ combination_warning: undefined }), C4);
    expect(bare.itemList!.combinationWarning).toBeUndefined();
    expect(JSON.stringify(withKeyOff)).toBe(JSON.stringify(bare));
    // and the key changes nothing but the one line
    const on = calcWith(vavWith(CW), C4);
    const { combinationWarning: _w, ...rest } = on.itemList!;
    expect(JSON.stringify({ ...on, itemList: rest })).toBe(JSON.stringify(bare));
  });
  it("PURE combinationWarningOf: n counts every non-box line (own extras + sections); share null -> input_missing", () => {
    const b = (family: string, s: number, i: number) => ({ state: "priced", family, figures: { supply_rate: s, install_rate: i } }) as never;
    const sv = (s: number, i: number) => ({ view: { rowPriced: true, totals: { supply_rate: s, install_rate: i } } }) as never;
    const items = withInputs();
    expect(combinationWarningOf(COMBINATION_WARNING, [b("VAV box", 100, 0), b("Conical piece", 40, 0)], [sv(20, 0)], { supply_rate: 160, install_rate: 0 }, items))
      .toBe("This rate combines the box with 2 extras (Rs 60 of Rs 160). Review each item before using.");
    expect(combinationWarningOf(COMBINATION_WARNING, [b("VAV box", 100, 0), b("Conical piece", 40, 0)], [], { supply_rate: 140, install_rate: 0 }, items)).toBeUndefined();
    expect(combinationWarningOf(COMBINATION_WARNING, [b("VAV box", 100, 0), b("Conical piece", 60, 0)], [], { supply_rate: 160, install_rate: 0 },
      withInputs(undefined, { vav_combination_warning_share: null }))).toBe(COMBINATION_WARNING.input_missing);
  });
});

describe("VAV-2a B7 - a borrowed item's quantity per box from the row (BoQ row, the switch off on a scratch copy)", () => {
  const row = (thermoQty: string | null, cfg = vavWith({}, QTY)) => vavSheet({
    30: { text: "750 CFM", items: [boxItem(), { _section: "misc", item: "Digital Thermostat", item_as_written: "2 digital thermostats", qty_per_box: thermoQty }] },
  }, { cfg })(30).itemList!;
  it("POSITIVE: 'two thermostats' (qty_per_box 2) -> the Misc line's quantity is 2: 22,400 + 2 x 4,200 = 30,800; 2,400 + 2 x 500 = 3,400", () => {
    const v = row("2");
    const sec = v.sections!.independent[0].view;
    expect(sec.items[0].qty).toBe("2");
    expect(sec.items[0].qtyDefaulted).toBe(false);
    expect(tot(v)).toEqual([30800, 3400]);
  });
  it("NEGATIVE: nothing named (None) -> 1, marked as assumed; an unreadable / zero count -> 1", () => {
    for (const q of [null, "None", "two", "0", "-1"]) {
      const v = row(q);
      expect(v.sections!.independent[0].view.items[0].qty).toBe("1");
      expect(v.sections!.independent[0].view.items[0].qtyDefaulted).toBe(true);
      expect(tot(v)).toEqual([26600, 2900]);
    }
  });
  it("KEY ABSENT = UNCHANGED: without the section's qty_attr a stated 2 is NOT read (the v76 behaviour: 1)", () => {
    const v = row("2", vavWith({}, { misc: { qty_attr: undefined } }));
    expect(v.sections!.independent[0].view.items[0].qty).toBe("1");
    expect(tot(v)).toEqual([26600, 2900]);
    expect(JSON.stringify(row("2", vavBare()))).toBe(JSON.stringify(v));
  });
  it("the pricer's typed quantity wins over the row's count", () => {
    const s = vavSheet({ 30: { text: "750 CFM", items: [boxItem(), { _section: "misc", item: "Digital Thermostat", qty_per_box: "2" }] } }, { cfg: vavWith({}, QTY) });
    const v = s(30, { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: [{ base: 0, family: null, attrs: {} }], sections: { misc: [{ base: 0, family: null, attrs: {}, qty: "3" }] } }) }).itemList!;
    expect(v.sections!.independent[0].view.items[0].qty).toBe("3");
    expect(tot(v)).toEqual([22400 + 3 * 4200, 2400 + 3 * 500]);
  });
  it("an OWN extra already reads qty_per_box (v76's qty_attribute_id): cone pieces 'on either side' = 2 -> 3,360", () => {
    const v = vavSheet({ 30: { text: "750 CFM", items: [boxItem(), { vav_item: "Conical piece", vav_item_as_written: "cone piece on either side", qty_per_box: "2" }] } },
      { cfg: vavWith({}, QTY) })(30).itemList!;
    expect(v.items[1].qty).toBe("2");
    expect(tot(v)).toEqual([22400 + 3360, 2400]);
  });
  it("the Sensors section reads it the same way (two CO2 sensors)", () => {
    const v = vavSheet({ 30: { text: "750 CFM", items: [boxItem(), { _section: "sensors", sensor: "CO2 Sensor", qty_per_box: "2" }] } }, { cfg: vavWith({}, QTY) })(30).itemList!;
    expect(v.sections!.independent[0].view.items[0].qty).toBe("2");
    expect(tot(v)).toEqual([22400 + 2 * 11130, 2400 + 2 * 900]);
  });
  it("PURE sectionQtyFromRow", () => {
    const it2 = (v: unknown) => ({ attributes: { q: { value: v, confidence: 1 } } }) as never;
    expect(sectionQtyFromRow(it2("2"), "q")).toBe("2");
    expect(sectionQtyFromRow(it2(3), "q")).toBe("3");
    expect(sectionQtyFromRow(it2("1.5"), "q")).toBe("1.5");
    for (const v of ["None", "", null, "x", "0", -2]) expect(sectionQtyFromRow(it2(v), "q")).toBeUndefined();
    expect(sectionQtyFromRow({ attributes: {} } as never, "q")).toBeUndefined();
  });
});
