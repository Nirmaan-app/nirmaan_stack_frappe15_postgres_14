/**
 * VAV-2b1 v80 -- the owner's full-rate add: 01:07 "i think we should be able to add a full bcakner using that. we will need it for seperate
 * rows i think"; 01:09 "yes for both"; 01:15 the DDC panel at full rate WITH its components by the share's formula, panel 1; 01:21 "b" / "we
 * are giving per unit rate which does not worry about the qty of rthe row" / "2 yes"; 01:31 the pre-fill (sheet VAVs / row quantity, rounded
 * up); 01:32 + 01:36 "A" the BACnet controller by the same formula. So: "Add VAV item" offers "BACnet over IP controller (full rate)" and "DDC
 * Panel/ Controller (full rate)" -- each inserts the WHOLE (per-unit) mode of its share block -- and "Add sensor" offers the Duct Static
 * Pressure Sensor as a plain item (typed quantity). The helper adds none of them; the Differential Pressure Switch stays out; a share and the
 * full-rate block of the same item may sit together, with the double-count line under the full-rate one; the review block counts both.
 * Keys: __fixtures__/vav2b1KeysV80.json (`withV80Keys` / `withV80Sensors`) on the v79 keys on the v78 FILE.
 */
import { describe, expect, it } from "vitest";
import { derivationCoverage } from "../../pricing/rate-master/derivationCoverage";
import { BY_ID, VAV, blk, tot } from "./vav1Vav.harness";
import { boxItem } from "./vav2a.harness";
import { KEYS80, box, calc80, itemsV79, other, real, sens80, sheet80, vav80 } from "./vav2b1.harness";
import { applyShareEdit, type SharesEditState } from "./vavSheetShares";
import type { ItemListSuggestion } from "./pricingSheetHelper";
import { assetByName } from "./v78ByName.harness";

const BOX = blk("VAV box", { shape: "Rectangular", vav_type: "Nothing specific mentioned", integrator_included: "No", airflow_cfm: "650" });
const ed = (...ops: Parameters<typeof applyShareEdit>[1][]) => ops.reduce<SharesEditState>((a, op) => applyShareEdit(a, op), {});
const menu = (s: ItemListSuggestion) => (s.itemList?.families ?? []).map((f) => f.family);
const sensorsAdd = (s: ItemListSuggestion) => (s.itemList?.sections?.adds ?? []).find((a) => a.id === "sensors")?.families.map((f) => f.family) ?? [];
const OFF = { drop: ["user_addable" as const] };
const W = Object.fromEntries((KEYS80.vav.sheet_shares_whole ?? []).map((w) => [String(w.key), w as { key: string; line: string; label: string }]));
const blockOf = (s: ItemListSuggestion, id: string) => s.itemList!.shares!.blocks.find((b) => b.id === id)!;
const f = (s: ItemListSuggestion, id: string, field: string) => blockOf(s, id).fields.find((x) => x.id === field)!;

describe("v80: the add lists -- two full-rate entries in 'Add VAV item', the DP sensor in 'Add sensor' (the DP switch stays out)", () => {
  it("'Add VAV item': v79's 6 families (no plain per-box controller) + the two full-rate entries", () => {
    const s = calc80({ items: [] });
    expect(menu(s)).toEqual(["VAV box", "VAV Integrator", "Duct connection", "Conical piece", "Integrator cabling", "VAV installation - any size"]);
    expect(s.itemList!.shares!.wholeAdds).toEqual([{ id: "bacnet_whole", label: "BACnet over IP controller (full rate)" },
      { id: "ddc_whole", label: "DDC Panel/ Controller (full rate)" }]);
  });
  it("'Add sensor' offers the CO2 Sensor and the Duct Static Pressure Sensor; the Differential Pressure Switch stays out", () => {
    expect(sensorsAdd(calc80({ items: [] }))).toEqual(["CO2 Sensor", "Duct Static Pressure Sensor"]);
  });
  it("VACUITY: user_addable taken out -> the sensor is withdrawn and offered nowhere (CO2 only)", () => {
    expect(sensorsAdd(calc80({ items: [] }, {}, vav80(OFF)))).toEqual(["CO2 Sensor"]);
  });
  it("an entry once added leaves the list (it is on the entry)", () => {
    expect(calc80({ items: [] }, ed({ op: "add", share: "bacnet_whole" })).itemList!.shares!.wholeAdds.map((w) => w.id)).toEqual(["ddc_whole"]);
  });
});

describe("v80: the full-rate BACnet controller block (owner 01:32 / 01:36 'A') -- per unit, by the share's formula, never divided", () => {
  it("in the Calculator, no VAVs typed -> 1 controller = 46,200 + 3,200 per unit; the sum line has no '/ N VAVs'", () => {
    const s = calc80({ items: [] }, ed({ op: "add", share: "bacnet_whole" }));
    expect(f(s, "bacnet_whole", "vavs")).toMatchObject({ value: "", source: "none" });
    expect(f(s, "bacnet_whole", "controllers_count").value).toBe("1");
    expect(blockOf(s, "bacnet_whole").figures).toEqual({ supply_rate: 46200, install_rate: 3200 });
    // owner 01:39 "the helper panel should explain how the price came": every step, the real numbers
    expect(blockOf(s, "bacnet_whole").sumLines).toEqual([
      "1 controller (type the number of VAVs to work it out)",
      "1 x 46,200 supply + 1 x 3,200 installation = 46,200 + 3,200 = 49,400 per unit",
      "(one controller: 33,000 cost x 1.4 = 46,200 supply; 2,000 cost x 1.6 = 3,200 installation)"]);
    expect(blockOf(s, "bacnet_whole").tag).toBe("added by you");
    expect(tot(s)).toEqual([46200, 3200]);
  });
  it("96 VAVs typed -> 3 controllers = 1,38,600 + 9,600 = 1,48,200 per unit", () => {
    const s = calc80({ items: [] }, ed({ op: "add", share: "bacnet_whole" }, { op: "set", share: "bacnet_whole", field: "vavs", value: "96" }));
    expect(f(s, "bacnet_whole", "controllers_count").value).toBe("3");
    expect(blockOf(s, "bacnet_whole").sumLines.slice(0, 2)).toEqual(["96 VAVs / 32 per controller = 3 controllers (rounded up)",
      "3 x 46,200 supply + 3 x 3,200 installation = 1,38,600 + 9,600 = 1,48,200 per unit"]);
    expect(blockOf(s, "bacnet_whole").figures).toEqual({ supply_rate: 138600, install_rate: 9600 });
  });
  it("the controllers count typed is kept and marked 'changed by you' (his '2 yes': a typed quantity), with its revert", () => {
    const s = calc80({ items: [] }, ed({ op: "add", share: "bacnet_whole" }, { op: "set", share: "bacnet_whole", field: "controllers_count", value: "2" }));
    expect(f(s, "bacnet_whole", "controllers_count")).toMatchObject({ value: "2", source: "changed", edited: true });
    expect(blockOf(s, "bacnet_whole").sumLines[0]).toBe("2 controllers (changed by you)");
    expect(blockOf(s, "bacnet_whole").figures).toEqual({ supply_rate: 92400, install_rate: 6400 });
  });
  it("'Or type the amount' replaces the sum with 'Amount typed by you'", () => {
    const s = calc80({ items: [] }, ed({ op: "add", share: "bacnet_whole" }, { op: "amount", share: "bacnet_whole", kind: "supply", value: "50000" }));
    expect(blockOf(s, "bacnet_whole").figures).toEqual({ supply_rate: 50000, install_rate: 3200 });
    expect(blockOf(s, "bacnet_whole").amountTyped).toBe(true);
  });
});

describe("v80: the full-rate DDC panel block (owner 01:15 / 01:22) -- panel 1 + controllers VAVs/32 + sensors VAVs/30, per unit", () => {
  it("80 VAVs -> 25,000 + 3 x 33,000 + 3 x 7,650 = 1,46,950 BCS -> 2,05,730 + 8,000 = 2,13,730 per panel", () => {
    const s = calc80({ items: [] }, ed({ op: "add", share: "ddc_whole" }, { op: "set", share: "ddc_whole", field: "vavs", value: "80" }));
    expect(["panels_count", "controllers_count", "sensors_count"].map((x) => f(s, "ddc_whole", x).value)).toEqual(["1", "3", "3"]);
    expect(blockOf(s, "ddc_whole").figures).toEqual({ supply_rate: 205730, install_rate: 8000 });
    expect(blockOf(s, "ddc_whole").sumLines).toEqual([
      "1 panel x 25,000 cost = 25,000",
      "80 VAVs / 32 per controller = 3 controllers (rounded up) x 33,000 cost = 99,000 (their installation is in the panel's 5,000)",
      "80 VAVs / 30 per sensor = 3 sensors (rounded up) x 7,650 cost = 22,950 (their installation is in the panel's 5,000)",
      "cost 1,46,950 x 1.4 = 2,05,730 supply",
      "installation 1 panel x 5,000 cost x 1.6 = 8,000",
      "= 2,05,730 + 8,000 = 2,13,730 per panel"]);
    expect(blockOf(s, "ddc_whole").sumLines.join(" ")).not.toMatch(/per box/);
  });
  it("the panel inside is ALWAYS 1 (no VAVs / 200 step): 400 VAVs -> panels 1, controllers 13, sensors 14", () => {
    const s = calc80({ items: [] }, ed({ op: "add", share: "ddc_whole" }, { op: "set", share: "ddc_whole", field: "vavs", value: "400" }));
    expect(["panels_count", "controllers_count", "sensors_count"].map((x) => f(s, "ddc_whole", x).value)).toEqual(["1", "13", "14"]);
  });
  it("no VAVs typed -> nothing priced yet, the reason (the panel's components need the count)", () => {
    const s = calc80({ items: [] }, ed({ op: "add", share: "ddc_whole" }));
    expect(blockOf(s, "ddc_whole").figures).toBeNull();
    expect(s.itemList!.rowPriced).toBe(false);
  });
});

describe("K2b (the cert's finding): a full-rate block says PER UNIT where a share says per box", () => {
  const s = calc80({ items: [BOX] }, ed({ op: "add", share: "bacnet" }, { op: "set", share: "bacnet", field: "vavs", value: "80" },
    { op: "add", share: "ddc_whole" }, { op: "set", share: "ddc_whole", field: "vavs", value: "80" }, { op: "add", share: "bacnet_whole" }));
  it("the full-rate DDC and BACnet blocks: ' per unit' on the figure line, 'Or type the amount (per unit)'", () => {
    for (const id of ["ddc_whole", "bacnet_whole"]) {
      expect(blockOf(s, id).perLabel, id).toBe(" per unit");
      expect(blockOf(s, id).typedLabel, id).toBe("Or type the amount (per unit)");
      expect(`${blockOf(s, id).perLabel}${blockOf(s, id).typedLabel}`, id).not.toMatch(/per box/);
    }
  });
  it("the fixed panel shows no 'VAVs per panel' box; its count stays (1)", () => {
    expect(blockOf(s, "ddc_whole").fields.map((x) => x.id)).not.toContain("panels_per");
    expect(f(s, "ddc_whole", "panels_count").value).toBe("1");
  });
  it("NEGATIVE: a SHARE block keeps the labels' per box (no own label)", () => {
    expect(blockOf(s, "bacnet").perLabel).toBeUndefined();
    expect(blockOf(s, "bacnet").typedLabel).toBeUndefined();
    expect(blockOf(s, "bacnet").fields.map((x) => x.id)).toContain("controllers_per");
  });
});

describe("v80: the BoQ-row pre-fill (owner 01:31 / 01:36) -- the sheet's VAVs / the row's quantity, rounded up; per unit", () => {
  // a separate controller / panel row of the sheet, taken as VAV-filed (reachable on a real row only once VAV-2b2 routes such rows)
  // the row's own model item removed by the user (an empty list), so the full-rate block alone prices it
  const own = (q: number | null) => ({ ...other("Supply, installation, testing of DDC Controller with I/O module", q, VAV), items: [] });
  const sheet = (vavs: number, q: number | null) => sheet80({ 10: box(vavs, { controller: "bacnet" }), 50: own(q) as never });
  const add = (id: string, more: Parameters<typeof applyShareEdit>[1][] = []) => ({ __shares__: JSON.stringify(ed({ op: "add", share: id }, ...more)) });
  it("DDC: 45 VAVs, row quantity 2 -> 23 per panel ('45 VAVs on the sheet / 2 panels on this row = 23 per panel'): controllers 1, sensors 1", () => {
    const s = sheet(45, 2)(50, add("ddc_whole"));
    expect(f(s, "ddc_whole", "vavs")).toMatchObject({ value: "23", source: "sheet" });
    expect(["panels_count", "controllers_count", "sensors_count"].map((x) => f(s, "ddc_whole", x).value)).toEqual(["1", "1", "1"]);
    expect(blockOf(s, "ddc_whole").sumLines[0]).toBe("45 VAVs on the sheet / 2 panels on this row = 23 per panel");
    // (25,000 + 33,000 + 7,650) = 65,650 BCS x 1.4 = 91,910; install 8,000
    expect(blockOf(s, "ddc_whole").figures).toEqual({ supply_rate: 91910, install_rate: 8000 });
  });
  it("DDC: 80 VAVs, row quantity 1 -> 80 = 2,13,730 per panel (no pre-fill line)", () => {
    const s = sheet(80, 1)(50, add("ddc_whole"));
    expect(f(s, "ddc_whole", "vavs").value).toBe("80");
    expect(blockOf(s, "ddc_whole").figures).toEqual({ supply_rate: 205730, install_rate: 8000 });
    expect(blockOf(s, "ddc_whole").sumLines.join(" ")).not.toMatch(/on this row/);
  });
  it("quantity blank / 0 -> the sheet's count", () => {
    for (const q of [null, 0]) expect(f(sheet(80, q)(50, add("ddc_whole")), "ddc_whole", "vavs").value, String(q)).toBe("80");
  });
  it("BACnet: 96 VAVs, quantity 1 / 2 / 3 -> 1,48,200 / 98,800 / 49,400 per unit (3 / 2 / 1 controllers)", () => {
    const per = (q: number) => { const b = blockOf(sheet(96, q)(50, add("bacnet_whole")), "bacnet_whole").figures!; return b.supply_rate + b.install_rate; };
    expect([per(1), per(2), per(3)]).toEqual([148200, 98800, 49400]);
    // the owner's wording (01:39): the steps on the quantity-2 row
    expect(blockOf(sheet(96, 2)(50, add("bacnet_whole")), "bacnet_whole").sumLines.slice(0, 3)).toEqual([
      "96 VAVs on the sheet / 2 controllers on this row = 48 per controller",
      "48 VAVs / 32 per controller = 2 controllers (rounded up)",
      "2 x 46,200 supply + 2 x 3,200 installation = 92,400 + 6,400 = 98,800 per unit"]);
  });
  it("a typed VAV count is kept and marked 'changed by you' over the pre-fill", () => {
    const s = sheet(45, 2)(50, add("ddc_whole", [{ op: "set", share: "ddc_whole", field: "vavs", value: "60" }]));
    expect(f(s, "ddc_whole", "vavs")).toMatchObject({ value: "60", source: "changed", edited: true });
    expect(blockOf(s, "ddc_whole").sumLines.join(" ")).not.toMatch(/on this row/);
  });
  it("the row's quantity enters ONLY the pre-fill: the block's figures stay per unit (the BoQ multiplies)", () => {
    const s = sheet(80, 1)(50, add("ddc_whole"));
    expect(s.itemList!.totals?.supply_rate).toBe(205730);
  });
});

describe("v80: the Duct Static Pressure Sensor at full rate -- a plain item, typed quantity, borrowed live", () => {
  it("10,710 + 900 per unit; quantity 3 = 32,130 + 2,700", () => {
    expect(tot(calc80({ items: [], sections: { sensors: [blk("Duct Static Pressure Sensor")] } }))).toEqual([10710, 900]);
    expect(tot(calc80({ items: [], sections: { sensors: [blk("Duct Static Pressure Sensor", {}, "3")] } }))).toEqual([32130, 2700]);
  });
  it("borrowed LIVE from the Sensors sheet (no VAV copy): the Sensors item's rate changed -> the line follows", () => {
    const bumped = itemsV79().map((i) => i.kind === "hvac_sensor_item" && i.attributes.sensor === "Duct Static Pressure Sensor" ? { ...i, rates: { ...i.rates, cost_supply: 8000 } } : i);
    expect(tot(calc80({ items: [], sections: { sensors: [blk("Duct Static Pressure Sensor")] } }, {}, vav80(), bumped))).toEqual([11200, 900]);
    expect(JSON.stringify(vav80())).not.toMatch(/\b7650\b|\b10710\b/);
  });
});

describe("v80: the HELPER never adds a full-rate item by itself (a model-read one is dropped with its line)", () => {
  const rows = { 10: { qty: 80, items: [boxItem({ controller_mention: "none", controller_by_others: "No", dp_sensor_mention: "No" }),
    { vav_item: "BACnet over IP controller", vav_item_as_written: "BACnet controller", qty_per_box: "None", scope: "None" },
    { _section: "sensors", sensor: "Duct Static Pressure Sensor", sensor_as_written: "static pressure sensor", qty_per_box: "None" }] } };
  it("POSITIVE the model items are dropped, each with its line; no full-rate block appears; the row keeps the box alone", () => {
    const s = sheet80(rows)(10);
    expect(s.itemList!.items.map((b) => b.family)).toEqual(["VAV box"]);
    expect(s.itemList!.sections?.independent ?? []).toEqual([]);
    expect(s.itemList!.shares!.blocks.filter((b) => /_whole$/.test(b.id))).toEqual([]);
    const text = JSON.stringify(s.itemList);
    // VAV-2b2 #133 (ANSWER 17 3a, 2026-11-21): the line's wording only (BEFORE "<family>: no longer added to each box")
    for (const x of ["BACnet over IP controller", "Duct Static Pressure Sensor"]) expect(text, x).toContain(`${x} is not added to each box. It is shared across the sheet's VAV boxes: use the share button to add it.`);
  });
  it("the sheet rules and the shares are untouched: the same sheet's BACnet share on v80 = on v79 (1,733 + 120 at 80 VAVs)", () => {
    const s = sheet80({ 10: box(80, { controller: "bacnet" }) })(10);
    expect(s.itemList!.shares!.blocks.map((b) => [b.id, b.figures])).toEqual([["bacnet", { supply_rate: 1733, install_rate: 120 }]]);
  });
});

describe("v80: a share AND the full-rate item on one entry -- both in the total, the review block counts both, the line under the full-rate one", () => {
  const low = itemsV79(undefined, { vav_combination_warning_share: 0.1 });
  for (const [share, whole] of [["bacnet", "bacnet_whole"], ["ddc", "ddc_whole"]] as const) {
    it(`the ${share} share + its full-rate block (80 VAVs each)`, () => {
      const both = calc80({ items: [BOX] }, ed({ op: "add", share }, { op: "set", share, field: "vavs", value: "80" },
        { op: "add", share: whole }, { op: "set", share: whole, field: "vavs", value: "80" }), vav80(), low);
      const a = blockOf(both, share).figures!, b = blockOf(both, whole).figures!;
      const boxOnly = tot(calc80({ items: [BOX] }, {}, vav80(), low));
      expect(tot(both)).toEqual([Number(boxOnly[0]) + a.supply_rate + b.supply_rate, Number(boxOnly[1]) + a.install_rate + b.install_rate]);
      expect(blockOf(both, whole).notes).toContain(W[whole].line);
      expect(blockOf(both, share).notes).not.toContain(W[whole].line);
      expect(both.itemList!.combinationWarning).toMatch(/box with 2 extras/);
      // VACUITY: the full-rate block alone -> no line
      const alone = calc80({ items: [BOX] }, ed({ op: "add", share: whole }, { op: "set", share: whole, field: "vavs", value: "80" }), vav80(), low);
      expect(blockOf(alone, whole).notes).not.toContain(W[whole].line);
    });
  }
  it("the Duct Static Pressure Sensor item + the dp share: the line under the item", () => {
    const entry = { items: [BOX], sections: { sensors: [blk("Duct Static Pressure Sensor")] } };
    const both = calc80(entry, ed({ op: "add", share: "dp" }, { op: "set", share: "dp", field: "vavs", value: "80" }), vav80(), low);
    const item = (both.itemList!.sections?.independent ?? []).flatMap((sv) => sv.view.items ?? []).find((x) => x.family === "Duct Static Pressure Sensor")!;
    expect(item.doubleCountLine).toBe("A DP sensor share is also on this row. Check that the sensor is not counted twice.");
    expect(both.itemList!.combinationWarning).toMatch(/box with 2 extras/);
    const alone = calc80(entry, {}, vav80(), low);
    expect((alone.itemList!.sections?.independent ?? []).flatMap((sv) => sv.view.items ?? []).find((x) => x.family === "Duct Static Pressure Sensor")!.doubleCountLine).toBeUndefined();
  });
});

describe("v80: the Derivation tab -- the new lines with their own reasons, coverage 0", () => {
  const sections = { hvac_misc: BY_ID.get("hvac_misc"), hvac_sensors: sens80() } as Record<string, unknown>;
  it("MISSING / ORPHAN / UNREASONED / WRONG / DEAD = 0; each new line shows the owner's words", () => {
    const r = derivationCoverage(vav80(), itemsV79(), sections);
    expect([r.missing, r.orphan, r.unreasoned, r.wrong, r.dead]).toEqual([[], [], [], [], []]);
    const l1 = r.lines.find((x) => /can be added by hand at its full rate/.test(x.title))!;
    expect(l1.title).toBe("The Duct Static Pressure Sensor can be added by hand at its full rate");
    expect(l1.reason).toBe(KEYS80.vav.derivation_reasons_new[0].why);
    const l2 = r.lines.find((x) => /^A full-rate block prices the item per unit/.test(x.title))!;
    expect(l2.reason).toBe(KEYS80.vav.derivation_reasons_new[1].why);
  });
  // VAV-2b1 K2b (the cert's C1 finding, ANSWER 49): the three generated sentences now say what the screen does, asserted against the live lists
  it("K2b line 'kinds offered' of the sensor section = exactly what 'Add sensor' offers (no withdrawn Differential Pressure Switch)", () => {
    const r = derivationCoverage(vav80(), itemsV79(), sections);
    const l = r.lines.find((x) => /^The sensor section is priced by/.test(x.title))!;
    const offered = sensorsAdd(calc80({ items: [] }));
    expect(offered).toEqual(["CO2 Sensor", "Duct Static Pressure Sensor"]);
    expect(String(l.detail)).toContain(`the kinds offered: ${offered.join(", ")}`);
    expect(String(l.detail)).not.toContain("Differential Pressure Switch");
  });
  it("K2b the block line names the add buttons in the screen's order (= the Calculator's buttons)", () => {
    const r = derivationCoverage(vav80(), itemsV79(), sections);
    const l = r.lines.find((x) => /^Each shared item is its own block/.test(x.title))!;
    const shares = (vav80() as unknown as { list_spec: { pricing: { sheet_shares: { shares: Array<{ id: string; label: string }> } } } }).list_spec.pricing.sheet_shares.shares;
    const shown = calc80({ items: [] }).itemList!.shares!.adds.map((a) => `'${shares.find((x) => x.id === a.id)!.label}'`);   // the buttons' shares, in the buttons' order
    const at = shown.map((b) => String(l.detail).indexOf(b));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });
  it("K2b the withdrawn line: the families no list offers, and the one the user may still add by hand (user_addable)", () => {
    const r = derivationCoverage(vav80(), itemsV79(), sections);
    const l = r.lines.find((x) => /no longer added to each box/.test(x.title))!;
    expect(String(l.detail)).toContain("no add list offers the BACnet over IP controller, Differential Pressure Switch");
    expect(String(l.detail)).toContain("the Duct Static Pressure Sensor can still be added by hand at full rate");
    // VACUITY: without user_addable it is the v79 sentence again
    const off = derivationCoverage(vav80(OFF), itemsV79(), sections).lines.find((x) => /no longer added to each box/.test(x.title))!;
    expect(String(off.detail)).toContain("no add list offers them per box");
  });
  it("VACUITY: without user_addable the first line is gone", () => {
    expect(derivationCoverage(vav80(OFF), itemsV79(), sections).lines.some((x) => /can be added by hand/.test(x.title))).toBe(false);
  });
  it("MINT PARITY (once v80 is the newest file): its VAV config IS v79's + the v80 keys, its Sensors config IS v79's + the family", () => {
    // VAV-2b2 K2 (HVAC v81 minted + loaded; PIN F9, ANSWER 28): read v80 BY NAME (sha-checked), no longer "the newest file" - v81 is newer
    // and has its own mint parity (vav2b2). BEFORE: compared BY_ID / ITEMS of the newest file, guarded by `version >= 80`
    const v80 = assetByName("rate_master_hvac_all_v80.json", "76f0a942");
    expect(v80.byId.get(VAV)).toEqual(vav80());
    expect(v80.byId.get("hvac_sensors")).toEqual(sens80());
    expect(v80.items.length).toBe(853);
  });
});

describe("ANSWER 35 (owner 01:16): the share goes ONLY on rows that price VAV boxes -- never on a separate BACnet / DDC / DP sensor row", () => {
  // each real own row taken as a VAV-FILED row (the worst case: it reaches the VAV helper), the model reading its own item; the sheet's box
  // row carries the BACnet + DP reading, so the sheet's decision DOES add shares to the box row (the vacuity of each case)
  const sheet = (own: Record<string, unknown>) => sheet80({ 10: box(80, { controller: "bacnet", dp: true }), 50: own as never });
  const cases: Array<[string, Record<string, unknown>]> = [
    ["BACnet controller row BOQ-26-00007 r385", { ...real("BOQ-26-00007 'HVAC BOQ' r385"), qty: 1, category: VAV,
      items: [{ vav_item: "BACnet over IP controller", vav_item_as_written: "controller for BACNet integration", qty_per_box: "None", scope: "None" }] }],
    ["DDC panel row BOQ-26-00313 r202", { ...real("BOQ-26-00313 'HVAC' r202"), category: VAV,
      items: [{ vav_item: "none of these", vav_item_as_written: "DDC Controller with I/O module", qty_per_box: "None", scope: "None" }] }],
    ["DP sensor row BOQ-26-00352 r267", { ...real("BOQ-26-00352 'HVAC ' r267"), category: VAV,
      items: [{ _section: "sensors", sensor: "Duct Static Pressure Sensor", sensor_as_written: "pressure sensors in supply air duct", qty_per_box: "None" }] }],
  ];
  for (const [name, own] of cases) {
    it(`${name}: no share block on it; the sheet's box row still carries its shares`, () => {
      const s = sheet(own);
      expect(s(50).itemList?.shares?.blocks ?? [], name).toEqual([]);
      expect(s(10).itemList!.shares!.blocks.length, name).toBeGreaterThan(0);
    });
  }
});

describe("ANSWER 36 E (the 01:02 check's defect): the helper makes NO share block on a row that is not a counted VAV box row", () => {
  // BOQ-26-00171 'HVAC' r153 (Lot 1, BMS reconnection work; filed VAV Box): the stub read it as a box item, so before this fix the helper
  // showed BACnet 2,888 + 200 and DP 669 + 56 blocks on a row it refuses by its unit
  const r153 = { ...real("BOQ-26-00171 'HVAC' r153"), category: VAV, items: [boxItem({ controller_mention: "controller", controller_by_others: "No", dp_sensor_mention: "Yes" })] };
  const rows = { 10: box(15, { controller: "controller", dp: true }), 153: r153 as never };
  it("POSITIVE the real Lot row carries no helper share; NEGATIVE the counted box row on the same sheet still does", () => {
    expect(sheet80(rows)(153).itemList?.shares?.blocks ?? []).toEqual([]);
    expect(sheet80(rows)(10).itemList!.shares!.blocks.map((b) => b.id)).toEqual(["bacnet", "dp"]);
  });
  it("VACUITY: the same row with a Nos unit is a counted box row again -> the helper adds its shares", () => {
    expect(sheet80({ ...rows, 153: { ...r153, unit: "Nos" } as never })(153).itemList!.shares!.blocks.map((b) => b.id)).toEqual(["bacnet", "dp"]);
  });
  it("C (his 'b'): the three share buttons STAY on that row; a share the USER adds there carries the warning", () => {
    const s = sheet80(rows)(153, { __shares__: JSON.stringify(ed({ op: "add", share: "bacnet" })) });
    expect(s.itemList!.shares!.adds.map((a) => a.id)).toEqual(["dp", "ddc"]);
    expect(s.itemList!.shares!.blocks.find((b) => b.id === "bacnet")!.notes).toContain(KEYS80.vav.sheet_shares_lines_add!.not_box_row);
  });
  it("VACUITY: the same user share on a counted box row, and in the Calculator, carries no such warning", () => {
    const onBox = sheet80(rows)(10, { __shares__: JSON.stringify(ed({ op: "add", share: "ddc" })) });
    expect(JSON.stringify(onBox.itemList!.shares)).not.toContain("is not priced as a VAV box");
    expect(JSON.stringify(calc80({ items: [BOX] }, ed({ op: "add", share: "bacnet" })).itemList!.shares)).not.toContain("is not priced as a VAV box");
  });
});
