/** DU-1 Part B: the newest HVAC asset, the owner's 97 duct sheet rows, and the model reading of a sheet row (shared by the duct tests). */
import { readdirSync } from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { readJsonFixture } from "../../pricing/calculatorPanelParity.harness";

export type SheetRow = { src: number; row: string; unit: string; sheet: [number, number] };
type Asset = { items: Array<Record<string, unknown>>; category_configs: Array<{ category_id: string }> };
const DATA = path.resolve(__dirname, "../../../../../nirmaan_stack/services/boq_rate_master/data");
/** the latest HVAC asset by version number */
export const LATEST = readdirSync(DATA).filter((f) => /^rate_master_hvac_all_v\d+\.json$/.test(f))
  .sort((a, b) => Number(a.match(/v(\d+)/)![1]) - Number(b.match(/v(\d+)/)![1])).pop()!;
const A = readJsonFixture<Asset>(pathToFileURL(path.join(DATA, LATEST)));
export const SHEET = readJsonFixture<{ rows: SheetRow[] }>(new URL("./__fixtures__/du1DuctSheet97.json", import.meta.url)).rows;
export const ITEMS: Array<Record<string, unknown>> = A.items.map((i) => ({ ...i, discipline: "HVAC" }));
export const CFG = new Map(A.category_configs.map((c) => [c.category_id, c]));
export const cell = (value: string) => ({ value, confidence: 0.9 });

/** the item 1 (+ insulation section) the model returns for a sheet row, as DU-D0 D6 read them */
export function ductItems(name: string): unknown[] {
  const g = name.match(/(\d{2})G/)?.[1];
  const dia = /Round/.test(name) ? name.match(/(\d+) mm(?! insulation)/)?.[1] : undefined;
  const ins = name.match(/\+ (\d+) mm insulation/)?.[1];
  const pir = /PIR/.test(name) ? name.match(/(\d+) mm/)?.[1] : undefined;
  const type = pir ? "PIR (Pre Insulated Duct)" : /Fire Rated/.test(name) ? "Fire Rated (MS)" : /Round/.test(name) ? "Round (GI) - per metre"
    : /Spiral/.test(name) ? "Spiral / Oval (GI)" : "Rectangular (GI)";
  const it0 = { attributes: { duct_type: cell(type), duct_type_as_written: cell(name), gauge_as_written: cell(pir ? `${pir} mm` : `${g}G`),
    ...(dia ? { size_as_written: cell(`${dia} mm dia`) } : {}), insulated: cell(ins ? "Yes" : "No") } };
  return ins ? [it0, { section: "insulation", attributes: { item: cell("Thermal Nitrile Insulation"), thickness_mm: cell(`${ins} mm`), cladding: cell("None") } }] : [it0];
}
