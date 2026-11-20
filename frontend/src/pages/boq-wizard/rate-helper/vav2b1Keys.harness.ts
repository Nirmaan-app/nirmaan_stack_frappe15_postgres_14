/**
 * VAV-2b1: the next HVAC rate file's keys (ONE file, `__fixtures__/vav2b1Keys.json`, also read by mint_hvac_v79_vav2b1.py) and their
 * transformation of ONE hvac_vav_box config -- a module with no other harness import and file paths resolved from __dirname, so a jsdom
 * test can use it too (jsdom gives `import.meta.url` no file scheme). Scratch copies only; the asset file is never written.
 */
import path from "path";
import { pathToFileURL } from "url";
import type { RateCategoryConfig, RateMasterItem } from "../../pricing/rate-master/rateMasterTypes";
import { readJsonFixture } from "../../pricing/calculatorPanelParity.harness";

type Json = Record<string, unknown>;
type Reason = { title?: string; why?: string };
export type Keys3 = {
  items: Array<Json & { item_uid: string; kind: string; attributes: Json }>;
  pricing: { withdrawn_families: string[]; own_row_check_serves_also: string[]; combination_warning_heading: string; band_from_lower_limit: Json;
    sheet_shares: Json & { count: Json; separate: Json } };
  derivation_reasons: { replace: Record<string, Reason>; new: Reason[] };
};
const FIX = path.resolve(__dirname, "__fixtures__");
export const KEYS3 = readJsonFixture<Keys3>(pathToFileURL(path.join(FIX, "vav2b1Keys.json")));

/** What a test changes on the keys (the QR modes; keys taken out for KEY ABSENT = UNCHANGED). */
export type V79Over = { blank?: "skip" | "sheet_off"; drop?: Array<"withdrawn_families" | "serves_also" | "heading" | "lower_limit" | "sheet_shares">;
  separate?: Json };

/** The next rate file's transformation of ONE hvac_vav_box config (the mint does the same in Python). Idempotent. */
export function withV79Keys(cfg: RateCategoryConfig, over: V79Over = {}): RateCategoryConfig {
  const c = structuredClone(cfg) as unknown as { list_spec: { pricing: Json } };
  const pr = c.list_spec.pricing;
  const drop = new Set(over.drop ?? []);
  if (drop.has("withdrawn_families")) delete pr.withdrawn_families; else pr.withdrawn_families = [...KEYS3.pricing.withdrawn_families];
  const oc = pr.own_row_check as { serves?: Json } | undefined;
  if (oc?.serves) { if (drop.has("serves_also")) delete oc.serves.also; else oc.serves.also = [...KEYS3.pricing.own_row_check_serves_also]; }
  const cw = pr.combination_warning as Json | undefined;
  if (cw) { if (drop.has("heading")) delete cw.heading; else cw.heading = KEYS3.pricing.combination_warning_heading; }
  const bf = pr.band_from as Json | undefined;
  if (bf) { if (drop.has("lower_limit")) delete bf.lower_limit; else bf.lower_limit = structuredClone(KEYS3.pricing.band_from_lower_limit); }
  if (drop.has("sheet_shares")) delete pr.sheet_shares;
  else {
    const ss = structuredClone(KEYS3.pricing.sheet_shares);
    if (over.blank) (ss.count as Json).blank = over.blank;
    if (over.separate) ss.separate = structuredClone(over.separate);
    pr.sheet_shares = ss;
  }
  const rs = pr.derivation_reasons as Reason[];
  if (!drop.has("sheet_shares")) {
    for (const [from, to] of Object.entries(KEYS3.derivation_reasons.replace)) {
      const i = rs.findIndex((r) => r.title === from);
      if (i >= 0) rs[i] = { ...to };
    }
  }
  for (const r of KEYS3.derivation_reasons.new) if (!rs.some((x) => x.title === r.title)) rs.push({ ...r });
  return c as unknown as RateCategoryConfig;
}

/** the items with the next file's new items (a new item the items already carry is taken from them) */
export function withV79Items(items: readonly RateMasterItem[]): RateMasterItem[] {
  const has = (uid: string) => items.some((i) => (i as unknown as { item_uid?: string }).item_uid === uid);
  return [...items, ...KEYS3.items.filter((i) => !has(i.item_uid)).map((i) => ({ ...structuredClone(i), discipline: "HVAC" } as unknown as RateMasterItem))];
}

/** VAV-2b1: real rows of the 84 VAV sheets (description, own notes, unit, quantity, category), copied from VAV-D0's read-only dump */
export type RealRow = { ref: string; kind: string; category: string; unit: string | null; qty: number | null; description: string; notes: string[]; headings: string[] };
export const REAL = readJsonFixture<{ rows: RealRow[] }>(pathToFileURL(path.join(FIX, "vav2b1RealRows.json"))).rows;
