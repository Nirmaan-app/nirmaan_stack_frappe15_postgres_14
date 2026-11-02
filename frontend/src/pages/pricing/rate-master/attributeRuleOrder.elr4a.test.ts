// ELR-4a AC1 / AC2 / AC3 / AC7 (owner R-DERIV 2026-09-27; R-APPROVE 2026-10-29 "option b" and the P6 answer; R-Q4):
// the rules lists of point wiring, switches & sockets and pop-up boxes, written from their config.
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { readJsonFixture } from "@/pages/pricing/calculatorPanelParity.harness";
import { DERIVATION_RULINGS, attributeRuleOrder, type RuleOrderItem } from "./itemListRuleOrder";

const DATA = path.resolve(__dirname, "../../../../../nirmaan_stack/services/boq_rate_master/data");
const EXTRACTION = path.resolve(__dirname, "../../../../../nirmaan_stack/services/boq_rate_master/extraction.py");
type Step = Record<string, any>;
type Cfg = { category_id: string; pipelines: Record<string, { steps: Step[] }>; attribute_definitions: Array<Record<string, any>>;
  extraction_defaults: Record<string, any>; rules?: Array<{ id: string }> };
type AssetFile = { items: RuleOrderItem[]; category_configs: Cfg[] };
// READ, never imported (tsc and a whole asset); the asset named -- v69 is the live config the lines were approved on
const elec = readJsonFixture<AssetFile>(pathToFileURL(path.join(DATA, "rate_master_electrical_all_v69.json")));
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

const PW = ["The wires", "Three conductors", "Points covered", "Switch", "Quantities left blank", "Back box and colour", "Circuit length",
  "Conduit included", "Conduit type", "Circuit wiring", "Conduit size and length", "Plate, back box and blanks", "Supply", "Install"];
const SS = ["Switch", "Back box size (a bare box)", "Quantities left blank", "Back box and colour", "Plate, back box and blanks", "Supply", "Install"];
const PB = ["Includes modules", "The box", "Quantities left blank", "The plate and blanks", "The modules' price", "Totals"];

describe("ELR-4a AC2: the three lists, exactly the lines the owner approved, in run order", () => {
  it("POSITIVE: point wiring 14, switches & sockets 7, pop-up boxes 6 -- titles in order", () => {
    expect(titles(cfg("point_wiring"))).toEqual(PW);
    expect(titles(cfg("switches_sockets"))).toEqual(SS);
    expect(titles(cfg("popup_boxes"))).toEqual(PB);
  });

  it("the approved words, with the Pricing Inputs by their labels (a sample of every shape)", () => {
    const pw = texts(cfg("point_wiring"));
    expect(pw[6]).toBe("Circuit length -- The length the BoQ states. Otherwise: a row naming only a first or primary point takes 'Point wiring - circuit length of the first point'; a row naming only secondary, looped or further points takes 'Point wiring - circuit length per further point', or n times it when the row names n such points; otherwise the first point's length + 'Point wiring - circuit length per further point' for every additional point. The point type is read by code from the row and its headings. -- why: " + DERIVATION_RULINGS.point_wiring.length);
    expect(pw[10]).toContain("fits the smallest of 25, 32 and 50 mm whose usable share holds it. The shares are 'Conduit fill - PVC 25 mm', 'Conduit fill - PVC 32 mm' and 'Conduit fill - PVC 50 mm', or the three 'Conduit fill - MS ...' inputs for an MS conduit.");
    expect(pw[10]).toContain("If even 50 mm cannot hold the wires, the row does not price.");
    expect(pw[11]).toContain("a socket counts 2 modules and a switch 1;");
    expect(pw[11]).toContain("with nothing on the board, a 3-module back box and no plate; each spare module on the plate gets a '1M Blanker'; \"Blank plate qty\" can lower that count but never raise it above the spare.");
    expect(pw[12]).toContain("from 'Unarmoured cable discount, supply markup & wastage' (the wastage is not applied)");
    expect(pw[13]).toContain("x (1 + 'Cable installation markup') x one install unit per 3 runs");
    expect(pw[13]).toContain("the switch & socket discounted rate x 'Point wiring accessory installation share', rounded once.");
    expect(pw[9]).toContain("priced over 'Point wiring - circuit wiring stretch, DB to the first point' (a stretch you type is kept)");
    const ss = texts(cfg("switches_sockets"));
    expect(ss[1]).toContain("With none readable, the box is 3 modules, shown as assumed. Where the BoQ writes a range such as '9/8M', the box takes whatever count the AI read; the \"higher of a range\" rule is not applied today.");
    expect(ss[4]).toContain("each switch and socket counts its own module width;");
    expect(ss[4]).toContain("with nothing on the board, see line 2;");
    expect(ss[5]).toBe("Supply -- The parts' list prices added, x (1 - discount) x (1 + supply markup) from 'Switch & socket discount & supply markup', rounded up to the next 10. -- why: reason not recorded");
    const pb = texts(cfg("popup_boxes"));
    expect(pb[1]).toContain("x the \"Module count\".");
    expect(pb[3]).toContain("There is no back box: the pop-up box is the enclosure.");
    expect(pb[4]).toContain("Install = that x 'Pop-up box module installation share', rounded up to the next 10.");
  });

  it("every line ends with its reason -- the approved quote, or 'reason not recorded' -- and the owner's three P6 edits hold", () => {
    for (const id of ["point_wiring", "switches_sockets", "popup_boxes"]) {
      const ls = lines(cfg(id));
      const table = DERIVATION_RULINGS[id];
      expect(ls.map((l) => l.reason), id).toEqual(Object.values(table));
      for (const l of ls) expect(l.detail, `${id}: ${l.title}`).toMatch(/ -- why: (.*\(owner[^)]*\d{4}-\d{2}-\d{2}[^)]*\)|.*reason not recorded)/);
    }
    expect(lines(cfg("point_wiring")).filter((l) => l.reason === "reason not recorded").map((l) => l.n)).toEqual([6, 11, 12, 13]);
    // PW7: no figures in the reason, the inputs named in their place (owner edit)
    expect(DERIVATION_RULINGS.point_wiring.length).toContain("then length will be ['Point wiring - circuit length of the first point']");
    expect(DERIVATION_RULINGS.point_wiring.length).not.toMatch(/\b(15|5) mts\b/);
    // PW12: no plain-words quote recorded -> "reason not recorded", no internal name (owner edit)
    expect(DERIVATION_RULINGS.point_wiring.plate).toBe("reason not recorded");
    // SS2 (owner edit)
    expect(DERIVATION_RULINGS.switches_sockets.bare_box).toBe("\"extraction should provide the higher count\" (owner, 2026-09-08); ranges: accepted as built, the higher-count rule not applied today (owner, 2026-09-08); the mm-only rows at 3M: \"this is ok\" (owner, 2026-09-07)");
  });

  it("AC3 (f): each 'Quantities left blank' line says clearing a 'None' plate means it is worked out, or asked on an empty box", () => {
    for (const id of ["point_wiring", "switches_sockets", "popup_boxes"]) {
      const q = lines(cfg(id)).find((l) => l.title === "Quantities left blank")!;
      expect(q.detail, id).toMatch(/Clearing a "None" plate means "work it out": the plate is computed, or, (where the board holds nothing|on an empty box), "Plate qty" is asked\./);
    }
  });

  it("NEGATIVE: no internal name, raw config rule id or snake_case token; no Pricing Input value (D8)", () => {
    for (const id of ["point_wiring", "switches_sockets", "popup_boxes"]) {
      const all = lines(cfg(id)).map((l) => `${l.title} ${l.detail}`).join("\n");
      expect(all, id).not.toMatch(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/);
      expect(all, id).not.toMatch(/\b(R9|R12|R13|S[1-4]|P1)\b/);
      expect(all, id).not.toMatch(/\bctx\b|from_attr|on_zero|module_fit|circuit_fit|component_ref/);
      expect(all, id).not.toMatch(/\b0\.\d+\b|\b(15|30)\s*(m|mts)\b|₹/);
    }
  });
});

describe("ELR-4a AC1: each line is written from its source -- delete the source and the line goes; change a value and it follows", () => {
  const without = (id: string, mutate: (c: Cfg) => Cfg, gone: string) => {
    const before = titles(cfg(id));
    const after = titles(mutate(cfg(id)));
    expect(before, `${id} before`).toContain(gone);
    expect(after, `${id} without the source of '${gone}'`).not.toContain(gone);
  };

  it("point wiring: every line, each by its own source", () => {
    without("point_wiring", (c) => dropRules(c, ["R9"]), "The wires");
    without("point_wiring", (c) => { c.attribute_definitions.forEach((d) => delete d.conductor_floor); return c; }, "Three conductors");
    without("point_wiring", (c) => { delete c.extraction_defaults.points; return c; }, "Points covered");
    without("point_wiring", (c) => dropRules(c, ["S1", "S2", "S3"]), "Switch");
    without("point_wiring", (c) => { for (const k of Object.keys(c.extraction_defaults)) if (c.extraction_defaults[k]?.requires_named) delete c.extraction_defaults[k]; return c; }, "Quantities left blank");
    without("point_wiring", (c) => { delete c.extraction_defaults.back_box; return c; }, "Back box and colour");
    without("point_wiring", (c) => dropSteps(c, (s) => s.step === "derive_attribute"), "Circuit length");
    without("point_wiring", (c) => dropSteps(c, (s) => s.params?.from_attr === "conduit_handoff"), "Conduit included");
    without("point_wiring", (c) => dropSteps(c, (s) => s.params?.result_attr === "conduit_type" && !s.params?.from_attr), "Conduit type");
    without("point_wiring", (c) => dropSteps(c, (s) => !!s.params?.default_from_ctx), "Circuit wiring");
    without("point_wiring", (c) => dropSteps(c, (s) => s.step === "circuit_fit"), "Conduit size and length");
    without("point_wiring", (c) => dropSteps(c, (s) => s.step === "module_fit"), "Plate, back box and blanks");
    without("point_wiring", (c) => dropSteps(c, (s) => s.step === "sum_components" && s.result === "supply"), "Supply");
    without("point_wiring", (c) => dropSteps(c, (s) => s.step === "sum_components" && s.result === "install"), "Install");
  });

  it("switches & sockets and pop-up boxes: every line, each by its own source", () => {
    without("switches_sockets", (c) => dropRules(c, ["S1", "S2", "S3"]), "Switch");
    without("switches_sockets", (c) => dropRules(c, ["S4"]), "Back box size (a bare box)");
    without("switches_sockets", (c) => { for (const k of Object.keys(c.extraction_defaults)) if (c.extraction_defaults[k]?.requires_named) delete c.extraction_defaults[k]; return c; }, "Quantities left blank");
    without("switches_sockets", (c) => { delete c.extraction_defaults.colour; return c; }, "Back box and colour");
    without("switches_sockets", (c) => dropSteps(c, (s) => s.step === "module_fit"), "Plate, back box and blanks");
    without("switches_sockets", (c) => dropSteps(c, (s) => s.step === "roundup" && s.target === "supply"), "Supply");
    without("switches_sockets", (c) => dropSteps(c, (s) => s.step === "roundup" && s.target === "install"), "Install");
    without("popup_boxes", (c) => dropRules(c, ["P1"]), "Includes modules");
    without("popup_boxes", (c) => dropSteps(c, (s) => s.step === "match_master_row"), "The box");
    without("popup_boxes", (c) => { for (const k of Object.keys(c.extraction_defaults)) if (c.extraction_defaults[k]?.requires_named) delete c.extraction_defaults[k]; return c; }, "Quantities left blank");
    without("popup_boxes", (c) => dropSteps(c, (s) => s.step === "module_fit"), "The plate and blanks");
    without("popup_boxes", (c) => dropSteps(c, (s) => s.result === "module_supply"), "The modules' price");
    without("popup_boxes", (c) => dropSteps(c, (s) => !!s.params?.modules_from_ctx), "Totals");
  });

  it("a clause goes with its own step: the 'normal conduit named elsewhere' map, the secondary exclusion, the n-times reader", () => {
    const t = (c: Cfg) => texts(c).join("\n");
    expect(t(cfg("point_wiring"))).toContain("a normal conduit named elsewhere on the row -> included");
    expect(t(dropSteps(cfg("point_wiring"), (s) => s.params?.from_attr === "other_conduit"))).not.toContain("a normal conduit named elsewhere");
    expect(t(dropSteps(cfg("point_wiring"), (s) => s.params?.from_attr === "point_type" && s.params?.result_attr === "circuit_qty_m"))).not.toContain("never charged on a secondary-point row");
    const noType = cfg("point_wiring");
    noType.attribute_definitions = noType.attribute_definitions.filter((d) => d.id !== "point_type");
    expect(t(noType)).not.toContain("n times it");
  });

  it("the values are the config's own: sizes, the zero-module box, the default count, the Pricing Input names", () => {
    const c = cfg("point_wiring");
    for (const s of steps(c)) if (s.step === "circuit_fit") s.params.sizes = [20, 32, 50];
    for (const s of steps(c)) if (s.step === "module_fit") s.params.ladders.forEach((L: Record<string, unknown>) => { if (L.on_zero_modules) L.on_zero_modules = 4; });
    c.extraction_defaults.points = 2;
    const t = texts(c).join("\n");
    expect(t).toContain("fits the smallest of 20, 32 and 50 mm");
    expect(t).toContain("a 4-module back box");
    expect(t).toContain("where none is stated, 2.");
    const renamed = structuredClone(elec.items);
    for (const it of renamed) if ((it.attributes as Record<string, unknown> | undefined)?.item === "pw_circuit_stretch") (it.attributes as Record<string, unknown>).name = "Stretch, renamed";
    expect(lines(cfg("point_wiring"), renamed).map((l) => l.detail).join("\n")).toContain("priced over 'Stretch, renamed'");
  });

  it("CODE RULES: each line tied to a code rule names a function that exists in extraction.py (a removal fails here)", () => {
    const py = fs.readFileSync(EXTRACTION, "utf8");
    for (const fn of ["apply_conductor_floor", "point_type_of", "secondary_length_m", "fill_paired_slot_defaults", "force_absent_dependents"]) {
      expect(py, fn).toMatch(new RegExp(`^def ${fn}\\(`, "m"));
    }
  });
});

describe("ELR-4a AC2: nothing else moves", () => {
  // ELR-4b (owner P6, 2026-10-29) INVERTED: WAS wiring 13 lines and the other eight Electrical categories []; NOW wiring
  // 15 (WC-b / WC-c inserted) and the other eight list their own rules (attributeRuleOrder.elr4b.test.ts); only the
  // Pricing Inputs category stays without a list. Every HVAC category: unchanged.
  it("UNCHANGED: every HVAC category; Electrical as ELR-4b ruled (wiring 15, the other eight listed, the Pricing Inputs none)", () => {
    expect(lines(cfg("wiring_cabling")).length).toBe(15);
    for (const c of elec.category_configs) {
      if (["wiring_cabling", "point_wiring", "switches_sockets", "popup_boxes"].includes(c.category_id)) continue;
      if (c.category_id === "electrical_pricing_inputs") expect(lines(c), c.category_id).toEqual([]);
      else expect(lines(c).length, c.category_id).toBeGreaterThan(0);
    }
    for (const c of hvac.category_configs) expect(attributeRuleOrder(c, hvac.items), c.category_id).toEqual([]);
  });
});

describe("ELR-4a AC5: the live asset v70 (wording only) lists the same lines", () => {
  it("v70 gives line for line what v69 gives, on all thirteen categories", () => {
    const v70 = readJsonFixture<AssetFile>(pathToFileURL(path.join(DATA, "rate_master_electrical_all_v70.json")));
    for (const c of elec.category_configs) {
      const live = v70.category_configs.find((x) => x.category_id === c.category_id)!;
      expect(attributeRuleOrder(live, v70.items), c.category_id).toEqual(lines(c));
    }
  });
});
