/**
 * VAV-2b2 T5 / B1 / QR-K2 / T4: the Derivation tab on v81 (coverage MISSING / ORPHAN / UNREASONED / WRONG / DEAD = 0, each new line ITS OWN
 * reason - lesson (e): the reasons list is first-match), the reading questions in the VAV config (the model is asked them; the request text
 * itself is proved server-side by test_vav2b2_keys), the adaptor rule (owner 13:40 "4 a") on the panel's own-row view, and KEY ABSENT =
 * the v80 file's own behaviour.
 */
import { describe, expect, it } from "vitest";
import { derivationCoverage } from "../../pricing/rate-master/derivationCoverage";
import { KEYS81, V80, box81, items81, sheet81, vav80file, vav81, type Row81 } from "./vav2b2.harness";

const sections = { hvac_misc: V80.byId.get("hvac_misc"), hvac_sensors: V80.byId.get("hvac_sensors") } as Record<string, unknown>;

describe("T5 the Derivation tab on v81", () => {
  const r = derivationCoverage(vav81(), items81(), sections);
  it("MISSING / ORPHAN / UNREASONED / WRONG / DEAD = 0 for VAV Box", () => {
    expect([r.missing, r.orphan, r.unreasoned, r.wrong, r.dead]).toEqual([[], [], [], [], []]);
  });
  it("each NEW line shows ITS OWN reason (the owner's words), not a broader one", () => {
    for (const nr of KEYS81.vav.derivation_reasons_new ?? []) {
      const re = new RegExp(nr.title, "i");
      const lines = r.lines.filter((l) => re.test(l.title));
      expect(lines.length, nr.title).toBeGreaterThan(0);
      for (const l of lines) expect(l.reason, l.title).toBe(nr.why);
    }
  });
  it("the warning line names the share as 25% today (the Pricing Input, read live) with its replaced reason", () => {
    const l = r.lines.find((x) => /^A row whose extras come to more than a set share/.test(x.title))!;
    expect(l.detail).toMatch(/\(25% today\)/);
    expect(l.reason).toBe(KEYS81.vav.derivation_reasons_replace![0].why);
  });
  it("NO EARLIER LINE MOVES: every v80 line keeps its number and title; the new ones come after the VAV-2b1 lines", () => {
    const before = derivationCoverage(vav80file(), items81(), sections).lines;
    const after = r.lines;
    const newTitles = new Set((KEYS81.vav.derivation_reasons_new ?? []).flatMap((nr) => after.filter((l) => new RegExp(nr.title, "i").test(l.title)).map((l) => l.title)));
    const kept = after.filter((l) => !newTitles.has(l.title));
    expect(kept.map((l) => l.title)).toEqual(before.map((l) => l.title));
  });
  it("VACUITY: a planted reason no line matches -> DEAD names it", () => {
    const planted = vav81() as unknown as { list_spec: { pricing: { derivation_reasons: Array<{ title: string; why: string }> } } };
    planted.list_spec.pricing.derivation_reasons.push({ title: "^A line no rule writes", why: "planted" });
    expect(derivationCoverage(planted as never, items81(), sections).dead.length).toBe(1);
  });
});

describe("B1: the reading questions are in the VAV config's list (what the model is asked)", () => {
  const defs = (vav81() as unknown as { list_spec: { attribute_definitions: Array<{ id: string; values?: string[]; note?: string }> } }).list_spec.attribute_definitions;
  it("controller_mention / controller_by_others / dp_sensor_mention, with the reading's values", () => {
    expect(defs.find((d) => d.id === "controller_mention")?.values).toEqual(["ddc_inclusive", "ddc", "bacnet", "controller", "none"]);
    expect(defs.find((d) => d.id === "controller_by_others")?.values).toEqual(["Yes", "No"]);
    expect(defs.find((d) => d.id === "dp_sensor_mention")?.values).toEqual(["Yes", "No"]);
  });
  it("R5: the item question says 'suitable for duct connections' is NOT a duct connection (owner 2026-11-19 19:06 '9a')", () => {
    expect(defs.find((d) => d.id === "vav_item")?.note).toMatch(/'suitable for duct connections' describes the box - that is NOT a duct connection item/);
  });
  it("R6: only a controller FOR CONTROLLING THE VAVs; DDC panel = controller; other equipment's and a makes line do not count", () => {
    const n = defs.find((d) => d.id === "controller_mention")?.note ?? "";
    for (const w of ["FOR CONTROLLING THE VAVs", "the two are the same thing", "an AHU's 'BACNET/IP DDC'", "'centralised controller for VFD operation'", "single OEM"]) expect(n).toContain(w);
  });
  it("KEY ABSENT: the v80 file asks none of the three", () => {
    const d80 = (vav80file() as unknown as { list_spec: { attribute_definitions: Array<{ id: string }> } }).list_spec.attribute_definitions.map((d) => d.id);
    expect(d80.some((id) => ["controller_mention", "controller_by_others", "dp_sensor_mention"].includes(id))).toBe(false);
  });
});

describe("QR-K2 (owner 13:40 '4 a'): an adaptor / adapter row is not the BACnet controller's own row (the panel's own-row view)", () => {
  // BOQ-26-00020 r194's words, with a quantity 1 (so it WOULD switch the share off if it counted)
  const ADAPTOR = "Unification adaptor for connecting between central remote controller and BMS Computer on BACnet protocol.";
  const rows = (cfg = vav81()) => sheet81({ 1: box81(36, { controller: "bacnet" }), 194: { text: ADAPTOR, qty: 1, unit: "Set", category: "hvac_misc" } as Row81 }, { cfg });
  it("v81: the adaptor row switches no share off -> the boxes carry the BACnet controller share", () => {
    expect(rows()(1).itemList!.shares!.blocks.some((b) => b.id === "bacnet")).toBe(true);
  });
  it("VACUITY: without the added not-words (the v80 test) the same row IS a BACnet own row -> no share", () => {
    expect(rows(vav81({ dropPricing: ["separate_not_words_add"] }))(1).itemList!.shares!.blocks.some((b) => b.id === "bacnet")).toBe(false);
  });
  it("NEGATIVE: a real BACnet controller row (BOQ-26-00424 r52 words) still switches the share off", () => {
    const s = sheet81({ 1: box81(36, { controller: "bacnet" }), 52: { text: "Supply & installation of VAV BACnet controller/ Modbus card with wall mountable metallic enclosure for BMS integration.", qty: 2, unit: "Nos", category: "hvac_misc" } as Row81 });
    expect(s(1).itemList!.shares!.blocks.some((b) => b.id === "bacnet")).toBe(false);
  });
});
