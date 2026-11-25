/**
 * VAV-2c1 R3 / T4 (owner 2026-11-22 10:49 "check for similar instances across other HVAC categories and remove if found", 13:03 "a"): no
 * sentence of the screen code carries an internal working label ON A SCREEN. Every string literal, template and JSX text of the rate-helper
 * / rate-master / pricing files is walked by the program of P1 b (pricerCodeTexts.harness.ts) and read with the shared label
 * list (scripts/pricer_text_labels.json). A stored sentence may keep its tag ONLY where the one plain-English function drops it when it is
 * drawn (12e-3b: "the PURE pricer's own text keeps them") -- and then the function is proved to drop it, here. Electrical's own line is not
 * touched by this slice (owner 13:05). The rules page (Derivation) is read AS RENDERED.
 */
import path from "path";
import { describe, expect, it } from "vitest";
import LABELS from "../../../../../scripts/pricer_text_labels.json";
import { codeFiles, walkCode } from "./pricerCodeTexts.harness";
import { itemListRuleOrder } from "./itemListRuleOrder";
import { plainPricerText } from "./plainEnglish";
import { V81, cfg82, items82 } from "../../boq-wizard/rate-helper/vav2c1.harness";

const SRC = path.resolve(__dirname, "../../..");
const KINDS = LABELS.kinds.filter((k) => k.id !== "key").map((k) => new RegExp(k.re, "g"));
const NOT_LABELS = new Set(["QRO"]);   // a rate-only unit (R/O, QRO)
const labelsIn = (t: string): string[] => KINDS.flatMap((re) => t.match(re) ?? []).filter((x) => !NOT_LABELS.has(x));
const ELECTRICAL = /the D26 adder means ADD A BUS BAR/;   // the Electrical rules page: its own slice (owner 2026-11-22 13:05)

describe("T4 the screen code's own sentences", () => {
  const all = walkCode(SRC);
  it("the walk sees the screen code (the counts): files and readable strings", () => {
    expect(codeFiles(SRC).length).toBeGreaterThanOrEqual(60);
    expect(all.length).toBeGreaterThan(2000);
  });
  it("a string that carries a label is drawn through the plain-English function, which drops it", () => {
    const kept = all.filter((x) => labelsIn(x.text).length && !ELECTRICAL.test(x.text));
    const shown = kept.filter((x) => labelsIn(plainPricerText(x.text)).length);
    expect(shown.map((x) => `${x.file}:${x.line} ${x.text.slice(0, 120)}`)).toEqual([]);
    // only the item-list pricer's and the valve reading rules' sentences are kept that way
    expect([...new Set(kept.map((x) => x.file))].sort()).toEqual(["pages/boq-wizard/rate-helper/itemListPricing.ts", "pages/boq-wizard/rate-helper/pricingSheetHelper.ts"]);
    expect(kept.length).toBe(40);   // measured: 57 labelled strings at HEAD - 11 scope notes - 5 rules-page lines - 1 Electrical
  });
  it("VACUITY: a planted scope note with a tag IS found, and one the function cannot drop fails", () => {
    expect(labelsIn("priced as supply + installation (owner F2)")).toEqual(["F2"]);
    expect(labelsIn(plainPricerText("the sentences of ANSWER 16, per QR-K2 (a)"))).not.toEqual([]);
  });
});

describe("T4 the rules pages AS RENDERED, every HVAC category (v82's edits)", () => {
  const CATS = ["hvac_adp", "hvac_insulation", "hvac_piping", "hvac_vrf", "hvac_valve_package", "hvac_misc", "hvac_ducting", "hvac_vav_box", "hvac_sensors"];
  const items = items82();
  const page = (cat: string, cfgOf: (c: string) => unknown): string[] => {
    const sections = Object.fromEntries(CATS.map((c) => [c, cfgOf(c)]));
    const lines = itemListRuleOrder(cfgOf(cat) as never, items, sections as never);
    return lines.flatMap((l) => [l.title, l.detail ?? "", ...((l as { sub?: Array<{ title: string; detail?: string }> }).sub ?? []).flatMap((s) => [s.title, s.detail ?? ""])]);
  };
  for (const cat of CATS) {
    it(`${cat}: no label on the page`, () => {
      const t = page(cat, (c) => cfg82(c));
      expect(t.length).toBeGreaterThan(8);
      expect(t.filter((x) => labelsIn(x).length)).toEqual([]);
      expect(t.filter((x) => /\b(bacnet|ddc)_whole\b|chat-Claude/.test(x))).toEqual([]);
    });
  }
  it("RED on v81: Ducting, VAV Box, Valve Package and VRF's pages carry labels today", () => {
    const red = CATS.filter((cat) => page(cat, (c) => V81.byId.get(c)).some((x) => labelsIn(x).length));
    expect(red).toEqual(["hvac_valve_package", "hvac_ducting", "hvac_vav_box"]);
  });
  it("his own words and dates stay: Ducting's shape line, VAV's separate-row line", () => {
    const d = page("hvac_ducting", (c) => cfg82(c)).join("\n"), v = page("hvac_vav_box", (c) => cfg82(c)).join("\n");
    expect(d).toContain('shape not stated - priced as rectangular, in amber, switchable (owner, 2026-11-13 21:03)');
    expect(d).toContain('(owner "option C", 2026-11-16 16:38)');
    expect(v).toContain('owner 2026-11-21 15:56 "1a 2a 3b": a separate DDC panel row with a quantity');
    expect(v).toContain("no VAVs typed: nothing is priced");
    // lines 42 / 43: a block by the name the screens use, never its id
    expect(v).toContain("(the BACnet controller share)");
    expect(v).toMatch(/BACnet controller share, BACnet over IP controller \(full rate\)/);
    expect(v).not.toMatch(/\(the (bacnet|ddc|dp)|\(the (bacnet|ddc|dp) share\)|(bacnet|ddc)_whole/);
    // line 44: each item once
    const claim = v.split("\n").find((x) => x.startsWith("only on a sheet with VAV rows"))!;
    expect(claim.match(/VAV integrator -> /g)).toHaveLength(1);
    expect(claim.match(/VAV installation -> /g)).toHaveLength(1);
  });
  it("QR-V (owner 2026-11-22 20:13 'a'): the Ducting lines follow the live inputs", () => {
    const at = (up: number | null, thr: number) => {
      const its = items82({ ducting_install_only_uplift: up, ducting_insulation_coverage_threshold: thr });
      return itemListRuleOrder(cfg82("hvac_ducting") as never, its, { hvac_insulation: cfg82("hvac_insulation"), hvac_misc: cfg82("hvac_misc") } as never).map((l) => l.detail ?? "").join("\n");
    };
    expect(at(0, 0.9)).toContain("'Ducting - installation-only uplift', 0% today");
    expect(at(0.2, 0.8)).toContain("'Ducting - installation-only uplift', 20% today");
    expect(at(0.2, 0.8)).toContain("(80% today; exactly at = covered)");
    expect(at(null, 0.9)).toContain("'Ducting - installation-only uplift', not set today");
  });
});
