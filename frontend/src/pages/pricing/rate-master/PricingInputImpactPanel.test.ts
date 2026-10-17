/**
 * SLICE 12b(B) -- the impact panel, the ITEMS column and the page wiring.
 *
 * ⚠️ SOURCE PINS, BY NECESSITY. There is NO DOM test environment in this repo
 * (`frontend/CLAUDE.md`), so a component's rendering cannot be asserted -- only its source can. The
 * ARITHMETIC lives in `pricingInputImpact.ts` and is tested properly there; what these pins protect is
 * the set of decisions that are invisible to a pure test and would otherwise be silently reversible:
 * the panel being a flex sibling rather than an overlay, the count being distinct SKUs, nothing being
 * written until Save, and the column only existing where the page opted in.
 *
 * The precedent is `RateHelperPanel.test.ts`, which does exactly this for the same reason.
 */
import { describe, it, expect } from "vitest";
import { gridColumnKeys, COL_PI_ITEMS } from "./rateMasterGridColumns";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { IMPACT_PANEL_WIDTH, IMPACT_COPY, fieldBoxText, plainSkuLabel, typeIntoField, type FieldEditState } from "./PricingInputImpactPanel";
import { computePricingInputReach } from "./pricingInputReach";
import { readJsonFixture } from "../calculatorPanelParity.harness";
import { NOT_MOVED_NOTE } from "./pricingInputImpact";

const read = (f: string) => fs.readFileSync(path.join(__dirname, f), "utf-8");
const PANEL = read("PricingInputImpactPanel.tsx");
const VIEWER = read("RateMasterDataViewer.tsx");
const PAGE = read("RateMasterPage.tsx");
const REACH = read("pricingInputReach.ts");

describe("SLICE 12b(B) -- the impact panel's shape", () => {
  it("is 470px, the width the owner ruled", () => {
    expect(IMPACT_PANEL_WIDTH).toBe(470);
    expect(PANEL).toContain("style={{ width: IMPACT_PANEL_WIDTH }}");
  });

  it("⚠️ NEGATIVE: it is a FLEX SIBLING, never a Sheet -- 'beside the table, not covering it'", () => {
    // `components/ui/sheet.tsx` OVERLAYS, which is the thing the owner ruled out. The panel must
    // occupy real layout width so the table narrows instead of being hidden.
    // ⚠️ assert on the IMPORT, not the text: the panel's own comment NAMES sheet.tsx in order to say
    // why it is not used, and a substring check on that comment would fail for the right reason stated.
    expect(PANEL).not.toMatch(/from "@\/components\/ui\/sheet"/);
    expect(PANEL).not.toMatch(/<Sheet[\s>]/);
    expect(PANEL).toContain("<aside");
    // and the PAGE puts it in a flex row beside the viewer, not on top of it
    expect(PAGE).toContain('<div className="flex items-start gap-3">');
    expect(PAGE).toContain("<PricingInputImpactPanel");
  });

  it("opens on the ITEMS count and closes by toggling the same count", () => {
    expect(VIEWER).toContain("onOpenImpact?.(");
    expect(VIEWER).toContain("openImpactUid === r.it.item_uid ? null :");
  });

  it("ACCEPTANCE 9: each category group has its OWN scroll box, and the counter reads N of M", () => {
    expect(PANEL).toContain('g.rows.length > 8 && "max-h-[340px] overflow-y-auto"');
    expect(PANEL).toContain("${shown} of ${total}");
    expect(PANEL).toContain('data-testid="impact-search"');
    expect(PANEL).toContain('data-testid="impact-count"');
  });

  it("ACCEPTANCE 10: the four columns, and the leg is NAMED in the header", () => {
    for (const h of [">Item<", ">becomes<", ">change<"]) expect(PANEL).toContain(h);
    /**
     * ⚠️ INVERTED (owner, 2026-10-05, mechanical authority) -- `84e2e5fde` invalidated the old literal.
     *
     * The `now` heading used to be a bare `>now<`. It reported TWO DIFFERENT QUANTITIES under that one
     * unlabelled word: the SKU's stored rate when nothing was edited, and the pipeline's computed leg
     * when something was -- measured 109 against 306 on the same row. `computeImpact` now returns the
     * computed leg in BOTH branches, and the heading NAMES which leg it is, which is what this test's
     * own title always asked for.
     *
     * The old literal is asserted ABSENT rather than deleted, so re-introducing a bare `now` heading --
     * the state in which the column lied about its own quantity -- turns this red again.
     */
    expect(PANEL).not.toContain(">now<");
    expect(PANEL).toContain("now <span");
    expect(PANEL).toContain("({impact.legLabel})");
    // the leg label comes from the pure module, so the panel cannot invent a different one
    expect(PANEL).toContain("impact.legLabel");
    // and the heading carries the plain-language note saying both figures are that leg
    expect(PANEL).toContain("IMPACT_COPY.nowLegTitle(impact.legLabel)");
  });

  it("ACCEPTANCE 10: Save is DISABLED until something changes, and Cancel restores", () => {
    expect(PANEL).toContain("disabled={!impact.changed || saving}");
    expect(PANEL).toContain("onClick={() => { setEdited({}); setError(null); }}");
  });

  it("⚠️ NOTHING IS WRITTEN WHILE TYPING -- the only write is inside the Save handler", () => {
    // `onSave` must appear exactly once outside the prop declaration: in `doSave`. A second call site
    // would mean an edit could reach the database without Save being pressed.
    const calls = PANEL.match(/await onSave\(/g) ?? [];
    expect(calls).toHaveLength(1);
    // the field handler only ever touches local state
    const setField = PANEL.slice(PANEL.indexOf("const setField ="), PANEL.indexOf("const valueOf ="));
    expect(setField).toContain("setEdited(");
    expect(setField).not.toContain("onSave");
  });

  it("ACCEPTANCE 11: the working names both legs, highlights only the CHANGED parameter, shows 'was'", () => {
    expect(PANEL).toContain('data-testid="impact-verdict"');
    expect(PANEL).toContain("Where each number comes from");
    // the changed field is amber; an unchanged one is plain blue -- never both, never neither
    expect(PANEL).toContain("isDirtyField(k)");
    expect(PANEL).toContain("bg-amber-100");
    expect(PANEL).toContain("— was ${");
    expect(PANEL).toContain(IMPACT_COPY.back);
  });

  it("the amber line says it is a PREVIEW, and says the opposite when nothing is edited", () => {
    expect(IMPACT_COPY.preview).toContain("nothing is saved until you press Save");
    expect(IMPACT_COPY.unchanged).toContain("as they stand today");
    expect(PANEL).toContain("impact.changed ? IMPACT_COPY.preview : IMPACT_COPY.unchanged");
  });

  it("⚠️ N-1: the panel states that a ROW is rounded, so its per-SKU figure is not mistaken for one", () => {
    // the per-SKU number is UNROUNDED by ruling; the row's own change differs because the row is
    // rounded once at the end (measured: 13.0%-17.8% over 136 switchgear SKUs against a flat 16.667%)
    expect(IMPACT_COPY.rowRounding).toContain("rounded once at the end");
    expect(PANEL).toContain("IMPACT_COPY.rowRounding");
  });

  /**
   * ⚠️ INVERTED (owner ruling, 2026-09-29). The adder's panel used to render ONE SENTENCE and no
   * rows. The owner's rule is whose PRICE moves: an adder moves all 450 trays, so it lists them --
   * as rate PLUS adder, with the condition it applies under stated beneath.
   */
  it("a FLAT ADDER lists its SKUs like every other shape, as an addition, with its condition", () => {
    expect(IMPACT_COPY.flatAdder).not.toContain("no SKU rate is listed");
    expect(IMPACT_COPY.flatAdder).toContain("not multiplied");
    // the "not moved" note stays, and stays TRUE: no SKU's stored rate is scaled by an adder --
    // which is a different claim from "no SKU is listed", the one that was wrong.
    expect(NOT_MOVED_NOTE.flat_adder).toContain("added to the row");
    expect(NOT_MOVED_NOTE.flat_adder).not.toContain("listed");
    // the list is no longer behind a shape test -- nothing suppresses it
    expect(PANEL).not.toContain('{IMPACT_COPY.flatAdder}');
    expect(PANEL).toContain("NO SHAPE SUPPRESSES THE LIST");
    expect(PANEL).toContain("adderConditionText");
  });

  it("N-7 NEGATIVE: no category ID reaches the screen -- every label goes through the resolver", () => {
    expect(PANEL).toContain("categoryLabel(");
    expect(PAGE).toContain("categoryLabel={categoryDisplayName}");
    // the resolver prefers the config's own display name, then the registry, and only then the id
    expect(PAGE).toContain("?.category_display");
  });

  it("a non-admin gets the panel READ-ONLY -- the controls are absent, not merely disabled", () => {
    expect(PANEL).toContain("{canEdit ? (");
    expect(PAGE).toContain("canEdit={isAdmin && !writesBlocked}");
  });
});

describe("SLICE 12b(B) -- the ITEMS column", () => {
  it("ACCEPTANCE 8: it shows DISTINCT SKUs and is clickable", () => {
    expect(VIEWER).toContain('data-testid="pi-items-count"');
    expect(VIEWER).toContain("r?.distinctSkus.length");
  });

  it("⚠️ NEGATIVE: it is NOT the used_by site count -- those correlate with nothing", () => {
    // measured on v65: tray_supply is 1 site / 450 SKUs; conduit is 10 sites / 8 SKUs
    const start = VIEWER.indexOf("const impactCountFor");
    const body = VIEWER.slice(start, VIEWER.indexOf("[inputReach],", start));
    expect(body).toContain("distinctSkus.length");
    expect(body).not.toContain("used_by");
  });

  /**
   * ⚠️ INVERTED (owner ruling, 2026-09-29). The dash said "this moves no SKU rate", which is true of
   * the RATE and false of the PRICE. An adder counts like every other input.
   */
  it("a FLAT ADDER counts its SKUs like every other input -- no dash special case", () => {
    expect(VIEWER).not.toContain("if (r?.isFlatAdder) return \"—\";");
    expect(VIEWER).toContain("AN ADDER COUNTS LIKE EVERY OTHER INPUT");
  });

  /**
   * ⚠️ INVERTED 2026-10-05 under mechanical authority, NOT deleted. It counted the `showImpactCol ?`
   * RENDER SITES -- header, colgroup and body -- because the column's order lived in three places.
   * It lives in one now (`rateMasterGridColumns.gridColumnKeys`), which is what stops the header and
   * the body drifting apart; counting sites would therefore pin the very duplication that was removed.
   * The CLAIM is unchanged and is asserted against the list instead, which is stronger: the column is
   * in the plan only when the page opts in.
   */
  it("⚠️ NEGATIVE: the column is ABSENT unless the page opted in, so every other grid is unchanged", () => {
    expect(VIEWER).toContain("const showImpactCol = piMode && !!onOpenImpact && !!inputReach;");
    const base = { canEdit: false, showKindCol: false, piMode: true, specMode: false,
                   textCols: [], attrCols: [], rateCols: ["r1"] };
    expect(gridColumnKeys({ ...base, showImpactCol: false })).not.toContain(COL_PI_ITEMS);
    expect(gridColumnKeys({ ...base, showImpactCol: true })).toContain(COL_PI_ITEMS);
    // and a SKU grid never has it, opted in or not
    expect(gridColumnKeys({ ...base, piMode: false, showImpactCol: true })).not.toContain(COL_PI_ITEMS);
  });
});

describe("SLICE 12b(B) -- the page's config load", () => {
  it("reuses the SHARED N-fetch plumbing rather than minting a second fetcher", () => {
    expect(PAGE).toContain("RATE_MASTER_CONFIG_TARGETS");
    expect(PAGE).toContain("RateConfigFetcher");
    expect(PAGE).toContain("useConfigsByCategory");
    expect(PAGE).toContain("rateHelperPlumbing");
  });

  it("⚠️ the fetchers mount ONLY on the Pricing Inputs category -- no other grid pays for them", () => {
    expect(PAGE).toContain("isPricingInputConfig(config)\n              ? RATE_MASTER_CONFIG_TARGETS");
  });

  it("the reach walk is memoised on [configs, items], not recomputed per render", () => {
    expect(PAGE).toContain("const inputReach = useMemo(");
    expect(PAGE).toContain("[allConfigs, items],");
  });
});

describe("SLICE 12b(B) -- the reach walk's three measured invariants are documented in the module", () => {
  it("records WHY provenance, narrowing and install_as_ratio each matter, with the measured numbers", () => {
    // these comments are the only place the wrong answers are written down; a future reader who
    // "simplifies" the walk needs to find the reason it is not simple.
    expect(REACH).toContain("PROVENANCE, NOT THE CONSUMING STEP");
    expect(REACH).toContain("A COLUMN IS NARROWED, NOT JUST TYPED");
    expect(REACH).toContain("install_as_ratio` CARRIES NO `target`");
    expect(REACH).toContain("163");   // the switchgear over-count
    expect(REACH).toContain("292");   // the cable over-count
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
// SLICE 12e-2b -- the 12e-2 cert findings on this panel: the reach of a family's input (finding 2, AC8), the row
// label (finding 2, owner "HVAC item-list rows"), and the Factor box typed key by key (finding 3, AC9).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
const readAsset = (name: string) =>
  readJsonFixture<{ discipline: string; items: Array<Record<string, unknown>>; category_configs: Array<{ category_id: string }> }>(
    new URL("../../../../../nirmaan_stack/services/boq_rate_master/data/" + name, import.meta.url),
  );
const reachOf = (name: string) => {
  const a = readAsset(name);
  const configs = Object.fromEntries(a.category_configs.map((c) => [c.category_id, c]));
  const items = a.items.map((it) => ({ ...it, discipline: a.discipline }));
  return { a, configs, items, reach: computePricingInputReach(configs as never, items as never) };
};
const digest = (v: unknown) => crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 12);

/**
 * EVERY pricing input of BOTH disciplines, BY ID: its distinct-SKU count and a digest of its whole reach record
 * (SKUs, columns in order, candidates, categories, pipelines). The digests were taken with the family filter OFF and
 * ON in the same session (12e-2b A/B): the four Piping inputs are the ONLY ones that differ, so every other line
 * here is the reach as it was before this slice -- a change to any of them is a change to an existing input.
 */
const REACH_BEFORE_PIPING: Record<string, number> = {
  piping_accessories_copper: 40, piping_accessories_cpvc: 40, piping_accessories_ms: 40, piping_accessories_pvc: 40,
};
const REACH_PINS: Record<string, Record<string, [number, string]>> = {
  hvac: {
    alu_sheet_24g: [68, "bedcabb7b25d"],
    alu_sheet_26g: [68, "5f31d8e70534"],
    cladding_overlap: [136, "462b40e5f3ba"],
    gi_framework_adder: [7, "a33958bb1162"],
    gi_framework_factor: [7, "a33958bb1162"],
    gi_sheet_rate: [7, "a33958bb1162"],
    glass_cloth: [84, "45e9c08f17f5"],
    piping_accessories_copper: [13, "cbfdcf6b5cdd"],
    piping_accessories_cpvc: [6, "1e615fd276e7"],
    piping_accessories_ms: [13, "661179b24773"],
    piping_accessories_pvc: [8, "c34debf23f7a"],
  },
  electrical: {
    cable_arm: [187, "de399aab25ad"],
    cable_install: [292, "5f00933a811a"],
    cable_unarm: [105, "3efb16f508eb"],
    conduit: [8, "ea80cf480343"],
    conduit_share: [8, "080345dd4c5a"],
    db_share: [136, "c5d25213a70a"],
    earthing_install: [25, "3d896b4802ac"],
    earthing_supply: [25, "c88deb0338d6"],
    gland: [296, "b2fba904c328"],
    indsock: [28, "f2d4792a3fa8"],
    indsock_share: [134, "7219c1d1bb5c"],
    jb_discount: [6, "62279b31baea"],
    jb_share: [6, "62279b31baea"],
    jb_supply: [6, "62279b31baea"],
    lms_bcs: [24, "01ba2a35e308"],
    lms_supply: [24, "3cbfcb856c4d"],
    lug: [296, "6573707219be"],
    misc_install: [13, "4ec8e505b7a0"],
    misc_supply: [13, "d96f906e3f67"],
    popup_install: [1, "e92dc9e73103"],
    popup_module_share: [53, "af8d7dafc406"],
    popup_supply: [1, "a16ef1b12eb5"],
    pw_accessory_share: [61, "6af27815a626"],
    pw_switch_share: [22, "e0cc94ffa1a3"],
    switchgear: [136, "46d023b57283"],
    swsock: [61, "f1f1de52abff"],
    swsock_share: [61, "3d78ed689e51"],
    termination_share: [296, "385c9ffd99cd"],
    tray_accessories: [450, "1bf42ae42ab8"],
    tray_cutting: [450, "53a3b604fb43"],
    tray_cutting_amount: [450, "4f5a85605053"],
    tray_discount: [450, "808d0f53a9e4"],
    tray_install: [450, "7507c690c53c"],
    tray_refilling: [450, "a8ea7c4e35df"],
    tray_supply: [450, "b1f378dac665"],
  },
};

describe("SLICE 12e-2b AC8 -- a family-scoped input reaches that family's SKUs, and nothing else moves", () => {
  const hvac = reachOf("rate_master_hvac_all_v36.json");
  const elec = reachOf("rate_master_electrical_all_v66.json");
  const famOf = (uid: string) => (hvac.items.find((it) => (it as { item_uid?: string }).item_uid === uid) as unknown as { attributes: Record<string, unknown> }).attributes.pipe_type;

  it.each([["piping_accessories_copper", "Copper", 13], ["piping_accessories_ms", "MS", 13], ["piping_accessories_pvc", "PVC", 8], ["piping_accessories_cpvc", "CPVC", 6]] as const)(
    "%s lists only the %s pipes: %s SKUs (BEFORE: all 40)", (id, family, count) => {
      const r = hvac.reach[id];
      expect(r.distinctSkus).toHaveLength(count);
      expect(new Set(r.distinctSkus.map(famOf))).toEqual(new Set([family]));
      expect(new Set(r.columns.map((c) => famOf(c.itemUid)))).toEqual(new Set([family]));
      expect(REACH_BEFORE_PIPING[id]).toBe(40);
      // NEGATIVE: the input is still read by its category, and by that family's pipelines alone
      expect(r.readByCategories).toEqual(["hvac_piping"]);
      expect(r.pipelines.every((p) => p.pipelineId.startsWith(`${family}/`))).toBe(true);
    });
  it("the four add up to the 40 pipes, with no SKU under two families' inputs", () => {
    const all = ["copper", "ms", "pvc", "cpvc"].flatMap((f) => hvac.reach[`piping_accessories_${f}`].distinctSkus);
    expect(all).toHaveLength(40);
    expect(new Set(all).size).toBe(40);
  });
  it("every input of BOTH disciplines, by id: the count and the whole reach record (Insulation, ADP and Electrical exactly as before)", () => {
    for (const [name, got] of [["hvac", hvac.reach], ["electrical", elec.reach]] as const) {
      const table = Object.fromEntries(Object.keys(got).sort().map((id) => [id, [got[id].distinctSkus.length, digest(got[id])]]));
      expect({ name, table }).toEqual({ name, table: REACH_PINS[name] });
    }
    expect(Object.keys(REACH_PINS.hvac)).toHaveLength(11);
    expect(Object.keys(REACH_PINS.electrical)).toHaveLength(35);
  });
  it("NEGATIVE: a column read by a pipeline that belongs to NO family is open -- Electrical has no family-owned pipeline, so the filter can never act there", () => {
    for (const c of elec.a.category_configs) expect((c as { list_spec?: unknown }).list_spec).toBeUndefined();
    expect(REACH).toContain("IT FILTERS THE LIST, IT DOES NOT RE-KEY THE COLUMNS");
  });
});

describe("SLICE 12e-2b -- an item-list SKU's row label names its facts by the panel field's label (owner: 'HVAC item-list rows')", () => {
  const hvac = readAsset("rate_master_hvac_all_v36.json");
  const cfg = (id: string) => hvac.category_configs.find((c) => c.category_id === id);
  it("Piping: 'size_mm 15.9' reads 'Pipe size 15.9'", () => {
    expect(plainSkuLabel("Refrigerant Piping/Copper Piping · size_mm 15.9", [cfg("hvac_piping")])).toBe("Refrigerant Piping/Copper Piping · Pipe size 15.9");
  });
  it("Insulation and ADP rows follow the same rule (the field's own label)", () => {
    expect(plainSkuLabel("Nitrile Rubber Insulation · cladding 26G Aluminium · thickness_mm 25 · pipe_size_mm 100", [cfg("hvac_insulation")]))
      .toBe("Nitrile Rubber Insulation · Cladding 26G Aluminium · Thickness (mm) 25 · Pipe size (mm) 100");
    // a SKU attribute read from a differently named field takes that field's label, through the config's own reader
    expect(plainSkuLabel("Fire Damper Actuator · torque_nm 6 · ul no", [cfg("hvac_adp")])).toBe("Fire Damper Actuator · Torque (as written) 6 · UL listed no");
  });
  it("NEGATIVE: a row of a category that is not item-list (every Electrical row) is byte-identical; so is an id the config has no label for, and the row's own name", () => {
    const elec = readAsset("rate_master_electrical_all_v66.json");
    const conduit = elec.category_configs.find((c) => c.category_id === "conduit_piping");
    expect(plainSkuLabel("PVC Conduit · size_mm 20", [conduit])).toBe("PVC Conduit · size_mm 20");
    expect(plainSkuLabel("PVC Conduit · size_mm 20", [])).toBe("PVC Conduit · size_mm 20");
    expect(plainSkuLabel("Some pipe · item_detail 6.4", [cfg("hvac_piping")])).toBe("Some pipe · item_detail 6.4");
    expect(plainSkuLabel("size_mm 15.9", [cfg("hvac_piping")])).toBe("size_mm 15.9");                // the NAME is never rewritten
    // and the shared label function is untouched: the panel applies this at its one `computeImpact` call
    expect(PANEL).toContain("plainSkuLabel(r.label, r.categories.map((c) => allConfigs[c]))");
  });
});

describe("SLICE 12e-2b AC9 -- a value box typed key by key keeps what was typed (BEFORE: '0.4' became 4)", () => {
  const STORED = { factor: 0.3, supply_markup: 0.45 };
  /** Type `text` one character at a time, exactly as the box's onChange delivers it; returns the box text and the value after each key. */
  const typeKeys = (key: string, text: string, percent = false, from: FieldEditState = { edited: {}, drafts: {} }) => {
    let state = from;
    let shown = "";
    const trail: Array<[string, number | undefined]> = [];
    for (const ch of text) {
      shown = shown + ch;
      state = typeIntoField(state, key, shown, percent);
      shown = fieldBoxText(state, key, STORED, percent);          // what React renders back into the box
      trail.push([shown, state.edited[key]]);
    }
    return { state, shown, value: state.edited[key], trail };
  };
  it.each([["0.4", 0.4], ["0.05", 0.05], ["1.25", 1.25], [".5", 0.5], ["0", 0], ["0.30", 0.3], ["12", 12]] as const)("typing %s character by character gives %s", (text, want) => {
    const r = typeKeys("factor", text);
    expect(r.shown).toBe(text);                                   // the box holds exactly what was typed
    expect(r.value).toBe(want);
  });
  it("the trail of '0.4': the dot survives the keystroke that used to erase it, and the value is never 4", () => {
    const r = typeKeys("factor", "0.4");
    expect(r.trail).toEqual([["0", 0], ["0.", 0], ["0.4", 0.4]]);
    expect(r.trail.map(([, v]) => v)).not.toContain(4);
  });
  it("'.5': a lone dot is kept as text and changes no value until a digit follows", () => {
    expect(typeKeys("factor", ".5").trail).toEqual([[".", undefined], [".5", 0.5]]);
  });
  it("backspace to empty: the box STAYS empty and the edit is withdrawn (the stored value stands, Save has nothing to write)", () => {
    let state = typeKeys("factor", "0.4").state;
    for (const shown of ["0.", "0", ""]) state = typeIntoField(state, "factor", shown, false);
    expect(fieldBoxText(state, "factor", STORED, false)).toBe("");
    expect("factor" in state.edited).toBe(false);
  });
  it("a percent box is typed the same way: '12.5' -> 0.125, the text kept", () => {
    const r = typeKeys("supply_markup", "12.5", true);
    expect(r.shown).toBe("12.5");
    expect(r.value).toBeCloseTo(0.125, 10);
  });
  it("NEGATIVE: with no edit open the box shows the stored value as it always did; a non-number is ignored, text and value both", () => {
    expect(fieldBoxText({ edited: {}, drafts: {} }, "factor", STORED, false)).toBe("0.3");
    expect(fieldBoxText({ edited: {}, drafts: {} }, "supply_markup", STORED, true)).toBe("45%");
    const before = typeKeys("factor", "0.4").state;
    expect(typeIntoField(before, "factor", "0.4x", false)).toBe(before);
  });
  it("the texts belong to ONE edit object, so Cancel and Save (which replace it) drop them with no second reset", () => {
    expect(PANEL).toContain("const drafts = draftState.owner === edited ? draftState.drafts : NO_DRAFTS;");
    expect(PANEL).toContain("value={fieldBoxText({ edited, drafts }, k, stored, isPercentField(k))}");
  });
});
