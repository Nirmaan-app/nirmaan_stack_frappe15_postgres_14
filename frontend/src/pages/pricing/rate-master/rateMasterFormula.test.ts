// SLICE 12a -- THE CROSS-LANGUAGE PIN for the derived-cost marking and the two formula surfaces.
//
// The rate FILE is built server-side (`services/boq_rate_master/csv_exporter.py`) and the Rate Master
// SCREEN renders the same text client-side (`rateMasterSpec.ts`), because the screen cannot call an
// exporter for one cell. That is a DELIBERATE duplication -- the precedent is `isRowQtyBearing` /
// `node_is_qty_bearing` -- and this file is the mechanism that stops the two drifting: every literal
// below also appears, character for character, in `test_rate_master.TestFormulaExplanations`, which
// asserts the PYTHON renderer produces it from the SAME fixture. Change one side without the other
// and one of the two suites goes red.
//
// ⚠️ THE FIXTURE ITSELF IS PART OF THE PIN. Keep `FORMULA_FIXTURE` identical to the Python copy; a
// quiet edit to one config here would make both suites green about different things.
import { describe, expect, it } from "vitest";
import {
  BOQ_RATE_NOTE,
  FORMULA_COLUMNS,
  FORMULA_TYPED,
  baseWording,
  columnNote,
  derivedCells,
  derivedCountsByKey,
  formatNum,
  isDerivedCell,
  rowFormula,
  sideOfRateKey,
} from "./rateMasterSpec";
import type { RateCategoryConfig, RateMasterItem } from "./rateMasterTypes";

// ── the shared fixture (mirrored in test_rate_master.FORMULA_FIXTURE) ─────────────────────────────

const CFG = {
  discipline: "HVAC",
  category_id: "fixture_cat",
  category_display: "Fixture",
  item_kinds: ["fixture_item"],
  attribute_definitions: [
    { id: "item", label: "Item", type: "choice", values: ["Nitrile", "PUF"] },
    { id: "cladding", label: "Cladding", type: "choice", values: ["No", "26G Aluminium"] },
    { id: "thickness_mm", label: "Thickness", type: "number_choice", values: [13, 19] },
  ],
  pipelines: {
    fx_boq: {
      output: ["supply"],
      steps: [
        { step: "match_master_row", params: { kind: "fixture_item" } },
        {
          step: "scale", target: "cost_insulation", result: "supply",
          params: { m_from_ctx: "supply_markup" }, formula: "base*(1+m)",
          explain: "supply: cost x (1 + markup)",
        },
        { step: "roundup", target: "supply", params: { digits: 0 } },
      ],
    },
    // db_switchgear's shape: a step with NEITHER a formula NOR an explain.
    fx_assembly: {
      output: ["supply"],
      steps: [
        { step: "component_ref", target: "cost_adhesive", ref: { kind: "fixture_item", cladding: "No" } },
        // wiring_cabling's shape: a `component_band` names its targets inside `bands[*].target`.
        {
          step: "component_band", band_on: "thickness_mm", formula: "cost_cladding*2",
          bands: [{ when: "<35", target: "cost_install_cladding" }],
        },
        { step: "sum_components", result: "supply" },
      ],
    },
  },
  rate_composition: {
    supply: {
      parts: ["cost_insulation", "cost_adhesive", "cost_cladding"],
      wastage_key: "wastage", markup_key: "supply_markup", roundup: 0,
    },
    install: {
      parts: ["cost_install_insulation", "cost_install_cladding"],
      markup_key: "install_markup", roundup: 0,
    },
  },
  derived_rates: {
    "rmi-clad0000001": {
      cost_insulation: [
        { from: { item_uid: "rmi-bare0000001", rate_key: "cost_insulation" }, multiplier: 1, constant: 0 },
      ],
      cost_cladding: [
        { from: { item_uid: "rmi-bare0000001", rate_key: "cost_cladding" }, multiplier: 1, constant: 132.46875 },
      ],
    },
  },
} as unknown as RateCategoryConfig;

const BARE = {
  item_uid: "rmi-bare0000001", discipline: "HVAC", kind: "fixture_item", unit: "Mts",
  attributes: { item: "Nitrile", cladding: "No", thickness_mm: 13 },
  rates: {
    cost_insulation: 99, cost_adhesive: 30, cost_cladding: 0, wastage: 0.05,
    cost_install_insulation: 10, cost_install_cladding: 0, supply_markup: 0.4, install_markup: 0.4,
  },
} as unknown as RateMasterItem;

const CLAD = {
  item_uid: "rmi-clad0000001", discipline: "HVAC", kind: "fixture_item", unit: "Mts",
  attributes: { item: "Nitrile", cladding: "26G Aluminium", thickness_mm: 13 },
  rates: {
    cost_insulation: 99, cost_adhesive: 30, cost_cladding: 132.46875, wastage: 0.05,
    cost_install_insulation: 10, cost_install_cladding: 150, supply_markup: 0.4, install_markup: 0.4,
  },
} as unknown as RateMasterItem;

// A category with NO composition and NO derived cells -- the `typed` shape every Electrical row takes.
const PLAIN_CFG = {
  discipline: "Electrical", category_id: "plain_cat", attribute_definitions: [],
  pipelines: {}, item_kinds: ["plain_item"],
} as unknown as RateCategoryConfig;
const PLAIN = {
  item_uid: "rmi-plain000001", discipline: "Electrical", kind: "plain_item", brand: "ACME",
  unit: "Nos", attributes: {}, rates: { list_price: 120 },
} as unknown as RateMasterItem;

const byUid = (u: string | undefined) => [BARE, CLAD].find((i) => i.item_uid === u);

// ── the pinned literals ───────────────────────────────────────────────────────────────────────────

const EXPECT = {
  baseWordingBare: "Nitrile, No, 13, Mts [rmi-bare0000001]",
  cladSupply: [
    "insulation 99  <- derived from cost_insulation of Nitrile, No, 13, Mts [rmi-bare0000001]",
    "+ adhesive 30",
    "+ cladding 132.47  <- derived from cost_cladding of Nitrile, No, 13, Mts [rmi-bare0000001] + 132.47",
    "= 261.47",
    "x (1 + wastage 0.05) = 274.54",
    "ROUNDUP -> 275   (total BCS supply)",
    "x (1 + supply markup 0.4) = 385",
    "ROUNDUP -> 385   (BoQ supply)",
  ].join("\n"),
  cladInstall: [
    "install insulation 10",
    "+ install cladding 150",
    "= 160",
    "ROUNDUP -> 160   (total BCS install)",
    "x (1 + install markup 0.4) = 224",
    "ROUNDUP -> 224   (BoQ install)",
  ].join("\n"),
  bareSupply: [
    "insulation 99",
    "+ adhesive 30",
    "+ cladding 0",
    "= 129",
    "x (1 + wastage 0.05) = 135.45",
    "ROUNDUP -> 136   (total BCS supply)",
    "x (1 + supply markup 0.4) = 190.4",
    "ROUNDUP -> 191   (BoQ supply)",
  ].join("\n"),
  noteCostInsulation: [
    "DERIVED on 1 row(s): the value comes from another catalogue row -- see that row's supply_formula / install_formula.",
    "a PART of the supply cost: (cost_insulation + cost_adhesive + cost_cladding) x (1 + wastage), rounded up.",
    "supply: cost x (1 + markup)",
  ].join("\n"),
  noteWastage:
    "the supply wastage fraction: (cost_insulation + cost_adhesive + cost_cladding) x (1 + this), rounded up.",
  noteSupplyMarkup: ["the supply markup fraction.", BOQ_RATE_NOTE].join("\n"),
  notePlainListPrice: "a TYPED rate. No pipeline reads it yet.",
  noteBandedTarget: [
    "a PART of the install cost: (cost_install_insulation + cost_install_cladding), rounded up.",
    "used when thickness_mm <35",
  ].join("\n"),
  noteAssemblyStep: [
    "a PART of the supply cost: (cost_insulation + cost_adhesive + cost_cladding) x (1 + wastage), rounded up.",
    "read off ANOTHER catalogue row, as one component of an assembly total",
  ].join("\n"),
} as const;

describe("slice 12a -- formatNum mirrors the Python renderer", () => {
  it("groups thousands, drops an integer's decimals and trims one trailing zero", () => {
    expect([0, 1, 1000, 1234567, 0.05, 132.46875, 1.4, 2.5, null].map((v) => formatNum(v)))
      .toEqual(["0", "1", "1,000", "1,234,567", "0.05", "132.47", "1.4", "2.5", ""]);
  });
});

describe("slice 12a -- baseWording reads as wording with the id at the end (owner I-5)", () => {
  it("names brand, the attributes and the unit, then the uid in brackets", () => {
    expect(baseWording(CFG, BARE)).toBe(EXPECT.baseWordingBare);
  });

  it("NEGATIVE: an absent base row yields an empty string rather than a broken reference", () => {
    expect(baseWording(CFG, undefined)).toBe("");
  });
});

describe("slice 12a -- isDerivedCell is the ONE marking predicate", () => {
  it("marks only the declared (item, rate key) pairs", () => {
    expect(isDerivedCell(CFG, "rmi-clad0000001", "cost_insulation")).toBe(true);
    expect(isDerivedCell(CFG, "rmi-clad0000001", "cost_cladding")).toBe(true);
  });

  it("NEGATIVE: the row's OWN parts and its markups are NOT derived -- they stay editable (owner I-3)", () => {
    for (const k of ["cost_adhesive", "wastage", "supply_markup", "install_markup",
                     "cost_install_insulation", "cost_install_cladding"]) {
      expect(isDerivedCell(CFG, "rmi-clad0000001", k)).toBe(false);
    }
  });

  it("NEGATIVE: the BASE row's own cost is not derived, and a config declaring nothing marks nothing", () => {
    expect(isDerivedCell(CFG, "rmi-bare0000001", "cost_insulation")).toBe(false);
    expect(isDerivedCell(PLAIN_CFG, "rmi-plain000001", "list_price")).toBe(false);
    expect(derivedCells(PLAIN_CFG).size).toBe(0);
  });

  it("NEGATIVE: an unknown item uid is never marked", () => {
    expect(isDerivedCell(CFG, undefined, "cost_insulation")).toBe(false);
    expect(isDerivedCell(CFG, "rmi-nosuchrow01", "cost_insulation")).toBe(false);
  });
});

describe("slice 12a -- rowFormula shows each step's own result (owner I-6)", () => {
  it("a composed supply cost names its derived part and every intermediate figure", () => {
    expect(rowFormula(CFG, CLAD, "supply", byUid)).toBe(EXPECT.cladSupply);
  });

  it("the install side composes its own two parts and its own markup", () => {
    expect(rowFormula(CFG, CLAD, "install", byUid)).toBe(EXPECT.cladInstall);
  });

  it("a BASE row composes the same way with no derived reference anywhere in the text", () => {
    const txt = rowFormula(CFG, BARE, "supply", byUid);
    expect(txt).toBe(EXPECT.bareSupply);
    expect(txt).not.toContain("derived");
  });

  it("NEGATIVE: a category with no composition and no derived cell reads `typed` on both sides", () => {
    expect(rowFormula(PLAIN_CFG, PLAIN, "supply", () => undefined)).toBe(FORMULA_TYPED);
    expect(rowFormula(PLAIN_CFG, PLAIN, "install", () => undefined)).toBe(FORMULA_TYPED);
  });
});

describe("slice 12a -- columnNote explains a rate column (owner I-7 / I-7a / I-9)", () => {
  it("a derived, composed column names all three facts", () => {
    expect(columnNote(CFG, "cost_insulation", 1)).toBe(EXPECT.noteCostInsulation);
  });

  it("the wastage and markup columns name their role, and only a markup carries the BoQ-rate note", () => {
    expect(columnNote(CFG, "wastage")).toBe(EXPECT.noteWastage);
    expect(columnNote(CFG, "supply_markup")).toBe(EXPECT.noteSupplyMarkup);
    expect(columnNote(CFG, "wastage")).not.toContain(BOQ_RATE_NOTE);
  });

  it("NEGATIVE: a column no pipeline reads says exactly that rather than inventing a rule", () => {
    expect(columnNote(PLAIN_CFG, "list_price")).toBe(EXPECT.notePlainListPrice);
  });

  it("an assembly step with neither a formula nor an explain names what it DOES", () => {
    // This branch shipped UNPINNED -- the fixture had no such step -- and db_switchgear's note
    // read a bare "18 pipelines" because of it. Both sides are pinned here now.
    expect(columnNote(CFG, "cost_adhesive")).toBe(EXPECT.noteAssemblyStep);
  });

  it("a BANDED target is reported as read -- its target lives inside bands[], not step.target", () => {
    expect(columnNote(CFG, "cost_install_cladding")).toBe(EXPECT.noteBandedTarget);
  });
});

describe("slice 12a -- the small shared facts", () => {
  it("sideOfRateKey sends every install-named key to the install column and the rest to supply", () => {
    expect(["cost_install", "install_markup", "cost_install_cladding", "install_rate"]
      .map(sideOfRateKey)).toEqual(["install", "install", "install", "install"]);
    expect(["cost_supply", "supply_markup", "wastage", "list_price"]
      .map(sideOfRateKey)).toEqual(["supply", "supply", "supply", "supply"]);
  });

  it("derivedCountsByKey counts only the items actually in the file", () => {
    expect(derivedCountsByKey(CFG, [BARE, CLAD])).toEqual({ cost_insulation: 1, cost_cladding: 1 });
    expect(derivedCountsByKey(CFG, [BARE])).toEqual({});
    expect(derivedCountsByKey(PLAIN_CFG, [PLAIN])).toEqual({});
  });

  it("the two formula columns are named and ordered as the rate file writes them", () => {
    expect([...FORMULA_COLUMNS]).toEqual(["supply_formula", "install_formula"]);
  });
});
