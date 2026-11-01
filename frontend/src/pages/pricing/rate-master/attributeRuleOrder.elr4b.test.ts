// ELR-4b AC1 / AC2 / AC3 / AC7 (owner R-DERIV 2026-09-27; R-APPROVE 2026-10-29 "option b"; the P6 answer 2026-10-29:
// "all approved; Q1 yes; Q2 no; Q3 a; Q4 a; Q5 a; Q6 a; Q7 noted; aliases b; DB4 keep verbatim; MI2 repeat MI1's quote in
// full on the tab"): the rules lists of the other eight Electrical categories and wiring's six corrections, written
// from their config.
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { readJsonFixture } from "@/pages/pricing/calculatorPanelParity.harness";
import { DERIVATION_RULINGS, attributeRuleOrder, type RuleOrderItem } from "./itemListRuleOrder";

const DATA = path.resolve(__dirname, "../../../../../nirmaan_stack/services/boq_rate_master/data");
const EXTRACTION = path.resolve(__dirname, "../../../../../nirmaan_stack/services/boq_rate_master/extraction.py");
const PROMPT = path.resolve(__dirname, "../../../../../nirmaan_stack/services/boq_category/prompts/boq_rate_attr_extraction_prompt.md");
type Step = Record<string, any>;
type Cfg = { category_id: string; pipelines: Record<string, { steps: Step[] }>; attribute_definitions: Array<Record<string, any>>;
  extraction_defaults?: Record<string, any>; rules?: Array<{ id: string; guidance?: string }>; synonyms?: Record<string, Record<string, string>>;
  composite_slots?: Record<string, any>; decomposition_rules?: Record<string, any>; matching_mode?: string; [k: string]: unknown };
type AssetFile = { items: RuleOrderItem[]; category_configs: Cfg[] };
// READ, never imported (tsc and a whole asset); v70 is the live config the lines were approved on (P6, 2026-10-29)
const elec = readJsonFixture<AssetFile>(pathToFileURL(path.join(DATA, "rate_master_electrical_all_v70.json")));
const hvac = readJsonFixture<AssetFile>(pathToFileURL(path.join(DATA, "rate_master_hvac_all_v54.json")));
const cfg = (id: string): Cfg => structuredClone(elec.category_configs.find((c) => c.category_id === id)!);
const lines = (c: unknown, items: RuleOrderItem[] = elec.items) => attributeRuleOrder(c, items);
const titles = (c: unknown) => lines(c).map((l) => l.title);
const texts = (c: unknown) => lines(c).map((l) => `${l.title} -- ${l.detail}`);
const steps = (c: Cfg) => Object.entries(c.pipelines).filter(([id]) => !/bcs/i.test(id)).flatMap(([, p]) => p.steps);
const dropSteps = (c: Cfg, pred: (s: Step) => boolean): Cfg => {
  for (const p of Object.values(c.pipelines)) p.steps = p.steps.filter((s) => !pred(s));
  return c;
};
const dropRules = (c: Cfg, ids: string[]): Cfg => { c.rules = (c.rules ?? []).filter((r) => !ids.includes(r.id)); return c; };
const NR = "reason not recorded";

const EIGHT = ["db_switchgear", "industrial_sockets", "earthing", "conduit_piping", "cabletray_raceway", "junction_box_raceway", "lighting_mgmt_system", "miscellaneous"];

// THE APPROVED LINES (P6, 2026-10-29), title -- text, word for word; the reason is checked against the table separately
const APPROVED: Record<string, string[]> = {
  db_switchgear: [
    "The DB is split into its parts -- The AI reads the row as the board (shell), up to five breaker types with their quantities, and an enclosure only when one is named; a breaker row with no board has no shell; parts the catalogue does not carry (ATS, bus bars, meters, IP enclosures, flexi boards) are left out and the rest is priced",
    "Board size -- The way-count the BoQ states, else the next larger board in the catalogue -- never a smaller one; a range takes the highest",
    "Breakers -- The amperage the BoQ states, else the next higher rating -- never lower; a range such as '10/16 A' takes the highest. Curve as stated, else D for a board serving a UPS, else C",
    "Four-pole and SP+N breakers -- TPN, TP+N, TP+NL, TP+2N, TP+2NL and 4P mean four pole. When the row's own words call a breaker TPN-family or SPN-family, it is matched at that named pole where the catalogue has one, else at four pole (TPN) or double pole (SPN), at the same amperage or the next one up (a note on the field says when the amperage moved up); with nothing at or above, the breaker is left blank and the row does not price until it is filled",
    "RCCB / RCBO and ELCB -- An RCCB or RCBO with no leakage current stated anywhere takes the highest mA at the stated device, amperage and pole; an ELCB is priced as two parts, an MCB plus an RCCB",
    "Outgoings per phase -- A quantity stated per phase is multiplied by 3 on a TPN or VTPN board and by 1 on an SPN board",
    "Quantities and missing parts -- A part named with no quantity counts 1; a part the BoQ says is absent (None) is not priced; every part must be answered, a part or None, or the row does not price. A row where no part is matched at all prices at 0 today",
    "Supply -- The parts' list prices x their quantities, added, x (1 - discount) x (1 + supply markup) from 'Switchgear discount & supply markup', rounded up to the next 10",
    "Install -- The rounded supply x 'DB installation share', rounded up to the next 10 -- the share is of the whole board with its breakers, not the shell alone",
  ],
  industrial_sockets: [
    "Paired MCB -- Added only when the BoQ names a breaker (MCB, MCCB, RCBO, RCCB, ELCB or \"circuit breaker\"); an amperage alone is not a breaker, so the socket is priced alone. A Paired MCB you pick is used as picked",
    "MCB pole -- The pole the BoQ states: TPN, TP+N, TP+NL, TP+2N, TP+2NL, 4P and Four Pole mean four pole; SPN, SP+N, SP+NL, SP&N and 1P+N mean double pole; none stated -> from the socket: 3 pin -> single pole, 5 pin -> four pole",
    "MCB curve -- As stated, else C",
    "MCB rating -- The amperage the BoQ states, else the next higher rating at that pole and curve; nothing at or above -> the row does not price. If the amperage was not read, no MCB is added and the socket is priced alone, with no note on screen",
    "Interlocked socket -- Includes its MCB: no separate MCB is added",
    "Enclosure -- IP67 when the BoQ says IP67 or waterproof, else IP44/54 splash proof; this is on the AI's read, and the calculator does not assume it",
    "Supply -- The socket at 'Industrial socket discount & supply markup' + the MCB at 'Switchgear discount & supply markup', each rounded up to the rupee, then added",
    "Install -- The supply x 'Industrial socket installation share', rounded up to the next 10",
  ],
  earthing: [
    "The earthing item -- Matched on Material and Type exactly. A row read as Type 'Bus bar' with Material CU or GI matches no earthing item and does not price (priced by hand for now); a row read as Material 'BUS BAR' matches the Bus bar item itself",
    "With Bus bar -- As stated, else Without. With adds the Bus bar item's own supply rate; Without adds nothing",
    "Supply and install -- Supply = (the item's supply + the Bus bar) x (1 + 'Earthing supply markup'); install = the item's install x (1 + 'Earthing installation markup'); neither is rounded",
  ],
  conduit_piping: [
    "Conduit type -- As stated; GI is priced as MS",
    "Size -- The stated size, else the next larger size stocked for that type; an inch size in the row's own description is read as its trade size (3/4\" = 20, 1\" = 25, 1 1/4\" = 32, 1 1/2\" = 40, 2\" = 50 mm); above the largest stocked size the row does not price",
    "Supply and install -- Supply = list price x (1 - discount) x (1 + supply markup) from 'Conduit discount & supply markup', not rounded; install = the supply x 'Conduit installation share', rounded up to the next 10",
  ],
  cabletray_raceway: [
    "Material -- As stated, with two substitutions: a uPVC tray is priced as GI Solid; a plain MS tray as MS powder coated",
    "Thickness -- The millimetres the BoQ states; a thickness given only as a sheet gauge is converted to millimetres (16 gauge = 1.6 mm), using the body's gauge where body and cover differ and the nearest heading's where several give one. The thickness is not fitted: one the catalogue does not stock for that type and material does not price",
    "Width -- The stated width, else the next wider stocked at that type, material and thickness; above the widest the row does not price",
    "Where unstated -- Solid, no cover, no floor cutting, no floor refilling, ceiling-mounted; a raceway is floor-mounted. This is on the AI's read; on the calculator you choose the installation",
    "Supply per metre -- (the tray x (1 - 'Cable tray discount') + the cover x (1 - 'Cable tray discount') when Cover is Yes + 'Cable tray ceiling accessories' when ceiling-mounted + 'Cable tray floor refilling' when Floor Refilling is Yes) x (1 + 'Cable tray supply markup'), rounded up to the rupee",
    "Install per metre -- The tray's install rate x (1 + 'Cable tray installation markup') + 'Cable tray floor cutting' x (1 + 'Cable tray floor-cutting installation markup') when Floor Cutting is Yes; not rounded",
  ],
  junction_box_raceway: [
    "Face size -- The face the BoQ states, the larger if the two differ; the depth does not matter. Matched exactly as stocked, so a face the catalogue does not stock, or a box with no face size, does not price",
    "Supply and install -- Supply = list price x (1 - 'Junction box discount') x (1 + 'Junction box supply markup'), rounded up to the next 10; install = the supply x 'Junction box installation share', rounded up to the next 10",
  ],
  lighting_mgmt_system: [
    "One catalogue item per row -- Picked by its Item and Brand; both must be filled (a blank Brand does not price); a row naming several items is not priced here",
    "Supply -- The catalogue rate x (1 + 'Lighting management system supply markup'), rounded up to the next 10; there is no install figure",
  ],
  miscellaneous: [
    "One catalogue item per row, by name -- A row naming several items is not priced here",
    "Supply and install -- The item's own BoQ supply and install rates, as they stand; no Pricing Input and no rounding",
  ],
};
const body = (l: { title: string; detail?: string }) => `${l.title} -- ${String(l.detail).replace(/ -- why: [\s\S]*$/, "")}`;

describe("ELR-4b AC2: the eight lists, exactly the lines the owner approved, in run order", () => {
  it("POSITIVE: every line, word for word (DB 9, industrial 8, earthing 3, conduit 3, tray 6, JB 2, LMS 2, misc 2)", () => {
    for (const id of EIGHT) expect(lines(cfg(id)).map(body), id).toEqual(APPROVED[id]);
    expect(EIGHT.reduce((n, id) => n + lines(cfg(id)).length, 0)).toBe(35);
  });

  it("every line ends with its reason -- the approved quote, or 'reason not recorded' -- and the P6 answer holds", () => {
    for (const id of EIGHT) {
      const ls = lines(cfg(id));
      expect(ls.map((l) => l.reason), id).toEqual(Object.values(DERIVATION_RULINGS[id]));
      for (const l of ls) expect(l.detail, `${id}: ${l.title}`).toBe(`${body(l).slice(l.title.length + 4)} -- why: ${l.reason}`);
    }
    // DB4 verbatim, typos included (owner: "DB4 keep verbatim")
    expect(DERIVATION_RULINGS.db_switchgear.db_pole).toBe("\"for any ploe + Neutral, should be matched withnext higher pole: SPN with DP, TPN with 4p ... we need to first match with SPN in catalog, if that is not there then we match with DP\" (owner, 2026-09-05)");
    // MI2 repeats MI1's quote in full (owner: "MI2 repeat MI1's quote in full on the tab")
    expect(DERIVATION_RULINGS.miscellaneous.mi_price).toBe(DERIVATION_RULINGS.miscellaneous.mi_item);
    expect(DERIVATION_RULINGS.miscellaneous.mi_price).toBe("\"the Misc block is SELF-CONTAINED -- its hardcoded rates ARE the BoQ rates\" (owner, 2026-07-29)");
    // Q5 a: LM2 names the Pricing Input where the ruling gave a figure
    expect(DERIVATION_RULINGS.lighting_mgmt_system.lm_supply).toContain("marked up by ['Lighting management system supply markup'] for BoQ");
    expect(DERIVATION_RULINGS.lighting_mgmt_system.lm_supply).not.toContain("1.3");
    // Q6 a: CT4's quote names "installation", never the field id
    expect(DERIVATION_RULINGS.cabletray_raceway.ct_defaults).toContain("installation Ceiling for cable tray");
    expect(DERIVATION_RULINGS.cabletray_raceway.ct_defaults).not.toContain("installation_type");
    // the raw ids the drafts carried are gone (R-RAW): DB9 "(owner-locked, F-17)", IS1 "(owner ruling A)"
    expect(DERIVATION_RULINGS.db_switchgear.db_install).toBe(NR);
    expect(DERIVATION_RULINGS.industrial_sockets.is_mcb).toBe(NR);
    // Q2 no: no extra earthing line
    expect(titles(cfg("earthing"))).toEqual(["The earthing item", "With Bus bar", "Supply and install"]);
  });

  it("NEGATIVE: no internal name, raw config rule id or snake_case token; no Pricing Input value or rupee figure (D8)", () => {
    for (const id of EIGHT) {
      const all = lines(cfg(id)).map((l) => `${l.title} ${l.detail}`).join("\n");
      expect(all, id).not.toMatch(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/);
      expect(all, id).not.toMatch(/\bR(2|3|4|7|8|11|12|13)\b|\bF-17\b/);
      expect(all, id).not.toMatch(/\(owner R1\)|owner ruling A|owner-locked/);
      expect(all, id).not.toMatch(/\bctx\b|from_attr|catalog_fit|component_ref|match_master_row|map_attribute/);
      expect(all, id).not.toMatch(/\b0\.\d+\b|%|\bRs\b|₹|\b(106|180|200|3,000)\b/);
    }
  });

  it("Pricing Inputs are named by their LABEL from the items, never their id: a renamed input follows", () => {
    const renamed = structuredClone(elec.items);
    for (const it of renamed) if ((it.attributes as Record<string, unknown> | undefined)?.item === "db_share") (it.attributes as Record<string, unknown>).name = "DB share, renamed";
    expect(lines(cfg("db_switchgear"), renamed).map((l) => l.detail).join("\n")).toContain("The rounded supply x 'DB share, renamed'");
    expect(lines(cfg("db_switchgear"), []).map((l) => l.detail).join("\n")).toContain("'db share'");
  });
});

describe("ELR-4b AC1: each line is written from its source -- delete the source and the line goes; change a value and it follows", () => {
  const without = (id: string, mutate: (c: Cfg) => Cfg, gone: string) => {
    const before = titles(cfg(id));
    const after = titles(mutate(cfg(id)));
    expect(before, `${id} before`).toContain(gone);
    expect(after, `${id} without the source of '${gone}'`).not.toContain(gone);
    expect(after.length, `${id}: only '${gone}' goes`).toBe(before.length - 1);
  };

  it("DB & switchgear: every line, each by its own source", () => {
    without("db_switchgear", (c) => { delete c.composite_slots!.repeatable.count; return c; }, "The DB is split into its parts");
    without("db_switchgear", (c) => dropRules(c, ["R2"]), "Board size");
    without("db_switchgear", (c) => { delete c.decomposition_rules!.amp; return c; }, "Breakers");
    without("db_switchgear", (c) => { delete c.composite_slots!.repeatable.values_from; return c; }, "Four-pole and SP+N breakers");
    without("db_switchgear", (c) => dropRules(c, ["R3", "R4"]), "RCCB / RCBO and ELCB");
    without("db_switchgear", (c) => dropRules(c, ["R8"]), "Outgoings per phase");
    without("db_switchgear", (c) => { c.extraction_defaults = {}; return c; }, "Quantities and missing parts");
    without("db_switchgear", (c) => dropSteps(c, (s) => s.step === "sum_components" && s.result === "supply"), "Supply");
    without("db_switchgear", (c) => dropSteps(c, (s) => s.step === "scale" && s.result === "install"), "Install");
  });

  it("industrial sockets: every line, each by its own source", () => {
    without("industrial_sockets", (c) => dropRules(c, ["R12"]), "Paired MCB");
    without("industrial_sockets", (c) => dropSteps(c, (s) => s.params?.result_attr === "mcb_pole_norm"), "MCB pole");
    without("industrial_sockets", (c) => dropSteps(c, (s) => s.params?.result_attr === "mcb_curve"), "MCB curve");
    without("industrial_sockets", (c) => { for (const s of steps(c)) if (s.step === "catalog_fit") s.params.direction = "down"; return c; }, "MCB rating");
    without("industrial_sockets", (c) => { for (const s of steps(c)) if (s.qty?.if_attr) s.qty = 1; return c; }, "Interlocked socket");
    without("industrial_sockets", (c) => { c.extraction_defaults = {}; return c; }, "Enclosure");
    without("industrial_sockets", (c) => dropSteps(c, (s) => s.name === "socket"), "Supply");
    without("industrial_sockets", (c) => dropSteps(c, (s) => s.step === "scale" && s.result === "install"), "Install");
  });

  it("earthing, conduit, junction box, lighting management and miscellaneous: every line, each by its own source", () => {
    without("earthing", (c) => { c.attribute_definitions = c.attribute_definitions.map((d) => d.id === "type" ? { ...d, values: d.values.filter((v: string) => v !== "Bus bar") } : d); return c; }, "The earthing item");
    without("earthing", (c) => { delete c.extraction_defaults!.with_busbar; return c; }, "With Bus bar");
    without("earthing", (c) => dropSteps(c, (s) => s.step === "scale" && s.result === "install"), "Supply and install");
    without("conduit_piping", (c) => { delete c.synonyms; return c; }, "Conduit type");
    without("conduit_piping", (c) => dropSteps(c, (s) => s.step === "scale" && s.result === "install_per_mtr"), "Supply and install");
    without("junction_box_raceway", (c) => dropRules(c, ["R11"]), "Face size");
    without("junction_box_raceway", (c) => dropSteps(c, (s) => s.step === "scale" && s.result === "install"), "Supply and install");
    without("lighting_mgmt_system", (c) => { c.matching_mode = "single"; return c; }, "One catalogue item per row");
    without("lighting_mgmt_system", (c) => dropSteps(c, (s) => s.step === "scale" && s.result === "supply"), "Supply");
    without("miscellaneous", (c) => dropSteps(c, (s) => s.step === "match_master_row"), "One catalogue item per row, by name");
    without("miscellaneous", (c) => dropSteps(c, (s) => s.target === "boq_install"), "Supply and install");
    // the conduit size line rides on the ladder: without it, the size line goes (and the type line, which reads the
    // same ladder's category as its own) -- the scratch demo of P3
    const c = dropSteps(cfg("conduit_piping"), (s) => s.step === "catalog_fit");
    expect(titles(c)).toEqual(["Supply and install"]);
  });

  it("cable tray: every line, each by its own source", () => {
    without("cabletray_raceway", (c) => dropRules(c, ["R7"]), "Material");
    without("cabletray_raceway", (c) => dropSteps(c, (s) => s.params?.from_attr === "thickness_swg"), "Thickness");
    without("cabletray_raceway", (c) => dropSteps(c, (s) => s.step === "catalog_fit"), "Width");
    without("cabletray_raceway", (c) => { c.extraction_defaults = {}; return c; }, "Where unstated");
    without("cabletray_raceway", (c) => dropSteps(c, (s) => s.name === "ceiling_accessories"), "Supply per metre");
    without("cabletray_raceway", (c) => dropSteps(c, (s) => s.name === "floor_cutting"), "Install per metre");
  });

  it("a clause goes with its own source; a value follows its source", () => {
    const t = (c: Cfg) => texts(c).join("\n");
    // the industrial pick-wins clause rides on prefer_attr; the silent clause on on_missing_fact
    const noPick = cfg("industrial_sockets");
    for (const s of steps(noPick)) if (s.step === "catalog_fit") delete s.params.prefer_attr;
    expect(t(noPick)).not.toContain("A Paired MCB you pick is used as picked");
    const loud = cfg("industrial_sockets");
    for (const s of steps(loud)) if (s.step === "catalog_fit") delete s.params.on_missing_fact;
    expect(t(loud)).not.toContain("with no note on screen");
    // the tray's "not fitted" clause rides on the width ladder reading the thickness
    const fitThk = cfg("cabletray_raceway");
    for (const s of steps(fitThk)) if (s.step === "catalog_fit") delete s.params.where.thickness_mm;
    expect(t(fitThk)).not.toContain("The thickness is not fitted");
    // values: the breaker count, the default quantity, the curve default, the inch table, the gauge example
    const db = cfg("db_switchgear");
    db.composite_slots!.repeatable.count = 4;
    for (const k of Object.keys(db.extraction_defaults!)) db.extraction_defaults![k] = 2;
    expect(t(db)).toContain("up to four breaker types");
    expect(t(db)).toContain("counts 2;");
    const ind = cfg("industrial_sockets");
    for (const s of steps(ind)) if (s.params?.result_attr === "mcb_curve") s.params.default = "B";
    expect(t(ind)).toContain("MCB curve -- As stated, else B");
    const cp = cfg("conduit_piping");
    cp.attribute_definitions.find((d) => d.id === "size_mm")!.inch_trade_mm = { "3/4": 20, "1": 25 };
    expect(t(cp)).toContain("read as its trade size (3/4\" = 20, 1\" = 25 mm)");
    const ct = cfg("cabletray_raceway");
    for (const s of steps(ct)) if (s.params?.from_attr === "thickness_swg") delete s.params.table["16"];
    expect(t(ct)).toContain("(0 gauge = 8.2 mm)");
  });

  it("the inch table is written in size order, not the JSON key order (integer-like keys sort first in JavaScript)", () => {
    const def = cfg("conduit_piping").attribute_definitions.find((d) => d.id === "size_mm")!;
    expect(Object.keys(def.inch_trade_mm)[0]).not.toBe("3/4");   // the trap: "1" and "2" come first
    expect(texts(cfg("conduit_piping"))[1]).toContain("(3/4\" = 20, 1\" = 25, 1 1/4\" = 32, 1 1/2\" = 40, 2\" = 50 mm)");
  });
});

describe("ELR-4b AC1: the words the owner approved as words are tied to the config and code that rule them", () => {
  it("the four-pole and SP+N families (DB4 / IS2) are exactly the industrial pole table's FP and DP words", () => {
    const tbl = steps(cfg("industrial_sockets")).find((s) => s.params?.result_attr === "mcb_pole_norm")!.params.table as Record<string, string>;
    const four = Object.keys(tbl).filter((k) => tbl[k] === "FP" && k !== "FP");
    const two = Object.keys(tbl).filter((k) => tbl[k] === "DP" && k !== "DP");
    const is2 = texts(cfg("industrial_sockets"))[1];
    for (const w of four) expect(is2, w).toContain(w);
    for (const w of two) expect(is2, w).toContain(w);
    expect(four.sort()).toEqual(["4P", "Four Pole", "TP+2N", "TP+2NL", "TP+N", "TP+NL", "TPN"]);
    expect(two.sort()).toEqual(["1P+N", "SP&N", "SP+N", "SP+NL", "SPN"]);
  });

  it("the breaker words (IS1) are R12's; the parts left out (DB1) are the partial-pricing rule's; the curve / amp words (DB3) are the resolution rules'", () => {
    const r12 = cfg("industrial_sockets").rules!.find((r) => r.id === "R12")!.guidance!;
    for (const w of ["MCCB", "RCBO", "RCCB", "ELCB", "circuit breaker"]) expect(r12, w).toContain(w);
    const partial = JSON.stringify(cfg("db_switchgear").decomposition_rules!.partial_pricing);
    for (const w of ["ATS", "bus bars", "MFM", "IP enclosures", "flexi DBs"]) expect(partial, w).toContain(w);
    const dr = cfg("db_switchgear").decomposition_rules!;
    expect(dr.amp.rule).toBe("exact_or_next_higher");
    expect(dr.amp.range).toBe("take_highest_first");
    expect(dr.curve.order).toEqual(["boq_stated", "ups_context_D", "default_C"]);
  });

  it("CODE RULES: each line tied to a code rule names a function that exists (a removal fails here)", () => {
    const py = fs.readFileSync(EXTRACTION, "utf8");
    for (const fn of ["breaker_catalog_for", "apply_pole_plus_neutral_ladder", "apply_inch_trade_size", "inch_trade_tables"]) {
      expect(py, fn).toMatch(new RegExp(`^def ${fn}\\(`, "m"));
    }
    // the pole ladder is driven by the composite's breaker catalogue, the inch corrector by the definition's table
    expect(py).toMatch(/"pole_catalog": breaker_catalog_for\(cfg, disc\) if is_composite else None/);
    // the wiring insulation line (WC-b) is the base prompt's rule, keyed on an ARMOURED / UNARMOURED definition
    expect(fs.readFileSync(PROMPT, "utf8")).toMatch(/a FLEXIBLE cable is UNARMOURED; and if NEITHER "armoured" nor\s+"unarmoured" is indicated anywhere/);
  });
});

// WAS (ELR-1 / ELR-4a, 544bf6fdc): wiring's thirteen lines, line for line as they stood before this slice
const WIRING_WAS = [
  "Every row shows both blocks, Cable and Termination -- a row whose description names a termination offers the Termination figure, any other row the Cable figure",
  "The cable and the termination are each matched in the catalogue -- on Material, Insulation, Core and Thickness (sqmm), exactly as the catalogue writes them",
  "Conduit included: the BoQ's answer -- where it cannot be judged, No",
  "Conduit type: the BoQ's answer, never assumed -- a row naming none prices no conduit",
  // ELR-5 (owner R-W7, "Q4 a"); WAS "Conduit size (mm): the size the BoQ states -- where a conduit type is named and no size, 25 mm"
  "Conduit size (mm) -- where a conduit type is named and no size, 25 mm",
  "Cable supply per metre = list price x (1 - discount) x (1 + supply markup), rounded up to the next 10 -- the discount and the markup from 'Armoured cable discount, supply markup & wastage' when Insulation is ARMOURED; 'Unarmoured cable discount, supply markup & wastage' when Insulation is UNARMOURED",
  "Parallel runs multiply the rounded supply -- Runs x the rounded supply rate",
  "Cable install per metre = install base x (1 + 'Cable installation markup'), rounded up to the rupee -- then x one install unit per 3 runs (1 to 3 runs = 1, 4 to 6 = 2, and so on)",
  "The conduit is priced as its own category prices it: list price x (1 - discount) x (1 + supply markup), from 'Conduit discount & supply markup', not rounded -- one conduit per row whatever the runs; only when Conduit included is Yes and a conduit type is named",
  "The conduit install = its supply x 'Conduit installation share', rounded up to the next 10",
  "Supply = the cable supply + the conduit supply, rounded up to the rupee -- install = the two install legs added, not rounded again",
  "Termination supply per set = the lug + the gland, each list price x (1 - discount) x (1 + supply markup), rounded up to the next 10, x runs -- the lug from 'Cable lug discount & supply markup'; the gland by Thickness (sqmm): below 35 the smaller one, from 35 the larger one, from 'Cable gland discount & supply markup'",
  "Termination install = its supply (already x runs) x 'Termination installation share', rounded up to the next 10 -- runs are not applied again",
];
const wbody = (l: { title: string; detail?: string }) => `${l.title} -- ${String(l.detail ?? "").replace(/ -- why: [\s\S]*$/, "").replace(/^why: [\s\S]*$/, "")}`.replace(/ -- $/, "");

describe("ELR-4b AC3: wiring's six corrections, exactly; every other wiring line byte-identical", () => {
  it("WAS 13 lines / NOW 15: WC-a, WC-d, WC-e, WC-f amended in place, WC-b / WC-c inserted after line 2 (R-W6: WC-f describes today)", () => {
    const now = lines(cfg("wiring_cabling")).map(wbody);
    expect(now.length).toBe(15);
    expect(now[0]).toBe(`${WIRING_WAS[0]}; the two figures are never added together`);
    expect(now[2]).toBe("Insulation: the BoQ's answer -- a flexible cable is unarmoured; where neither armoured nor unarmoured is stated on the row or its headings, unarmoured");
    expect(now[3]).toBe("Runs and cores: as the BoQ states them -- where no run count is stated, 1 run; where no core count is stated, 1 core");
    expect(now[5]).toBe(`${WIRING_WAS[3]}; a GI conduit is priced as MS`);
    expect(now[7]).toBe(`${WIRING_WAS[5]}; the wastage in those inputs is not applied to the BoQ rate`);
    expect(now[10]).toBe("The conduit is priced at its catalogue rate: list price x (1 - discount) x (1 + supply markup), from 'Conduit discount & supply markup', not rounded -- one conduit per row whatever the runs; only when Conduit included is Yes and a conduit type is named; at the size the BoQ states (it is not moved to the next stocked size, as the Conduit category does) -- a size not stocked for that type does not price");
    // NEGATIVE half kept: the WAS wording of line 9 is gone (it claimed the Conduit category's size fitting)
    expect(now.join("\n")).not.toContain("The conduit is priced as its own category prices it");
    // every other line: byte-identical to WAS (only its number moved, by the two inserted lines)
    for (const [wasIdx, nowIdx] of [[1, 1], [2, 4], [4, 6], [6, 8], [7, 9], [9, 11], [10, 12], [11, 13], [12, 14]]) expect(now[nowIdx], `WAS ${wasIdx + 1}`).toBe(WIRING_WAS[wasIdx]);
    // the reasons: only the conduit-type line's gains the GI quote; the two new lines carry theirs
    const ls = lines(cfg("wiring_cabling"));
    expect(ls[5].reason).toBe("\"dont use dfault for material type\" (owner, 2026-08-23); \"GI and MS are PRICE-INTERCHANGEABLE FOR CONDUITS ONLY\" (owner, 2026-07-29)");
    expect(ls[2].reason).toContain("the insulation DEFAULTS to UNARMOURED (not null)\" (owner, 2026-07-28)");
    expect(ls[3].reason).toContain("If a core count is not stated, record 1.\" (owner, 2026-08-05)");
  });

  it("each correction rides on its own source", () => {
    const t = (c: Cfg) => lines(c).map(wbody).join("\n");
    const noIns = cfg("wiring_cabling");
    noIns.attribute_definitions = noIns.attribute_definitions.map((d) => d.id === "insulation" ? { ...d, values: ["ARMOURED"] } : d);
    expect(t(noIns)).not.toContain("a flexible cable is unarmoured");
    expect(t(dropRules(cfg("wiring_cabling"), ["R10"]))).not.toContain("Runs and cores");
    const noSyn = cfg("wiring_cabling");
    delete noSyn.synonyms;
    expect(t(noSyn)).not.toContain("a GI conduit is priced as MS");
    const noWaste = structuredClone(elec.items);
    for (const it of noWaste) { const a = it.attributes as Record<string, unknown> | undefined; if (a && typeof a.name === "string") a.name = a.name.replace(/ & wastage/, ""); }
    expect(lines(cfg("wiring_cabling"), noWaste).map(wbody).join("\n")).not.toContain("the wastage in those inputs");
    // ELR-4d's change: a ladder on the conduit's size removes "at the size the BoQ states" (the line follows the code)
    const fitted = cfg("wiring_cabling");
    fitted.pipelines.cable_boq.steps.unshift({ step: "catalog_fit", params: { bind: "size_mm", direction: "up" } });
    expect(t(fitted)).not.toContain("at the size the BoQ states");
  });
});

describe("ELR-4b AC2: nothing else moves", () => {
  it("UNCHANGED: point wiring, switches & sockets and pop-up boxes keep their lines; only PB2 / PB6's quote loses '(owner R1)' (P6 Q1 yes)", () => {
    expect(lines(cfg("point_wiring")).length).toBe(14);
    expect(lines(cfg("switches_sockets")).length).toBe(7);
    const pb = lines(cfg("popup_boxes"));
    expect(pb.length).toBe(6);
    expect(pb[1].reason).toBe("\"the switch-socket module set now lives INSIDE this category and its price is ADDED to the box price\" (owner, 2026-08-21)");
    expect(pb[5].reason).toBe(pb[1].reason);
    // NEGATIVE half kept: the raw id is on no line of any Electrical tab
    for (const c of elec.category_configs) expect(lines(c).map((l) => l.detail).join("\n"), c.category_id).not.toContain("(owner R1)");
  });

  it("UNCHANGED: every HVAC category's builder output (the aliases list through the Electrical config on the tab, not here)", () => {
    for (const c of hvac.category_configs) expect(attributeRuleOrder(c, hvac.items), c.category_id).toEqual([]);
  });
});
