/**
 * ELR-4c (owner R-39, standing block 39, 2026-10-08; the P6 answer 2026-10-30 "Q6 a") -- EVERY ELECTRICAL DERIVATION LINE
 * FIRES FROM THE PANEL'S ENTRY POINT. The Electrical twin of `ruleReachability.test.ts` (HVAC T1), pinned the same way.
 *
 *   THE GUARD: the lines the cases in `electricalRuleCases.ts` name must EQUAL the lines `attributeRuleOrder` (the Derivation
 *   tab's builder) generates from the LIVE configs (v70 at ELR-4c, v71 at ELR-4d) -- 77 over 12 categories. A new line with no case fails the suite;
 *   a case naming a line that no longer exists fails it too. Nothing is excluded (owner Q6 a): the 17 lines that describe
 *   the AI's READ have model-read cases.
 *
 *   THE CASES: each line has a positive and a negative case through `makePricingSheetHelper(...).compute`; each asserts its
 *   figures exactly and its line's own effect on screen, and a line's two sides must differ.
 */
import { describe, expect, it } from "vitest";
import type { RateCategoryConfig } from "@/pages/pricing/rate-master/rateMasterTypes";
import {
  ELECTRICAL_CONFIGS, ELECTRICAL_RULE_CASES, ELECTRICAL_RULE_ROWS, MODEL_READ_LINES, electricalGeneratedLines, electricalGuardDiff,
  figuresOf, panelResult, panelText, type ElectricalRuleCase,
} from "@/pages/pricing/electricalRuleCases";

const GENERATED = electricalGeneratedLines();

describe("THE GUARD -- the Electrical lines the cases name EQUAL the lines the live config generates", () => {
  it("77 lines over 12 categories, generated from the live configs by the tab's own builder", () => {
    expect(Object.fromEntries(Object.entries(GENERATED).map(([cat, ls]) => [cat, ls.length]))).toEqual({
      wiring_cabling: 15, point_wiring: 14, switches_sockets: 7, popup_boxes: 6, db_switchgear: 9, industrial_sockets: 8,
      earthing: 3, conduit_piping: 3, cabletray_raceway: 6, junction_box_raceway: 2, lighting_mgmt_system: 2, miscellaneous: 2,
    });
    expect(Object.values(GENERATED).flat()).toHaveLength(77);
  });

  it("THE GUARD: every generated line has a case and every case names a generated line", () => {
    expect(electricalGuardDiff(GENERATED, ELECTRICAL_RULE_CASES)).toEqual({});
  });

  it("every line has a POSITIVE and a NEGATIVE case", () => {
    const missing: string[] = [];
    for (const [cat, lines] of Object.entries(GENERATED)) {
      for (const line of lines) {
        for (const kind of ["pos", "neg"] as const) {
          if (!ELECTRICAL_RULE_CASES.some((c) => c.cat === cat && c.line === line && c.kind === kind)) missing.push(`${cat} / ${line} / ${kind}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("case ids are unique and every case's stored row is in the fixture", () => {
    const ids = ELECTRICAL_RULE_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ELECTRICAL_RULE_CASES.filter((c) => !ELECTRICAL_RULE_ROWS[c.row]).map((c) => c.id)).toEqual([]);
    expect(ELECTRICAL_RULE_CASES.filter((c) => ELECTRICAL_RULE_ROWS[c.row].cat !== c.cat).map((c) => c.id)).toEqual([]);
  });

  it("owner Q6 a: the 17 AI-read lines are covered by model-read cases, and only they are; nothing is excluded", () => {
    const readLines = Object.entries(MODEL_READ_LINES).flatMap(([cat, ls]) => ls.map((l) => `${cat} / ${l}`)).sort();
    expect(readLines).toHaveLength(17);
    const modelRead = [...new Set(ELECTRICAL_RULE_CASES.filter((c) => c.how === "model-read").map((c) => `${c.cat} / ${c.line}`))].sort();
    expect(modelRead).toEqual(readLines);
    for (const l of readLines) expect(Object.entries(GENERATED).flatMap(([cat, ls]) => ls.map((t) => `${cat} / ${t}`))).toContain(l);
  });

  it("VACUITY: a line whose case is removed is named uncovered; a case naming a dead line is named dead", () => {
    const withoutBoard = ELECTRICAL_RULE_CASES.filter((c) => !(c.cat === "db_switchgear" && c.line === "Board size"));
    expect(electricalGuardDiff(GENERATED, withoutBoard)).toEqual({ db_switchgear: { uncovered: ["Board size"], dead: [] } });
    const dead: ElectricalRuleCase = { ...ELECTRICAL_RULE_CASES[0], id: "DEAD", line: "A line no config generates" };
    expect(electricalGuardDiff(GENERATED, [...ELECTRICAL_RULE_CASES, dead])).toEqual({ [dead.cat]: { uncovered: [], dead: ["A line no config generates"] } });
  });

  it("AC0: deleting the config source behind DB2 'Board size' (rule R2) takes the line off the tab AND the guard names it", () => {
    const db = structuredClone(ELECTRICAL_CONFIGS.get("db_switchgear")!) as RateCategoryConfig & { rules?: Array<{ id?: string }> };
    expect((db.rules ?? []).some((r) => r.id === "R2")).toBe(true);
    db.rules = (db.rules ?? []).filter((r) => r.id !== "R2");
    const configs = new Map(ELECTRICAL_CONFIGS);
    configs.set("db_switchgear", db);
    const gen = electricalGeneratedLines(configs);
    expect(gen.db_switchgear).not.toContain("Board size");
    expect(gen.db_switchgear).toHaveLength(8);
    expect(electricalGuardDiff(gen, ELECTRICAL_RULE_CASES)).toEqual({ db_switchgear: { uncovered: [], dead: ["Board size"] } });
  });
});

describe("every Electrical case through the panel's entry point (the live asset)", () => {
  it.each(ELECTRICAL_RULE_CASES.map((c) => [`${c.id} ${c.cat} / ${c.line} (${c.kind}, ${c.how})`, c] as const))("%s", (_name, c) => {
    const r = panelResult(c);
    expect(figuresOf(r)).toEqual(c.fig);
    const text = panelText(r);
    const has = (s: string) => text.some((t) => t.includes(s));
    expect(c.re.filter((s) => !has(s))).toEqual([]);
    expect((c.not ?? []).filter((s) => has(s))).toEqual([]);
  });

  it("a line's positive and negative differ -- in the figures or on screen", () => {
    const same: string[] = [];
    for (const [cat, lines] of Object.entries(GENERATED)) {
      for (const line of lines) {
        const pos = ELECTRICAL_RULE_CASES.find((c) => c.cat === cat && c.line === line && c.kind === "pos")!;
        const neg = ELECTRICAL_RULE_CASES.find((c) => c.cat === cat && c.line === line && c.kind === "neg")!;
        const p = panelResult(pos);
        const n = panelResult(neg);
        if (JSON.stringify(figuresOf(p)) === JSON.stringify(figuresOf(n)) && JSON.stringify(panelText(p)) === JSON.stringify(panelText(n))) same.push(`${cat} / ${line}`);
      }
    }
    expect(same).toEqual([]);
  });
});
