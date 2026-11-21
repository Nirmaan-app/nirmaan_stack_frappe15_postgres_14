/**
 * VAV-2b2: HVAC v81's keys (ONE file, `__fixtures__/vav2b2Keys.json`, also read by scripts/_instruments/mint_hvac_v81_vav2b2.py) and their
 * transformation of the v80 FILE's hvac_vav_box config and items -- scratch copies only; the asset file is never written. A module with
 * no other harness import (a jsdom test can use it). Pinned equal to the mint by vav2b2Rules' MINT PARITY test.
 */
import path from "path";
import { pathToFileURL } from "url";
import type { RateCategoryConfig, RateMasterItem } from "../../pricing/rate-master/rateMasterTypes";
import { readJsonFixture } from "../../pricing/calculatorPanelParity.harness";

type Json = Record<string, unknown>;
type Reason = { title: string; why: string };
type Def = Json & { id: string; note?: string };
export type Keys81 = {
  pricing_inputs: Record<string, { from: number; to: number; why: string; remarks_append?: string }>;
  vav: {
    drop_top_keys?: string[];
    list_defs_add?: Def[];
    list_def_notes_append?: Record<string, string>;
    section_family_notes?: Record<string, string>;
    pricing_set?: Record<string, unknown>;
    pricing_merge?: Record<string, unknown>;
    whole_set?: Record<string, Record<string, unknown>>;
    separate_not_words_add?: Record<string, string>;
    separate_extras_add?: Json[];
    derivation_reasons_replace?: Array<Reason & { from: string }>;
    derivation_reasons_new?: Reason[];
  };
};
const FIX = path.resolve(__dirname, "__fixtures__");
export const KEYS81 = readJsonFixture<Keys81>(pathToFileURL(path.join(FIX, "vav2b2Keys.json")));

/** What a test takes out of the keys (KEY ABSENT = UNCHANGED; the vacuity runs). */
export type V81Over = { dropPricing?: string[]; dropListDefs?: boolean; dropNotes?: boolean };

/** v81's transformation of ONE hvac_vav_box config (the mint does the same in Python, `vav_config`). Idempotent on v81. */
export function withV81Keys(cfg: RateCategoryConfig, over: V81Over = {}): RateCategoryConfig {
  const c = structuredClone(cfg) as unknown as Json & { list_spec: { attribute_definitions: Def[]; sections?: Array<Json & { id: string }>; pricing: Json } };
  const k = KEYS81.vav;
  for (const key of k.drop_top_keys ?? []) delete c[key];
  const ls = c.list_spec;
  if (!over.dropListDefs) for (const d of k.list_defs_add ?? []) if (!ls.attribute_definitions.some((x) => x.id === d.id)) ls.attribute_definitions.push(structuredClone(d));
  if (!over.dropNotes) {
    for (const [id, tail] of Object.entries(k.list_def_notes_append ?? {})) {
      const d = ls.attribute_definitions.find((x) => x.id === id);
      if (d && !(d.note ?? "").endsWith(tail)) d.note = (d.note ?? "") + tail;
    }
    for (const [id, note] of Object.entries(k.section_family_notes ?? {})) {
      const s = (ls.sections ?? []).find((x) => x.id === id);
      if (s) s.family_note = note;
    }
  }
  const pr = ls.pricing;
  for (const [key, val] of Object.entries(k.pricing_set ?? {})) if (!(over.dropPricing ?? []).includes(key)) pr[key] = structuredClone(val);
  for (const [p, val] of Object.entries(k.pricing_merge ?? {})) {
    if ((over.dropPricing ?? []).includes(p)) continue;
    const parts = p.split(".");
    let node = pr as Json;
    for (const part of parts.slice(0, -1)) node = node[part] as Json;
    node[parts[parts.length - 1]] = structuredClone(val);
  }
  if (!(over.dropPricing ?? []).includes("separate_extras_add")) {
    const exs = (((pr.sheet_shares as Json | undefined)?.separate as Json | undefined)?.extras as Json[] | undefined) ?? [];
    for (const e of k.separate_extras_add ?? []) if (!exs.some((x) => x.label === e.label && x.share === e.share)) exs.push(structuredClone(e));
  }
  for (const [label, words] of Object.entries(k.separate_not_words_add ?? {})) {
    if ((over.dropPricing ?? []).includes("separate_not_words_add")) continue;
    const e = ((((pr.sheet_shares as Json | undefined)?.separate as Json | undefined)?.extras as Json[] | undefined) ?? []).find((x) => x.label === label);
    if (e && !String(e.not_words ?? "").includes(words)) e.not_words = e.not_words ? `${String(e.not_words)}|${words}` : words;
  }
  for (const [key, fields] of Object.entries(k.whole_set ?? {})) {
    if ((over.dropPricing ?? []).includes(`whole_set.${key}`)) continue;
    const w = (((pr.sheet_shares as Json | undefined)?.whole as Json[] | undefined) ?? []).find((x) => x.key === key);
    if (w) Object.assign(w, structuredClone(fields));
  }
  const rs = ((pr.derivation_reasons as Reason[] | undefined) ?? (pr.derivation_reasons = [] as Reason[]) as Reason[]);
  for (const r of k.derivation_reasons_replace ?? []) {
    const i = rs.findIndex((x) => x.title === r.from);
    if (i >= 0) rs[i] = { title: r.title, why: r.why };
  }
  for (const r of k.derivation_reasons_new ?? []) if (!rs.some((x) => x.title === r.title)) rs.push({ ...r });
  return c as unknown as RateCategoryConfig;
}

/** v81's items: each declared Pricing Input's factor (and remarks) changed; `over` sets a factor (null removes the input) for a test. */
export function withV81Items(items: readonly RateMasterItem[], over: Record<string, number | null> = {}): RateMasterItem[] {
  return items.flatMap((i) => {
    const id = /_pricing_input$/.test(String(i.kind)) ? String(i.attributes?.item ?? "") : "";
    const ch = KEYS81.pricing_inputs[id];
    let out = i;
    if (ch) {
      const r = i.rates as Json;
      const rem = String(i.attributes?.remarks ?? "");
      out = { ...i, rates: { ...r, factor: r.factor === ch.from ? ch.to : r.factor },
        attributes: { ...i.attributes, ...(ch.remarks_append && !rem.endsWith(ch.remarks_append) ? { remarks: rem + ch.remarks_append } : {}) } } as RateMasterItem;
    }
    if (!(id in over)) return [out];
    if (over[id] === null) return [];
    return [{ ...out, rates: { ...(out.rates as Json), factor: over[id] } } as unknown as RateMasterItem];
  });
}
