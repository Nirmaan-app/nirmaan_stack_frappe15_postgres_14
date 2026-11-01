// ELR-1 AC2 (owner R-NOTES-RULE: a note is required on a field that is TYPED, RENDERS and is MANDATORY; R-SCOPE (5)
// "the validator then enforces notes for Electrical"; R-NOTE A, 2026-10-27 23:00): the audit's ATTRIBUTE branch.
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { readJsonFixture } from "@/pages/pricing/calculatorPanelParity.harness";
import type { RateCategoryConfig, RateMasterItem } from "@/pages/pricing/rate-master/rateMasterTypes";
import { auditPanelFields, missingNotes } from "./panelFieldAudit";
import { makePricingSheetHelper } from "./pricingSheetHelper";
import { isSuggestion } from "./rateHelperTypes";

const DATA = path.resolve(__dirname, "../../../../../nirmaan_stack/services/boq_rate_master/data");
// the asset whose notes this file pins, NAMED. ELR-2: WAS v67 (ELR-1's Runs note); NOW v68 (the 28 notes, AC3)
const asset = readJsonFixture<never>(pathToFileURL(path.join(DATA, "rate_master_electrical_all_v68.json"))) as
  { items: RateMasterItem[]; category_configs: RateCategoryConfig[] };
const items: RateMasterItem[] = asset.items.map((i) => ({ ...i, discipline: "Electrical" }));
const cfgOf = (id: string): RateCategoryConfig => structuredClone(asset.category_configs.find((c) => c.category_id === id)!);

const RUNS_NOTE = "How many parallel runs of this cable the row needs, e.g. 2 runs of 4C x 95 sqmm. Leave 1 if the BoQ names a single run.";

/**
 * THE NAMED EXPECTED-MISSING LIST (owner AC2 (c)), INVERTED BY ELR-2 (AC3, mechanical authority -- this slice's own ruling).
 * WAS: 28 named fields with no note yet (point_wiring 8, db_switchgear 7, popup_boxes 7, switches_sockets 6), a list
 * that could only shrink. NOW: EMPTY -- every typed + rendered + mandatory field of EVERY Electrical category carries
 * its note, and the audit refuses any that loses one (the negative halves below).
 */
const EXPECTED_MISSING: Record<string, string[]> = {};

/** ELR-2 AC3: the owner-approved notes, EXACTLY (the Phase A answer, 2026-10-28; note 10 and the 13:41 amendment's notes 8 / 9
 * in the owner's words). */
const MCB = "How many of this breaker the DB holds in total, e.g. 30 for 10 per phase on a TPN DB. Leave 1 if the BoQ names the breaker without a count.";
const POP_SOCK = "How many of this socket sit in the box, e.g. 2 for two 6/16A sockets. Leave 1 if the BoQ names the socket without a count.";
const SW_SOCK = "How many of this socket the board carries, e.g. 2 for two 6A sockets; the plate size follows the switches and sockets. Leave 1 if the BoQ names the socket without a count.";
const APPROVED_NOTES: Record<string, Record<string, string>> = {
  db_switchgear: {
    db_shell_qty: 'How many DBs of this type the row supplies, e.g. 2 for "2 Nos 8-way SPN DB". Leave 1 if the BoQ names a single DB.',
    mcb1_qty: MCB, mcb2_qty: MCB, mcb3_qty: MCB, mcb4_qty: MCB, mcb5_qty: MCB,
    enclosure_qty: 'How many separate enclosure boxes the row supplies, e.g. 2 for "2 Nos MCB enclosure box". Leave 1 if the BoQ names one enclosure.',
  },
  point_wiring: {
    wire1_runs: "How many runs of this wire the point carries, e.g. 3 for '3R x 1.5 sqmm'. Point wiring is always three conductors in total: if the BoQ gives one bare size, enter 3; if it gives two sizes, the larger wire takes 2 runs and the other takes 1.",
    wire2_runs: "How many runs of the second wire the point carries, usually 1, e.g. the earth in '2 x 1.5 + 1.5 earth'. Wire 1 and wire 2 together must make three conductors.",
    points: "How many points this row's rate covers, e.g. 3. With no length on the BoQ, the wire length is worked out from the number of points. Leave 1 if the BoQ names a single point.",
    // notes 11 / 12: derived from the owner's 8 / 9 pattern (13:41 amendment) -- the conductor floor covers the circuit wires
    circuit_wire1_runs: "How many runs of the circuit wire from the DB the row carries, e.g. 3 for '3R x 6 sqmm'. The circuit is always three conductors in total: if the BoQ gives one bare size, enter 3; if it gives two sizes, the larger wire takes 2 runs and the other takes 1.",
    circuit_wire2_runs: "How many runs of the second circuit wire the row carries, usually 1, e.g. the earth in '2 x 6 + 6 earth'. Circuit wire 1 and circuit wire 2 together must make three conductors.",
    switch_qty: "How many switches the point carries, e.g. 2 for two 1-way switches; the plate size follows the switches and sockets. Leave 1 if the BoQ names the switch without a count.",
    socket_qty: "How many sockets the point carries, e.g. 2 for two 6/16A sockets; the plate size follows the switches and sockets. Leave 1 if the BoQ names the socket without a count.",
    plate_qty: "How many face plates the point needs, e.g. 1 plate for a switch and a socket together. Leave 1 if the BoQ names the plate without a count.",
  },
  popup_boxes: {
    module_count: "How many modules the pop-up box holds, e.g. 8 for an 8-module floor box. The box itself is priced per module.",
    switch_qty: "How many switches sit in the box, e.g. 2 for two 16A switches. Leave 1 if the BoQ names the switch without a count.",
    socket1_qty: POP_SOCK, socket2_qty: POP_SOCK, socket3_qty: POP_SOCK, socket4_qty: POP_SOCK,
    plate_qty: "How many face plates the box needs, e.g. 1 plate covering all its modules. Leave 1 if the BoQ names the plate without a count.",
  },
  switches_sockets: {
    switch_qty: "How many switches the board carries, e.g. 2 for two 1-way switches; the plate size follows the switches and sockets. Leave 1 if the BoQ names the switch without a count.",
    socket1_qty: SW_SOCK, socket2_qty: SW_SOCK, socket3_qty: SW_SOCK, socket4_qty: SW_SOCK,
    plate_qty: "How many face plates the board needs, e.g. 1 plate for a switch and two sockets. Leave 1 if the BoQ names the plate without a count.",
  },
};

describe("ELR-1 AC2: the field audit measures Electrical (the attribute branch)", () => {
  it("every Electrical category: NO field missing a note -- ENFORCED for all of them (ELR-2: WAS the 28 named, NOW 0)", () => {
    const got: Record<string, string[]> = {};
    for (const c of asset.category_configs) {
      const m = missingNotes(c, items);
      if (m.length) got[c.category_id] = m;
    }
    expect(got).toEqual(EXPECTED_MISSING);
    expect(Object.values(EXPECTED_MISSING).flat().length).toBe(0);
  });

  it("ELR-2 AC3: the 28 fields carry the owner-approved text EXACTLY, and each is a field the audit asks a note of", () => {
    expect(Object.values(APPROVED_NOTES).flatMap((m) => Object.keys(m)).length).toBe(28);
    for (const [cid, notes] of Object.entries(APPROVED_NOTES)) {
      const audit = auditPanelFields(cfgOf(cid), items);
      for (const [attr, text] of Object.entries(notes)) {
        const f = audit.find((x) => x.attr === attr)!;
        expect([f.typed, f.renders, f.mandatory, f.needsNote], `${cid}.${attr}`).toEqual([true, true, true, true]);
        expect(f.note, `${cid}.${attr}`).toBe(text);
      }
    }
  });

  it("ELR-2 NEGATIVE (ENFORCED on every category that gained notes): a config losing one note is refused, naming it", () => {
    for (const [cid, attr] of [["db_switchgear", "mcb3_qty"], ["point_wiring", "points"], ["popup_boxes", "module_count"], ["switches_sockets", "plate_qty"]]) {
      const cfg = cfgOf(cid);
      delete (cfg.attribute_definitions.find((d) => d.id === attr) as { note?: string }).note;
      expect(missingNotes(cfg, items), cid).toEqual([attr]);
    }
  });

  it("ELR-2 AC3: the panel (a stored row) and the calculator (no row) both show each of the 28 notes under its field", () => {
    const configs = new Map(asset.category_configs.map((c) => [c.category_id, c]));
    for (const [cid, notes] of Object.entries(APPROVED_NOTES)) {
      const stored = Object.fromEntries(Object.keys(notes).map((a) => [a, { value: 1, confidence: 1 }]));
      for (const ext of [stored, undefined]) {
        const r = makePricingSheetHelper({ configsByCategory: configs, items,
          extractionByRow: new Map(ext ? [[3, { excelRow: 3, description: "", attributes: ext }]] : []) } as never)
          .compute({ excelRow: 3, description: "", nodeType: "Line Item", category: cid, discipline: "Electrical", rateKinds: [] } as never);
        if (!isSuggestion(r)) throw new Error(`${cid}: no suggestion`);
        const shown = Object.fromEntries(r.workings.attributes.filter((a) => a.typedNote).map((a) => [a.id, a.typedNote]));
        expect(shown, `${cid} ${ext ? "panel" : "calculator"}`).toEqual(notes);
      }
    }
  });

  it("wiring_cabling 'Runs': typed, rendered, mandatory -- and carries the R-NOTE A text", () => {
    const runs = auditPanelFields(cfgOf("wiring_cabling"), items).find((f) => f.attr === "runs")!;
    expect([runs.typed, runs.renders, runs.mandatory, runs.needsNote]).toEqual([true, true, true, true]);
    expect(runs.note).toBe(RUNS_NOTE);
  });

  it("NEGATIVE (ENFORCED): the same config without the note is refused, naming the field", () => {
    const cfg = cfgOf("wiring_cabling");
    delete (cfg.attribute_definitions.find((d) => d.id === "runs") as { note?: string }).note;
    expect(missingNotes(cfg, items)).toEqual(["runs"]);
  });

  it("each property both ways, from the product: a dropdown needs no note; a field made optional needs none", () => {
    const cfg = cfgOf("wiring_cabling");
    // TYPED: Material is a dropdown -- rendered and mandatory, no note asked
    const material = auditPanelFields(cfg, items).find((f) => f.attr === "material")!;
    expect([material.typed, material.mandatory, material.needsNote]).toEqual([false, true, false]);
    // MANDATORY: point_wiring's circuit length is typed and optional (a derived default fills it) -- no note asked
    const pw = auditPanelFields(cfgOf("point_wiring"), items);
    const optionalTyped = pw.filter((f) => f.typed && !f.mandatory).map((f) => f.attr);
    expect(optionalTyped.length).toBeGreaterThan(0);
    for (const a of optionalTyped) expect(pw.find((f) => f.attr === a)!.needsNote, a).toBe(false);
  });

  it("the audit names no attribute, category or discipline: the module source carries none", () => {
    const src = fs.readFileSync(path.join(__dirname, "panelFieldAudit.ts"), "utf-8");
    const code = src.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
    for (const banned of ["runs", "wiring", "Electrical", "plate_qty", "hvac_"]) expect(code, banned).not.toContain(banned);
  });
});

describe("ELR-1 AC2 (a): the attribute path carries the definition's note to the panel (and the calculator)", () => {
  const helper = (cfg: RateCategoryConfig, ext?: Record<string, { value: string | null; confidence: number }>) =>
    makePricingSheetHelper({
      configsByCategory: new Map(asset.category_configs.map((c) => [c.category_id, c])),
      items, extractionByRow: new Map(ext ? [[9, { excelRow: 9, description: "4C x 95 sqmm armoured copper cable", attributes: ext }]] : []),
    } as never).compute({ excelRow: 9, description: "4C x 95 sqmm armoured copper cable", nodeType: "Line Item",
      category: cfg.category_id, discipline: "Electrical", rateKinds: [] } as never);

  it("a BoQ row (stored answers) and the calculator (no row) both show Runs with its note; no other field has one", () => {
    for (const ext of [{ runs: { value: "2", confidence: 1 } }, undefined]) {
      const r = helper(cfgOf("wiring_cabling"), ext);
      if (!isSuggestion(r)) throw new Error("no suggestion");
      const noted = r.workings.attributes.filter((a) => a.typedNote).map((a) => [a.id, a.typedNote]);
      expect(noted).toEqual([["runs", RUNS_NOTE]]);
    }
  });

  it("HVAC Cables (an alias of wiring) reads wiring's config, so its Runs carries the same note", () => {
    const configs = new Map(asset.category_configs.map((c) => [c.category_id, c] as [string, RateCategoryConfig]));
    configs.set("hvac_cables", { category_id: "hvac_cables", discipline: "HVAC", alias_of: { discipline: "Electrical", category_id: "wiring_cabling" },
      attribute_definitions: [], pipelines: {} } as never);
    const r = makePricingSheetHelper({ configsByCategory: configs, items, extractionByRow: new Map() } as never)
      .compute({ excelRow: 1, description: "", nodeType: "Line Item", category: "hvac_cables", discipline: "HVAC", rateKinds: [] } as never);
    if (!isSuggestion(r)) throw new Error("no suggestion");
    expect(r.workings.attributes.find((a) => a.id === "runs")?.typedNote).toBe(RUNS_NOTE);
  });

  it("the panel draws it in the item-list path's own box and style (one class, two call sites)", () => {
    const src = fs.readFileSync(path.join(__dirname, "RateHelperPanel.tsx"), "utf-8");
    expect(src).toContain('{a.typedNote && <p className={TYPED_NOTE_CLASS} data-testid="attribute-typed-note">{a.typedNote}</p>}');
    expect(src).toContain("{f.typedNote && <p className={TYPED_NOTE_CLASS}>{f.typedNote}</p>}");
    expect(src).toContain('export const TYPED_NOTE_CLASS = "text-[10px] leading-tight opacity-90";');
  });
});
