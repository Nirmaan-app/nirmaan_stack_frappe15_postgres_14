// @vitest-environment jsdom
//
// ELR-1 AC4 (owner R-ELR0 2026-10-27 "7 ok": the Data Viewer matches the download; Q2 / Q3 rulings "a", 2026-10-27).
//
// THE PRODUCT VIEWER AGAINST THE EXPORTER'S OWN FILE, CELL BY CELL, EVERY ROW. The fixture
// (`__fixtures__/viewerVsFileElr1.json`) is the exporter's real download -- `csv_exporter.build_category_csv` and
// `build_category_xlsx`, read back by the importer's own readers -- for all 13 Electrical categories and the HVAC
// Pricing Inputs, taken from the dev database at Electrical v67 / HVAC v54 (live == file by content). The viewer is
// rendered from THOSE asset files, in the shape the endpoint hands the page.
//
// What it proves, per category (named below, never a count floor):
//   (1) the headers: the file id under each header, in order, equals the file's header row -- none extra, none missing;
//   (2) the rows: the same number of rows, and every cell's text equals the file's, CSV and Excel alike. The category
//       cell shows the display name (owner N-7) where the file writes the id; nothing else is mapped.
//   (3) the grids this slice must NOT change render byte-identical to before it (hashes taken with the pre-ELR-1
//       viewer): Insulation, Piping, ADP, the six HVAC empty-state categories and point_wiring's empty state (Q2).
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { describe, expect, it } from "vitest";
import crypto from "crypto";
import path from "path";
import { pathToFileURL } from "url";
import { readJsonFixture } from "@/pages/pricing/calculatorPanelParity.harness";

import { RateMasterDataViewer } from "./RateMasterDataViewer";
import { pricingInputUsedBy } from "./rateMasterSpec";
import type { RateCategoryConfig, RateMasterItem } from "./rateMasterTypes";

class StubResizeObserver {
  observe() { /* no layout in jsdom */ }
  unobserve() { /* no layout in jsdom */ }
  disconnect() { /* no layout in jsdom */ }
}
if (!(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver) {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = StubResizeObserver;
}
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DATA_DIR = path.resolve(__dirname, "../../../../../nirmaan_stack/services/boq_rate_master/data");
const FIXTURE = path.resolve(__dirname, "../__fixtures__/viewerVsFileElr1.json");

interface FileTable { headers: string[]; rows: string[][] }
interface Fixture {
  assets: Record<string, string>;
  categories: Record<string, { discipline: string; n: number; csv: FileTable; xlsx: FileTable }>;
}
interface Asset {
  discipline: string;
  category_configs: RateCategoryConfig[];
  items: Array<{ kind: string; brand?: string | null; unit?: string | null; attributes: Record<string, unknown>;
                 rates: Record<string, number>; item_uid: string; source?: { sheet?: string; row?: number } }>;
}

const fixture = readJsonFixture<never>(pathToFileURL(FIXTURE)) as Fixture;
const assets: Record<string, Asset> = {};
for (const [disc, file] of Object.entries(fixture.assets)) {
  assets[disc] = readJsonFixture<never>(pathToFileURL(path.join(DATA_DIR, file))) as Asset;
}

/** The items as `get_rate_master_items` hands them to the page: `source` flattened, `brand` projected (read time). */
function feed(asset: Asset): RateMasterItem[] {
  return asset.items.map((it) => ({
    name: it.item_uid, item_uid: it.item_uid, discipline: asset.discipline, kind: it.kind,
    brand: it.brand ?? undefined, unit: it.unit ?? undefined,
    attributes: { ...(it.brand ? { brand: it.brand } : {}), ...(it.attributes ?? {}) } as RateMasterItem["attributes"],
    rates: it.rates ?? {}, source_sheet: it.source?.sheet, source_row: it.source?.row,
  }));
}

function render(asset: Asset, config: RateCategoryConfig): { host: HTMLElement; cleanup: () => void } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const names: Record<string, string> = {};
  for (const c of asset.category_configs) names[c.category_id] = String(c.category_display || c.category_id);
  act(() => {
    root.render(
      <StrictMode>
        <RateMasterDataViewer
          items={feed(asset)}
          config={config}
          disciplineLabel={asset.discipline}
          categoryLabel={names[config.category_id]}
          derivedUsedBy={pricingInputUsedBy(asset.category_configs as never)}
          categoryNameById={names}
        />
      </StrictMode>,
    );
  });
  return { host, cleanup: () => { act(() => root.unmount()); host.remove(); } };
}

/** A header cell's file id, as drawn beneath its label; "" for a column the file does not carry. */
function headerIds(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll("thead tr th"))
    .map((th) => th.querySelector('[data-testid="file-column-id"]')?.textContent ?? "");
}

function bodyRows(host: HTMLElement): string[][] {
  return Array.from(host.querySelectorAll("tbody tr"))
    .filter((tr) => tr.getAttribute("data-testid") !== "formula-row")
    .map((tr) => Array.from(tr.querySelectorAll("td")).map((td) => td.textContent ?? ""));
}

/** The file's header KEY: a rate header carries its label in brackets (`list_price [List price]`). */
const headerKey = (h: string) => h.replace(/ \[[^\]]*\]$/, "");
const isFormulaRow = (r: string[]) => String(r[0] ?? "").startsWith("(formula row");

/** The 13 Electrical categories with items (point_wiring is the empty state, below) and the HVAC Pricing Inputs. */
const FOLLOWS_FILE = [
  "cabletray_raceway", "conduit_piping", "db_switchgear", "earthing", "electrical_pricing_inputs", "industrial_sockets",
  "junction_box_raceway", "lighting_mgmt_system", "miscellaneous", "popup_boxes", "switches_sockets", "wiring_cabling",
  "hvac_pricing_inputs",
];

describe("ELR-1 AC4: the Data Viewer equals the download, cell for cell (Electrical + both Pricing Inputs grids)", () => {
  it("the fixture holds exactly the categories named here, plus point_wiring", () => {
    expect(Object.keys(fixture.categories).sort()).toEqual([...FOLLOWS_FILE, "point_wiring"].sort());
  });

  for (const cid of FOLLOWS_FILE) {
    it(`${cid}: headers, row count and every cell equal the CSV and the Excel download`, () => {
      const fc = fixture.categories[cid];
      const asset = assets[fc.discipline];
      const config = asset.category_configs.find((c) => c.category_id === cid)!;
      const display = String(config.category_display || cid);
      const { host, cleanup } = render(asset, config);
      try {
        const ids = headerIds(host);
        for (const [fmt, table] of [["csv", fc.csv], ["xlsx", fc.xlsx]] as const) {
          // (1) the headers -- every column the screen shows is a file column, in the file's order
          expect(ids, `${cid} ${fmt} headers`).toEqual(table.headers.map(headerKey));
          // (2) the rows
          const fileRows = table.rows.filter((r) => !isFormulaRow(r));
          const screen = bodyRows(host);
          expect(screen.length, `${cid} ${fmt} rows`).toBe(fc.n);
          expect(fileRows.length, `${cid} ${fmt} file rows`).toBe(fc.n);
          const ci = table.headers.indexOf("category");
          const diffs: string[] = [];
          fileRows.forEach((fr, i) => {
            const want = fr.map((v, j) => (j === ci && v === cid ? display : String(v ?? "")));
            screen[i].forEach((got, j) => {
              if (got !== want[j]) diffs.push(`${cid} ${fmt} row ${i} ${table.headers[j]}: screen ${JSON.stringify(got)} file ${JSON.stringify(want[j])}`);
            });
          });
          expect(diffs.slice(0, 10), `${cid} ${fmt}: ${diffs.length} cell(s) differ`).toEqual([]);
        }
      } finally {
        cleanup();
      }
    });
  }

  it("NEGATIVE: the always-empty declared columns are gone and the file-only keys are present (db_switchgear)", () => {
    const asset = assets.Electrical;
    const config = asset.category_configs.find((c) => c.category_id === "db_switchgear")!;
    const { host, cleanup } = render(asset, config);
    try {
      const ids = headerIds(host);
      // declared, never filled by an item: a panel field, not a catalogue column
      expect(ids).not.toContain("mcb1_qty");
      expect(ids).not.toContain("db_shell_item");
      // carried by the items with no definition: a file column all the same
      for (const k of ["curve", "device", "family", "item", "pole"]) expect(ids).toContain(k);
      // and the screen-only source columns are not drawn
      expect(host.textContent).not.toContain("source sheet");
    } finally {
      cleanup();
    }
  });
});

// The pre-ELR-1 viewer's rendered HTML, sha256 (16 hex), `isAdmin` false: the HEAD (6561df525) copy of
// RateMasterDataViewer.tsx rendered by a scratch probe from the same assets and the same props as `renderPlain`.
// React's `useId` values (`:r1f:`) come from a counter shared by every root in the process, so they depend on what
// rendered before; they are normalised away -- the HEAD and the new viewer then hash equal on every grid below.
const BEFORE: Record<string, string> = {
  "HVAC/hvac_insulation": "0e995dc8e67d0bed",
  "HVAC/hvac_piping": "097fb6bca9ef94a6",
  "HVAC/hvac_adp": "592fc8ac41f4898c",
  "HVAC/hvac_ahu": "caa39b922a959f10",
  "HVAC/hvac_dx_unit": "a5c96d02dcc4aede",
  "HVAC/hvac_panels": "2b7f47527fbde60c",
  "HVAC/hvac_pumps": "7bb862e8df829e6b",
  "HVAC/hvac_cables": "0f3a525564168949",
  "HVAC/hvac_raceway": "56d65b82bd08b0ee",
  "Electrical/point_wiring": "03f32586a57e14a3",
};

/** The probe's exact render: items as the asset holds them (no projection), the category id as its label. */
function renderPlain(asset: Asset, config: RateCategoryConfig): string {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const items: RateMasterItem[] = asset.items.map((it) => ({
    name: it.item_uid, item_uid: it.item_uid, discipline: asset.discipline, kind: it.kind,
    brand: it.brand ?? undefined, unit: it.unit ?? undefined, attributes: (it.attributes ?? {}) as RateMasterItem["attributes"],
    rates: it.rates ?? {}, source_sheet: it.source?.sheet, source_row: it.source?.row,
  }));
  act(() => {
    root.render(<StrictMode><RateMasterDataViewer items={items} config={config} disciplineLabel={asset.discipline}
      categoryLabel={config.category_id} isAdmin={false} /></StrictMode>);
  });
  const html = host.innerHTML.replace(/:r[0-9a-z]+:/g, ":r:");
  act(() => root.unmount());
  host.remove();
  return html;
}

describe("ELR-1 AC4: the grids this slice must not change render byte-identical to before it", () => {
  for (const [key, before] of Object.entries(BEFORE)) {
    it(`${key}: unchanged`, () => {
      const [disc, cid] = key.split("/");
      const asset = assets[disc];
      const config = asset.category_configs.find((c) => c.category_id === cid)!;
      const html = renderPlain(asset, config);
      expect(crypto.createHash("sha256").update(html).digest("hex").slice(0, 16)).toBe(before);
    });
  }

  it("point_wiring (owner Q2 'a', no extra sentence): today's empty-state line exactly, and no table", () => {
    const asset = assets.Electrical;
    const html = renderPlain(asset, asset.category_configs.find((c) => c.category_id === "point_wiring")!);
    expect(html).toContain("This category has no data rows of its own &mdash; its pricing derives from other categories&rsquo; items.".replace("&mdash;", "—").replace("&rsquo;", "’"));
    expect(html).not.toContain("<table");
  });
});
