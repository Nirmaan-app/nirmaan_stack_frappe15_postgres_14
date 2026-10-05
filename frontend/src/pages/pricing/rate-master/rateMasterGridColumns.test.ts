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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ELECTRICAL from "../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_electrical_all_v66.json";
import HVAC from "../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v25.json";
import { columnOrderForFile } from "./rateMasterSpec";
import CAT_KINDS from "../../../../../scripts/_instruments/cat_kinds.json";
import {
  gridColumnKeys, gridColumnsSharedWithFile, attrColKey, rateColKey,
  COL_UNIT, COL_BRAND, COL_ACTIONS, COL_PI_NAME,
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
         * ⚠️ ONE DOCUMENTED DIVERGENCE, AND IT IS DELIBERATE: a SPEC-DRIVEN category puts its text
         * pair (`item_name`, `item_detail`) FIRST on the screen -- slice 1c / U3, "the text pair
         * FIRST, then the spec verdict, then brand" -- and omits its DERIVED attribute columns from
         * the file entirely. So for such a category the screen and the file legitimately differ in
         * where the text pair sits, and the file is not a complete reference for the rest.
         * Everywhere else the two orders must agree exactly, which is what `8fa8d3262` intended.
         */
        const fileOrder = inp.specMode
          ? [
              ...inp.textCols.map((d) => attrColKey(d.id)),
              COL_BRAND, COL_UNIT,
              ...inp.attrCols.map((d) => attrColKey(d.id)),
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
