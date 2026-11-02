/**
 * ELR-5 (owner "Q1 a, Q2 c, Q3 b, Q4 a", 2026-10-31; R-SS0) -- the mechanism behind the 12 Switches & Sockets rows at Rs 0, on
 * local copies of the pipeline that declare the sentence: a part its own Yes/No switched off counts as absent for
 * `none_refusal`, so Back box = No no longer keeps an empty row at Rs 0. Line 5's sentence and line 7's title on the
 * Derivation tab. The live rows through the panel and the calculator are in `elr5SwitchesLive.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { ELECTRICAL_CONFIGS, ELECTRICAL_ITEMS } from "@/pages/pricing/electricalRuleCases";
import { attributeRuleOrder } from "@/pages/pricing/rate-master/itemListRuleOrder";
import { noneRefusalOf, runPipeline } from "@/pages/pricing/rate-master/ratePipelineInterpreter";
import type { Pipeline } from "@/pages/pricing/rate-master/rateMasterTypes";

const REFUSAL = "No part of this row matched the catalogue - price it by hand.";
const SENTENCE = `With nothing on the board and no back box, the row does not price; it says: '${REFUSAL}'`;
const NOTHING = { switch_item: "None", socket1_item: "None", socket2_item: "None", socket3_item: "None", socket4_item: "None", plate_item: "None", colour: "White" };

type Step = { step?: string; name?: string; none_refusal?: string; none_skips?: boolean; qty?: unknown };
type Cfg = { category_id?: string; pipelines: Record<string, { steps: Step[] }> };

/** The Switches & Sockets config with the sentence declared on (or taken off) its BoQ pipeline, whatever the asset says. */
const cfgWith = (declared: boolean, cat = "switches_sockets", pid = "swsock_boq"): Cfg => {
  const c = structuredClone(ELECTRICAL_CONFIGS.get(cat)) as unknown as Cfg;
  for (const s of c.pipelines[pid].steps) {
    if (s.step !== "sum_components") continue;
    if (declared) s.none_refusal = REFUSAL;
    else delete s.none_refusal;
  }
  return c;
};
const run = (cfg: Cfg, sel: Record<string, string | number>, pid = "swsock_boq") =>
  runPipeline(pid, cfg.pipelines[pid] as unknown as Pipeline, ELECTRICAL_ITEMS, sel);

describe("a part its own Yes/No switched off counts as absent, for none_refusal only", () => {
  it("POSITIVE: every part None and Back box = No refuses, in the declared words", () => {
    const res = run(cfgWith(true), { ...NOTHING, back_box: "No" });
    expect(res.status).toBe("no_match");
    expect(noneRefusalOf(res)).toBe(REFUSAL);
    expect(res.finals).toEqual({});
  });

  it("POSITIVE: a blanker named alone refuses too: with no plate the fit gives it no spare module", () => {
    expect(noneRefusalOf(run(cfgWith(true), { ...NOTHING, blank_item: "1M Blanker", back_box: "No" }))).toBe(REFUSAL);
  });

  it("NEGATIVE: Back box = Yes on an empty board still prices the 3M box, so the row is not refused", () => {
    const res = run(cfgWith(true), { ...NOTHING, back_box: "Yes" });
    expect(res.status).toBe("ok");
    expect(noneRefusalOf(res)).toBeUndefined();
    expect([res.finals.supply, res.finals.install]).toEqual([70, 20]);
  });

  it("NEGATIVE: one part named keeps the row priced, with the box switched off", () => {
    const res = run(cfgWith(true), { ...NOTHING, switch_item: "10A 1 WAY SWITCH", switch_qty: 1, back_box: "No" });
    expect(res.status).toBe("ok");
    expect(res.finals.supply).toBeGreaterThan(0);
  });

  it("NEGATIVE: a part named at quantity 0 is still a part (ELR-4d's rule is unchanged)", () => {
    const res = run(cfgWith(true), { ...NOTHING, switch_item: "10A 1 WAY SWITCH", switch_qty: 0, back_box: "No" });
    expect(res.status).toBe("ok");
    expect(noneRefusalOf(res)).toBeUndefined();
    expect(res.finals.supply).toBeCloseTo(0);
  });

  it("NEGATIVE: with no sentence declared the same answers still sum to 0: the set is read by nothing else", () => {
    const res = run(cfgWith(false), { ...NOTHING, back_box: "No" });
    expect(res.status).toBe("ok");
    expect(res.finals.supply).toBeCloseTo(0);
    expect(res.finals.install).toBeCloseTo(0);
  });

  it("NEGATIVE: the BCS pipeline declares nothing and still sums to 0 (owner: deferred to the BCS build)", () => {
    const res = run(cfgWith(true), { ...NOTHING, back_box: "No" }, "swsock_bcs");
    expect(res.status).toBe("ok");
    expect(res.finals.bcs_supply).toBeCloseTo(0);
  });
});

describe("the Derivation lines (owner 'Q3 b', 'Q4 a')", () => {
  const lines = (cfg: unknown) => attributeRuleOrder(cfg, ELECTRICAL_ITEMS);
  const plate = (cfg: unknown) => lines(cfg).find((l) => l.title === "Plate, back box and blanks")!.detail ?? "";

  it("POSITIVE: line 5 says the refusal, in the config's words, last before the reason", () => {
    expect(lines(cfgWith(true)).findIndex((l) => l.title === "Plate, back box and blanks")).toBe(4);
    expect(plate(cfgWith(true))).toContain(`never raise it). ${SENTENCE} -- why:`);
  });

  it("the sentence is the config's: other words declared, other words shown", () => {
    const c = cfgWith(true);
    for (const s of c.pipelines.swsock_boq.steps) if (s.step === "sum_components") s.none_refusal = "Other words.";
    expect(plate(c)).toContain("it says: 'Other words.'");
  });

  it("NEGATIVE: a config declaring no sentence shows the line as it was, ending at the blanks", () => {
    const d = plate(cfgWith(false));
    expect(d).not.toContain("does not price");
    expect(d).toContain("never raise it). -- why:");
  });

  it("NEGATIVE: point wiring and pop-up boxes keep their own plate lines: neither declares the sentence", () => {
    for (const cat of ["point_wiring", "popup_boxes"]) {
      const l = attributeRuleOrder(ELECTRICAL_CONFIGS.get(cat), ELECTRICAL_ITEMS).find((x) => /plate and blanks|Plate, back box and blanks/.test(x.title));
      expect(l?.detail ?? "", cat).not.toContain("does not price");
    }
  });

  it("POSITIVE: wiring line 7's title is the field alone, and its detail is unchanged", () => {
    const l = attributeRuleOrder(ELECTRICAL_CONFIGS.get("wiring_cabling"), ELECTRICAL_ITEMS)[6];
    expect(l.title).toBe("Conduit size (mm)");
    expect(l.detail).toContain("where a conduit type is named and no size, 25 mm -- why:");
  });

  it("NEGATIVE: the old title is nowhere on the wiring tab; WAS 'Conduit size (mm): the size the BoQ states'", () => {
    const all = attributeRuleOrder(ELECTRICAL_CONFIGS.get("wiring_cabling"), ELECTRICAL_ITEMS).map((l) => `${l.title} ${l.detail ?? ""}`).join(" ");
    expect(all).not.toContain("the size the BoQ states");
  });
});
