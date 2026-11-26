/**
 * VAV-2a2: the v78 hvac_vav_box keys (ONE file, `__fixtures__/vav2a2Keys.json`, also read by the v78 mint) applied to a SCRATCH COPY of
 * the newest asset's VAV config, so the vav2a2* tests run the same on v77 (keys applied here) and on v78 (keys already there; applying
 * them again changes nothing). The asset file is never written. Shared by the vav2a2* tests.
 */
import type { RateCategoryConfig } from "../../pricing/rate-master/rateMasterTypes";
import { readJsonFixture } from "../../pricing/calculatorPanelParity.harness";
import { BY_ID, VAV, blk, type Block, type TabLine } from "./vav1Vav.harness";

type Json = Record<string, unknown>;
type Reason = { rule?: string; title?: string; why?: string };
export type Keys2 = {
  attribute_definitions_before: string;
  attribute_definitions: Json[];
  pricing: { band_from: Json & { bands: Array<{ value: string; max: number }>; inlet_table: Array<{ inch: number; band: string }> }; source_tags: Json; defaults: Json; panel_notes: Json; panel_controls_add: Json };
  own_row_check_serves: Json;
  derivation_reasons: { move_first: string; before: string; narrow: Record<string, string>; append_why: Record<string, string>; new: Reason[] };
};
export const KEYS2 = readJsonFixture<Keys2>(new URL("./__fixtures__/vav2a2Keys.json", import.meta.url));
/** the edge reason is written when the owner rules QR-E; until then the placeholder stands in the fixture */
export const EDGE_PLACEHOLDER = "EDGE_REASON";

/**
 * The v78 transformation of ONE hvac_vav_box config (the mint does the same in Python): the two definitions before the band's; the
 * pricing keys set (band_from, source_tags, panel_notes, the typed boxes' controls; defaults merged); the B7 quantity reason moved before
 * VAV-1's borrowed-section reasons (B5) and the new reasons appended. Idempotent. `over` replaces band_from fields (edge tests).
 */
export function withV78Keys(cfg: RateCategoryConfig, over: { band_from?: Json; serves?: Json | null; edgeReason?: string } = {}): RateCategoryConfig {
  const c = structuredClone(cfg) as unknown as { list_spec: { attribute_definitions: Json[]; pricing: Json } };
  const ls = c.list_spec;
  const defs = ls.attribute_definitions;
  for (const d of [...KEYS2.attribute_definitions].reverse()) {
    if (defs.some((x) => x.id === d.id)) continue;
    const at = defs.findIndex((x) => x.id === KEYS2.attribute_definitions_before);
    defs.splice(at < 0 ? defs.length : at, 0, structuredClone(d));
  }
  const pr = ls.pricing;
  pr.band_from = { ...structuredClone(KEYS2.pricing.band_from), ...(over.band_from ?? {}) };
  pr.source_tags = structuredClone(KEYS2.pricing.source_tags);
  pr.defaults = { ...((pr.defaults as Json | undefined) ?? {}), ...structuredClone(KEYS2.pricing.defaults) };
  pr.panel_notes = { ...((pr.panel_notes as Json | undefined) ?? {}), ...structuredClone(KEYS2.pricing.panel_notes) };
  pr.panel_controls = { ...((pr.panel_controls as Json | undefined) ?? {}), ...structuredClone(KEYS2.pricing.panel_controls_add) };
  // B8 (QR-C2 (a)): own_row_check.serves; `over.serves` replaces it (a test of another scope) or removes it (null)
  const oc = pr.own_row_check as Json | undefined;
  if (oc) { if (over.serves === null) delete oc.serves; else oc.serves = structuredClone(over.serves ?? KEYS2.own_row_check_serves); }
  const rs = pr.derivation_reasons as Reason[];
  const mv = rs.findIndex((r) => r.title === KEYS2.derivation_reasons.move_first);
  const before = rs.findIndex((r) => r.title === KEYS2.derivation_reasons.before);
  if (mv > before && before >= 0) rs.splice(before, 0, ...rs.splice(mv, 1));
  for (const [from, to] of Object.entries(KEYS2.derivation_reasons.narrow)) { const r = rs.find((x) => x.title === from); if (r) r.title = to; }
  for (const [title, add] of Object.entries(KEYS2.derivation_reasons.append_why)) {
    const r = rs.find((x) => x.title === title);
    if (r && !String(r.why).endsWith(add)) r.why = `${String(r.why)}${add}`;
  }
  for (const r of KEYS2.derivation_reasons.new) {
    if (rs.some((x) => x.title === r.title)) continue;
    rs.push({ ...r, why: String(r.why).replace(EDGE_PLACEHOLDER, over.edgeReason ?? EDGE_PLACEHOLDER) });
  }
  return c as unknown as RateCategoryConfig;
}

/** R7 (QR-V (a)): the v78 transformation of the Valve Package config -- the two "(owner VR9)" tags stripped, the E13 line added (the
 *  mint's `valve_config`). Idempotent. */
export function withV78Valve(cfg: RateCategoryConfig): RateCategoryConfig {
  const c = structuredClone(cfg) as unknown as Json;
  const V = (KEYS2 as unknown as { valve: { strip: Record<string, string>; rule_line: Json } }).valve;
  for (const [path, tag] of Object.entries(V.strip)) {
    const keys = path.split(".");
    let o = c as Record<string, unknown>;
    for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
    o[keys[keys.length - 1]] = String(o[keys[keys.length - 1]]).replace(tag, "");
  }
  const rl = ((c.list_spec as Json).pricing as Json).rule_lines as Json[];
  if (!rl.some((r) => r.rule === V.rule_line.rule)) rl.push(structuredClone(V.rule_line));
  return c as unknown as RateCategoryConfig;
}

/** the newest VAV config with the v78 keys (a scratch copy) */
export const vav78 = (over: Parameters<typeof withV78Keys>[1] = {}) => withV78Keys(BY_ID.get(VAV)!, over);

/** a CFM inside a sheet band under BOTH edge rules: one below the band's max */
export const cfmInside = (band: string): string => {
  const b = KEYS2.pricing.band_from.bands.find((x) => x.value === band);
  if (!b) throw new Error(`no band ${band}`);
  return String(b.max - 1);
};

/** the calculator entry for one tab line through the TYPED CFM (B3): the line's facts, the band left out, a CFM inside it typed */
export function tabEntryTyped(r: TabLine, how: { cfm?: string; inlet?: string } = {}): Block {
  const types: Record<string, string> = { "AHRI Certfied": "AHRI Certified", "AHRI Certfied Imported": "AHRI Certified Imported",
    "Nothing specific mentioned": "Nothing specific mentioned", "Imported": "Imported" };
  if (r.item === "VAV Integrator") return blk("VAV Integrator", { vav_type: types[r.type] });
  const size: Record<string, string> = how.inlet !== undefined ? { inlet_size: how.inlet } : { airflow_cfm: how.cfm ?? cfmInside(r.cfm) };
  return blk("VAV box", { shape: r.item.startsWith("Rect") ? "Rectangular" : "Oval", vav_type: types[r.type], integrator_included: r.integrator, ...size });
}
