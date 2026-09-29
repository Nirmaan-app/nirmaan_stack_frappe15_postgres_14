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
  /** one entry per (SKU, rate column); a row moved on two columns appears twice */
  columns: ReachedColumn[];
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

/** every pricing-input id a step READS, via any `*_from_ctx` param at any of its three depths */
function inputsRead(step: any, owners: Record<string, Set<string>>): Set<string> {
  const out = new Set<string>();
  const blobs: any[] = [step?.params ?? {}];
  for (const st of step?.rate_stages ?? []) blobs.push(st ?? {});
  for (const c of step?.conditions ?? []) blobs.push(c?.params ?? {});
  for (const b of blobs) {
    for (const [k, v] of Object.entries(b ?? {})) {
      if (!k.endsWith("_from_ctx") || typeof v !== "string") continue;
      for (const id of owners[v] ?? []) out.add(id);
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

  const colLookup = new Map<string, Col>();
  const hits = new Map<string, Map<string, Set<string>>>();   // inputId -> colKey -> categories
  const readBy = new Map<string, Set<string>>();
  const sawColumn = new Set<string>();
  const adders = new Map<string, AdderSpec>();
  const pipesBy = new Map<string, Set<string>>();   // inputId -> "category|pipelineId"

  for (const cid of Object.keys(configs ?? {}).sort()) {
    const cfg = (configs ?? {})[cid];
    for (const pid of Object.keys(cfg?.pipelines ?? {}).sort()) {
      const pl: any = (cfg!.pipelines as any)[pid] ?? {};
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
          if (!hits.has(id)) hits.set(id, new Map<string, Set<string>>());
          const m = hits.get(id)!;
          for (const k of ks) {
            if (!m.has(k)) m.set(k, new Set<string>());
            m.get(k)!.add(cid);
            sawColumn.add(id);
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

        if (st === "match_master_row" || st === "catalog_fit") {
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
          note(readers, ks);
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
    for (const [k, cats] of byCol) {
      const c = colLookup.get(k);
      if (!c || !c.kind || !c.rateKey) continue;
      const catList = Array.from(cats).sort();
      for (const uid of matching(c)) {
        columns.push({ itemUid: uid, kind: c.kind, rateKey: c.rateKey, categories: catList });
        distinct.add(uid);
        for (const cat of catList) (byCategory[cat] ??= new Set<string>()).add(uid);
      }
    }
    out[id] = {
      distinctSkus: Array.from(distinct).sort(),
      columns,
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

/** The ITEMS count the Pricing Inputs table shows -- DISTINCT SKUs (owner N-2), never uses. */
export function reachedSkuCount(
  reach: Record<string, InputReach> | null | undefined,
  inputId: string,
): number {
  return (reach ?? {})[inputId]?.distinctSkus.length ?? 0;
}
