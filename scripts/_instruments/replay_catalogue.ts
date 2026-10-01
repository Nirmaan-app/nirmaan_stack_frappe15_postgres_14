// SLICE 12b(A) no-op replay harness -- TEMPORARY, UNTRACKED. No AI call, no DB write, no repo write.
//
// WHAT IT PROVES. Ruling 3 makes the fold migration NOT like-for-like: the step computes differently
// (two inputs multiplied, in place of one pre-multiplied literal). So "the tests are green" is not
// enough -- every figure the catalogue can produce must come out IDENTICAL to the last decimal.
// Run BEFORE the change and AFTER; `_slice12b_replay_diff.py diff` must report IDENTICAL.
//
// ⚠️ THE SELECTION MUST BE IDENTICAL IN BOTH RUNS OR THE PROOF IS WORTHLESS. Everything below is
// derived deterministically from the asset -- no randomness, no clock. Items are sorted by item_uid
// and candidates are taken in that order, so the same asset always yields the same sweep.
//
// TWO DRIVERS, because the twelve Electrical categories are not one shape:
//
//   (1) ITEM-DRIVEN. A category that declares `item_kinds` is swept over its own items: the selection
//       is that item's stored attributes plus the category's `extraction_defaults` plus, for any
//       declared attribute still unset, the definition's first allowed value.
//
//   (2) ASSEMBLY-DRIVEN -- the reason this harness had to be rewritten. `point_wiring` declares
//       `item_kinds: []` and `wiring_cabling` declares none at all; both are pure assemblies driven
//       entirely by the SELECTION, so driver (1) produced ZERO records for them -- and between them
//       they hold every fold ruling 3 rewrites. So for each `component_ref` in a pipeline, this
//       driver reads the ref's LITERAL parts (kind, family, material, insulation, ...), finds the
//       catalogue rows matching them, takes the k-th such row, and sets each `@bound` selection
//       attribute to that row's value for the ref key that bound it. Sweeping k = 0..N-1 gives N
//       distinct fixed selections per category, so a fold multiplier is exercised against many
//       different base rates rather than one.
//
// ⚠️ A `no_match` IS A RESULT, NOT A GAP. The proof is that BEFORE and AFTER agree, refusals
// included: a refusal that becomes a figure, or a figure that becomes a refusal, is the regression
// this exists to catch. But a pipeline that NEVER yields a figure certifies nothing about the
// arithmetic inside it -- `diff.py coverage` names those explicitly, and they must be read.
import * as fs from "fs";
import { runAllPipelines } from "../../frontend/src/pages/pricing/rate-master/ratePipelineInterpreter";
import type {
  RateMasterItem,
  RateCategoryConfig,
  PipelineResult,
} from "../../frontend/src/pages/pricing/rate-master/rateMasterTypes";

const assetPath = process.argv[2];
const outPath = process.argv[3];
const ASSEMBLY_DEPTH = Number(process.argv[4] ?? 12);
if (!assetPath || !outPath) {
  console.error("usage: node _slice12b_replay.js <asset.json> <out.json> [assembly_depth]");
  process.exit(2);
}

const asset = JSON.parse(fs.readFileSync(assetPath, "utf-8"));
const discipline: string = asset.discipline;

// The catalogue exactly as `get_rate_master_items` hands it to the frontend, including the read-time
// brand projection (`extraction.PROJECTED_ITEM_COLUMNS` = ("brand",)): a non-blank `brand` column is
// copied into `attributes`, and a STORED attribute of the same name WINS. Nothing is written back.
const items: RateMasterItem[] = asset.items
  .slice()
  .sort((a: any, b: any) => String(a.item_uid).localeCompare(String(b.item_uid)))
  .map((it: any) => {
    const attrs: Record<string, any> = { ...(it.attributes ?? {}) };
    const brand = it.brand;
    if (typeof brand === "string" && brand.trim() !== "" && !("brand" in attrs)) attrs.brand = brand;
    return {
      item_uid: it.item_uid,
      discipline,
      kind: it.kind,
      brand: it.brand ?? undefined,
      unit: it.unit,
      attributes: attrs,
      rates: { ...(it.rates ?? {}) },
    } as RateMasterItem;
  });

type Sel = Record<string, string | number>;

/** extraction_defaults, then the definitions' first allowed value for anything still unset. */
function baseSelection(cfg: RateCategoryConfig, seed?: RateMasterItem): Sel {
  const sel: Sel = {};
  const defs = (cfg as any).extraction_defaults ?? {};
  for (const k of Object.keys(defs).sort()) {
    const v = defs[k];
    if (typeof v === "string" || typeof v === "number") sel[k] = v;
  }
  if (seed) {
    for (const k of Object.keys(seed.attributes ?? {}).sort()) {
      const v = (seed.attributes as any)[k];
      if (typeof v === "string" || typeof v === "number") sel[k] = v;
    }
  }
  const computed = computedAttrs(cfg);
  for (const d of ((cfg.attribute_definitions ?? []) as any[])) {
    const id = String(d.id);
    if (id in sel || computed.has(id)) continue;
    const vals = d.values;
    if (Array.isArray(vals) && vals.length > 0) {
      const v = vals[0];
      if (typeof v === "string" || typeof v === "number") sel[id] = v;
    }
  }
  return sel;
}

/**
 * Attributes the pipelines COMPUTE (`map_attribute` / `derive_attribute` `result_attr`).
 *
 * ⚠️ These must NEVER be pre-filled by the harness. `point_wiring`'s circuit length is written by a
 * `map_attribute` default of 30 and a `derive_attribute` of `base 15 + per_extra 5`; seeding
 * `circuit_length_m` with the generic numeric 1 SHADOWED both, so perturbing 15 or 30 moved no figure
 * at all and the sweep silently certified nothing about either.
 */
function computedAttrs(cfg: RateCategoryConfig): Set<string> {
  const out = new Set<string>();
  for (const pid of Object.keys((cfg as any).pipelines ?? {}).sort()) {
    for (const st of (((cfg as any).pipelines[pid] ?? {}).steps ?? [])) {
      if (st.step === "map_attribute" || st.step === "derive_attribute") {
        const ra = (st.params ?? {}).result_attr;
        if (typeof ra === "string" && ra.trim() !== "") out.add(ra);
      }
    }
  }
  return out;
}

/**
 * Every attribute a `conditions[].when` branches on, with the distinct values it is tested against.
 *
 * ⚠️ A category's conditional components are otherwise never exercised. `cabletray_raceway` prices
 * ceiling accessories at 106/m, floor refilling at 180/m and floor cutting at 200/m, each behind a
 * `when`; the definitions' FIRST allowed value is the "no" branch for all three, so the default sweep
 * took the zero branch every time and perturbing all three moved ZERO figures.
 */
function conditionGates(cfg: RateCategoryConfig): Map<string, Array<string | number>> {
  const out = new Map<string, Array<string | number>>();
  // TWO PASSES: a `from_attr` is only recognised as a gate source once the gate it feeds is known,
  // and the feeding step can appear BEFORE the step that tests it.
  for (let pass = 0; pass < 2; pass++)
  for (const pid of Object.keys((cfg as any).pipelines ?? {}).sort()) {
    for (const st of (((cfg as any).pipelines[pid] ?? {}).steps ?? [])) {
      const add = (k: string, v: any) => {
        if (typeof v !== "string" && typeof v !== "number") return;
        const cur = out.get(k) ?? [];
        if (!cur.some((x) => x === v)) cur.push(v);
        out.set(k, cur);
      };
      for (const cond of (st.conditions ?? [])) {
        for (const [k, v] of Object.entries(cond.when ?? {})) add(k, v);
      }
      // ⚠️ `qty.if_attr` IS A GATE TOO, and leaving it out cost the conduit family 98% of its reach.
      // `conduit_included` is written by a `map_attribute` whose default is "No", so once the harness
      // stopped shadowing computed attributes the conduit line priced at qty 0 on almost every row and
      // the 0.70 share -- P-8's headline case -- fell from 461 moved figures to 8. Sweeping the
      // `if_attr` values restores the "Yes" branch as an explicit case while the real default stays
      // the base case, so BOTH paths are now exercised rather than whichever one happened to win.
      const q = st.qty;
      if (q && typeof q === "object" && q.if_attr) {
        for (const [k, v] of Object.entries(q.if_attr)) add(k, v);
      }
      // `module_fit`'s include gate (`params.include_when: {attr, equals}`) is the same shape.
      const iw = (st.params ?? {}).include_when;
      if (iw && typeof iw === "object" && typeof iw.attr === "string") add(iw.attr, iw.equals);
      // ⚠️ A GATE THAT IS COMPUTED CANNOT BE SET DIRECTLY -- ITS SOURCES MUST BE SET INSTEAD, and
      // missing this kept all three point-wiring conduit sites blind through two attempted fixes.
      // `conduit_included` IS a gate (the conduit's `qty.if_attr` tests it), but it is also the
      // `result_attr` of three `map_attribute` steps driven by `conduit_handoff`, `other_conduit` and
      // `conduit_price_excluded`. Writing `conduit_included` into the selection is futile: those three
      // steps recompute it, and each one, at its first allowed value "Yes", forces it back to "No".
      // None of the three is a gate by the `when` / `if_attr` test, so they were never swept -- and
      // the only value the conduit gate is ever TESTED against is "Yes", so no `ALL=No` case existed
      // at all. So: every `from_attr` feeding a gate is itself treated as a gate, over its table keys.
      const ps2 = st.params ?? {};
      const ra = ps2.result_attr, fa = ps2.from_attr;
      if (typeof ra === "string" && typeof fa === "string" && out.has(ra)) {
        for (const tk of Object.keys(ps2.table ?? {})) add(fa, tk);
      }
    }
  }
  return out;
}

/**
 * PRIMED CASES -- §BD-5, hand-specified and documented, because the generic sweep provably cannot
 * reach them.
 *
 * ⚠️ WHY A HAND-SPECIFIED CASE IS THE RIGHT ANSWER HERE, after three generic attempts failed.
 * Point wiring's conduit is NOT behind a `when` or an `if_attr` -- its `qty` is `{from_fit:
 * "conduit_qty"}` -- so `conduit_included` never enters the gate set at all, and no amount of gate
 * sweeping touches it. The real chain is a cascade of `map_attribute` tables:
 *
 *     conduit_handoff        "Yes"    -> table Yes->No        -> conduit_included = No
 *     conduit_price_excluded "Yes"    -> table Yes->No        -> conduit_included = No
 *     conduit_included       "No"     -> table No->None       -> conduit_type = None
 *     conduit_type           "None"                           -> `none_skips` zeroes the line
 *
 * and BOTH of those attributes have the disabling value FIRST in `values`, which is what the generic
 * filler picks. Deriving "which value of a choice attribute enables a downstream component" means
 * walking the whole map cascade, which is a solver, not a sweep. So the two values are named here, with
 * the cascade written out, and the case is auditable.
 *
 * The consequence of NOT having this: all three point-wiring conduit sites are invisible, including
 * input 4's -- and `conduit_included` DEFAULTS to "Yes", so this is the COMMON case in a real BoQ.
 */
const PRIMED: Record<string, Record<string, string | number>> = {
  point_wiring: { conduit_handoff: "No", conduit_price_excluded: "No" },
};

/** Every distinct value any gate of this category is tested against. */
function allGateValues(cfg: RateCategoryConfig): Set<string | number> {
  const out = new Set<string | number>();
  for (const vs of conditionGates(cfg).values()) for (const v of vs) out.add(v);
  return out;
}

/** Every `component_ref` of every pipeline of this category, in a stable order. */
function componentRefs(cfg: RateCategoryConfig): any[] {
  const out: any[] = [];
  for (const pid of Object.keys((cfg as any).pipelines ?? {}).sort()) {
    for (const st of (((cfg as any).pipelines[pid] ?? {}).steps ?? [])) {
      if (st.step === "component_ref" && st.ref && typeof st.ref === "object") out.push(st);
    }
  }
  return out;
}

/**
 * THE KINDS AN ITEM-DRIVEN SWEEP SHOULD WALK.
 *
 * `item_kinds` alone is not it: `wiring_cabling` declares NONE and yet every one of its four
 * pipelines opens with `match_master_row {kind: "cable"}` or `{kind: "termination"}`, so an
 * item_kinds-only driver produced zero figures for the category that owns the cable discount and
 * markup the folds are derived FROM. The kinds a pipeline actually matches on are therefore unioned
 * in, read from `match_master_row` and `catalog_fit`.
 */
function drivingKinds(cfg: RateCategoryConfig): string[] {
  const out = new Set<string>((((cfg as any).item_kinds ?? []) as any[]).map(String));
  for (const pid of Object.keys((cfg as any).pipelines ?? {}).sort()) {
    for (const st of (((cfg as any).pipelines[pid] ?? {}).steps ?? [])) {
      if (st.step === "match_master_row" || st.step === "catalog_fit") {
        const k = (st.params ?? {}).kind;
        if (typeof k === "string" && k.trim() !== "") out.add(k);
      }
    }
  }
  return Array.from(out).sort();
}

/**
 * ASSEMBLY DRIVER. Fill every `@bound` selection attribute the category's component_refs need, by
 * picking the k-th catalogue row that satisfies each ref's LITERAL parts.
 *
 * ⚠️ A bound name that another step COMPUTES (`circuit_fit`'s `@fitted_size`, `module_fit`'s
 * `@blank_fit_item`) is still written here. That is harmless and deliberate: the interpreter's
 * `resolveAtRef` prefers a computed bind and falls back to the selection, so a computed one shadows
 * this value and an uncomputed one gets a usable fallback instead of aborting the pipeline. Either
 * way the value is the SAME in both runs, which is all the proof requires.
 */
function assemblySelection(cfg: RateCategoryConfig, k: number, onto?: Sel): { sel: Sel; bound: number } {
  // ⚠️ GAPS ONLY when `onto` is given. An item-driven case already carries the driving row's own
  // stored attributes, and overwriting one of those with a picked row's value would break the very
  // match it is there to exercise -- so a bound name already set is left exactly as it is.
  const fillOnly = onto !== undefined;
  const sel: Sel = onto !== undefined ? { ...onto } : baseSelection(cfg);
  let bound = 0;
  for (const st of componentRefs(cfg)) {
    const ref = st.ref as Record<string, any>;
    const literals: Array<[string, any]> = [];
    const atKeys: Array<[string, string]> = [];
    for (const [rk, rv] of Object.entries(ref)) {
      if (rk === "kind" || rk === "attributes") continue;
      if (typeof rv === "string" && rv.startsWith("@")) atKeys.push([rk, rv.slice(1)]);
      else literals.push([rk, rv]);
    }
    if (atKeys.length === 0) continue;
    const cands = items.filter(
      (it) => String(it.kind) === String(ref.kind) && literals.every(([rk, rv]) => (it.attributes as any)?.[rk] === rv)
    );
    if (cands.length === 0) continue;
    const pick = cands[k % cands.length];
    for (const [rk, boundName] of atKeys) {
      if (fillOnly && boundName in sel) continue;
      const v = (pick.attributes as any)?.[rk];
      if (typeof v === "string" || typeof v === "number") {
        sel[boundName] = v;
        bound++;
      }
    }
  }
  // NUMBERS. A `component_ref`'s `qty`, a `rate_stages` `mult_from_attr` and a `scale`'s
  // `<ident>_from_attr` all read the SELECTION, and an absent one is an honest no-compute that stops
  // the pipeline before the arithmetic under test. So every still-unset attribute the category
  // DECLARES AS A NUMBER gets one fixed positive value.
  //
  // ⚠️ Keying on the declared `type` rather than on the NAME is what finally reached
  // `popup_boxes.popup_boq`: its step 1 binds `module_count_from_attr`, and `module_count` matches no
  // `_qty` / `_runs` naming pattern, so a name-shaped rule refused all 74 of its cases at step 2.
  const computed = computedAttrs(cfg);
  for (const d of ((cfg.attribute_definitions ?? []) as any[])) {
    const id = String(d.id);
    if (id in sel || computed.has(id)) continue;
    const t = String(d.type ?? "");
    if (t === "number" || t === "number_choice" || /_qty$|_runs$|^points$|_m$/.test(id)) {
      sel[id] = 1;
      bound++;
    }
  }
  return { sel, bound };
}

function resultRecord(r: PipelineResult) {
  const last = r.steps.length ? r.steps[r.steps.length - 1] : undefined;
  const finals: Record<string, string> = {};
  for (const key of Object.keys(r.finals ?? {}).sort()) {
    const v = (r.finals as any)[key];
    // Serialised as TEXT at 17 significant digits. Compared as floats, a 291.43125 vs
    // 291.43125000000003 difference can read as equal; as text it cannot. (The 12a openpyxl lesson.)
    finals[key] = typeof v === "number" ? (Number.isFinite(v) ? v.toPrecision(17) : String(v)) : String(v);
  }
  return {
    pipeline: r.pipelineId,
    status: r.status,
    finals,
    matched: r.matchedItem?.item_uid ?? null,
    step_count: r.steps.length,
    last_label: last?.label ?? null,
    last_condition: (last as any)?.matchedCondition ?? null,
  };
}

const out: any[] = [];
let ok = 0;
let noMatch = 0;
let unsupported = 0;

function record(cfg: RateCategoryConfig, caseId: string, seedUid: string | null, kind: string | null, sel: Sel) {
  let results: PipelineResult[];
  try {
    results = runAllPipelines(cfg, items, sel);
  } catch (e: any) {
    out.push({ category: (cfg as any).category_id, item_uid: caseId, threw: String(e?.message ?? e) });
    return;
  }
  for (const r of results) {
    if (r.status === "ok") ok++;
    else if (r.status === "no_match") noMatch++;
    else unsupported++;
  }
  out.push({
    category: (cfg as any).category_id,
    item_uid: caseId,
    seed_uid: seedUid,
    kind,
    selection: Object.fromEntries(Object.keys(sel).sort().map((k) => [k, String(sel[k])])),
    results: results.map(resultRecord),
  });
}

const configs: RateCategoryConfig[] = (asset.category_configs ?? [])
  .slice()
  .sort((a: any, b: any) => String(a.category_id).localeCompare(String(b.category_id)));

for (const cfg of configs) {
  if (Object.keys((cfg as any).pipelines ?? {}).length === 0) continue; // not eligible
  const kinds: string[] = drivingKinds(cfg);
  const own = kinds.length ? items.filter((it) => kinds.includes(String(it.kind))) : [];

  // (1) item-driven, over every row of every kind the category matches on -- with the assembly
  // bindings filling only the gaps the row itself leaves (see assemblySelection's note).
  for (const item of own) {
    const seeded = baseSelection(cfg, item);
    const { sel } = assemblySelection(cfg, 0, seeded);
    record(cfg, item.item_uid, item.item_uid, String(item.kind), sel);
  }

  // (1b) GATE sweep. One extra case per (conditional attribute, value it is tested against), on top
  // of a fixed driving row, so every `when` branch of every conditional component fires at least
  // once. Without this the three cable-tray rupee allowances (106 / 180 / 200) were never priced.
  const gates = conditionGates(cfg);
  if (gates.size > 0) {
    const seed = own.length ? own[0] : undefined;
    for (const gk of Array.from(gates.keys()).sort()) {
      for (const gv of gates.get(gk)!) {
        const sel = assemblySelection(cfg, 0, baseSelection(cfg, seed)).sel;
        sel[gk] = gv;
        record(cfg, `gate:${gk}=${gv}`, seed?.item_uid ?? null, seed ? String(seed.kind) : null, sel);
      }
    }

    // (1c) ALL-GATES-TOGETHER cases -- §BD-5, and the gap they close is worth stating.
    //
    // ⚠️ SWEEPING ONE GATE AT A TIME IS NOT ENOUGH WHEN GATES COMPOSE. Point wiring's conduit is
    // switched OFF by ANY of `conduit_handoff` / `other_conduit` / `conduit_price_excluded` being
    // "Yes", and the generic filler sets each unset attribute to its FIRST allowed value -- which for
    // all three is "Yes". So every per-gate case still had at least two of them off, the conduit line
    // zeroed via `none_skips`, and the conduit's installation share moved ZERO figures. It is a LIVE
    // input -- indeed the DEFAULT case in a real BoQ, since `conduit_included` defaults to "Yes" --
    // that the rig had never driven once.
    //
    // A full cross-product is 2^n, so instead: set EVERY gate to the same value at once, for each
    // distinct value any gate is tested against. For the three conduit gates, "all No" is exactly the
    // case that turns the conduit on. Cheap, deterministic, and it generalises to every category.
    const allValues = new Set<string | number>();
    for (const vs of gates.values()) for (const v of vs) allValues.add(v);
    for (const gv of Array.from(allValues).sort((a, b) => String(a).localeCompare(String(b)))) {
      const sel = assemblySelection(cfg, 0, baseSelection(cfg, seed)).sel;
      for (const gk of gates.keys()) sel[gk] = gv;
      record(cfg, `gate:ALL=${gv}`, seed?.item_uid ?? null, seed ? String(seed.kind) : null, sel);
    }
  }

  // (2) assembly-driven -- ALWAYS, not only where (1) found nothing. `db_switchgear`,
  // `popup_boxes` and `switches_sockets` DO own items yet every item-driven run refused, because
  // their pipelines assemble from OTHER rows picked by the selection. Running both drivers over
  // every category is what took the certified set from 8 categories to all 12.
  if (componentRefs(cfg).length > 0) {
    for (let k = 0; k < ASSEMBLY_DEPTH; k++) {
      const { sel, bound } = assemblySelection(cfg, k);
      if (bound === 0) break;
      record(cfg, `asm:${k}`, null, null, sel);

      // (2b) THE GATES, OVERLAID ON THE ASSEMBLY CASE -- and this is the fix that actually worked.
      //
      // ⚠️ THE (1c) ALL-GATES CASES DID NOT REACH POINT WIRING, AND I CHECKED RATHER THAN ASSUMED.
      // (1c) builds its selection from `baseSelection(cfg, seed)` with `seed = own[0]` -- but
      // `point_wiring` declares `item_kinds: []`, so it has NO own rows, `seed` is undefined, and the
      // case lacks every `@`-bound wire / switch / plate attribute. Those pipelines then refuse long
      // before step 14, so all three point-wiring CONDUIT sites stayed invisible: perturbing
      // `pw_boq_install[14].stage1.mult`, `pw_boq_supply[14].stage0.mult` or `pw_bcs[14].stage0.mult`
      // moved ZERO figures even with the all-gates cases present.
      //
      // Only the ASSEMBLY selection reaches those steps, so the gates must ride on IT.
      for (const gv of Array.from(allGateValues(cfg)).sort((a, b) => String(a).localeCompare(String(b)))) {
        const g = assemblySelection(cfg, k).sel;
        for (const gk of conditionGates(cfg).keys()) g[gk] = gv;
        record(cfg, `asm:${k}/gate:ALL=${gv}`, null, null, g);
      }

      // (2c) the PRIMED case -- the only thing that reaches point wiring's conduit.
      const primed = PRIMED[String((cfg as any).category_id)];
      if (primed) {
        const g = assemblySelection(cfg, k).sel;
        for (const [pk, pv] of Object.entries(primed)) g[pk] = pv;
        record(cfg, `asm:${k}/primed`, null, null, g);
      }
    }
  }
}

fs.writeFileSync(outPath, JSON.stringify(out, null, 1), "utf-8");
console.log(
  `asset=${assetPath} discipline=${discipline} items=${items.length} ` +
    `records=${out.length} pipeline_runs=${ok + noMatch + unsupported} ok=${ok} no_match=${noMatch} unsupported=${unsupported}`
);
