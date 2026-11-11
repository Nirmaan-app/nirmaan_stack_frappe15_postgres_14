/**
 * SLICE 12b(B) -- THE PRICING-INPUT REACH WALK. PURE: no React, no fetch, no DB.
 *
 * Answers, for every pricing input: WHICH catalogue SKUs does changing this number move, which RATE
 * COLUMN of each does it move, and under which categories. That is what the ITEMS count on the Pricing
 * Inputs table is, and what the impact panel lists.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠️ THREE THINGS THIS MODULE EXISTS TO GET RIGHT. EACH WAS MEASURED WRONG FIRST.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * (1) PROVENANCE, NOT THE CONSUMING STEP. An assembly's multiplier is applied to the SUM, not to the
 *     component that fed it, so a walk reading only the step that touches a pricing input reports
 *     NOTHING for every assembly. The recon's first pass did exactly that and called FOUR inputs
 *     zero-reach when three of them reach 136, 61 and 136. The walk threads
 *     `(kind, rate_key) -> component -> sum_components -> scale/roundup -> output`.
 *
 * (2) A COLUMN IS NARROWED, NOT JUST TYPED. `where` carries the LITERAL attribute filters the rule
 *     applies -- a `component_ref`'s `family: "Switchgear"`, a `catalog_fit`'s `where`, a conditional
 *     step's `when`. Measured on v65 without them: `switchgear` read **163** instead of 136 (every
 *     `db_switchgear_item` rather than the Switchgear + Enclosure families) and `cable_unarm` read
 *     **292** instead of 105 (every cable rather than the UNARMOURED ones its condition selects). An
 *     over-count is not a rounding error: the badge would promise a pricer that 292 SKUs move when 105
 *     do.
 *
 * (3) `install_as_ratio` CARRIES NO `target`. It ratios whatever the pipeline is holding, so its
 *     provenance is the accumulated sum, not a target of its own. Without that, `termination_share`
 *     read **0** SKUs and was mis-reported as a flat adder when it moves all 296 termination rows.
 *
 * ⚠️ AND: `used_by`'s SITE COUNT CORRELATES WITH NOTHING A PRICER CARES ABOUT. Measured on v65,
 * `tray_supply` is 1 site / 450 SKUs while `conduit` is 10 sites / 8 SKUs. The site count is a property
 * of the RULES; this is a property of the CATALOGUE. Never substitute one for the other -- which is why
 * owner ruling N-7 took "sites" off the screen.
 *
 * ⚠️ DISTINCT SKUs, NEVER USES (owner ruling N-2): "SKUs we need to show not use cases." A switch/socket
 * row is priced by THREE categories, so the naive count is 175 and the honest one is 61. `distinctSkus`
 * is the badge AND the list length; the categories ride ON the row.
 */
import type { RateCategoryConfig, RateMasterItem } from "./rateMasterTypes";
// the SAME spec reader `isItemListConfig` is built on -- imported rather than re-tested here,
// so "is this category item-list" has one definition. Taken from `itemListPricing` directly so
// this module keeps no edge back to `pricingInputExact`, which imports a type from here.
import { itemListPricingSpec } from "../../boq-wizard/rate-helper/itemListPricing";
// the SHARED "does this row carry the axes the rules ladder on" predicate. `pricingInputExact`
// imports only TYPES from this module, so this value import creates no runtime cycle.
import { skuCarriesGeometry } from "./pricingInputExact";

/**
 * A row the structural walk could not TEST -- see `InputReach.candidateSkus`. It carries its own
 * kind and categories for the same reason `ReachedColumn` does: the confirmer needs the CONFIG that
 * prices it, and looking that up from a bare uid would mean re-deriving a mapping the walk already
 * had in hand.
 */
export interface CandidateSku {
  itemUid: string;
  kind: string;
  /** every item-list category of this kind that applied the input, sorted */
  categories: string[];
}

/** One SKU column a pricing input moves. */
export interface ReachedColumn {
  itemUid: string;
  kind: string;
  /** WHICH stored rate column of that row this input moves (owner N-4) */
  rateKey: string;
  /** every category whose rules apply this input to that column, sorted */
  categories: string[];
}

export interface InputReach {
  /** distinct catalogue rows -- the badge and the list length (owner N-2) */
  distinctSkus: string[];
  /** VRF-3b: the VRF unit SKUs an input SIZES (VRF's extras) or CONVERTS (a capacity reader's convert table) while it moves
   * no SKU's own rate -- the badge where `distinctSkus` is empty; never a column, never a panel list. Absent elsewhere. */
  assemblySkus?: string[];
  /** one entry per (SKU, rate column); a row moved on two columns appears twice */
  columns: ReachedColumn[];
  /**
   * SKUs this walk could not TEST, never SKUs it has cleared -- the population an EXACT run must
   * confirm or discard (`pricingInputExact.confirmInputMovesSku`).
   *
   * ⚠️ WHY A SECOND CHANNEL IS NEEDED AT ALL. `matching()` keeps a SKU only when it STORES the rate
   * column the step touches, which is the right test for an input that SCALES a stored rate. An
   * ITEM-LIST category builds an ASSEMBLY instead, so a row whose whole cost comes from pricing
   * INPUTS stores no cost column of its own -- Insulation's five cladding-only SKUs carry only
   * `cost_install_cladding` and the markups. They were therefore dropped before anything could ask
   * whether their price moves, and the F3 samples branch downstream became unreachable for the only
   * population it was written for (U9/F3, found in the 12c cert, 2026-10-05).
   *
   * ⚠️ THIS LIST IS DELIBERATELY OVER-INCLUSIVE AND MUST NEVER DRIVE A COUNT OR A PANEL ON ITS OWN.
   * It is structural -- "of a kind this input touched, in an item-list category, storing none of the
   * walked rate keys" -- so for the 26G sheet input it holds all five cladding types, where only the
   * two 26G ones actually move. Deciding WHICH move is a pricing question, and the answer comes from
   * running the product. A structural guess here would report 5 where 2 is the truth.
   */
  candidateSkus: CandidateSku[];
  /** distinct SKU uids per category, for the panel's grouping and its summary line */
  byCategory: Record<string, string[]>;
  /**
   * ⚠️ TRUE when this input changes a row's price WITHOUT scaling any SKU's stored rate -- a flat
   * per-metre adder (`tray_accessories` 106, `tray_refilling` 180, `tray_cutting_amount` 200) or a
   * markup ON such an adder (`tray_cutting`). `distinctSkus` is then EMPTY and that is honest: no SKU's
   * rate moves. But 450 tray rows DO change price, so the panel must not render an empty list and call
   * it "no impact" -- owner ruling N-5 gives these their own shape.
   */
  isFlatAdder: boolean;
  /**
   * Present when this input is read by an ADDITIVE component. It is what makes the flat-adder panel
   * show "rate plus adder" instead of a multiplier, and what lets it state its condition.
   */
  adder?: AdderSpec;
  /** the categories whose rules read this input at all, even where no SKU rate is scaled */
  readByCategories: string[];
  /**
   * ELR-3a -- present when an ASSEMBLY step reads this input through one of the four arms (`table_from_ctx`,
   * `default_from_ctx`, `constants_from_ctx`, `usable_from_ctx`): "length" (a map / derive arm) or "fill"
   * (circuit_fit's usable; a fill read anywhere wins). It is the range the input must stay in (owner R-R1 Q4) --
   * a length more than 0, a fill more than 0 and at most 1 -- the Python `pricing_input_ranges` twin.
   */
  assemblyRange?: "length" | "fill";
  /**
   * The PIPELINES that read this input, so the panel can run the REAL interpreter over them rather
   * than re-implementing what they do. Re-implementation is what made the panel disagree with the
   * product for a share and an adder; running the pipeline cannot drift from it.
   */
  pipelines: Array<{ category: string; pipelineId: string }>;
}

/**
 * How an ADDITIVE component contributes, so the panel can show "rate PLUS adder" and state the
 * CONDITION under which it applies. Recorded verbatim from the config -- the interpreter's own
 * `evalFormula` evaluates it, so there is no second evaluator.
 */
export interface AdderSpec {
  /** the component's formula, e.g. `accessories_per_mtr` or `cutting_rate*(1+markup)` */
  formula: string;
  /** every condition branch, with the ctx keys and literals it binds */
  branches: Array<{
    when: Record<string, unknown>;
    ctxBinds: Record<string, string>;
    literals: Record<string, number>;
  }>;
  /** the component's name, for the panel's wording */
  component: string;
  category: string;
}

const CTX_SUFFIX = "_from_ctx";
const BCS_PREFIX = "bcs_";
const isInternal = (k: unknown) => String(k ?? "").startsWith(BCS_PREFIX);

type Col = { kind: string; rateKey: string; where: Record<string, unknown> };

function colKey(c: Col): string {
  return [c.kind, c.rateKey, JSON.stringify(Object.entries(c.where).sort())].join("\u0000");
}

/** the LITERAL (non-`@`-bound) attribute filters of a `ref` or a `where` map */
function literalWhere(src: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src ?? {})) {
    if (k === "kind" || k === "attributes") continue;
    if (typeof v === "string" && v.startsWith("@")) continue;
    out[k] = v;
  }
  return out;
}

/** {ctx key -> the pricing-input ids that produced it}, transitively through the preamble scales. */
function ctxOwners(pipeline: { steps?: any[] } | null | undefined): Record<string, Set<string>> {
  const own: Record<string, Set<string>> = {};
  const steps = pipeline?.steps ?? [];
  for (const s of steps) {
    if (s?.step !== "rate_ref") continue;
    /**
     * ⚠️ ONLY A RATE_REF THAT READS A PRICING INPUT MAKES ONE. `rate_ref` is a general "read one
     * stored rate off one row" step, and slice 12c FINISH uses it to read a CATALOGUE row's own
     * wastage and markups -- which made the catalogue row appear in this map as an input with zero
     * SKUs, a name the Pricing Inputs page has never heard of. Keyed on the kind SUFFIX, exactly as
     * `is_pricing_input_kind` is, so no discipline or category is named here.
     */
    if (!String(s?.ref?.kind ?? "").endsWith("_pricing_input")) continue;
    const id = s?.ref?.item;
    if (typeof id !== "string") continue;
    (own[s.result] ??= new Set<string>()).add(id);
  }
  for (let pass = 0; pass < 6; pass++) {
    for (const s of steps) {
      if (s?.pricing_input !== true) continue;
      const acc = new Set<string>(own[s.result] ?? []);
      const srcs = [String(s.target ?? "")];
      for (const [k, v] of Object.entries(s.params ?? {})) {
        if (k.endsWith("_from_ctx")) srcs.push(String(v));
      }
      for (const src of srcs) for (const id of own[src] ?? []) acc.add(id);
      if (acc.size) own[s.result] = acc;
    }
  }
  return own;
}

/** every pricing-input id a step READS, via any `*_from_ctx` param at any of its three depths. ELR-3a: an
 * assembly arm's value is a MAP of keys (or a map of lists, `usable_from_ctx`), so every key string inside it counts
 * -- a string-valued param reads exactly as before. */
function inputsRead(step: any, owners: Record<string, Set<string>>): Set<string> {
  const out = new Set<string>();
  const blobs: any[] = [step?.params ?? {}];
  for (const st of step?.rate_stages ?? []) blobs.push(st ?? {});
  for (const c of step?.conditions ?? []) blobs.push(c?.params ?? {});
  const add = (v: unknown) => {
    if (typeof v === "string") for (const id of owners[v] ?? []) out.add(id);
    else if (Array.isArray(v)) v.forEach(add);
    else if (v && typeof v === "object") Object.values(v as Record<string, unknown>).forEach(add);
  };
  for (const b of blobs) {
    for (const [k, v] of Object.entries(b ?? {})) {
      if (k.endsWith("_from_ctx")) add(v);
    }
  }
  return out;
}

/**
 * The reach of every pricing input. PURE.
 *
 * `configs` is {category_id: config} for the whole discipline -- the walk is cross-category by nature
 * (a switch/socket row is reached from three of them), so a single config cannot answer it.
 *
 * Measured on v65: **8 ms** for all 35 inputs over 1,402 items. Memoise on [configs, items].
 */
/**
 * Every pipeline a config can run, as [id, pipeline] pairs: the config's OWN `pipelines` plus each
 * `list_spec.pricing.families[*].units[*].pipelines` of an ITEM-LIST category.
 *
 * ⚠️ WITHOUT THE SECOND HALF THE PANEL REPORTS ZERO FOR EVERY INPUT OF AN ITEM-LIST CATEGORY. An
 * item-list category keeps its rules inside `list_spec` (that is what lets it hold a full rule set
 * while staying ineligible), so a walk over `cfg.pipelines` alone sees nothing -- HVAC's seven inputs
 * priced 204 rows and would have shown "no SKUs affected" on their own impact panel. The Python
 * reach walk (`csv_exporter.pricing_input_used_by`) had the identical blindness and is fixed in the
 * same slice.
 *
 * The nested id carries family and unit class, so two families' `supply` pipelines are distinct keys
 * -- `pipesBy` is keyed by "category|pipelineId" and would otherwise merge them.
 */
export function pipelinesOf(cfg: unknown): Array<[string, any]> {
  return pipelinesWithFamily(cfg).map(([id, pl]) => [id, pl]);
}

/**
 * SLICE 12e-2b (12e-2 cert finding 2, AC8): the same walk, each pipeline with the FAMILY that owns it (null
 * for the config's own pipelines). A nested id cannot be parsed back into its family -- a family name may
 * itself hold a slash ("mixing box / LP plenum") -- so the family travels beside the id. `pipelinesOf` is this
 * list without the third member, so the ids and their order are one definition.
 */
function pipelinesWithFamily(cfg: unknown): Array<[string, any, string | null, boolean?]> {
  const out: Array<[string, any, string | null, boolean?]> = [];
  const own = (cfg as any)?.pipelines ?? {};
  for (const pid of Object.keys(own).sort()) out.push([pid, own[pid] ?? {}, null]);
  const fams = (cfg as any)?.list_spec?.pricing?.families ?? {};
  for (const fam of Object.keys(fams).sort()) {
    const units = fams[fam]?.units ?? {};
    for (const uc of Object.keys(units).sort()) {
      const pls = units[uc]?.pipelines ?? {};
      for (const pid of Object.keys(pls).sort()) out.push([`${fam}/${uc}/${pid}`, pls[pid] ?? {}, fam]);
    }
    /**
     * ADP-1 (owner Q2, 2026-10-19: "ok"): ... and every `convert` option's pipelines. ADP's per-number rules (the
     * mixing-box supply adder, the flexible duct's metres per piece) live there, and the walk above alone reported
     * them read by nothing. The id carries the option's index, since one class may convert in several ways. An
     * option prices a per-number ROW, never a SKU at its own unit, so the impact panel truthfully moves 0 SKUs
     * through it; the input is still reached ("used by").
     */
    const conv = fams[fam]?.convert ?? {};
    for (const uc of Object.keys(conv).sort()) {
      (Array.isArray(conv[uc]) ? conv[uc] : []).forEach((o: any, i: number) => {
        const pls = o?.pipelines ?? {};
        for (const pid of Object.keys(pls).sort()) out.push([`${fam}/${uc}->${String(o?.to)}#${i}/${pid}`, pls[pid] ?? {}, fam, true]);
      });
    }
  }
  return out;
}

/**
 * Note a CONDITIONAL additive component's inherited columns PER BRANCH, narrowed to the SKUs that
 * branch selects. Returns false when there is nothing to narrow by, so the caller falls back to the
 * un-narrowed note and every existing category stays byte-identical.
 */
function narrowAdditiveByBranch(
  step: any,
  ks: readonly string[],
  owners: Record<string, Set<string>> | Record<string, string[]>,
  note: (ids: Set<string>, keys: readonly string[]) => void,
  remember: (c: Col) => string,
  colLookup: Map<string, Col>,
  attrKeysByKind: Map<string, Set<string>>,
): boolean {
  let narrowedAny = false;
  const planned: Array<{ ids: Set<string>; keys: string[] }> = [];
  for (const cond of step?.conditions ?? []) {
    const ids = new Set<string>();
    for (const [k, v] of Object.entries(cond?.params ?? {})) {
      if (!k.endsWith(CTX_SUFFIX) || typeof v !== "string") continue;
      for (const id of owners[v] ?? []) ids.add(id);
    }
    if (!ids.size) continue;                       // a branch that reads no input contributes nothing
    const keys: string[] = [];
    for (const colK of ks) {
      const base = colLookup.get(colK);
      if (!base) continue;
      const carried = attrKeysByKind.get(base.kind) ?? new Set<string>();
      const extra: Record<string, unknown> = {};
      for (const [wk, wv] of Object.entries(cond?.when ?? {})) if (carried.has(wk)) extra[wk] = wv;
      if (!Object.keys(extra).length) { keys.push(colK); continue; }
      narrowedAny = true;
      keys.push(remember({ kind: base.kind, rateKey: base.rateKey, where: { ...base.where, ...extra } }));
    }
    if (keys.length) planned.push({ ids, keys });
  }
  if (!narrowedAny) return false;                  // nothing SKU-shaped to narrow by -- leave as it was
  for (const p of planned) note(p.ids, p.keys);
  return true;
}

/**
 * VRF-2b (owner R-INPUTS / R-CONV) -- A CAPACITY READER'S CONVERT TABLE READS ITS PRICING INPUTS. One entry per (input,
 * family) where the family's rule needs a number whose reader converts units through that input
 * (`list_spec.pricing.numbers[*].units.convert[*].input`). The input moves no SKU's own rate: it decides WHICH SKU a row
 * buys (16 TR x 1.25 = 20 HP -> the 20 HP unit), so it is "read by" the category with no column -- the ELR-3a assembly
 * shape. The Python twin is `csv_exporter._units_convert_uses`. PURE; never throws on a malformed config.
 */
export function unitsConvertUses(cfg: unknown): Array<{ input: string; family: string }> {
  const pr = (cfg as any)?.list_spec?.pricing;
  if (!pr || typeof pr !== "object") return [];
  const byInput = new Map<string, Set<string>>();
  for (const [nid, rd] of Object.entries<any>(pr.numbers ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    for (const c of Object.values<any>(rd?.units?.convert ?? {})) {
      const id = c?.input;
      if (typeof id === "string" && id) (byInput.get(id) ?? byInput.set(id, new Set<string>()).get(id)!).add(nid);
    }
  }
  const out: Array<{ input: string; family: string }> = [];
  for (const id of [...byInput.keys()].sort()) {
    const nids = byInput.get(id)!;
    for (const fam of Object.keys(pr.families ?? {}).sort()) {
      const fd = pr.families[fam];
      if (!fd || typeof fd !== "object") continue;
      const needs = new Set<string>(Array.isArray(fd.needs) ? fd.needs : []);
      for (const u of Object.values<any>(fd.units ?? {})) for (const n of (Array.isArray(u?.needs) ? u.needs : [])) needs.add(n);
      if ([...nids].some((n) => needs.has(n))) out.push({ input: id, family: fam });
    }
  }
  return out;
}

/** VRF-3b: a config / item read loosely (the configs are data the validator shapes; nothing here throws on a bad one). */
type Loose = Record<string, unknown>;
const loose = (v: unknown): Loose => (v && typeof v === "object" ? (v as Loose) : {});
const pricingOf = (cfg: unknown): Loose => loose(loose(loose(cfg).list_spec).pricing);
const famAttrOf = (cfg: unknown): string => String(loose(loose(cfg).list_spec).family_attribute_id ?? "family");
type ExtrasBand = { max: number | null; input: string };
/** VRF-6: an electrical accessory's HP schedule as bands -- the last row open (a unit above it takes the last rating) */
const scheduleBands = (acc: Loose): ExtrasBand[] => {
  const sch = loose(acc.electrical).schedule;
  if (!Array.isArray(sch)) return [];
  const rows = (sch as unknown[]).map(loose).filter((r) => typeof r.input === "string" && typeof r.max === "number");
  return rows.map((r, n) => ({ max: n === rows.length - 1 ? null : Number(r.max), input: String(r.input) }));
};
const bandsOf = (ex: Loose, table: string, role: string): ExtrasBand[] => {
  const v = loose(ex[table])[role];
  return Array.isArray(v) ? (v as ExtrasBand[]) : [];
};
const inputFactor = (items: readonly RateMasterItem[] | null | undefined, id: string): number | null => {
  const it = (items ?? []).find((x) => /_pricing_input$/.test(String(x?.kind ?? "")) && String(loose(x?.attributes).item ?? "") === id);
  const f = Number(loose(it?.rates).factor);
  return Number.isFinite(f) ? f : null;
};

/**
 * VRF-3b (owner 2026-11-05: the Pricing Inputs are "live-linked", "Used by VRF, Items View") -- THE INPUTS VRF'S `extras` READ:
 * one per table cell (`<band input>_supply_mm` ..., `<cable input>_cores` / `_sqmm`) and the two lengths, the twin of
 * `config_validation.extras_input_ids` (the Python used-by walk reads that). Each comes with the VRF unit SKUs whose row it
 * sizes: a band's cells reach the units of its role whose capacity, after conversion, falls in the band; the
 * communication cable and the lengths reach every unit that carries extras. PURE; [] for a config without `extras`.
 */
export function extrasUses(cfg: unknown, items: readonly RateMasterItem[] | null | undefined): Array<{ input: string; skus: string[] }> {
  const pr = pricingOf(cfg);
  const ex = loose(pr.extras);
  const roles = loose(ex.roles);
  if (!Object.keys(roles).length) return [];
  const famAttr = famAttrOf(cfg);
  const kinds = new Set<string>([String(pr.kind ?? ""), ...(Array.isArray(pr.extra_kinds) ? (pr.extra_kinds as string[]) : [])]);
  const units = loose(loose(loose(pr.numbers).capacity).units);
  const convert = loose(units.convert);
  const bandUnit = loose(ex.band_unit);
  const factorOfUnit = (u: string): number | null => (u === units.base ? 1 : (typeof loose(convert[u]).input === "string" ? inputFactor(items, String(loose(convert[u]).input)) : null));
  const conv = (v: number, from: string, to: string): number | null => {
    if (from === to) return v;
    const a = factorOfUnit(from); const b = factorOfUnit(to);
    return a && b ? (v / a) * b : null;
  };
  const unitSkus = (role: string) => (items ?? []).filter((it) => kinds.has(String(it.kind)) && roles[String(loose(it.attributes)[famAttr] ?? "")] === role);
  const inBand = (role: string, bands: ExtrasBand[], n: number) => unitSkus(role).filter((it) => {
    const a = loose(it.attributes);
    const v = Number(a.capacity);
    const u = String(a[String(units.unit_attr ?? "capacity_unit")] ?? bandUnit[role] ?? "");
    const c = Number.isFinite(v) ? conv(v, u, String(bandUnit[role] ?? "")) : null;
    if (c === null) return false;
    const lo = n === 0 ? -Infinity : Number(bands[n - 1].max);
    const hi = bands[n].max === null ? Infinity : Number(bands[n].max);
    return c > lo + 1e-9 && c <= hi + 1e-9;
  }).map((it) => String(it.item_uid ?? "")).filter(Boolean);
  const all = [...unitSkus("indoor"), ...unitSkus("outdoor")].map((it) => String(it.item_uid ?? "")).filter(Boolean);
  const out: Array<{ input: string; skus: string[] }> = [];
  for (const [table, cells] of [["pipe_bands", ["supply_mm", "return_mm", "insulation_mm"]], ["power_bands", ["cores", "sqmm"]]] as const) {
    for (const role of ["indoor", "outdoor"]) {
      const bands = bandsOf(ex, table, role);
      bands.forEach((b, n) => { const skus = inBand(role, bands, n); for (const c of cells) out.push({ input: `${b.input}_${c}`, skus }); });
    }
  }
  for (const c of ["cores", "sqmm"]) out.push({ input: `${String(ex.comm_input)}_${c}`, skus: all });
  for (const id of [ex.copper_length_input, ex.cable_length_input]) out.push({ input: String(id), skus: all });
  // VRF-5 (owner ANSWER 4-6, U6): the accessories' defaults -- a band's cell reaches the units of its role in that band, a flat
  // input every unit of its role -- and the installation-only uplift every unit (the twin of `accessory_input_ids`)
  for (const a of Array.isArray(ex.accessories) ? (ex.accessories as unknown[]) : []) {
    const acc = loose(a);
    const key = typeof loose(acc.electrical).rating_key === "string" ? String(loose(acc.electrical).rating_key) : "qty";
    for (const role of ["indoor", "outdoor"]) {
      const bands = (loose(acc.bands)[role] as ExtrasBand[] | undefined) ?? [];
      if (Array.isArray(bands)) bands.forEach((b, n) => out.push({ input: `${b.input}_${key}`, skus: inBand(role, bands, n) }));
    }
    const roleSkus = () => ((acc.roles as string[] | undefined) ?? []).flatMap((r) => unitSkus(r)).map((it) => String(it.item_uid ?? "")).filter(Boolean);
    if (typeof acc.input === "string" && acc.input) out.push({ input: String(acc.input), skus: roleSkus() });
    // VRF-6 (team rule): gas kg = HP x its input -- every unit of its role; the MCB + ELCB schedule -- each row the units of its role
    // whose size falls in it (the last row also every larger unit: above 26 HP -> 63 A)
    const qps = loose(acc.qty_per_size);
    if (typeof qps.input === "string" && qps.input) out.push({ input: String(qps.input), skus: roleSkus() });
    const sched = scheduleBands(acc);
    for (const role of (acc.roles as string[] | undefined) ?? []) sched.forEach((b, n) => out.push({ input: b.input, skus: inBand(role, sched, n) }));
  }
  const scope = loose(ex.scope);
  if (typeof scope.uplift_input === "string" && scope.uplift_input) out.push({ input: String(scope.uplift_input), skus: all });
  return out.map((u) => ({ ...u, skus: [...new Set(u.skus)].sort() }));
}

/**
 * VRF-3b (owner ANSWER 1, VRF3B-4 = (a): "show their real reach") -- the VRF unit SKUs a capacity reader's convert input
 * reaches: every SKU of a family whose rule needs that number (a capacity typed in another unit is converted before the
 * SKU is chosen, so the input decides which of them a row buys). Where-used only -- no SKU's own rate moves. PURE.
 */
export function unitsConvertSkus(cfg: unknown, items: readonly RateMasterItem[] | null | undefined): Map<string, string[]> {
  const pr = pricingOf(cfg);
  const famAttr = famAttrOf(cfg);
  const kinds = new Set<string>([String(pr.kind ?? ""), ...(Array.isArray(pr.extra_kinds) ? (pr.extra_kinds as string[]) : [])]);
  const out = new Map<string, Set<string>>();
  for (const u of unitsConvertUses(cfg)) {
    const set = out.get(u.input) ?? out.set(u.input, new Set<string>()).get(u.input)!;
    for (const it of items ?? []) {
      if (kinds.has(String(it.kind)) && String(loose(it.attributes)[famAttr] ?? "") === u.family && it.item_uid) set.add(String(it.item_uid));
    }
  }
  return new Map([...out.entries()].map(([k, v]) => [k, [...v].sort()]));
}

/**
 * VRF-3b (owner B2 "A typed rough size becomes the closest Piping size on entry"; 13:46 "matched to the exact mm size in
 * catalog which is closest") -- the stocked COPPER sizes a pipe-size cell of VRF's extras snaps to, or null for any other
 * input. Read from the extras' own copper target (category, family, size attribute) over the live catalogue. PURE.
 */
export function extrasSnapSizes(
  configs: Record<string, unknown> | null | undefined, items: readonly RateMasterItem[] | null | undefined, inputId: string,
): number[] | null {
  for (const cfg of Object.values(configs ?? {})) {
    const ex = loose(pricingOf(cfg).extras);
    if (!ex.pipe_bands) continue;
    const cells = (["indoor", "outdoor"] as const).flatMap((r) => bandsOf(ex, "pipe_bands", r).flatMap((b) => [`${b.input}_supply_mm`, `${b.input}_return_mm`]));
    if (!cells.includes(inputId)) continue;
    const copper = loose(ex.copper);
    const tgt = (configs ?? {})[String(copper.category ?? "")];
    const famAttr = famAttrOf(tgt);
    const kind = String(pricingOf(tgt).kind ?? "");
    const sizes = (items ?? []).filter((it) => String(it.kind) === kind && String(loose(it.attributes)[famAttr] ?? "") === String(copper.family ?? ""))
      .map((it) => Number(loose(it.attributes)[String(copper.size_attr ?? "")])).filter((n) => Number.isFinite(n) && n > 0);
    return [...new Set(sizes)].sort((a, b) => a - b);
  }
  return null;
}

/** VRF-3b (U9, board 14): the two tables the extras' Pricing Inputs make -- the pipe sizes per band and the cable specs per
 * band (+ the communication cable) -- read from the config's bands and the live inputs; a missing cell reads null. PURE. */
export interface ExtrasTables {
  pipes: Array<{ band: string; supply: number | null; ret: number | null; insulation: number | null }>;
  cables: Array<{ band: string; cores: number | null; sqmm: number | null; material: string; armour: string }>;
  lengths: Array<{ label: string; value: number | null }>;
  /** VRF-5 (owner ANSWER 5): the accessory defaults (per outdoor band / per indoor unit) and the installation-only uplift */
  accessories?: Array<{ label: string; value: number | null; unit: string; /** VRF-6: a schedule row's input (shared rows listed once) */ input?: string }>;
  uplift?: { label: string; value: number | null } | null;
}
export function extrasTablesOf(cfg: unknown, items: readonly RateMasterItem[] | null | undefined): ExtrasTables | null {
  const ex = loose(pricingOf(cfg).extras);
  if (!ex.pipe_bands) return null;
  const bandUnit = loose(ex.band_unit);
  const f = (id: string) => inputFactor(items, id);
  const attrsOf = (id: string) => loose((items ?? []).find((x) => /_pricing_input$/.test(String(x?.kind ?? "")) && String(loose(x?.attributes).item ?? "") === id)?.attributes);
  const bandWords = (bands: ExtrasBand[], n: number, role: string) => {
    const u = String(bandUnit[role] ?? "");
    const b = bands[n];
    const side = role === "indoor" ? "Indoor" : "Outdoor";
    if (b.max === null) return `${side} above ${String(bands[n - 1]?.max ?? 0)} ${u}`;
    return n === 0 ? `${side} up to ${String(b.max)} ${u}` : `${side} above ${String(bands[n - 1].max)} up to ${String(b.max)} ${u}`;
  };
  const pipes: ExtrasTables["pipes"] = [];
  const cables: ExtrasTables["cables"] = [];
  for (const role of ["indoor", "outdoor"]) {
    const pb = bandsOf(ex, "pipe_bands", role);
    pb.forEach((b, n) => pipes.push({ band: bandWords(pb, n, role), supply: f(`${b.input}_supply_mm`), ret: f(`${b.input}_return_mm`), insulation: f(`${b.input}_insulation_mm`) }));
  }
  for (const role of ["indoor", "outdoor"]) {
    const cb = bandsOf(ex, "power_bands", role);
    cb.forEach((b, n) => cables.push({ band: `Power - ${bandWords(cb, n, role)}`, cores: f(`${b.input}_cores`), sqmm: f(`${b.input}_sqmm`),
      material: String(attrsOf(`${b.input}_cores`).material ?? ""), armour: String(attrsOf(`${b.input}_cores`).armour ?? "") }));
  }
  const comm = String(ex.comm_input ?? "");
  cables.push({ band: "Communication - every unit", cores: f(`${comm}_cores`), sqmm: f(`${comm}_sqmm`),
    material: String(attrsOf(`${comm}_cores`).material ?? ""), armour: String(attrsOf(`${comm}_cores`).armour ?? "") });
  const lengths = [
    { label: "Copper length per pipe per Nos (m); insulation = copper", value: f(String(ex.copper_length_input ?? "")) },
    { label: "Cable length per Nos (m)", value: f(String(ex.cable_length_input ?? "")) },
  ];
  // VRF-5 (owner ANSWER 5: "they should also be part of the pricing input sheet for HVAC") -- the accessories table
  const accessories: NonNullable<ExtrasTables["accessories"]> = [];
  for (const a of Array.isArray(ex.accessories) ? (ex.accessories as unknown[]) : []) {
    const acc = loose(a);
    const el = loose(acc.electrical);
    const key = typeof el.rating_key === "string" ? String(el.rating_key) : "qty";
    const what = String(acc.title ?? acc.label ?? acc.id ?? "");
    const unit = key === "qty" ? String(acc.unit_word ?? "") : String(el.template ?? "").replace("{amp}", "").trim();   // "{amp}A FP MCCB" -> "A FP MCCB": the row reads "40 A FP MCCB"
    for (const role of ["indoor", "outdoor"]) {
      const bands = (loose(acc.bands)[role] as ExtrasBand[] | undefined) ?? [];
      if (Array.isArray(bands)) bands.forEach((b, n) => accessories.push({ label: `${what} - ${bandWords(bands, n, role)}`, value: f(`${b.input}_${key}`), unit: key === "qty" ? `${String(acc.unit_word ?? "")} per unit` : unit }));
    }
    if (typeof acc.input === "string" && acc.input) {
      accessories.push({ label: `${what} - per ${((acc.roles as string[] | undefined) ?? []).join(" / ")} unit`, value: f(String(acc.input)), unit: `${String(acc.unit_word ?? "")} per unit` });
    }
    // VRF-6 (team rule 2026-11-09): gas kg = HP x its factor; the MCB + ELCB schedule ONCE (one row per HP band, the accessories
    // sharing it named together)
    const qps = loose(acc.qty_per_size);
    if (typeof qps.input === "string" && qps.input) {
      accessories.push({ label: `${what} - per HP of the ${((acc.roles as string[] | undefined) ?? []).join(" / ")} unit`, value: f(String(qps.input)), unit: `${String(acc.unit_word ?? "")} per HP` });
    }
    const sched = scheduleBands(acc);
    if (sched.length && !accessories.some((r) => r.input === sched[0].input)) {
      const sharing = (Array.isArray(ex.accessories) ? (ex.accessories as unknown[]) : []).map(loose)
        .filter((o) => scheduleBands(o).map((b) => b.input).join("|") === sched.map((b) => b.input).join("|")).map((o) => String(o.label ?? o.id ?? ""));
      const role = ((acc.roles as string[] | undefined) ?? [])[0] ?? "outdoor";
      sched.forEach((b, n) => accessories.push({ label: `${sharing.join(" + ")} rating - ${bandWords(sched, n, role)}`, value: f(b.input), unit: "A", input: b.input }));
    }
  }
  const scope = loose(ex.scope);
  const uplift = typeof scope.uplift_input === "string" && scope.uplift_input
    ? { label: "Installation-only uplift (a row the BoQ prices as installation only)", value: f(String(scope.uplift_input)) } : null;
  return { pipes, cables, lengths, ...(accessories.length ? { accessories } : {}), ...(uplift ? { uplift } : {}) };
}

export function computePricingInputReach(
  configs: Record<string, RateCategoryConfig | null | undefined> | null | undefined,
  items: readonly RateMasterItem[] | null | undefined,
): Record<string, InputReach> {
  const uidsByColumn = new Map<string, string[]>();
  const matching = (c: Col): string[] => {
    const k = colKey(c);
    let got = uidsByColumn.get(k);
    if (got) return got;
    got = [];
    const filters = Object.entries(c.where);
    for (const it of items ?? []) {
      if (it.kind !== c.kind) continue;
      if ((it.rates ?? {})[c.rateKey] === undefined) continue;
      const attrs: Record<string, unknown> = { ...(it.attributes ?? {}) };
      // the read-time brand projection, so a `brand` filter behaves as it does at pricing time
      if (it.brand != null && !("brand" in attrs)) attrs.brand = it.brand;
      if (filters.some(([fk, fv]) => attrs[fk] !== fv)) continue;
      if (it.item_uid) got.push(it.item_uid);
    }
    uidsByColumn.set(k, got);
    return got;
  };

  /**
   * The attribute keys the catalogue's rows of a kind actually CARRY. Used to tell a branch that
   * selects a SKU SUBSET from one that selects a BoQ-ROW option.
   */
  const attrKeysByKind = new Map<string, Set<string>>();
  for (const it of items ?? []) {
    const k = String(it.kind ?? "");
    if (!attrKeysByKind.has(k)) attrKeysByKind.set(k, new Set<string>());
    const set = attrKeysByKind.get(k)!;
    for (const a of Object.keys(it.attributes ?? {})) set.add(a);
  }

  const itemByUid = new Map<string, RateMasterItem>();
  for (const it of items ?? []) if (it.item_uid) itemByUid.set(it.item_uid, it);
  const colLookup = new Map<string, Col>();
  const hits = new Map<string, Map<string, Set<string>>>();   // inputId -> colKey -> categories
  const readBy = new Map<string, Set<string>>();
  const sawColumn = new Set<string>();
  const adders = new Map<string, AdderSpec>();
  const pipesBy = new Map<string, Set<string>>();   // inputId -> "category|pipelineId"
  const assemblyRange = new Map<string, "length" | "fill">();   // ELR-3a: inputId -> the range its arm implies
  /**
   * SLICE 12e-2b (12e-2 cert finding 2, AC8) -- A FAMILY'S OWN PIPELINE PRICES THAT FAMILY'S SKUs.
   *
   * An item-list family's pipeline matches its row with the family bound from the ROW (`@`), which
   * `literalWhere` rightly drops -- so "Piping accessories - Copper", read by the Copper pipeline alone,
   * listed all 40 pipes where 13 move. The missing fact is WHICH FAMILY'S pipeline read the input for a
   * column: recorded here per (input, column), and applied when the rows are listed -- a row whose family
   * attribute names a family none of whose pipelines read the input is not reached by it.
   *
   * ⚠️ IT FILTERS THE LIST, IT DOES NOT RE-KEY THE COLUMNS. Putting the family into the column's `where`
   * gave the same SKUs in a different ORDER for every Insulation input; filtering the existing column keeps
   * every other input's list byte-identical. A column any un-owned pipeline read (a config's own
   * `pipelines` -- every Electrical category, ADP's shared default) is OPEN and is never filtered.
   */
  const famReaders = new Map<string, { attr: string; families: Set<string>; open: boolean }>();
  // VRF-3b: the VRF unit SKUs an input sizes or converts -- its reach where no SKU's own rate moves (the assembly shape)
  const assemblySkus = new Map<string, Set<string>>();

  for (const cid of Object.keys(configs ?? {}).sort()) {
    const cfg = (configs ?? {})[cid];
    // SLICE 12e-2b (AC8): the attribute an item-list category keeps its family in
    const famAttrId = String((cfg as any)?.list_spec?.family_attribute_id ?? "family");
    // VRF-2b: the convert table's inputs are READ by this category (no column: no SKU's own rate moves)
    for (const u of unitsConvertUses(cfg)) (readBy.get(u.input) ?? readBy.set(u.input, new Set<string>()).get(u.input)!).add(cid);
    // VRF-3b: VRF's extras read their inputs (one per table cell) -- read by this category, reaching the units they size;
    // the convert inputs reach the units whose capacity they convert (owner: "now at 0 items")
    for (const u of extrasUses(cfg, items)) {
      (readBy.get(u.input) ?? readBy.set(u.input, new Set<string>()).get(u.input)!).add(cid);
      const set = assemblySkus.get(u.input) ?? assemblySkus.set(u.input, new Set<string>()).get(u.input)!;
      for (const s of u.skus) set.add(s);
    }
    for (const [input, skus] of unitsConvertSkus(cfg, items)) {
      const set = assemblySkus.get(input) ?? assemblySkus.set(input, new Set<string>()).get(input)!;
      for (const s of skus) set.add(s);
    }
    for (const [pid, pl, ownerFamily, isConvert] of pipelinesWithFamily(cfg)) {
      const steps: any[] = pl.steps ?? [];
      const owners = ctxOwners(pl);
      const prov = new Map<string, Set<string>>();
      const acc = new Set<string>();
      let driving: string | undefined;
      let drivingWhere: Record<string, unknown> = {};

      const remember = (c: Col): string => {
        const k = colKey(c);
        colLookup.set(k, c);
        return k;
      };
      const provAdd = (key: string | undefined, ks: Iterable<string>) => {
        if (!key) return;
        const set = prov.get(key) ?? new Set<string>();
        for (const k of ks) set.add(k);
        prov.set(key, set);
      };
      const note = (ids: Set<string>, ks: readonly string[]) => {
        for (const id of ids) {
          if (!pipesBy.has(id)) pipesBy.set(id, new Set<string>());
          pipesBy.get(id)!.add(`${cid}|${pid}`);
          if (!readBy.has(id)) readBy.set(id, new Set<string>());
          readBy.get(id)!.add(cid);
          // ADP-1 (owner Q2): a CONVERSION prices a per-number ROW from another unit's SKU; no catalogue SKU is ever
          // priced through it at its own unit, so it reaches no SKU column -- the input is "read by" the category
          // and moves 0 SKUs, which is the truth the impact panel shows
          if (isConvert) continue;
          if (!hits.has(id)) hits.set(id, new Map<string, Set<string>>());
          const m = hits.get(id)!;
          for (const k of ks) {
            if (!m.has(k)) m.set(k, new Set<string>());
            m.get(k)!.add(cid);
            sawColumn.add(id);
            // SLICE 12e-2b (AC8): WHO read the input for this column -- a family's own pipeline, or one that
            // belongs to no family (then the column is open to every row, exactly as before)
            const fk = `${id}\u0000${k}`;
            const seen = famReaders.get(fk) ?? { attr: famAttrId, families: new Set<string>(), open: false };
            if (ownerFamily === null || seen.attr !== famAttrId) seen.open = true;
            else seen.families.add(ownerFamily);
            famReaders.set(fk, seen);
          }
        }
      };
      /** the `when` of a SINGLE-branch conditional step. A many-branch step narrows differently per
       * branch, so the union of its `when` maps is not a filter and must not be applied as one. */
      const whenOf = (step: any): Record<string, unknown> => {
        const cs = step?.conditions ?? [];
        return cs.length === 1 ? { ...(cs[0]?.when ?? {}) } : {};
      };

      const ordered = [
        ...steps.filter((s) => s?.step === "rate_ref" || s?.pricing_input === true),
        ...steps.filter((s) => !(s?.step === "rate_ref" || s?.pricing_input === true)),
      ];
      for (const s of ordered) {
        const st = s?.step;
        if (st === "rate_ref" || s?.pricing_input === true) continue;

        if (st === "map_attribute" || st === "derive_attribute" || st === "circuit_fit") {
          /**
           * ELR-3a -- AN ASSEMBLY STEP READS A LENGTH OR A FILL, AND THAT MOVES NO SKU's OWN RATE. The input is noted
           * as READ (its category, its pipelines, so the panel can price worked examples through them) with NO
           * column: the four point-wiring numbers build the assembly, they do not scale a catalogue rate. Before this
           * branch the walk did not visit these steps at all, so such an input had no reach entry -- "read by nothing".
           */
          const ids = inputsRead(s, owners);
          note(ids, []);
          for (const id of ids) {
            if (st === "circuit_fit") assemblyRange.set(id, "fill");
            else if (!assemblyRange.has(id)) assemblyRange.set(id, "length");
          }
        } else if (st === "match_master_row" || st === "catalog_fit") {
          driving = s?.params?.kind;
          drivingWhere = literalWhere(s?.params?.where);
        } else if (st === "component_ref") {
          const k = remember({
            kind: String(s?.ref?.kind ?? ""), rateKey: String(s?.target ?? ""),
            where: { ...literalWhere(s?.ref), ...whenOf(s) },
          });
          provAdd(s?.name, [k]);
          provAdd(s?.result, [k]);
          acc.add(k);
          note(inputsRead(s, owners), [k]);
        } else if (st === "component" || st === "component_band") {
          const tgts: string[] = s?.target ? [s.target] : (s?.bands ?? []).map((b: any) => b?.target);
          let ks = tgts.filter(Boolean).map((t) => remember({
            kind: String(driving ?? ""), rateKey: String(t),
            where: { ...drivingWhere, ...whenOf(s) },
          }));
          /**
           * ⚠️ AN ADDITIVE COMPONENT CARRIES NO `target` AND NO `bands` -- it adds a flat amount to
           * whatever the pipeline is holding, exactly as `install_as_ratio` ratios it. Reading only
           * the step that touches the input therefore reported ZERO for all three cable-tray adders
           * and for the markup on one of them, and the panel rendered empty. But 450 tray rows DO
           * change price when an adder moves, and the owner's rule is whose PRICE MOVES, not what
           * the input multiplies -- so the addend inherits the columns accumulated so far, which is
           * the set the `sum_components` below it will write.
           */
          const additive = ks.length === 0 && acc.size > 0;
          if (additive) ks = Array.from(acc);
          provAdd(s?.name, ks);
          for (const k of ks) acc.add(k);
          const readers = inputsRead(s, owners);
          /**
           * ⚠️ PER BRANCH, for the same reason `apply_effective_multiplier` below is. A CONDITIONAL
           * additive component does not move every row of its pipeline -- it moves the rows whose
           * branch it is. Insulation's cladding is ONE component with six branches keyed on the row's
           * own `cladding`, so folding them together reported 224 SKUs for an input that moves 68, and
           * 20 for one that moves 3. The owner found it on the live page: "can you check if only the
           * really linked SKUs for a parameter are coming in the SKUs count and list for it?"
           *
           * ⚠️ NARROWED ONLY BY `when` KEYS THE SKUs ACTUALLY CARRY. A branch may key on a BoQ-ROW
           * option instead -- `cover`, `installation_type`, `floor_refilling`, `floor_cutting`, which
           * is EVERY conditional component Electrical has, verified over v66 -- and no SKU carries
           * those, so narrowing on them would filter every row out and report zero. With this test
           * Electrical narrows by nothing and its whole reach map is byte-identical.
           */
          // ⚠️ ANY conditional component, additive or TARGETED. The first version gated on `additive`
          // and left the three GI inputs reporting 20 where 3 move: Insulation's AREA cladding has a
          // `target`, so its columns come from the target rather than from `acc` -- a different code
          // path, the same over-report. The narrowing is about WHICH SKUs a branch selects, which has
          // nothing to do with where the columns came from.
          const branchNoted = Array.isArray(s?.conditions) && s.conditions.length > 0
            && narrowAdditiveByBranch(s, ks, owners, note, remember, colLookup, attrKeysByKind);
          if (!branchNoted) note(readers, ks);
          if (additive) {
            const branches = (s?.conditions ?? []).map((c: any) => {
              const ctxBinds: Record<string, string> = {};
              const literals: Record<string, number> = {};
              for (const [k, v] of Object.entries(c?.params ?? {})) {
                if (k.endsWith(CTX_SUFFIX) && typeof v === "string") ctxBinds[k.slice(0, -CTX_SUFFIX.length)] = v;
                else if (typeof v === "number") literals[k] = v;
              }
              return { when: { ...(c?.when ?? {}) }, ctxBinds, literals };
            });
            const spec: AdderSpec = {
              formula: String(s?.formula ?? ""),
              branches,
              component: String(s?.name ?? ""),
              category: cid,
            };
            for (const id of readers) if (!adders.has(id)) adders.set(id, spec);
          }
        } else if (st === "sum_components") {
          provAdd(s?.result, acc);
        } else if (st === "apply_effective_multiplier") {
          // ⚠️ PER BRANCH. Each `when` selects a DIFFERENT SKU subset AND reads a DIFFERENT input --
          // ARMOURED reads cable_arm, UNARMOURED reads cable_unarm. Folded together, each input takes
          // every cable (292) instead of its own 187 / 105.
          const tgt: string | undefined = s?.target;
          for (const cond of s?.conditions ?? []) {
            const ids = new Set<string>();
            for (const [k, v] of Object.entries(cond?.params ?? {})) {
              if (!k.endsWith("_from_ctx") || typeof v !== "string") continue;
              for (const id of owners[v] ?? []) ids.add(id);
            }
            if (!ids.size || !tgt || !driving) continue;
            const k = remember({
              kind: driving, rateKey: tgt,
              where: { ...drivingWhere, ...(cond?.when ?? {}) },
            });
            provAdd(s?.result || tgt, [k]);
            note(ids, [k]);
          }
        } else if (st === "scale" || st === "install_as_ratio" || st === "roundup") {
          const tgt: string | undefined = s?.target;
          let ks = Array.from(prov.get(tgt ?? "") ?? []);
          if (tgt && !prov.has(tgt) && driving) {
            // the first read of the matched row's OWN rate. `!prov.has(tgt)` is load-bearing: a key an
            // earlier step registered EMPTY is a COMPUTED value, and testing only `ks.length === 0`
            // invents it as a stored column.
            ks = [remember({ kind: driving, rateKey: tgt, where: { ...drivingWhere } })];
            provAdd(tgt, ks);
          }
          // ⚠️ `install_as_ratio` carries NO `target`: it ratios whatever the pipeline is holding, so
          // its provenance is the accumulated sum. Without this `termination_share` reads 0 SKUs.
          if (!ks.length && st === "install_as_ratio") ks = Array.from(acc);
          provAdd(s?.result || tgt, ks);
          note(inputsRead(s, owners), ks);
        }
      }
    }
  }

  const out: Record<string, InputReach> = {};
  for (const id of new Set<string>([...hits.keys(), ...readBy.keys()])) {
    const byCol = hits.get(id) ?? new Map<string, Set<string>>();
    const columns: ReachedColumn[] = [];
    const byCategory: Record<string, Set<string>> = {};
    const distinct = new Set<string>();
    /**
     * Per KIND this input touched: the rate keys the walk asked for, and whether any category that
     * applied it there is ITEM-LIST. Both are needed to name the untestable population below.
     */
    const walkedKeys = new Map<string, Set<string>>();
    const itemListKind = new Set<string>();
    const itemListCats = new Map<string, Set<string>>();
    for (const [k, cats] of byCol) {
      const c = colLookup.get(k);
      if (!c || !c.kind || !c.rateKey) continue;
      const catList = Array.from(cats).sort();
      (walkedKeys.get(c.kind) ?? walkedKeys.set(c.kind, new Set<string>()).get(c.kind)!).add(c.rateKey);
      for (const cat of catList) {
        if (!itemListPricingSpec(configs?.[cat] as never)) continue;
        itemListKind.add(c.kind);
        (itemListCats.get(c.kind) ?? itemListCats.set(c.kind, new Set<string>()).get(c.kind)!).add(cat);
      }
      const readers = famReaders.get(`${id}\u0000${k}`);
      for (const uid of matching(c)) {
        if (readers && !readers.open) {
          const fam = (itemByUid.get(uid)?.attributes ?? {})[readers.attr];
          if (typeof fam === "string" && !readers.families.has(fam)) continue;
        }
        columns.push({ itemUid: uid, kind: c.kind, rateKey: c.rateKey, categories: catList });
        distinct.add(uid);
        for (const cat of catList) (byCategory[cat] ??= new Set<string>()).add(uid);
      }
    }
    /**
     * The untestable population -- see `candidateSkus`. A row of a touched kind, in an item-list
     * category, that stores NONE of the rate keys the walk asked for, so `matching()` could not
     * reach a verdict about it either way. Already-matched rows are excluded: they have a verdict.
     */
    const candidates: CandidateSku[] = [];
    for (const it of items ?? []) {
      const kind = String(it.kind ?? "");
      if (!itemListKind.has(kind)) continue;
      const uid = it.item_uid;
      if (!uid || distinct.has(uid)) continue;
      const rates = (it.rates ?? {}) as Record<string, unknown>;
      let storesOne = false;
      for (const rk of walkedKeys.get(kind) ?? []) if (rates[rk] !== undefined) { storesOne = true; break; }
      if (storesOne) continue;
      /**
       * ⚠️ AND IT MUST CARRY NO GEOMETRY. Without this the net is far too wide: 209 of Insulation's
       * 229 rows store no `cost_cladding`, so the three GI inputs each nominated 209 candidates and
       * every one of them cost a pricing probe to rule out (measured 2026-10-05; all 209 confirmed
       * NEGATIVE). A row that CARRIES its geometry is priced directly and already has a verdict from
       * the column walk -- the population this channel exists for is exactly the rows that cannot be
       * priced on their own, which is what the samples supply a geometry for. Narrowing here takes
       * every input to 5 candidates and changes no confirmed answer.
       */
      const cats = Array.from(itemListCats.get(kind) ?? []).sort();
      if (cats.every((cat) => skuCarriesGeometry(configs?.[cat], it))) continue;
      candidates.push({ itemUid: uid, kind, categories: cats });
    }
    out[id] = {
      distinctSkus: Array.from(distinct).sort(),
      columns,
      candidateSkus: candidates.sort((a, b) => a.itemUid.localeCompare(b.itemUid)),
      byCategory: Object.fromEntries(
        Object.entries(byCategory).map(([k, v]) => [k, Array.from(v).sort()]),
      ),
      /**
       * ⚠️ THE FLAG MEANS "THIS INPUT ADDS RATHER THAN SCALES", not "this input reaches nothing".
       * It used to be `distinct.size === 0`, which was a symptom of the walk missing the additive
       * path; now that the adders correctly reach their 450 trays that test would be FALSE for all
       * four and three of them would fall through to a multiplier panel. It also keeps the markup ON
       * an adder (`tray_cutting`, which carries only an `installation_markup`) on the adder's panel,
       * which is the owner's Q3 ruling -- a rate-key test could never do that.
       */
      isFlatAdder: adders.has(id),
      adder: adders.get(id),
      readByCategories: Array.from(readBy.get(id) ?? []).sort(),
      ...(assemblySkus.has(id) ? { assemblySkus: Array.from(assemblySkus.get(id)!).sort() } : {}),
      ...(assemblyRange.has(id) ? { assemblyRange: assemblyRange.get(id) } : {}),
      pipelines: Array.from(pipesBy.get(id) ?? []).sort().map((s2) => {
        const [category, pipelineId] = s2.split("|");
        return { category, pipelineId };
      }),
    };
  }
  void isInternal;
  void sawColumn;
  return out;
}

/** The ITEMS count the Pricing Inputs table shows -- DISTINCT SKUs (owner N-2), never uses. VRF-3b: an input that moves no
 * SKU's own rate counts the VRF units it sizes or converts (`assemblySkus`). */
export function reachedSkuCount(
  reach: Record<string, InputReach> | null | undefined,
  inputId: string,
): number {
  const r = (reach ?? {})[inputId];
  return (r?.distinctSkus.length || r?.assemblySkus?.length) ?? 0;
}
