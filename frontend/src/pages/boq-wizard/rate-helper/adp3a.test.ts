/**
 * ADP-3a (owner rulings 2026-10-20: H1 the "*" marker, H2 either-or groups, B6 a no-SKU sentence names only what the
 * products vary on, the 13:35 unit refusals, H6 nothing removed; the standing value-used line and calculator = panel)
 * -- U1-U7 on the LIVE assets (HVAC v48, Electrical v66), each with a positive case and a near miss. NO price moves:
 * every figure asserted here is the figure the same row priced at before the slice (the AC9 replay proves it over
 * every stored row). U8 (the screen-reader names) is `adp3a.dom.test.tsx`; the Derivation lines are in
 * `ruleReachability.test.ts` (T.a3Unit / T.a3Unstocked / T.a3Either) and their parity cases in
 * `calculatorPanelParity.test.ts` (I35 / I36 / A19-A21).
 */
import { describe, expect, it } from "vitest";
import { ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY } from "./pricingSheetHelper";
import { attr, attrsOf, calculator, field, fieldsOf, panel, priced } from "./adp3a.harness";

const ADP = "hvac_adp", INS = "hvac_insulation";
const NR = "Nitrile Rubber Insulation";
const adp = (unit: string, item: Record<string, string>) => panel({ cat: ADP, unit, model: [item] });
const ins = (unit: string, item: Record<string, string>) => panel({ cat: INS, unit, model: [item] });
const reqIds = (s: ReturnType<typeof panel>) => fieldsOf(s).filter((f) => f.required).map((f) => f.id);
const calcItem = (cat: string, unit: string, family: string, attrs: Record<string, string>) =>
  calculator(cat, { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: [{ base: null, family, attrs, other: Object.keys(attrs) }] }), [ROW_UNIT_OVERRIDE_KEY]: unit });

// ── U1 (H1): "*" on every field needed to price -- the gate's own condition, so it can never disagree with it ──────────
describe("U1 -- the needed-to-price marker", () => {
  it("POSITIVE: a per-number slot diffuser marks Slots only (the damper takes its ruled default, the piece length is read)", () => {
    const s = adp("nos", { family: "slot diffuser", air: "supply", damper: "None", slot_count: "3", size_mm: "1300 mm Length" });
    expect(reqIds(s)).toEqual(["slot_count"]);
    expect(s.values).toEqual({ supply_rate: 2866, install_rate: 458, combined_rate: 3324 });
  });
  it("POSITIVE: Insulation marks the cladding and the pipe size (the cladding's default has no absent-as-none -- AC1's one difference)", () => {
    expect(reqIds(ins("RMT", { item: NR, cladding: "26G Aluminium", thickness_mm: "19", pipe_size_mm: "50" }))).toEqual(["cladding", "pipe_size_mm"]);
  });
  it("POSITIVE: an attribute row marks what its gate needs, and the calculator marks the same fields as the panel", () => {
    const p = panel({ cat: "conduit_piping", unit: "RMT", attrs: { conduit_type: "MS" } });
    const c = calculator("conduit_piping", { conduit_type: "MS" });
    expect(attrsOf(p).filter((a) => a.required).map((a) => a.id)).toEqual(["conduit_type", "size_mm"]);
    expect(attrsOf(c).map((a) => [a.id, a.required])).toEqual(attrsOf(p).map((a) => [a.id, a.required]));
  });
  it("NEGATIVE: a field in an either-or group, a ruled default and a disabled field carry no marker", () => {
    expect(reqIds(adp("nos", { family: "VCD", variant: "GI rectangular", size_mm: "550X300" }))).toEqual([]);
    expect(field(adp("nos", { family: "slot diffuser", air: "supply", damper: "None", slot_count: "3", size_mm: "1300 mm Length" }), "damper").required).toBe(false);
    const pw = calculator("point_wiring", { circuit_wire_included: "No" });
    expect(attrsOf(pw).filter((a) => a.disabled && a.required)).toEqual([]);
  });
});

// ── U2 (H2): an either-or is drawn as one group ──────────────────────────────────────────────────────────────────────
describe("U2 -- either-or groups", () => {
  it("POSITIVE: a per-number VCD -- Size (W x H), or Area band", () => {
    const s = adp("nos", { family: "VCD", variant: "GI rectangular", size_mm: "550X300" });
    expect([field(s, "size_mm").group, field(s, "area_band").group]).toEqual(["Size (W x H), or Area band", "Size (W x H), or Area band"]);
  });
  it("POSITIVE: a per-number plenum -- Area, or all three of Length, Width, Height", () => {
    const s = adp("nos", { family: "mixing box / LP plenum" });
    expect(fieldsOf(s).filter((f) => f.group).map((f) => [f.id, f.group])).toEqual(
      ["plenum_area_sqm", "plenum_length_mm", "plenum_width_mm", "plenum_height_mm"].map((id) => [id, "Area, or all three of Length, Width, Height"]));
  });
  it("POSITIVE: a square diffuser -- Neck size, or Outer size, with the outer size SHOWN as its own field", () => {
    const s = adp("nos", { family: "square diffuser", damper: "with", size_mm: "595x595" });
    expect(field(s, "size_mm")).toMatchObject({ label: "Outer size", value: "595x595", group: "Neck size, or Outer size", required: false });
    expect(field(s, "neck_mm").group).toBe("Neck size, or Outer size");
    expect(s.values).toEqual({ supply_rate: 2523, install_rate: 576, combined_rate: 3099 });
  });
  it("POSITIVE (cert C3): a group's fields sit together even where another field is read between them (the square diffuser's Air stream)", () => {
    const s = adp("nos", { family: "square diffuser", damper: "with", air: "supply", size_mm: "595x595" });
    expect(fieldsOf(s).map((f) => f.id)).toEqual(["damper", "neck_mm", "size_mm", "air"]);
    for (const row of [s, adp("nos", { family: "VCD", variant: "GI rectangular", size_mm: "550X300" }), adp("nos", { family: "mixing box / LP plenum" })]) {
      const g = fieldsOf(row).map((f) => f.group);
      const first = g.findIndex(Boolean), last = g.length - 1 - [...g].reverse().findIndex(Boolean);
      expect(g.slice(first, last + 1).every(Boolean)).toBe(true);
    }
    expect(s.values).toEqual({ supply_rate: 2523, install_rate: 576, combined_rate: 3099 });
  });
  it("NEGATIVE: a per-sq.m VCD has one way to price -- no size field and no group", () => {
    const s = adp("sqm", { family: "VCD", variant: "GI rectangular" });
    expect(fieldsOf(s).map((f) => [f.id, f.group])).toEqual([["variant", null]]);
  });
});

// ── U3: a refusal names EVERY missing fact, and each one's box is outlined ───────────────────────────────────────────
describe("U3 -- every missing field named and outlined", () => {
  it("POSITIVE: a per-number VCD with neither way stated names both, and both boxes are red", () => {
    const s = adp("nos", { family: "VCD", variant: "GI rectangular" });
    expect(s.itemList!.reason).toBe("VCD needs Size (W x H), or Area band - neither stated - price this row by hand");
    expect([field(s, "size_mm").blank, field(s, "area_band").blank, field(s, "variant").blank]).toEqual([true, true, false]);
    // calculator = panel: the same sentence and the same two red boxes
    const c = calcItem(ADP, "nos", "VCD", { variant: "GI rectangular" });
    expect(c.itemList!.reason).toBe(s.itemList!.reason);
    expect([field(c, "size_mm").blank, field(c, "area_band").blank]).toEqual([true, true]);
  });
  it("POSITIVE: a square diffuser with neither names both", () => {
    const s = adp("nos", { family: "square diffuser", damper: "with" });
    expect(s.itemList!.reason).toBe("square diffuser needs Neck size, or Outer size - neither stated - price this row by hand");
    expect([field(s, "neck_mm").blank, field(s, "size_mm").blank]).toEqual([true, true]);
  });
  it("POSITIVE: Insulation missing two facts names both (BEFORE: only the first)", () => {
    const s = ins("RMT", { item: NR, thickness_mm: "19" });
    expect(s.itemList!.reason).toBe("could not tell cladding; no pipe size stated");
    expect(fieldsOf(s).filter((f) => f.blank).map((f) => f.id)).toEqual(["cladding", "pipe_size_mm"]);
  });
  it("POSITIVE: an attribute row names its missing field -- the panel and the calculator in their own words", () => {
    expect(panel({ cat: "conduit_piping", unit: "RMT", attrs: { conduit_type: "MS" } }).workings.derivation).toEqual(["Missing to price: Size (mm) -- fill them to compute a rate."]);
    expect(calculator("conduit_piping", { conduit_type: "MS" }).workings.derivation).toEqual(["Fill to price: Size (mm)."]);
  });
  it("NEGATIVE: a priced row outlines nothing", () => {
    const s = adp("nos", { family: "VCD", variant: "GI rectangular", size_mm: "550X300" });
    expect(priced(s)).toBe(true);
    expect(fieldsOf(s).filter((f) => f.blank || f.outline)).toEqual([]);
  });
});

// ── U4 (B6 and the outline keyed to the field the refusal is about) ──────────────────────────────────────────────────
describe("U4 -- the refusal is about the field, and names only what the products vary on", () => {
  it("POSITIVE (B6): a fire damper's per-sq.m SKUs carry no width or height, so the sentence never names them", () => {
    const s = adp("nos", { family: "fire damper", variant: "UL", ul: "no", size_mm: "600x600" });
    expect(s.itemList!.reason).toBe("No SKU for fire damper: UL listed no, variant UL - price this row by hand");
  });
  it("NEGATIVE (B6): a fact every product shares STAYS when the row contradicts it -- the one access door is 450 x 450", () => {
    expect(adp("nos", { family: "access door", size_mm: "600x600" }).itemList!.reason).toBe("No SKU for access door: width 600, height 600 - price this row by hand");
  });
  it("POSITIVE: a box that HOLDS words but gave too little is outlined, not emptied (an access door's '600'; a bare pipe size '4')", () => {
    const door = adp("nos", { family: "access door", size_mm: "600" });
    expect(door.itemList!.reason).toBe("no height stated");
    expect(field(door, "size_mm")).toMatchObject({ value: "600", outline: true, blank: false });
    const pipe = ins("RMT", { item: NR, cladding: "26G Aluminium", thickness_mm: "19", pipe_size_mm: "4" });
    expect(pipe.itemList!.reason).toBe("size 4 has no unit - price this row by hand");
    expect(fieldsOf(pipe).filter((f) => f.outline).map((f) => f.id)).toEqual(["pipe_size_mm"]);
  });
  it("NEGATIVE: the same rows priced outline nothing", () => {
    expect(fieldsOf(ins("RMT", { item: NR, cladding: "26G Aluminium", thickness_mm: "19", pipe_size_mm: "50" })).filter((f) => f.outline)).toEqual([]);
    expect(fieldsOf(adp("nos", { family: "access door", size_mm: "450x450" })).filter((f) => f.outline)).toEqual([]);
  });
});

// ── U5 (owner 13:35): a kind not stocked in the row's unit refuses, naming the units it IS stocked in ────────────────
describe("U5 -- unit refusals", () => {
  it("POSITIVE: a known unit the kind is not stocked in, and a unit the catalogue does not know, read the same way", () => {
    expect(adp("sqm", { family: "access door", size_mm: "600x600" }).itemList!.reason).toBe("access door is not stocked per sq.m (stocked per number) - price this row by hand");
    expect(adp("Lot", { family: "access door", size_mm: "600x600" }).itemList!.reason).toBe("access door is not stocked per 'Lot' (stocked per number) - price this row by hand");
    expect(ins("nos", { item: NR, cladding: "26G Aluminium", thickness_mm: "19", pipe_size_mm: "50" }).itemList!.reason)
      .toBe("Nitrile Rubber Insulation is not stocked per 'nos' (stocked per metre) - price this row by hand");
  });
  it("NEGATIVE: the kind's own unit prices, with no unit sentence", () => {
    const s = adp("nos", { family: "access door", size_mm: "450x450" });   // the one stocked access door
    expect(priced(s)).toBe(true);
    expect(s.itemList!.reason ?? "").not.toMatch(/is not stocked per/);
  });
});

// ── U6: the value used, under every field the pricing read ───────────────────────────────────────────────────────────
describe("U6 -- value-used lines", () => {
  it("POSITIVE: a size read as width x height, an area band read at its largest, and the area the rate is multiplied by", () => {
    const vcd = adp("nos", { family: "VCD", variant: "GI rectangular", size_mm: "550X300" });
    expect(field(vcd, "size_mm").note).toBe("BoQ says 550X300 -> width 550 mm, height 300 mm");
    expect(vcd.itemList!.items[0].working).toContain("area: width 550 x height 300 mm = 0.17 sq.m (from 'Size')");
    const band = adp("nos", { family: "VCD", variant: "GI rectangular", area_band: "Up to 0.5 Sqmt" });
    expect(field(band, "area_band").note).toBe("BoQ says Up to 0.5 Sqmt -> priced at 0.5 sq.m (the largest value)");
  });
  it("POSITIVE: the neck size priced from an outer size says so; a per-sq.ft row shows the rate before and after", () => {
    const sq = adp("nos", { family: "square diffuser", damper: "with", size_mm: "595x595" });
    expect(field(sq, "neck_mm")).toMatchObject({ value: "450", note: "matched on the outer size 595x595; largest neck size behind it is 450" });
    expect(adp("sqft", { family: "VCD", variant: "GI rectangular" }).itemList!.items[0].working).toContain("per sq.ft: sq.m rate x 0.0929 (supply 7830 -> 728; install 1920 -> 179)");
  });
  it("POSITIVE: an Electrical value the pipeline landed on says how -- a stocked size as given, a fitted one from what was asked", () => {
    expect(attr(panel({ cat: "conduit_piping", unit: "RMT", attrs: { conduit_type: "MS", size_mm: "25" } }), "size_mm").landed).toEqual(["As given - a stocked size"]);
    expect(attr(calculator("conduit_piping", { conduit_type: "MS", size_mm: "25" }), "size_mm").landed).toEqual(["As given - a stocked size"]);
  });
  it("NEGATIVE: a blank or unread field carries no value-used line", () => {
    const vcd = adp("nos", { family: "VCD", variant: "GI rectangular", size_mm: "550X300" });
    expect([field(vcd, "area_band").note, field(vcd, "variant").note]).toEqual([null, null]);
    expect(attr(panel({ cat: "conduit_piping", unit: "RMT", attrs: { conduit_type: "MS" } }), "size_mm").landed).toEqual([]);
  });
});

// ── U7: the calculator asks exactly what the server would ────────────────────────────────────────────────────────────
describe("U7 -- the calculator", () => {
  const CIRCUIT = /Circuit wire/;
  it("POSITIVE: circuit wiring No exempts every circuit-wire field, as the server's force_absent_dependents does", () => {
    const no = calculator("point_wiring", { circuit_wire_included: "No" });
    expect(no.workings.derivation![0]).toMatch(/^Fill to price: /);
    expect(no.workings.derivation![0]).not.toMatch(CIRCUIT);
    expect(attrsOf(no).filter((a) => /^circuit_wire\d/.test(a.id)).every((a) => a.disabled || a.value === "None")).toBe(true);
  });
  it("NEGATIVE: circuit wiring Yes still asks for every circuit-wire field; a stated circuit field is never overwritten", () => {
    expect(calculator("point_wiring", { circuit_wire_included: "Yes" }).workings.derivation![0]).toMatch(CIRCUIT);
    expect(attr(calculator("point_wiring", { circuit_wire_included: "No", circuit_wire1_thickness_sqmm: "2.5" }), "circuit_wire1_thickness_sqmm").value).toBe("2.5");
  });
  it("POSITIVE: once a plate is named, the plate quantity takes the extraction default and is shown as a default; NEGATIVE: unnamed, it stays blank", () => {
    const blank = calculator("point_wiring", { circuit_wire_included: "No" });
    expect(attr(blank, "plate_qty").value).toBe("");
    const plate = blank.workings.attributes.find((a) => a.id === "plate_item")!.options?.find((o) => String(o) !== "None");
    expect(plate).toBeTruthy();
    const named = calculator("point_wiring", { circuit_wire_included: "No", plate_item: String(plate) });
    const q = named.workings.attributes.find((a) => a.id === "plate_qty")!;
    expect([q.value, !!q.defaulted]).toEqual(["1", true]);
    expect(named.workings.derivation![0]).not.toMatch(/Plate qty/);
  });
});
