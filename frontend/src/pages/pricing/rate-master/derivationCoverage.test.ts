/**
 * DU-1 PART A -- THE DERIVATION COVERAGE CHECK AND VP-DRV FIX-1..4 (owner 2026-11-15 13:30-13:41, verbatim: "we need to make sutre
 * that the derivatrion screen captures all th erules" / "the derivation tab is part of rat emaster screen. it needs to be buiult there
 * only" / "going forwrad we need to add a derivation coverage check before deployment to ensure all rules (model + code+ anywhere
 * else) are captured in the dderivation tab for that category in the rate master"; QR-1 Q1 (a) 15:47: FIX-1 generic).
 *
 * Every case runs on FIXTURES (a structured clone of the committed v69 asset, edited in memory) -- never live data. Each mechanism
 * has a positive and a negative case. THE GUARD on the latest asset (Valve Package and Misc MISSING / ORPHAN = 0) lives in
 * `derivationCoverage.latest.test.ts`, minted with the asset that declares the lines (v70).
 */
import { readFileSync } from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { describe, expect, it } from "vitest";
import { CODE_RULES, derivationCoverage } from "./derivationCoverage";
import { itemListRuleOrder } from "./itemListRuleOrder";
import { readJsonFixture } from "../calculatorPanelParity.harness";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the configs are JSON clones edited in memory
type Cfg = any;
type Asset = { items: Array<Record<string, unknown>>; category_configs: Cfg[] };
const DATA = path.resolve(__dirname, "../../../../../nirmaan_stack/services/boq_rate_master/data");
const V69 = readJsonFixture<Asset>(pathToFileURL(path.join(DATA, "rate_master_hvac_all_v69.json")));
const cfg = (id: string): Cfg => structuredClone(V69.category_configs.find((c) => c.category_id === id));
const VALVE = "hvac_valve_package", MISC = "hvac_misc", ADP = "hvac_adp";
const titles = (c: Cfg, sec?: Record<string, Cfg>) => itemListRuleOrder(c, V69.items, sec).map((l) => l.title);
const lines = (c: Cfg, sec?: Record<string, Cfg>) => itemListRuleOrder(c, V69.items, sec);
/** a complete set of declared lines for every code rule of a kind */
const declareAll = (c: Cfg) => {
  c.list_spec.pricing.rule_lines = (CODE_RULES[c.list_spec.pricing.kind] ?? []).map((r) => ({ rule: r, title: `Declared line for ${r}` }));
  return c;
};

describe("DU-1 FIX-1 -- every text_notes entry and every material_text map entry is its own line (generic)", () => {
  it("POSITIVE: the Valve Package's 4 notes and the drain valve are on its tab, each quoting its own words", () => {
    const l = lines(cfg(VALVE));
    const notes = l.filter((x) => / carries a note$/.test(x.title));
    expect(notes.length).toBe(4);
    expect(notes.map((n) => n.detail).join(" ")).toMatch(/flanges, nuts, bolts and gaskets.*Flanged Balancing Valve.*Valve insulation is not on our sheets.*One price for an automatic air vent/);
    expect(l.find((x) => /^A 'drain' in the valve type as written/.test(x.title))?.detail).toBe("with a line: 'BoQ says a drain valve -> priced as the Ball Valve of the same size'");
  });
  it("POSITIVE: an entry's own `rule_line` is its title; ADP (QR-1 Q1 (a)) also lists its 2 notes", () => {
    const c = cfg(VALVE);
    c.list_spec.pricing.text_notes[3].rule_line = "An automatic air vent has one price for any size, with a note";
    expect(titles(c)).toContain("An automatic air vent has one price for any size, with a note");
    expect(lines(cfg(ADP)).filter((x) => / carries a note -- why: /.test(`${x.title} -- ${x.detail}`) || / carries a note$/.test(x.title)).length).toBe(2);
  });
  it("NEGATIVE (structural vacuity): each entry taken out takes ITS line, and only it", () => {
    const base = titles(cfg(VALVE));
    for (let i = 0; i < 4; i++) {
      const c = cfg(VALVE); c.list_spec.pricing.text_notes.splice(i, 1);
      expect(titles(c).length).toBe(base.length - 1);
    }
    const c = cfg(VALVE); c.list_spec.pricing.material_text.map.splice(0, 1);   // the drain entry
    expect(titles(c).some((t) => /^A 'drain'/.test(t))).toBe(false);
    expect(titles(c).length).toBe(base.length - 1);
  });
});

describe("DU-1 FIX-2 -- the scope line states VP-5 E11 + the pair rule; line 1 the description unit (every category)", () => {
  const scope = (c: Cfg) => lines(c).find((x) => x.title === "The BoQ scope: supply + installation unless the row says otherwise")?.detail ?? "";
  it("POSITIVE: E11 (i) / (ii) / (iii) as built, and the pair rule on its own line", () => {
    const d = scope(cfg(VALVE));
    expect(d).toContain("with the item's supply quoted on its own row of the sheet -> the normal installation rate, supply 0, naming that row");
    expect(d).toContain("-> the installation x (1 + the Pricing Input 'Valve - installation-only uplift'), with a note");
    expect(d).toContain("otherwise -> supply + installation, with the note 'BoQ says installation only but no supply row is quoted for it - priced supply + installation (we do end to end)'");
    expect(titles(cfg(VALVE))).toContain("A 'Supply of' row whose installation is quoted on its own row of the sheet is priced supply only");
  });
  it("NEGATIVE: the old VP-1 wording ('only when the sheet quotes no supply row') is gone; a scope without supply_row keeps the VP-1 line and has no pair line", () => {
    expect(scope(cfg(VALVE))).not.toContain("only when the sheet quotes no supply row");
    const c = cfg(VALVE); delete c.list_spec.pricing.scope.supply_row;
    expect(scope(c)).toContain("only when the sheet quotes no supply row");
    expect(titles(c).some((t) => /^A 'Supply of' row/.test(t))).toBe(false);
  });
  it("POSITIVE: a category's own refix factors and its uplift on the supply-row case (Ducting's config shape) are said from config", () => {
    const c = cfg(VALVE);
    c.list_spec.pricing.scope.refix = [{ label: "removal", factor: 0.5 }, { label: "refixing", factor: 1 }];
    c.list_spec.pricing.scope.supply_row.uplift = true;
    const d = scope(c);
    expect(d).toContain("removal -> 0.5 x the item's installation; refixing -> 1 x the item's installation; both named in the row -> the two added (1.5 x)");
    expect(d).toContain("the installation x (1 + the Pricing Input 'Valve - installation-only uplift'), supply 0, naming that row");
  });
  it("POSITIVE + NEGATIVE: line 1 names the description unit on every item-list category; never on a config without unit classes", () => {
    for (const id of [VALVE, MISC, ADP, "hvac_insulation", "hvac_piping", "hvac_vrf"]) {
      expect(lines(cfg(id))[0].detail ?? "", id).toContain("'Unit read from the description: <unit>'");
    }
    const c = cfg(VALVE); c.list_spec.pricing.unit_classes = {};
    expect(lines(c)[0].detail ?? "").not.toContain("Unit read from the description");
  });
});

describe("DU-1 FIX-3 -- declared rule lines (`rule_lines`) are rendered, each carrying its rule id", () => {
  it("POSITIVE: each declared line is on the tab with its rule id; plain English (no tag reaches the screen)", () => {
    const c = cfg(VALVE);
    c.list_spec.pricing.rule_lines = [{ rule: "D1", title: "A thermostat beside a PIBCV is part of it (owner D1)", detail: "with a line" }];
    const l = lines(c).find((x) => x.rule === "D1");
    expect(l?.title).toBe("A thermostat beside a PIBCV is part of it");
    expect(l?.detail).toBe("with a line");
  });
  it("NEGATIVE: no `rule_lines` -> no declared line (every committed config before v70)", () => {
    expect(lines(cfg(VALVE)).some((x) => x.rule)).toBe(false);
  });
});

describe("DU-1 FIX-4 -- a borrow-only category's own rules nest under the section line", () => {
  it("POSITIVE: with Misc's config handed over, Misc's own generated lines sit under the Valve Package's Misc line", () => {
    const l = lines(cfg(VALVE), { hvac_misc: cfg(MISC) });
    const sec = l.find((x) => x.title === "The misc item section is priced by Misc item's rules");
    expect(sec?.sub?.map((s) => s.title)).toEqual(titles(cfg(MISC)));
  });
  it("NEGATIVE: without it (the alias / older callers), and on any other line, nothing nests", () => {
    expect(lines(cfg(VALVE)).some((x) => x.sub)).toBe(false);
    const l = lines(cfg(VALVE), { hvac_misc: cfg(MISC) });
    expect(l.filter((x) => x.sub).length).toBe(1);
  });
});

describe("DU-1 reasons -- a category declaring `derivation_reasons` carries a 'why' on every line", () => {
  it("POSITIVE: by rule id and by title pattern, the '(owner, date)' kept", () => {
    const c = declareAll(cfg(MISC));
    c.list_spec.pricing.derivation_reasons = [{ rule: "T1", why: "inch sizes are named by their NB (owner, 2026-11-14)" }, { title: "^The row's unit", why: "units ruling (owner, 2026-11-11)" }];
    const l = lines(c);
    expect(l.find((x) => x.rule === "T1")?.detail).toBe("why: inch sizes are named by their NB (owner, 2026-11-14)");
    expect(l[0].reason).toBe("units ruling (owner, 2026-11-11)");
    expect(derivationCoverage(c, V69.items).unreasoned.length).toBe(l.length - 2);
  });
  it("NEGATIVE: no key -> no reason on any line (Valve, Misc, Insulation, Piping, VRF unchanged)", () => {
    for (const id of [VALVE, MISC, "hvac_insulation", "hvac_piping", "hvac_vrf"]) expect(lines(cfg(id)).every((x) => x.reason === undefined), id).toBe(true);
  });
});

describe("DU-1 THE GUARD (fixtures) -- MISSING / ORPHAN", () => {
  it("POSITIVE: the Valve Package with every code rule declared and Misc nested -> 0 / 0 (Misc's own T1 too)", () => {
    const misc = declareAll(cfg(MISC));
    const r = derivationCoverage(declareAll(cfg(VALVE)), V69.items, { hvac_misc: misc });
    expect(r.missing).toEqual([]);
    expect(r.orphan).toEqual([]);
  });
  it("NEGATIVE: v69 as committed -> every code rule MISSING (the 23 VP-DRV found as reading rules + T1), and Misc's T1", () => {
    const r = derivationCoverage(cfg(VALVE), V69.items, { hvac_misc: cfg(MISC) });
    expect(r.missing.filter((m) => m.startsWith("code rule ")).map((m) => m.split(" ")[2].replace(/:$/, "")).sort()).toEqual([...CODE_RULES.hvac_valve_item].sort());
    expect(r.missing).toContain("hvac_misc (borrowed) code rule T1: no declared line");
    expect(r.missing.filter((m) => m.startsWith("config "))).toEqual([]);
  });
  it("NEGATIVE: a declared line naming no code rule is an ORPHAN; one dropped is MISSING", () => {
    const c = declareAll(cfg(VALVE));
    c.list_spec.pricing.rule_lines.push({ rule: "Z9", title: "A rule that does not exist" });
    c.list_spec.pricing.rule_lines.splice(0, 1);
    const r = derivationCoverage(c, V69.items, { hvac_misc: declareAll(cfg(MISC)) });
    expect(r.orphan).toEqual(["declared line Z9: names no code rule of hvac_valve_item"]);
    expect(r.missing).toEqual(["code rule D1: no declared line"]);
  });
  it("NEGATIVE: a config rule with no line is MISSING (Piping's sheet-heading note today; a fixture key the tab cannot state)", () => {
    expect(derivationCoverage(cfg("hvac_piping"), V69.items).missing).toEqual(["config sheet_heading_notes: no line states it"]);
    const c = declareAll(cfg(VALVE)); c.list_spec.pricing.sheet_heading_notes = cfg("hvac_piping").list_spec.pricing.sheet_heading_notes;
    expect(derivationCoverage(c, V69.items, { hvac_misc: declareAll(cfg(MISC)) }).missing).toContain("config sheet_heading_notes: no line states it");
  });
  it("NEGATIVE: the borrowed category's own gaps count against the borrower (Misc without its T1 line)", () => {
    const r = derivationCoverage(declareAll(cfg(VALVE)), V69.items, { hvac_misc: cfg(MISC) });
    expect(r.missing).toEqual(["hvac_misc (borrowed) code rule T1: no declared line"]);
  });
});

describe("DU-1 THE GUARD (source) -- no code rule exists without its register entry", () => {
  // every "(owner X)" tag the valve reading rules write (the VALVE_NETS wording table and the valveReviewNets body) is registered
  const src = readFileSync(path.resolve(__dirname, "../../boq-wizard/rate-helper/pricingSheetHelper.ts"), "utf-8");
  const start = src.indexOf("export const VALVE_NETS");
  const end = src.indexOf("\nexport function", src.indexOf("export function valveReviewNets"));
  const body = src.slice(start, end > 0 ? end : undefined);
  it("POSITIVE: the scan reads the gated code (non-empty) and finds the tags", () => {
    expect(start).toBeGreaterThan(0);
    expect(body).toContain("export function valveReviewNets");
    expect(body.match(/\(owner [A-Z]\d+[a-z]?\)/g)!.length).toBeGreaterThan(20);
  });
  it("every tag is a registered code rule of the valve kind (E2 / E9 / T1 write no tag; they are registered by name)", () => {
    const tags = [...new Set((body.match(/\(owner ([A-Z]\d+[a-z]?)\)/g) ?? []).map((t) => t.slice(7, -1)))].sort();
    const unregistered = tags.filter((t) => !CODE_RULES.hvac_valve_item.includes(t));
    expect(unregistered).toEqual([]);
  });
  it("NEGATIVE: a tag the register does not hold is caught", () => {
    const fake = body + ' z_line: "a new rule (owner D9)",';
    const tags = [...new Set((fake.match(/\(owner ([A-Z]\d+[a-z]?)\)/g) ?? []).map((t) => t.slice(7, -1)))];
    expect(tags.filter((t) => !CODE_RULES.hvac_valve_item.includes(t))).toEqual(["D9"]);
  });
});
