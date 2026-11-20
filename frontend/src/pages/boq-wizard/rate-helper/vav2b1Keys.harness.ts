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
    own_row_check_zero_rows: Json; integrator_cabling_zero_rows: Json;
    sheet_shares: Json & { count: Json; separate: Json } };
  derivation_reasons: { replace: Record<string, Reason>; new: Reason[] };
};
const FIX = path.resolve(__dirname, "__fixtures__");
export const KEYS3 = readJsonFixture<Keys3>(pathToFileURL(path.join(FIX, "vav2b1Keys.json")));

/** What a test changes on the keys (the QR modes; keys taken out for KEY ABSENT = UNCHANGED). */
export type V79Over = { blank?: "skip" | "sheet_off"; drop?: Array<"withdrawn_families" | "serves_also" | "heading" | "lower_limit" | "sheet_shares" | "zero_rows">;
  separate?: Json };

/** The next rate file's transformation of ONE hvac_vav_box config (the mint does the same in Python). Idempotent. */
export function withV79Keys(cfg: RateCategoryConfig, over: V79Over = {}): RateCategoryConfig {
  const c = structuredClone(cfg) as unknown as { list_spec: { pricing: Json } };
  const pr = c.list_spec.pricing;
  const drop = new Set(over.drop ?? []);
  if (drop.has("withdrawn_families")) delete pr.withdrawn_families; else pr.withdrawn_families = [...KEYS3.pricing.withdrawn_families];
  const oc = pr.own_row_check as { serves?: Json } | undefined;
  if (oc?.serves) { if (drop.has("serves_also")) delete oc.serves.also; else oc.serves.also = [...KEYS3.pricing.own_row_check_serves_also]; }
  // rule 4 (owner 21:05 / 21:47): the quantity-0 own rows
  const oc2 = pr.own_row_check as Json | undefined;
  if (oc2) { if (drop.has("zero_rows")) delete oc2.zero_rows; else oc2.zero_rows = structuredClone(KEYS3.pricing.own_row_check_zero_rows); }
  const ic = pr.integrator_cabling as Json | undefined;
  if (ic) { if (drop.has("zero_rows")) delete ic.zero_rows; else ic.zero_rows = structuredClone(KEYS3.pricing.integrator_cabling_zero_rows); }
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

/** VAV-2b1 v80 (owner 2026-11-21 01:07 / 01:09 "yes for both"): the full-rate add of the three shared items (ONE file,
 *  `__fixtures__/vav2b1KeysV80.json`, also read by mint_hvac_v80_vav2b1.py). Applied to the v79 VAV config and the Sensors config. */
type CopyOf = Record<string, { copy_of: string }>;
type ValueAdd = { value: string; before: string };
export type KeysV80 = {
  vav: { families_add: CopyOf; vav_item_values_add?: ValueAdd; withdrawn_add: string[]; sensors_section_families_add: string[];
    user_addable: Array<{ family: string; share?: string; line?: string }>; derivation_reasons_new: Reason[]; sheet_shares_lines_add?: Record<string, string>;
    sheet_shares_whole?: Json[]; separate_not_words_add?: Record<string, string> };
  sensors: { families_add: CopyOf; sensor_values_add: ValueAdd };
};
export const KEYS80 = readJsonFixture<KeysV80>(pathToFileURL(path.join(FIX, "vav2b1KeysV80.json")));
type ListCfg = { list_spec: { family_attribute_id: string; attribute_definitions: Array<{ id: string; values?: string[] }>;
  sections?: Array<{ id: string; families?: string[] }>; pricing: Json & { families: Record<string, unknown> } } };
const addFamilies = (c: ListCfg, add: CopyOf) => {
  for (const [f, d] of Object.entries(add)) if (!c.list_spec.pricing.families[f]) c.list_spec.pricing.families[f] = structuredClone(c.list_spec.pricing.families[d.copy_of]);
};
const addValue = (c: ListCfg, add: ValueAdd) => {
  const def = c.list_spec.attribute_definitions.find((d) => d.id === c.list_spec.family_attribute_id);
  if (!def?.values || def.values.includes(add.value)) return;
  const at = def.values.indexOf(add.before);
  def.values.splice(at < 0 ? def.values.length : at, 0, add.value);
};

/** v80's transformation of ONE hvac_vav_box config (on v79's; the mint does the same in Python). Idempotent. `drop: ["user_addable"]`
 *  takes out only the offer (the vacuity: the families stay withdrawn and offered nowhere). */
export function withV80Keys(cfg: RateCategoryConfig, over: { drop?: Array<"user_addable"> } = {}): RateCategoryConfig {
  const c = structuredClone(cfg) as unknown as ListCfg;
  const pr = c.list_spec.pricing as Json & { families: Record<string, unknown>; withdrawn_families?: string[]; derivation_reasons?: Reason[] };
  const k = KEYS80.vav;
  addFamilies(c, k.families_add);
  if (k.vav_item_values_add) addValue(c, k.vav_item_values_add);
  pr.withdrawn_families = [...(pr.withdrawn_families ?? []), ...k.withdrawn_add.filter((f) => !(pr.withdrawn_families ?? []).includes(f))];
  const sec = (c.list_spec.sections ?? []).find((s) => s.id === "sensors");
  if (sec) sec.families = [...(sec.families ?? []), ...k.sensors_section_families_add.filter((f) => !(sec.families ?? []).includes(f))];
  if ((over.drop ?? []).includes("user_addable")) delete pr.user_addable; else pr.user_addable = structuredClone(k.user_addable);
  const ss = pr.sheet_shares as { lines?: Record<string, string>; whole?: Json[]; separate?: { extras: Array<{ label: string; not_words?: string }> } } | undefined;
  if (ss?.lines && k.sheet_shares_lines_add) Object.assign(ss.lines, k.sheet_shares_lines_add);
  if (ss && k.sheet_shares_whole) ss.whole = structuredClone(k.sheet_shares_whole);
  for (const [label, words] of Object.entries(k.separate_not_words_add ?? {})) {
    const e = ss?.separate?.extras.find((x) => x.label === label);
    if (e && !(e.not_words ?? "").includes(words)) e.not_words = e.not_words ? `${e.not_words}|${words}` : words;
  }
  const rs = (pr.derivation_reasons ??= []);
  for (const r of k.derivation_reasons_new) if (!rs.some((x) => x.title === r.title)) rs.push({ ...r });
  return c as unknown as RateCategoryConfig;
}

/** v80's transformation of the borrow-only hvac_sensors config: the Duct Static Pressure Sensor as a family. Idempotent. */
export function withV80Sensors(cfg: RateCategoryConfig): RateCategoryConfig {
  const c = structuredClone(cfg) as unknown as ListCfg;
  addFamilies(c, KEYS80.sensors.families_add);
  addValue(c, KEYS80.sensors.sensor_values_add);
  return c as unknown as RateCategoryConfig;
}
