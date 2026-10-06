// @vitest-environment jsdom
//
// THE FIRST DOM TEST IN THIS REPO (slice 12c-T, item 8, owner ruling 2026-10-07).
//
// ⚠️ WHY THIS FILE EXISTS, AND WHY NO PURE-HELPER TEST COULD REPLACE IT.
// `rateMasterGridColumns.ts` records what happened on 2026-10-03 in commit `8fa8d3262`: the `unit`
// HEADER was moved to sit just after `brand` -- "where the rate file puts it" -- and the BODY cell
// stayed after the rate columns. From that moment every grid of every category except Pricing
// Inputs rendered its values ONE PLACE LEFT of their headings: on Electrical's wiring grid the unit
// "Set" appeared under `lug_list`, "COPPER" under `Insulation`, a price under `Conduit size (mm)`;
// on HVAC Insulation the material sat under `Type` and a markup under `cost_supply`.
//
// THE DEFECT WAS INVISIBLE BECAUSE EVERY FIGURE ON THE SCREEN WAS STILL PLAUSIBLE -- only its label
// was wrong. The DOWNLOAD was correct throughout, so nothing downstream broke and no test noticed;
// the grid simply mislabelled money. That module's own docstring says the ordering "had to be
// extracted rather than tested through a render" because this repo had no DOM environment. It now
// has one, opt-in per file via the docblock above, and this is the test that closes the gap.
//
// WHAT IT ASSERTS, for one HVAC category and one Electrical category:
//   (a) the Nth rendered <th> NAMES the Nth column of the ONE ordering -- catches a one-sided
//       HEADER move, which is the side that drifted (the body maps `cells[key]`, keyed, so it
//       cannot);
//   (b) for every item row, the Nth <td> holds the value THAT column's key implies -- the
//       cell-by-cell check, driven by the column key rather than by position alone.
//
// It uses jsdom + react-dom/client ONLY. No `@testing-library` -- that was the owner's scope.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { beforeAll, describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

import { RateMasterDataViewer } from "./RateMasterDataViewer";
import {
  COL_ACTIONS, COL_BRAND, COL_FORMULA_INSTALL, COL_FORMULA_SUPPLY, COL_KIND, COL_SOURCE_ROW,
  COL_SOURCE_SHEET, COL_SPEC, COL_UNIT, gridColumnKeys,
} from "./rateMasterGridColumns";
import { categoryItemKinds, isCategoryDataScopeEmpty } from "./rateMasterStructure";
import {
  DERIVED_COPY, columnOrderForFile, isDerivedCell, isPricingInputConfig, isSpecDrivenConfig,
  sourceOrder, splitSpecColumns,
} from "./rateMasterSpec";
import type { RateCategoryConfig, RateMasterItem } from "./rateMasterTypes";

// ─── jsdom's gaps ───────────────────────────────────────────────────────────────────────────
//
// jsdom implements the DOM, not the whole browser. These are APIs the real browser has and jsdom
// does not, stubbed here so a layout effect can run. They are TEST-ENVIRONMENT shims and must never
// become product code: the component is unchanged, and anything whose correctness depends on real
// measurement (the sticky-column widths this observer feeds) is still a live-browser question.
class StubResizeObserver {
  observe() { /* no layout in jsdom */ }
  unobserve() { /* no layout in jsdom */ }
  disconnect() { /* no layout in jsdom */ }
}
if (!(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver) {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = StubResizeObserver;
}
// React 18 asks the host to declare that it is an act() environment; without it every render warns.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ─── the assets, read at RUNTIME ────────────────────────────────────────────────────────────
//
// ⚠️ READ, NEVER `import`ed: `tsc` infers a structural type for a whole JSON module and dies on a
// few megabytes (the standing rule the calculator-parity suite records).
// ⚠️ AND THE VERSION IS DERIVED, NEVER NAMED. A pin aimed at a specific future version name has a
// shelf life of one mint -- `test_h07` was hardcoded to v64, went stale at v65, was re-aimed at v66
// and the very next slice minted v66. So: take the highest N on disk, per series.
const DATA_DIR = path.resolve(__dirname, "../../../../../nirmaan_stack/services/boq_rate_master/data");

function latestAsset(prefix: string): string {
  const rx = new RegExp(`^${prefix}(\\d+)\\.json$`);
  const found = fs.readdirSync(DATA_DIR)
    .map((f) => ({ f, m: rx.exec(f) }))
    .filter((x) => x.m)
    .map((x) => ({ f: x.f, n: Number((x.m as RegExpExecArray)[1]) }))
    .sort((a, b) => a.n - b.n);
  if (!found.length) throw new Error(`no asset matching ${prefix}<N>.json in ${DATA_DIR}`);
  return path.join(DATA_DIR, found[found.length - 1].f);
}

interface Asset {
  discipline: string;
  category_configs: RateCategoryConfig[];
  items: Array<{
    kind: string; brand?: string | null; unit?: string | null;
    attributes: Record<string, string | number>; rates: Record<string, number>;
    item_uid: string; source?: { sheet?: string; row?: number };
  }>;
}

function readAsset(file: string): Asset {
  return JSON.parse(fs.readFileSync(file, "utf-8")) as Asset;
}

/** The asset's items in the shape the endpoint hands the screen: `source` flattened. */
function toItems(asset: Asset, kinds: string[], limit: number): RateMasterItem[] {
  const want = new Set(kinds);
  return asset.items
    .filter((it) => want.has(it.kind))
    .slice(0, limit)
    .map((it) => ({
      name: it.item_uid,
      item_uid: it.item_uid,
      discipline: asset.discipline,
      kind: it.kind,
      brand: it.brand ?? undefined,
      unit: it.unit ?? undefined,
      attributes: it.attributes ?? {},
      rates: it.rates ?? {},
      source_sheet: it.source?.sheet,
      source_row: it.source?.row,
    }));
}

// ─── rendering ──────────────────────────────────────────────────────────────────────────────

function render(items: RateMasterItem[], config: RateCategoryConfig, disciplineLabel: string) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <StrictMode>
        <RateMasterDataViewer
          items={items}
          config={config}
          disciplineLabel={disciplineLabel}
          categoryLabel={config.category_id}
        />
      </StrictMode>,
    );
  });
  return {
    host,
    cleanup: () => { act(() => root.unmount()); host.remove(); },
  };
}

/** The ONE ordering, derived exactly as the component derives it -- from the exported helpers. */
function expectedColumnKeys(items: RateMasterItem[], config: RateCategoryConfig): string[] {
  const kinds = categoryItemKinds(config);
  const scoped = isCategoryDataScopeEmpty(config)
    ? []
    : sourceOrder(items.filter((it) => kinds.includes(it.kind)));
  const specMode = isSpecDrivenConfig(config);
  const specCols = splitSpecColumns(config.attribute_definitions);
  const textCols = specMode ? specCols.text : [];
  const fileOrder = columnOrderForFile(config, scoped);
  const defs = specMode
    ? specCols.derived
    : config.attribute_definitions.filter((d) => d.id !== "brand");
  const rank = new Map(fileOrder.attrs.map((id, i) => [id, i] as const));
  const known = defs.filter((d) => rank.has(d.id))
    .sort((x, y) => (rank.get(x.id) as number) - (rank.get(y.id) as number));
  const attrCols = [...known, ...defs.filter((d) => !rank.has(d.id))];
  return gridColumnKeys({
    canEdit: false,                       // rendered without `isAdmin`, so no actions column
    showKindCol: kinds.length > 1,
    piMode: isPricingInputConfig(config),
    specMode,
    showImpactCol: false,
    textCols,
    attrCols,
    rateCols: fileOrder.rates,
  });
}

/** What the cell under `key` must read for `item`. `null` = this test makes no claim about it. */
function expectedCell(key: string, item: RateMasterItem, config: RateCategoryConfig): string | null {
  if (key === COL_BRAND) return String(item.brand ?? "");
  if (key === COL_UNIT) return String(item.unit ?? "");
  if (key === COL_KIND) return String(item.kind ?? "");
  if (key === COL_SOURCE_SHEET) return String(item.source_sheet ?? "");
  if (key === COL_SOURCE_ROW) return String(item.source_row ?? "");
  if (key.startsWith("attr:")) {
    const v = item.attributes?.[key.slice(5)];
    return v === null || v === undefined ? "" : String(v);
  }
  if (key.startsWith("rate:")) {
    const k = key.slice(5);
    const v = item.rates?.[k];
    // ⚠️ A DERIVED CELL CARRIES THE WORD AS WELL AS THE FIGURE, and that is the I-2/I-3 marking,
    // not noise: its figure comes from ANOTHER catalogue row, so the cell is read-only and says so.
    // (This test found it -- the first draft expected the bare number on HVAC Insulation's
    // `cost_insulation`, which is declared derived on three of its rows.) An ABSENT derived cell
    // shows the word ALONE, which is also deliberate: "absent" and "not applicable" differ.
    const tag = isDerivedCell(config, item.item_uid, k) ? DERIVED_COPY.cellTag : "";
    if (v === null || v === undefined) return tag;
    return String(v) + tag;
  }
  // the spec verdict and the two formula columns are PROSE generated from the config, not a value
  // read off the row -- their alignment is covered by (a), their text by the exporter's own tests
  if (key === COL_SPEC || key === COL_FORMULA_SUPPLY || key === COL_FORMULA_INSTALL) return null;
  if (key === COL_ACTIONS) return null;
  return null;
}

/** The label the header for `key` must NAME. `null` = no claim (prose / derived headers). */
function expectedHeaderNames(key: string, config: RateCategoryConfig): string | null {
  if (key === COL_BRAND) return "brand";
  if (key === COL_UNIT) return "unit";
  if (key === COL_KIND) return "kind";
  if (key === COL_SOURCE_SHEET) return "source sheet";
  if (key.startsWith("attr:")) {
    const id = key.slice(5);
    const d = config.attribute_definitions.find((x) => x.id === id);
    return d ? d.label : null;
  }
  if (key.startsWith("rate:")) return key.slice(5);   // the KEY always LEADS the cell
  return null;
}

function headerTexts(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll("thead tr th")).map((th) => th.textContent ?? "");
}

function itemRowCells(host: HTMLElement): string[][] {
  return Array.from(host.querySelectorAll("tbody tr"))
    .filter((tr) => tr.getAttribute("data-testid") !== "formula-row")
    .map((tr) => Array.from(tr.querySelectorAll("td")).map((td) => td.textContent ?? ""));
}

// ─── the two subjects ───────────────────────────────────────────────────────────────────────

interface Subject {
  label: string;
  discipline: string;
  categoryId: string;
  items: RateMasterItem[];
  config: RateCategoryConfig;
}

const SUBJECTS: Subject[] = [];

beforeAll(() => {
  const specs = [
    { label: "HVAC / hvac_insulation", prefix: "rate_master_hvac_all_v", categoryId: "hvac_insulation" },
    { label: "Electrical / wiring_cabling", prefix: "rate_master_electrical_all_v", categoryId: "wiring_cabling" },
  ];
  for (const s of specs) {
    const asset = readAsset(latestAsset(s.prefix));
    const config = asset.category_configs.find((c) => c.category_id === s.categoryId);
    if (!config) throw new Error(`${s.categoryId} is not in ${s.prefix}<latest>`);
    const items = toItems(asset, categoryItemKinds(config), 6);
    if (!items.length) throw new Error(`${s.categoryId} has no items in the asset`);
    SUBJECTS.push({ label: s.label, discipline: asset.discipline, categoryId: s.categoryId, items, config });
  }
});

describe("RateMasterDataViewer -- every cell sits under its correct header", () => {
  it("renders a real table for both disciplines", () => {
    for (const s of SUBJECTS) {
      const { host, cleanup } = render(s.items, s.config, s.discipline);
      try {
        const heads = headerTexts(host);
        const rows = itemRowCells(host);
        expect(heads.length, `${s.label}: header cells`).toBeGreaterThan(4);
        expect(rows.length, `${s.label}: item rows`).toBe(s.items.length);
        // the formula / explanation row is present and is NOT counted as an item row
        expect(host.querySelectorAll('tbody tr[data-testid="formula-row"]').length).toBe(1);
      } finally {
        cleanup();
      }
    }
  });

  it("(a) the Nth header NAMES the Nth column of the one ordering", () => {
    for (const s of SUBJECTS) {
      const keys = expectedColumnKeys(s.items, s.config);
      const { host, cleanup } = render(s.items, s.config, s.discipline);
      try {
        const heads = headerTexts(host);
        expect(heads.length, `${s.label}: one header per planned column`).toBe(keys.length);
        const wrong: string[] = [];
        keys.forEach((key, i) => {
          const want = expectedHeaderNames(key, s.config);
          if (want === null) return;
          if (!(heads[i] ?? "").includes(want)) {
            wrong.push(`col ${i} key=${key} wanted header naming "${want}" but read "${heads[i]}"`);
          }
        });
        expect(wrong, `${s.label}: headers out of step with the ordering`).toEqual([]);
      } finally {
        cleanup();
      }
    }
  });

  it("(b) every body cell holds the value its own column's key implies", () => {
    for (const s of SUBJECTS) {
      const keys = expectedColumnKeys(s.items, s.config);
      const ordered = sourceOrder(s.items.filter((it) => categoryItemKinds(s.config).includes(it.kind)));
      const { host, cleanup } = render(s.items, s.config, s.discipline);
      try {
        const rows = itemRowCells(host);
        expect(rows.length).toBe(ordered.length);
        const wrong: string[] = [];
        let checked = 0;
        ordered.forEach((item, r) => {
          expect(rows[r].length, `${s.label}: row ${r} cell count`).toBe(keys.length);
          keys.forEach((key, c) => {
            const want = expectedCell(key, item, s.config);
            if (want === null) return;
            checked += 1;
            const got = (rows[r][c] ?? "").trim();
            if (got !== want.trim()) {
              wrong.push(`row ${r} col ${c} key=${key}: wanted "${want}" read "${got}"`);
            }
          });
        });
        // ⚠️ THE ANTI-VACUITY FLOOR. Without it a mapping bug that produced zero comparable cells
        // would pass silently -- the exact shape of defect this file exists to catch.
        expect(checked, `${s.label}: cells actually compared`).toBeGreaterThan(20);
        expect(wrong, `${s.label}: cells under the wrong header`).toEqual([]);
      } finally {
        cleanup();
      }
    }
  });

  it("the ordering really does place `unit` right after `brand` on a SKU grid", () => {
    // the specific claim `8fa8d3262` broke, asserted on the RENDERED header row
    for (const s of SUBJECTS) {
      const { host, cleanup } = render(s.items, s.config, s.discipline);
      try {
        const heads = headerTexts(host).map((h) => h.trim());
        const b = heads.findIndex((h) => h === "brand");
        const u = heads.findIndex((h) => h === "unit");
        expect(b, `${s.label}: a SKU grid has a brand header`).toBeGreaterThanOrEqual(0);
        expect(u, `${s.label}: a SKU grid has a unit header`).toBe(b + 1);
      } finally {
        cleanup();
      }
    }
  });
});
