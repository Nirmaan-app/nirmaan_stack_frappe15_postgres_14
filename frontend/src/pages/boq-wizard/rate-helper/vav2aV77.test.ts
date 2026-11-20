/**
 * VAV-2a B10 / AC0 / AC8 / T5 / T6 ON THE NEWEST HVAC ASSET (a latest-asset reader by file prefix: rate_master_hvac_all_v -- from HVAC v77).
 * v77 = v76 + the VAV-2a keys on hvac_vav_box + the 8 VAV-2a Pricing Inputs (scripts/_instruments/mint_hvac_v77_vav2a.py), the key values
 * from the ONE keys file (__fixtures__/vav2aKeys.json). calculator_only stays ON (VAV rows "coming soon" until VAV-2b; vav1VavSurfaces T8
 * pins it on this asset too). The Derivation coverage of VAV Box (MISSING / ORPHAN / UNREASONED 0) is guarded by
 * derivationCoverage.latest.test.ts on this asset.
 */
import { describe, expect, it } from "vitest";
import { itemListRuleOrder } from "../../pricing/rate-master/itemListRuleOrder";
import { derivationCoverage } from "../../pricing/rate-master/derivationCoverage";
import { computePricingInputReach } from "../../pricing/rate-master/pricingInputReach";
import { BY_ID, ITEMS, LATEST, VAV, blk, calc, D2, tot } from "./vav1Vav.harness";
import { KEYS } from "./vav2a.harness";

const C = BY_ID.get(VAV)! as unknown as { calculator_only?: boolean; list_spec: { pricing: Record<string, unknown>; sections: Array<Record<string, unknown>> } };
const BOX = blk("VAV box", { shape: "Rectangular", vav_type: "Nothing specific mentioned", integrator_included: "No", cfm_range: "450-800" });
const C4 = { items: [BOX, blk("BACnet over IP controller")], sections: { misc: [blk("Digital Thermostat")], sensors: [blk("CO2 Sensor")] } };
const version = Number(LATEST.match(/v(\d+)/)![1]);

describe(`VAV-2a on ${LATEST}`, () => {
  it("B10: the VAV config carries EXACTLY the keys file's values; calculator_only stays true", () => {
    expect(version).toBeGreaterThanOrEqual(77);
    // VAV-2a2 (v78): own_row_check gains `serves` (B8); every VAV-2a value is still there unchanged
    for (const [k, v] of Object.entries(KEYS.pricing)) {
      const got = structuredClone(C.list_spec.pricing[k]) as Record<string, unknown>;
      if (k === "own_row_check" && version >= 78) delete got.serves;
      expect(got, k).toEqual(v);
    }
    // POSITIVE (chat-Claude's review 2026-11-20 00:52, PIN 3): on v78 the serves key is EXACTLY what the owner ruled -- item first; the
    // BACnet over IP controller only; presence decides (QR-C2 (a) 00:34; 00:37 "one controller for many VAVs")
    if (version >= 78) {
      expect((C.list_spec.pricing.own_row_check as { serves?: unknown }).serves)
        .toEqual({ item_first: true, extras: ["BACnet over IP controller"], presence_decides: true });
    }
    for (const [id, ks] of Object.entries(KEYS.sections)) {
      const s = C.list_spec.sections.find((x) => x.id === id)!;
      for (const [k, v] of Object.entries(ks)) expect(s[k], `${id}.${k}`).toEqual(v);
    }
    expect(C.calculator_only).toBe(true);
  });
  it("B10: the 8 Pricing Inputs are loaded at the owner's defaults and each is READ by VAV Box (born connected: 'used by VAV Box')", () => {
    const reach = computePricingInputReach(Object.fromEntries(BY_ID), ITEMS);
    for (const [id, v] of Object.entries(KEYS.inputs)) {
      const it = ITEMS.find((i) => i.kind === "hvac_pricing_input" && i.attributes?.item === id);
      expect(it, id).toBeTruthy();
      expect(Number((it!.rates as { factor?: unknown }).factor), id).toBe(v.factor);
      expect(it!.attributes?.name, id).toBe(v.name);
      expect((reach[id] as unknown as { readByCategories?: string[] })?.readByCategories, id).toEqual([VAV]);
    }
  });
  it("AC0 / C3: the calculator's D2 case still reads 34,720 + 2,900 with no warning", () => {
    const v = calc(D2).itemList!;
    expect(tot(calc(D2))).toEqual([34720, 2900]);
    expect(v.combinationWarning).toBeUndefined();
  });
  it("AC0 / C4: box + BACnet over IP + thermostat + CO2 (BOQ-26-00318 r173) = 83,930 + 7,000 with the combination warning and its figures", () => {
    const v = calc(C4).itemList!;
    expect(tot(calc(C4))).toEqual([83930, 7000]);
    expect(v.combinationWarning).toBe("This rate combines the box with 3 extras (Rs 66,130 of Rs 90,930). Review each item before using.");
  });
  it("AC0 / C1: the Derivation tab states every VAV-2a rule with its reason; the cabling line reads BCS cost 140 per metre, quoted 196", () => {
    const sections = { hvac_misc: BY_ID.get("hvac_misc"), hvac_sensors: BY_ID.get("hvac_sensors") } as Record<string, unknown>;
    const lines = itemListRuleOrder(BY_ID.get(VAV), ITEMS as never, sections);
    const text = lines.map((l) => `${l.title} :: ${l.detail ?? ""} :: ${l.reason ?? ""}`).join("\n");
    for (const t of ["An extra the sheet charges on its own row is checked against that row",
                     "A VAV integrator priced on its own row of the sheet changes the box line, without a quantity test",
                     "On a sheet with a VAV integrator anywhere, every VAV box row is checked for a separate integrator cabling row",
                     "is priced as the installation alone",
                     "A row whose extras come to more than a set share of the VAV box's own rate carries a warning to review it",
                     "section's quantity per vav item is the count the row names"]) expect(text, t).toContain(t);
    expect(text).toContain("BCS cost 140 per metre, quoted 196 per metre");
    expect(text).toContain("at the Pricing Input 'VAV - integrator cabling metres per box' (2 m per box today = 392 per box quoted)");
    const kind = lines.find((l) => l.title.startsWith("That kind's rule for that unit"))!;
    expect(kind.reason).toContain("BCS cost 140 per metre, quoted 196 per metre");
    expect(lines.filter((l) => l.reason === "reason not recorded").map((l) => l.title)).toEqual([]);
  });
  it("T5: Derivation coverage for VAV Box 0 / 0 / 0 on this asset (and the guard would see a key taken out)", () => {
    const sections = { hvac_misc: BY_ID.get("hvac_misc"), hvac_sensors: BY_ID.get("hvac_sensors") } as Record<string, unknown>;
    const r = derivationCoverage(BY_ID.get(VAV), ITEMS as never, sections);
    expect([r.missing, r.orphan, r.unreasoned]).toEqual([[], [], []]);
  });
});
