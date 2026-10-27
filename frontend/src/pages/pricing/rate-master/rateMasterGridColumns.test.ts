/**
 * THE GRID'S COLUMN ORDER IS THE FILE'S COLUMN ORDER -- for every category of every discipline, in
 * every render mode.
 *
 * ⚠️ WHY THESE TESTS EXIST, AND WHY THEY ARE SHAPED LIKE THIS. On 2026-10-03 commit `8fa8d3262`
 * ("the data viewer's columns and rows follow the download") moved the `unit` HEADER to sit just
 * after `brand` and left the body cell after the rate columns. Every grid of every category except
 * Pricing Inputs then rendered its values ONE PLACE LEFT of their headings: on Electrical's wiring
 * grid the unit "Set" appeared under `lug_list` and "COPPER" under `Insulation`; on HVAC Insulation
 * a markup sat under `cost_supply`. The DOWNLOAD was correct throughout.
 *
 * Nothing caught it, and nothing could have: the figures were all plausible, only mislabelled, and
 * this repo has NO DOM test environment (frontend/CLAUDE.md, deliberate) so no test can render the
 * grid and read a cell. That is precisely why the order was extracted into a PURE function -- what
 * cannot be observed through a render can still be asserted about the list both renders consume.
 *
 * So these tests assert the ORDER, for every real category, from the real assets; the source pin at
 * the bottom asserts that the header and the body both MAP that list rather than carrying their own.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ELECTRICAL from "../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_electrical_all_v66.json";
import HVAC from "../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v25.json";
import { columnOrderForFile } from "./rateMasterSpec";
import CAT_KINDS from "../../../../../scripts/_instruments/cat_kinds.json";
import {
  gridColumnKeys, gridColumnsSharedWithFile, attrColKey, rateColKey, fileColumnId, plainFileColumnLabel,
  COL_UNIT, COL_BRAND, COL_ACTIONS, COL_PI_NAME, COL_ITEM_UID, COL_DISCIPLINE, COL_CATEGORY, COL_SPEC,
  COL_SOURCE_SHEET, COL_SOURCE_ROW,
} from "./rateMasterGridColumns";

type AnyRec = Record<string, unknown>;
interface Asset { category_configs: Array<AnyRec & { category_id: string }>; items: Array<AnyRec & { kind?: string }> }

const ASSETS: Array<[string, Asset]> = [
  ["Electrical", ELECTRICAL as unknown as Asset],
  ["HVAC", HVAC as unknown as Asset],
];

/** The categories a discipline's asset really holds items for, with those items. */
function categoriesWithItems(asset: Asset, disc: string): Array<{ id: string; config: AnyRec; items: Array<AnyRec> }> {
  const out: Array<{ id: string; config: AnyRec; items: Array<AnyRec> }> = [];
  for (const cfg of asset.category_configs) {
    /**
     * ⚠️ THE KINDS COME FROM THE EXPORTER, NOT FROM `item_kinds` -- and getting this wrong made an
     * EARLIER VERSION OF THIS FILE VACUOUS WHERE IT MATTERED MOST. Two Electrical categories
     * (`wiring_cabling`, `point_wiring`) declare NO `item_kinds` in the asset, yet `wiring_cabling`
     * holds 588 rows, and it is the grid whose misalignment was actually seen in the browser. The
     * count assertions still passed while that category was being skipped, which is exactly the way
     * a sweep lies. The authoritative mapping is `csv_exporter._load`, exported to `cat_kinds.json`.
     */
    const entry = (CAT_KINDS as Record<string, { kinds: string[] }>)[`${disc}/${cfg.category_id}`];
    const kinds = new Set<string>(entry?.kinds ?? []);
    const items = asset.items.filter((i) => kinds.has(String(i.kind ?? "")));
    if (items.length) out.push({ id: cfg.category_id, config: cfg, items });
  }
  return out;
}

const isPricingInputs = (id: string) => /pricing_inputs?$/.test(id);
const isSpecDriven = (cfg: AnyRec) => cfg.attributes_from_spec === true;

/** The grid inputs a category would produce, per render mode. */
function inputsFor(cfg: AnyRec, items: Array<AnyRec>, mode: "normal" | "editing" | "pricingInputs") {
  const { attrs, rates } = columnOrderForFile(cfg as never, items as never);
  const piMode = isPricingInputs(String(cfg.category_id));
  const specMode = isSpecDriven(cfg);
  const specText = specMode ? ["item_name", "item_detail"] : [];
  const textCols = specText.map((id) => ({ id }));
  const attrCols = attrs.filter((a) => !specText.includes(a)).map((id) => ({ id }));
  const kinds = new Set<string>((cfg.item_kinds as string[] | undefined) ?? []);
  return {
    canEdit: mode === "editing",
    showKindCol: kinds.size > 1,
    piMode: mode === "pricingInputs" ? true : piMode,
    specMode,
    showImpactCol: false,
    textCols,
    attrCols,
    rateCols: rates,
    fileAttrs: attrs,
    fileRates: rates,
  };
}

describe("the grid's columns are the file's columns, in the file's order", () => {
  for (const [disc, asset] of ASSETS) {
    const cats = categoriesWithItems(asset, disc);

    it(`${disc}: the sweep reaches real categories (never vacuous)`, () => {
      expect(cats.length).toBeGreaterThan(0);
      for (const c of cats) expect(c.items.length).toBeGreaterThan(0);
    });

    for (const c of cats) {
      it(`${disc}/${c.id}: the shared columns appear in the file's order`, () => {
        const inp = inputsFor(c.config, c.items, "normal");
        const keys = gridColumnKeys(inp);
        const shared = gridColumnsSharedWithFile(keys);
        /**
         * ⚠️ INVERTED at ADP-4b (owner D7 / AC3, "the data viewer shows exactly what downloads") by mechanical authority.
         * BEFORE, the ONE DOCUMENTED DIVERGENCE: a spec-driven category put its text pair FIRST on the screen (slice 1c /
         * U3) and this branch modelled the file order from the screen's own inputs:
         *   [...textCols, COL_BRAND, COL_UNIT, ...attrCols, ...fileRates]
         * AFTER: the grid IS the file's order -- the three identity columns, brand, unit, the text pair, the rates (the
         * "read from spec" columns are not in the file, nor on the default grid).
         */
        const fileOrder = inp.specMode
          ? [
              COL_ITEM_UID, COL_DISCIPLINE, COL_CATEGORY,
              COL_BRAND, COL_UNIT,
              ...inp.textCols.map((d) => attrColKey(d.id)),
              ...inp.fileRates.map((k) => rateColKey(k)),
            ]
          : [
              ...(inp.piMode ? [] : [COL_BRAND, COL_UNIT]),
              ...inp.textCols.map((d) => attrColKey(d.id)),
              ...inp.attrCols.map((d) => attrColKey(d.id)),
              ...inp.fileRates.map((k) => rateColKey(k)),
              ...(inp.piMode ? [COL_UNIT] : []),
            ];
        // compare as ORDERED SEQUENCES of the columns both carry
        const inBoth = new Set(fileOrder);
        expect(shared.filter((k) => inBoth.has(k))).toEqual(
          fileOrder.filter((k) => shared.includes(k)));
      });
    }
  }
});

describe("every render mode, every category: one list, correct shape", () => {
  const MODES = ["normal", "editing", "pricingInputs"] as const;
  for (const mode of MODES) {
    it(`${mode}: every category produces a list with no duplicate column and one unit`, () => {
      let checked = 0;
      for (const [disc, asset] of ASSETS) {
        for (const c of categoriesWithItems(asset, disc)) {
          const keys = gridColumnKeys(inputsFor(c.config, c.items, mode));
          expect(new Set(keys).size, `${c.id}: duplicate column key`).toBe(keys.length);
          expect(keys.filter((k) => k === COL_UNIT).length, `${c.id}: unit must appear exactly once`).toBe(1);
          checked++;
        }
      }
      // COUNT ASSERTED: the mode's sweep must have reached every category of both disciplines
      expect(checked).toBeGreaterThanOrEqual(15);
    });
  }

  it("normal: `unit` sits immediately after `brand` -- the rule 8fa8d3262 set out to apply", () => {
    let checked = 0;
    for (const [disc, asset] of ASSETS) {
      for (const c of categoriesWithItems(asset, disc)) {
        if (isPricingInputs(c.id)) continue;
        const keys = gridColumnKeys(inputsFor(c.config, c.items, "normal"));
        expect(keys[keys.indexOf(COL_BRAND) + 1], `${c.id}`).toBe(COL_UNIT);
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(13);
  });

  it("pricingInputs: `unit` sits AFTER the rate columns, where that page has always put it", () => {
    let checked = 0;
    for (const [disc, asset] of ASSETS) {
      for (const c of categoriesWithItems(asset, disc)) {
        const inp = inputsFor(c.config, c.items, "pricingInputs");
        if (!inp.rateCols.length) continue;
        const keys = gridColumnKeys(inp);
        expect(keys.indexOf(COL_UNIT)).toBeGreaterThan(keys.indexOf(rateColKey(inp.rateCols[inp.rateCols.length - 1])));
        expect(keys).not.toContain(COL_BRAND);   // the input's NAME leads instead
        expect(keys).toContain(COL_PI_NAME);
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(15);
  });

  it("editing adds the actions column FIRST and changes nothing else", () => {
    let checked = 0;
    for (const [disc, asset] of ASSETS) {
      for (const c of categoriesWithItems(asset, disc)) {
        const plain = gridColumnKeys(inputsFor(c.config, c.items, "normal"));
        const edit = gridColumnKeys(inputsFor(c.config, c.items, "editing"));
        expect(edit[0]).toBe(COL_ACTIONS);
        expect(edit.slice(1)).toEqual(plain);
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(15);
  });
});

describe("VACUITY -- reintroduce the one-sided move and each mode goes red", () => {
  /** The retired body order: `unit` emitted after the rate columns regardless of mode. */
  function retiredBodyOrder(inp: ReturnType<typeof inputsFor>): string[] {
    const keys = gridColumnKeys(inp).filter((k) => k !== COL_UNIT);
    const lastRate = inp.rateCols.length ? rateColKey(inp.rateCols[inp.rateCols.length - 1]) : null;
    const at = lastRate ? keys.indexOf(lastRate) + 1 : keys.length;
    return [...keys.slice(0, at), COL_UNIT, ...keys.slice(at)];
  }

  it("normal: the retired order puts `unit` somewhere else -- so the pin can fail", () => {
    let differed = 0;
    for (const [disc, asset] of ASSETS) {
      for (const c of categoriesWithItems(asset, disc)) {
        if (isPricingInputs(c.id)) continue;
        const inp = inputsFor(c.config, c.items, "normal");
        if (!inp.rateCols.length) continue;
        const good = gridColumnKeys(inp);
        const bad = retiredBodyOrder(inp);
        expect(bad).not.toEqual(good);                                   // the defect IS expressible
        expect(bad[bad.indexOf(COL_BRAND) + 1]).not.toBe(COL_UNIT);      // and it breaks the rule above
        differed++;
      }
    }
    // the vacuity check must itself reach rows, or it proves nothing
    expect(differed).toBeGreaterThanOrEqual(12);
  });

  it("pricingInputs: the retired order is INDISTINGUISHABLE -- which is why PI never broke", () => {
    let same = 0;
    for (const [disc, asset] of ASSETS) {
      for (const c of categoriesWithItems(asset, disc)) {
        const inp = inputsFor(c.config, c.items, "pricingInputs");
        if (!inp.rateCols.length) continue;
        expect(retiredBodyOrder(inp)).toEqual(gridColumnKeys(inp));
        same++;
      }
    }
    expect(same).toBeGreaterThanOrEqual(15);
  });

  it("editing: the retired order breaks there too", () => {
    let differed = 0;
    for (const [disc, asset] of ASSETS) {
      for (const c of categoriesWithItems(asset, disc)) {
        if (isPricingInputs(c.id)) continue;
        const inp = inputsFor(c.config, c.items, "editing");
        if (!inp.rateCols.length) continue;
        expect(retiredBodyOrder(inp)).not.toEqual(gridColumnKeys(inp));
        differed++;
      }
    }
    expect(differed).toBeGreaterThanOrEqual(12);
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE SOURCE PIN (owner item 3) -- NAMED AS A PIN, NOT AS THE CELL TEST.
 *
 * ⚠️ THIS IS NOT A SUBSTITUTE for comparing rendered cells against the file; this repo has no DOM
 * environment, so that test cannot exist here (registered for slice 12c-T as the owner's deferred
 * jsdom option). What this pin DOES guarantee is narrower and still worth having: the header, the
 * formula row and the body all MAP the shared list, so a second ordering cannot be reintroduced
 * without deleting a `gridCols.map` -- which this test would catch.
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */
describe("source pin: the viewer has ONE ordering and every row maps it", () => {
  const src = readFileSync(join(__dirname, "RateMasterDataViewer.tsx"), "utf-8");

  it("the header, the formula row and the body all map `gridCols`", () => {
    const mounts = src.match(/\{gridCols\.map\(/g) ?? [];
    expect(mounts.length).toBe(3);
  });

  it("the empty-state colSpan counts the shared list, not a hand-kept sum", () => {
    expect(src).toContain("colSpan={gridCols.length}");
    expect(src).not.toMatch(/colSpan=\{\(canEdit \? 1 : 0\)/);
  });

  it("⚠️ the unit cell exists ONCE -- the retired second placement is gone", () => {
    expect((src.match(/r\.it\.unit/g) ?? []).length).toBe(1);
    expect(src).not.toContain("{!piMode && <TableCell>{r.it.unit}</TableCell>}");
    expect(src).not.toContain("{piMode && <TableCell>{r.it.unit}</TableCell>}");
  });

  it("the order itself comes from the pure module, not from this component", () => {
    expect(src).toContain('from "./rateMasterGridColumns"');
    expect(src).toContain("gridColumnKeys({");
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════════════
 * ADP-4b (owner D7 / AC3, 2026-10-21): "a toggle, off by default, so the screen equals the file, plus drop the
 * empty Depth column ... same column order both sides". Read on the CURRENT HVAC asset (the highest version on disk),
 * against the column list the backend pins for the real ADP download (`test_spec_reader.py` HVAC_FILE_COLUMNS, and
 * `csv_exporter.build_category_rows` measured in-container at ADP-4b PA3: the same 13).
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */
describe("ADP-4b -- a spec-driven grid shows exactly the download's columns; 'Show spec details' adds the rest", () => {
  const DATA = join(__dirname, "../../../../../nirmaan_stack/services/boq_rate_master/data");
  const latest = readdirSync(DATA).filter((f) => /^rate_master_hvac_all_v\d+\.json$/.test(f))
    .sort((a, b) => Number(/v(\d+)/.exec(a)![1]) - Number(/v(\d+)/.exec(b)![1])).pop()!;
  const hvac = JSON.parse(readFileSync(join(DATA, latest), "utf-8")) as Asset;
  const adp = hvac.category_configs.find((c) => c.attributes_from_spec === true)!;
  const adpItems = hvac.items.filter((i) => ((adp.item_kinds as string[] | undefined) ?? []).includes(String(i.kind)));
  const HVAC_FILE_COLUMNS = ["item_uid", "discipline", "category", "brand", "unit", "item_name", "item_detail",
    "cost_install", "cost_supply", "install_markup", "supply_markup", "supply_formula", "install_formula"];
  const inputs = (details: boolean, canEdit = false) => {
    const inp = inputsFor(adp, adpItems, canEdit ? "editing" : "normal");
    return { ...inp, showSpecDetails: details };
  };
  const fileIds = (keys: string[]) => keys.map((k) => fileColumnId(k, new Set(["item_name", "item_detail"])));

  it("the sweep reaches the ADP config and its items (never vacuous)", () => {
    expect(adp.category_id).toBe("hvac_adp");
    expect(adpItems.length).toBeGreaterThan(80);
  });

  it("POSITIVE: the default grid's columns are the file's 13, in the file's order -- each one names its file column", () => {
    expect(fileIds(gridColumnKeys(inputs(false)))).toEqual(HVAC_FILE_COLUMNS);
  });

  it("POSITIVE: the admin actions column stays FIRST and is the only column the file does not carry (owner 2026-10-21)", () => {
    const keys = gridColumnKeys(inputs(false, true));
    expect(keys[0]).toBe(COL_ACTIONS);
    expect(fileIds(keys.slice(1))).toEqual(HVAC_FILE_COLUMNS);
    expect(fileColumnId(COL_ACTIONS, new Set())).toBeNull();
  });

  it("POSITIVE: the toggle adds the spec verdict and the 'read from spec' columns after the text pair, and the source sheet and row before the formulas", () => {
    const off = gridColumnKeys(inputs(false));
    const on = gridColumnKeys(inputs(true));
    const inp = inputs(true);
    const added = on.filter((k) => !off.includes(k));
    expect(added).toEqual([COL_SPEC, ...inp.attrCols.map((d) => attrColKey(d.id)), COL_SOURCE_SHEET, COL_SOURCE_ROW]);
    expect(on.indexOf(COL_SPEC)).toBe(on.indexOf(attrColKey("item_detail")) + 1);
    expect(on.indexOf(COL_SOURCE_ROW) + 1).toBe(on.indexOf("formula:supply"));
    // the file's columns keep their order inside the wider grid
    expect(on.filter((k) => off.includes(k))).toEqual(off);
    // NEGATIVE: none of the added columns is a file column
    for (const k of added) expect({ k, id: fileColumnId(k, new Set(["item_name", "item_detail"])) }).toEqual({ k, id: null });
  });

  it("NEGATIVE: a grid that is not spec-driven ignores the toggle -- every Electrical and other HVAC category is unchanged", () => {
    let checked = 0;
    for (const [disc, asset] of ASSETS) {
      for (const c of categoriesWithItems(asset, disc)) {
        if (isSpecDriven(c.config)) continue;
        const inp = inputsFor(c.config, c.items, "normal");
        expect(gridColumnKeys({ ...inp, showSpecDetails: true }), c.id).toEqual(gridColumnKeys(inp));
        expect(gridColumnKeys(inp), c.id).not.toContain(COL_ITEM_UID);
        checked++;
      }
    }
    // every category with items on Electrical v66 and HVAC v25 except the one spec-driven (ADP): 14, asserted exactly
    expect(checked).toBe(14);
  });

  it("plain labels: the identity columns by name, a rate id read as words -- no id on its own", () => {
    expect(["item_uid", "discipline", "category", "brand", "unit"].map(plainFileColumnLabel))
      .toEqual(["Item ID", "Discipline", "Category", "Brand", "Unit"]);
    expect(["cost_install", "cost_supply", "install_markup", "supply_markup"].map(plainFileColumnLabel))
      .toEqual(["Install cost", "Supply cost", "Install markup", "Supply markup"]);
  });
});

