// Rate Master (RM-2) -- the PURE pipeline interpreter.
//
// THE SINGLE COMPUTE SOURCE for the stored rate-master pipelines. It executes
// the stored step vocabulary against (config pipelines, master items, selected
// attributes) and produces per-step traces + finals. It has NO React imports and
// no I/O -- RM-3's pricer-facing helper consumes it UNCHANGED (there is never a
// second implementation of this arithmetic).
//
// Design invariants:
//  - EXACT matching on canonical values (no case-insensitive matching anywhere).
//  - Formulas are read FROM the config and evaluated by a tiny safe arithmetic
//    evaluator (no eval(); CSP-safe) -- the arithmetic is not hardcoded per step.
//  - An UNKNOWN step type yields an explicit "unsupported" trace + a per-pipeline
//    "unsupported" status; the pipeline never silently skips it (forward-compat).
//  - A combination with no master row yields status "no_match" and ZERO finals.
//  - ROUNDUP is Excel ROUNDUP (away from zero) at `digits`: digits -1 => tens.

import type {
  Pipeline,
  PipelineResult,
  RateCategoryConfig,
  RateMasterItem,
  StepTrace,
} from "./rateMasterTypes";

// ---------- tiny safe arithmetic evaluator (+ - * / , parens, unary minus) ----------

type Tok = { t: "num" | "id" | "op" | "lp" | "rp"; v: string };

function tokenize(expr: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (c === " " || c === "\t") {
      i++;
      continue;
    }
    if (c === "(") {
      toks.push({ t: "lp", v: c });
      i++;
    } else if (c === ")") {
      toks.push({ t: "rp", v: c });
      i++;
    } else if ("+-*/".includes(c)) {
      toks.push({ t: "op", v: c });
      i++;
    } else if (/[0-9.]/.test(c)) {
      let j = i + 1;
      while (j < expr.length && /[0-9.]/.test(expr[j])) j++;
      toks.push({ t: "num", v: expr.slice(i, j) });
      i = j;
    } else if (/[a-zA-Z_]/.test(c)) {
      let j = i + 1;
      while (j < expr.length && /[a-zA-Z0-9_]/.test(expr[j])) j++;
      toks.push({ t: "id", v: expr.slice(i, j) });
      i = j;
    } else {
      throw new Error(`Unexpected character '${c}' in formula '${expr}'`);
    }
  }
  return toks;
}

/**
 * Evaluate a simple arithmetic formula with identifiers bound from `env`.
 * Throws on unknown identifiers / malformed input -- surfaces config problems
 * rather than silently mis-computing.
 */
export function evalFormula(expr: string, env: Record<string, number>): number {
  const toks = tokenize(expr);
  let pos = 0;
  const peek = () => toks[pos];

  function parseExpr(): number {
    let val = parseTerm();
    while (peek() && peek().t === "op" && (peek().v === "+" || peek().v === "-")) {
      const op = toks[pos++].v;
      const rhs = parseTerm();
      val = op === "+" ? val + rhs : val - rhs;
    }
    return val;
  }
  function parseTerm(): number {
    let val = parseFactor();
    while (peek() && peek().t === "op" && (peek().v === "*" || peek().v === "/")) {
      const op = toks[pos++].v;
      const rhs = parseFactor();
      val = op === "*" ? val * rhs : val / rhs;
    }
    return val;
  }
  function parseFactor(): number {
    const tk = peek();
    if (!tk) throw new Error(`Unexpected end of formula '${expr}'`);
    if (tk.t === "op" && tk.v === "-") {
      pos++;
      return -parseFactor();
    }
    if (tk.t === "num") {
      pos++;
      return parseFloat(tk.v);
    }
    if (tk.t === "id") {
      pos++;
      if (!(tk.v in env)) throw new Error(`Unknown identifier '${tk.v}' in formula '${expr}'`);
      return env[tk.v];
    }
    if (tk.t === "lp") {
      pos++;
      const v = parseExpr();
      if (!peek() || peek().t !== "rp") throw new Error(`Missing ')' in formula '${expr}'`);
      pos++;
      return v;
    }
    throw new Error(`Unexpected token '${tk.v}' in formula '${expr}'`);
  }

  const result = parseExpr();
  if (pos !== toks.length) throw new Error(`Trailing tokens in formula '${expr}'`);
  return result;
}

// ---------- helpers ----------

/** Excel ROUNDUP (away from zero) to `digits`. digits -1 => nearest ten up. */
export function roundUp(x: number, digits: number): number {
  const factor = Math.pow(10, digits);
  return Math.ceil(x * factor - 1e-9) / factor;
}

// ---------- EA-4a assembly helpers (used only by circuit_fit + the assembly component_ref) ----------

/** EA-4a-r: the POSITIVE-ABSENCE sentinel. A composite component set to this value contributes ZERO
 * (distinct from blank/undefined, which stays an honest missing-attr). Emitted only for allow_none defs. */
export const NONE_SENTINEL = "None";

/** Compact number for trace strings: integer as-is, else 2 decimals (drops trailing zeros). */
function fmtNum(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(2)));
}

/** Apply one rate stage's optional roundup. `up0` = ROUNDUP to units, `up-1` = to tens; absent => unrounded. */
function roundByMode(x: number, mode?: "up0" | "up-1"): number {
  if (mode === "up0") return roundUp(x, 0);
  if (mode === "up-1") return roundUp(x, -1);
  return x;
}

/** Resolve an ABSENT-MEANS-ONE numeric factor from the selection.
 *
 * OWNER RULING (point_wiring runs): a missing / non-numeric / non-positive runs factor resolves to 1,
 * in BOTH circuit_fit and the rate stage. This DELIBERATELY DIVERGES from the cable-runs `_from_attr`
 * precedent in `scale`, which hard-fails to an honest no-compute. Three reasons: (a) backward
 * compatibility REQUIRES it in circuit_fit -- every shipped wire_specs is a 2-tuple with no runs attr
 * at all, and absence must not change their behaviour; (b) differing absent-semantics between the two
 * sites inside ONE category would be incoherent; (c) the cable hard-fail produced a configurator
 * regression where every row reads no-compute until the user fills a box that is 1 in almost every case.
 * A run count is a MULTIPLIER whose neutral element is 1, not a missing measurement. */
function absentMeansOne(selected: Record<string, string | number>, attr: string | undefined): number {
  if (!attr) return 1;
  const v = Number(selected[attr]);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

/** Walk a component_ref's rate_stages: rate *= mult (x an optional attribute-bound factor), then the
 * optional per-stage roundup, in order. `mult_from_attr` folds in BEFORE that stage's rounding, so
 * `x runs then round` -- the owner's ruling. Absent `mult_from_attr` => factor 1 => byte-identical. */
function stageRate(
  base: number,
  stages: import("./rateMasterTypes").RateStage[] | undefined,
  selected: Record<string, string | number>,
): number {
  let r = base;
  for (const st of stages ?? []) r = roundByMode(r * st.mult * absentMeansOne(selected, st.mult_from_attr), st.round);
  return r;
}

/** Resolve an assembly component_ref qty. Returns null for an HONEST missing-attr no-compute (a from_attr
 * / from_fit source that is absent or non-numeric) -- never a guessed 0. */
function resolveQty(
  qty: import("./rateMasterTypes").QtySpec | undefined,
  selected: Record<string, string | number>,
  ctx: Record<string, number>
): number | null {
  if (qty === undefined) return 1;
  if (typeof qty === "number") return qty;
  if ("from_attr" in qty) {
    const v = Number(selected[qty.from_attr]);
    return Number.isFinite(v) ? v : null;
  }
  if ("from_fit" in qty) {
    const v = ctx[qty.from_fit];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  }
  // if_attr: a boolean-style switch on a selected attribute (e.g. back_box Yes -> 1 else 0).
  const on = Object.entries(qty.if_attr).every(([k, val]) => selected[k] === val);
  return on ? qty.then : qty.else;
}

/**
 * Match the row for `kind` on the INTERSECTION of the row's stored attributes and the selected
 * attributes: every key the ROW carries must equal the selection; keys the row does NOT carry (a
 * pipeline-level choice such as `kva` or `cover`) are ignored. Matching stays EXACT on canonical
 * values where the keys overlap. This lets a row that stores only its own identifying keys (e.g.
 * ups_per_kva carrying pricing_mode only) match a richer selection. For wiring the row's key set and
 * the selection's key set are identical, so this is byte-equivalent to the prior every-selected-key
 * match -- the five wiring goldens are unchanged (regression pins). (EA-1 feature 3.)
 */
export function matchMasterRow(
  items: RateMasterItem[],
  kind: string,
  selected: Record<string, string | number>
): RateMasterItem | undefined {
  return items.find(
    (it) =>
      it.kind === kind &&
      Object.keys(it.attributes).every((k) => !(k in selected) || it.attributes[k] === selected[k])
  );
}

function bandTargetFor(bands: { when: string; target: string }[], value: number): { target: string; label: string } | undefined {
  for (const b of bands) {
    const w = b.when.trim();
    if (w.startsWith(">=")) {
      if (value >= parseFloat(w.slice(2))) return { target: b.target, label: `${value} >= ${parseFloat(w.slice(2))}` };
    } else if (w.startsWith("<=")) {
      if (value <= parseFloat(w.slice(2))) return { target: b.target, label: `${value} <= ${parseFloat(w.slice(2))}` };
    } else if (w.startsWith("<")) {
      if (value < parseFloat(w.slice(1))) return { target: b.target, label: `${value} < ${parseFloat(w.slice(1))}` };
    } else if (w.startsWith(">")) {
      if (value > parseFloat(w.slice(1))) return { target: b.target, label: `${value} > ${parseFloat(w.slice(1))}` };
    }
  }
  return undefined;
}

/**
 * Choose a band by the band_on value, supporting BOTH string-equality bands (a non-comparator `when`,
 * matched EXACTLY against the value as a string -- e.g. the tray `cover` = WITH/WITHOUT/COVER_ONLY)
 * AND the legacy numeric comparator bands (`<35` / `>=35`, the wiring gland band). String-equality is
 * tried first; a comparator band is only considered when the value is numeric. Returns undefined when
 * nothing matches (an HONEST no-compute upstream). (EA-1 feature 1.)
 */
function chooseBand(bands: { when: string; target: string }[], rawVal: unknown): { target: string; label: string } | undefined {
  const sval = String(rawVal);
  for (const b of bands) {
    const w = b.when.trim();
    if (!/^(<=|>=|<|>)/.test(w) && w === sval) return { target: b.target, label: b.when };
  }
  const num = Number(rawVal);
  if (Number.isFinite(num)) {
    const c = bandTargetFor(bands, num);
    if (c) return c;
  }
  return undefined;
}

// ---- SLICE 2: module-count ladder helpers (used only by module_fit) ----

/** One resolvable rung of a catalog ladder: a module SIZE and the catalog LABEL that serves it. */
export interface ModuleRung {
  /** The module count this rung covers. */
  size: number;
  /** The catalog item label, exactly as stored (e.g. "8M", "1M & 2M"). */
  label: string;
}

/**
 * Parse a catalog rung's label into the module sizes it covers.
 *
 * THE `"1M & 2M"` RULING (owner-locked): that is ONE catalog item covering TWO sizes, so BOTH a
 * computed 1 and a computed 2 must match it. It is represented by EXPANSION -- every integer in the
 * label is a covered size, and the rung is entered into the ladder once per covered size, all
 * carrying the same label. A naive integer ladder cannot parse it; expansion means the exact-match
 * path handles the combined rung with no special case anywhere downstream.
 *
 * "3M" -> [3]; "1M & 2M" -> [1, 2]; "12M" -> [12]; a label carrying no integer -> [] (skipped).
 * PURE.
 */
export function moduleSizesFromLabel(label: string): number[] {
  const found = String(label ?? "").match(/\d+/g);
  if (!found) return [];
  const out: number[] = [];
  for (const raw of found) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0 && !out.includes(n)) out.push(n);
  }
  return out.sort((a, b) => a - b);
}

/**
 * Build a ladder from the CATALOG: every active master row of `kind` whose stored attributes match
 * every `where` entry EXACTLY, expanded by `moduleSizesFromLabel` and sorted ascending by size.
 * A size served by more than one label keeps the first after a deterministic (size, label) sort, so
 * row order in the master can never change the answer. PURE.
 */
export function buildModuleLadder(
  items: RateMasterItem[],
  spec: { kind: string; where?: Record<string, string | number>; label_attr?: string }
): ModuleRung[] {
  const labelAttr = spec.label_attr || "item";
  const where = spec.where ?? {};
  const rungs: ModuleRung[] = [];
  for (const it of items) {
    if (it.kind !== spec.kind) continue;
    if (!Object.entries(where).every(([k, v]) => it.attributes?.[k] === v)) continue;
    const label = it.attributes?.[labelAttr];
    if (typeof label !== "string" && typeof label !== "number") continue;
    for (const size of moduleSizesFromLabel(String(label))) rungs.push({ size, label: String(label) });
  }
  rungs.sort((a, b) => (a.size - b.size) || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  return rungs.filter((r, i) => i === 0 || rungs[i - 1].size !== r.size);
}

/**
 * Fit a module count onto a ladder: the EXACT size when the catalog carries it, otherwise the NEXT
 * HIGHER one. NEVER a lower one -- a plate smaller than its contents cannot hold them, so rounding
 * down would be a wrong price, not merely a wrong size.
 *
 * Returns null when the count is ABOVE the ladder's top rung. That is deliberately an honest
 * no-compute rather than a clamp to the largest size: the catalog simply has no such plate, and
 * clamping would silently under-price by the missing modules AND show a plate that cannot fit. (This
 * is where the step DIVERGES from circuit_fit, which does fall back to its largest size -- circuit_fit
 * then re-checks with `circuits <= 0`, so an unusable fit is still caught downstream; here there is no
 * such second gate.) PURE.
 */
export function fitModuleLadder(rungs: ModuleRung[], count: number): { label: string; modules: number; exact: boolean } | null {
  const exact = rungs.find((r) => r.size === count);
  if (exact) return { label: exact.label, modules: exact.size, exact: true };
  const next = rungs.find((r) => r.size > count);
  return next ? { label: next.label, modules: next.size, exact: false } : null;
}

function readableCondition(when: Record<string, string | number>, params: Record<string, number>): string {
  const lhs = Object.entries(when)
    .map(([k, v]) => `${k} = ${v}`)
    .join(", ");
  const rhs = Object.entries(params)
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
  return `${lhs} -> ${rhs}`;
}

// ---------- the interpreter ----------

/** Run one pipeline for the selected attributes. Never throws on data shape -- it
 * returns a status ("ok" | "no_match" | "unsupported") + traces. */
export function runPipeline(
  pipelineId: string,
  pipeline: Pipeline,
  items: RateMasterItem[],
  selected: Record<string, string | number>
): PipelineResult {
  const ctx: Record<string, number> = {};
  const steps: StepTrace[] = [];
  let matchedItem: RateMasterItem | undefined;
  const components: Record<string, number> = {};
  // SLICE 2: STRING-valued bindings produced by module_fit (a ladder's fitted LABEL, e.g. "12M").
  // `ctx` is numbers-only, and a plate/box size is a catalog label, so it needs its own scope. A
  // component_ref's "@<name>" resolves here BEFORE falling back to the selection -- so a bind whose
  // name matches a selected attribute SHADOWS it, which is exactly how a COMPUTED plate replaces a
  // stated one. Empty unless a module_fit ran, so every pre-slice-2 pipeline is byte-identical.
  const fitLabels: Record<string, string> = {};

  const snapshot = () => ({ ...ctx });

  // Option C (owner-approved scope addition, EA-DIFF): enforce runPipeline's own "never throws on data
  // shape" contract. A data-shape problem in a step formula -- an unbound identifier, a malformed
  // expression (e.g. a `scale` that carries `conditions` whose params the `scale` step never binds, so
  // the formula references an identifier that is not in scope) -- must degrade to the honest
  // `unsupported` status for THIS pipeline, so the Rate Master Derivation tab AND the pricing helper
  // render the honest state and NEVER hit the React error boundary. Contract enforcement, not new
  // vocabulary; a well-formed pipeline is byte-unaffected.
  let lastStepType = "";
  try {
  for (const raw of pipeline.steps) {
    const stepType = (raw as { step: string }).step;
    lastStepType = stepType;

    if (stepType === "match_master_row") {
      const s = raw as import("./rateMasterTypes").MatchMasterRowStep;
      const row = matchMasterRow(items, s.params.kind, selected);
      if (!row) {
        steps.push({
          step: stepType,
          label: s.explain || `match the ${s.params.kind} row`,
          params: { kind: s.params.kind },
          runningValues: snapshot(),
        });
        return { pipelineId, outputs: pipeline.output, status: "no_match", steps, finals: {}, note: pipeline.note };
      }
      matchedItem = row;
      for (const [k, v] of Object.entries(row.rates)) ctx[k] = v;
      steps.push({
        step: stepType,
        label: s.explain || `matched the ${s.params.kind} row`,
        params: { kind: s.params.kind },
        runningValues: snapshot(),
      });
    } else if (stepType === "apply_effective_multiplier") {
      const s = raw as import("./rateMasterTypes").ApplyEffectiveMultiplierStep;
      const cond = s.conditions.find((c) =>
        Object.entries(c.when).every(([k, v]) => matchedItem?.attributes[k] === v)
      );
      if (!cond) {
        steps.push({ step: stepType, label: s.explain || "apply effective multiplier", runningValues: snapshot(), unsupported: false });
        // no matching condition -> treat as a data gap, honestly (no value produced)
        return { pipelineId, outputs: pipeline.output, status: "no_match", steps, finals: {}, matchedItem, note: pipeline.note };
      }
      const value = ctx[s.target] * evalFormula(s.formula, { ...cond.params });
      ctx[s.result] = value;
      steps.push({
        step: stepType,
        label: s.explain || "supplier discount then markup",
        params: cond.params,
        matchedCondition: readableCondition(cond.when, cond.params),
        produced: { key: s.result, value },
        runningValues: snapshot(),
      });
    } else if (stepType === "scale") {
      const s = raw as import("./rateMasterTypes").ScaleStep;
      const env: Record<string, number> = { base: ctx[s.target] };
      let attrMissing: string | null = null;
      for (const [pk, pv] of Object.entries(s.params ?? {})) {
        if (pk.endsWith("_from_attr")) {
          // EA-1 feature 2: bind the identifier (key minus `_from_attr`) to the SELECTED attribute's
          // numeric value; a missing / non-numeric attr is an HONEST no-compute (not a zero default).
          const ident = pk.slice(0, -"_from_attr".length);
          const av = selected[String(pv)];
          if (typeof av !== "number" || !Number.isFinite(av)) {
            attrMissing = String(pv);
            break;
          }
          env[ident] = av;
        } else if (typeof pv === "number") {
          env[pk] = pv;
        }
      }
      if (attrMissing !== null) {
        steps.push({
          step: stepType,
          label: `attribute '${attrMissing}' missing or non-numeric -- no value computed`,
          runningValues: snapshot(),
        });
        return { pipelineId, outputs: pipeline.output, status: "no_match", steps, finals: {}, matchedItem, note: pipeline.note };
      }
      const baseVal = ctx[s.target];
      if (typeof baseVal !== "number" || !Number.isFinite(baseVal)) {
        // EA-1b HONEST PARTIAL: the source row has no value for this target rate (e.g. a misc row that
        // carries supply but not install, or vice-versa). Do NOT invent one (never 0 / NaN) -- skip
        // THIS output; it stays absent (renders "-"). The pipeline's other outputs still compute.
        steps.push({
          step: stepType,
          label: `${s.target} not available on this row -- ${s.result} not computed`,
          runningValues: snapshot(),
        });
        continue;
      }
      const value = evalFormula(s.formula, env);
      ctx[s.result] = value;
      steps.push({
        step: stepType,
        label: s.explain || "scale",
        params: s.params,
        produced: { key: s.result, value },
        runningValues: snapshot(),
      });
    } else if (stepType === "roundup") {
      const s = raw as import("./rateMasterTypes").RoundupStep;
      const value = roundUp(ctx[s.target], s.params.digits);
      ctx[s.target] = value;
      steps.push({
        step: stepType,
        label: s.explain || `round up (${s.params.digits <= -1 ? "to tens" : "to units"})`,
        params: { digits: s.params.digits },
        produced: { key: s.target, value },
        runningValues: snapshot(),
      });
    } else if (stepType === "component") {
      const s = raw as import("./rateMasterTypes").ComponentStep;
      const env: Record<string, number> = {};
      if (s.target !== undefined) {
        // Bind the target value under BOTH `base` (the normalized contract) and its own name (the
        // legacy wiring `lug` component's formula references `lug_list`).
        env.base = ctx[s.target];
        env[s.target] = ctx[s.target];
      }
      let params: Record<string, number> = s.params ?? {};
      if (Array.isArray(s.conditions)) {
        // EA-1 feature 4: a conditional component resolves its params by the SELECTED attributes
        // (e.g. the earthing chamber keyed on with_chamber). An unmatched condition is an HONEST
        // no-compute -- never a zero default.
        const cond = s.conditions.find((c) =>
          Object.entries(c.when).every(([k, v]) => selected[k] === v)
        );
        if (!cond) {
          steps.push({ step: stepType, label: s.explain || `component: ${s.name} (no matching condition)`, runningValues: { ...snapshot(), ...componentEntries(components) } });
          return { pipelineId, outputs: pipeline.output, status: "no_match", steps, finals: {}, matchedItem, note: pipeline.note };
        }
        params = cond.params ?? {};
      }
      for (const [k, v] of Object.entries(params)) if (typeof v === "number") env[k] = v;
      const value = evalFormula(s.formula, env);
      components[s.name] = value;
      steps.push({
        step: stepType,
        label: s.explain || `component: ${s.name}`,
        params,
        produced: { key: s.name, value },
        runningValues: { ...snapshot(), ...componentEntries(components) },
      });
    } else if (stepType === "circuit_fit") {
      // EA-4a: size the conduit + count circuits for a point-wiring run. overall_dia = Sum
      // sqrt(sqmm/pi)*2*core over wire_specs; fitted_size = smallest size whose usable dia (size *
      // usable[conduit_type][i]) >= dia (largest if none fit); circuits = ROUNDDOWN(usable_dia/dia);
      // conduit_qty = ROUNDUP(length/circuits). BINDS the three results by `binds` for later @fitted_size /
      // from_fit reads. Any missing/zero input, unknown conduit_type, or circuits <= 0 -> HONEST no-compute.
      const s = raw as import("./rateMasterTypes").CircuitFitStep;
      const p = s.params;
      let overallDia = 0;
      let miss: string | null = null;
      for (const [coreAttr, thickAttr, runsAttr] of p.wire_specs) {
        // EA-4a-r: an OPTIONAL wire set to the "None" sentinel is POSITIVELY ABSENT -- omit it from the dia
        // (a single-wire point fits on wire1 alone). Its disabled core attr is not read.
        if (p.optional_wire_when_none && thickAttr === p.optional_wire_when_none && selected[thickAttr] === NONE_SENTINEL) {
          continue;
        }
        const core = Number(selected[coreAttr]);
        const thick = Number(selected[thickAttr]);
        if (!Number.isFinite(core) || core <= 0 || !Number.isFinite(thick) || thick <= 0) {
          miss = `${coreAttr}/${thickAttr}`;
          break;
        }
        // point_wiring RUNS: the OPTIONAL third wire_spec element names a parallel-runs attribute.
        // Conduit sizing is runs x cores; the CATALOG MATCH stays cores-only (the ref.core binding is
        // untouched) -- one attribute serving both is exactly what broke the previous rule. ABSENT
        // MEANS 1, which is what keeps every shipped 2-tuple byte-identical.
        overallDia += Math.sqrt(thick / Math.PI) * 2 * core * absentMeansOne(selected, runsAttr);
      }
      const ctype = selected[p.conduit_type_attr];
      const usable = ctype != null ? p.usable[String(ctype)] : undefined;
      const length = Number(selected[p.length_attr]);
      if (miss !== null) {
        steps.push({ step: stepType, label: `attribute '${miss}' missing or non-positive -- no value computed`, runningValues: snapshot() });
        return { pipelineId, outputs: pipeline.output, status: "no_match", steps, finals: {}, matchedItem, note: pipeline.note };
      }
      if (!usable) {
        steps.push({ step: stepType, label: `conduit_type '${String(ctype)}' has no usable fractions -- no value computed`, runningValues: snapshot() });
        return { pipelineId, outputs: pipeline.output, status: "no_match", steps, finals: {}, matchedItem, note: pipeline.note };
      }
      if (!Number.isFinite(length) || length <= 0 || overallDia <= 0) {
        steps.push({ step: stepType, label: `${p.length_attr} missing/zero or zero overall diameter -- no value computed`, runningValues: snapshot() });
        return { pipelineId, outputs: pipeline.output, status: "no_match", steps, finals: {}, matchedItem, note: pipeline.note };
      }
      let fittedSize = p.sizes[p.sizes.length - 1];
      let fittedUsable = p.sizes[p.sizes.length - 1] * usable[p.sizes.length - 1];
      for (let i = 0; i < p.sizes.length; i++) {
        const ud = p.sizes[i] * usable[i];
        if (ud >= overallDia) {
          fittedSize = p.sizes[i];
          fittedUsable = ud;
          break;
        }
      }
      const circuits = Math.floor(fittedUsable / overallDia);
      if (circuits <= 0) {
        steps.push({ step: stepType, label: `no circuit fits the conduit (dia ${overallDia.toFixed(3)}) -- no value computed`, runningValues: snapshot() });
        return { pipelineId, outputs: pipeline.output, status: "no_match", steps, finals: {}, matchedItem, note: pipeline.note };
      }
      const conduitQty = roundUp(length / circuits, 0);
      const binds = s.binds ?? ["fitted_size", "circuits", "conduit_qty"];
      const vals = [fittedSize, circuits, conduitQty];
      binds.forEach((b, i) => { if (i < vals.length) ctx[b] = vals[i]; });
      steps.push({
        step: stepType,
        label: s.explain || "circuit fit",
        matchedCondition: `dia ${overallDia.toFixed(3)} -> ${fittedSize}mm, ${circuits} circuits, conduit qty ${conduitQty}`,
        runningValues: snapshot(),
      });
    } else if (stepType === "module_fit") {
      // SLICE 2: compute the module count, then resolve it against catalog ladders.
      //   modules  = SUM(weight x selected[attr]) -- weights + attr ids from CONFIG, never hardcoded
      //   each ladder -> exact size if the catalog carries it, else the NEXT HIGHER one, never lower
      //   blanks   = the plate's modules - the modules its contents occupy
      // Every failure is an HONEST no-compute naming its cause -- never a silent zero, never a guess.
      const s = raw as import("./rateMasterTypes").ModuleFitStep;
      const p = s.params;
      const bail = (label: string) => {
        steps.push({ step: stepType, label, runningValues: snapshot() });
        return { pipelineId, outputs: pipeline.output, status: "no_match" as const, steps, finals: {}, matchedItem, note: pipeline.note };
      };

      // (a) the parameterised weighted sum -------------------------------------------------------
      let occupied = 0;
      let termMiss: string | null = null;
      const termParts: string[] = [];
      for (const t of p?.terms ?? []) {
        // POSITIVE ABSENCE: the term's own value, or its controlling item, set to the "None"
        // sentinel means this slot is deliberately empty -> contributes 0. Distinct from blank.
        if (
          (t.none_when && selected[t.none_when] === NONE_SENTINEL) ||
          selected[t.attr] === NONE_SENTINEL
        ) {
          termParts.push(`${fmtNum(t.weight)} x ${t.attr}(None)`);
          continue;
        }
        const rawVal = selected[t.attr];
        const v = Number(rawVal);
        // BLANK / absent / non-numeric is UNKNOWN, not zero -- an honest no-compute (the same
        // hard-fail `scale`'s _from_attr takes). A count's neutral element is 0, but ABSENCE of a
        // count is not a statement that there are none; "None" is how a row says none.
        if (rawVal === undefined || rawVal === null || rawVal === "" || !Number.isFinite(v)) {
          termMiss = t.attr;
          break;
        }
        occupied += t.weight * v;
        termParts.push(`${fmtNum(t.weight)} x ${t.attr}(${fmtNum(v)})`);
      }
      if (termMiss !== null) {
        return bail(`attribute '${termMiss}' missing or non-numeric -- no module count computed`);
      }
      if (!Number.isFinite(occupied) || occupied <= 0) {
        // A non-positive count is an ABSENCE of contents, not a size to fit. Applying the
        // next-higher rule would manufacture a plate for a row carrying nothing.
        return bail(`module count ${fmtNum(occupied)} is not a positive count -- no value computed`);
      }

      // (b) resolve each ladder from the SAME count ----------------------------------------------
      const fittedByBind: Record<string, number> = {};
      const ladderParts: string[] = [];
      for (const L of p?.ladders ?? []) {
        const rungs = buildModuleLadder(items, L);
        if (!rungs.length) {
          return bail(`ladder '${L.bind}' (${L.kind}) has no catalog rows -- no value computed`);
        }
        const fit = fitModuleLadder(rungs, occupied);
        if (!fit) {
          const top = rungs[rungs.length - 1];
          return bail(
            `${fmtNum(occupied)} modules exceeds the largest '${L.bind}' the catalog carries (${top.label}) -- no value computed`
          );
        }
        fitLabels[L.bind] = fit.label;
        fittedByBind[L.bind] = fit.modules;
        if (L.bind_modules) ctx[L.bind_modules] = fit.modules;
        ladderParts.push(`${L.bind} ${fit.label}${fit.exact ? "" : " (next higher)"}`);
      }

      // (c) the blank (filler) count --------------------------------------------------------------
      let blankPart = "";
      if (p?.blanks) {
        const b = p.blanks;
        let base = fittedByBind[b.from_ladder];
        let baseWhat = b.from_ladder;
        const statedRaw = b.stated_attr ? selected[b.stated_attr] : undefined;
        if (
          b.stated_attr &&
          statedRaw !== undefined && statedRaw !== null && statedRaw !== "" && statedRaw !== NONE_SENTINEL
        ) {
          // The row STATES a plate, so that is the plate that gets priced -- the blanks must be
          // counted against IT, or the two would use different numbers and contradict each other.
          const statedSizes = moduleSizesFromLabel(String(statedRaw));
          if (!statedSizes.length) {
            return bail(`stated '${b.stated_attr}' ("${String(statedRaw)}") carries no module size -- no blank count computed`);
          }
          // A combined rung ("1M & 2M") states a RANGE; the size actually used is the smallest one
          // that can hold the contents, and its absence is caught by the negative guard below.
          base = statedSizes.find((n) => n >= occupied) ?? statedSizes[statedSizes.length - 1];
          baseWhat = `stated ${String(statedRaw)}`;
        }
        if (typeof base !== "number" || !Number.isFinite(base)) {
          return bail(`blank count needs ladder '${b.from_ladder}', which did not resolve -- no value computed`);
        }
        const blanks = base - occupied;
        if (blanks < 0) {
          // A plate SMALLER than its contents is a contradiction in the source data. Clamping to
          // zero would price a physically impossible row and hide the contradiction; a negative
          // quantity must never reach a price. Refuse, and say why.
          return bail(
            `${baseWhat} holds ${fmtNum(base)} modules but the contents occupy ${fmtNum(occupied)} -- no value computed`
          );
        }
        ctx[b.bind] = blanks;
        blankPart = `; ${fmtNum(blanks)} blank${blanks === 1 ? "" : "s"} (${baseWhat} ${fmtNum(base)} - ${fmtNum(occupied)})`;
      }

      steps.push({
        step: stepType,
        label: s.explain || "module fit",
        // (d) THE WORKING: the arithmetic AND the ladder hop, in one line.
        matchedCondition: `${termParts.join(" + ")} = ${fmtNum(occupied)} modules -> ${ladderParts.join(", ")}${blankPart}`,
        runningValues: snapshot(),
      });
    } else if (stepType === "component_ref") {
      const s = raw as import("./rateMasterTypes").ComponentRefStep;
      // EA-4a ASSEMBLY SHAPE (referenced item x quantity): detected by the presence of rate_stages / qty.
      // ref carries the match attrs INLINE (values literal | "@<attr>" from the selection | "@fitted_size"
      // from circuit_fit); base = matched row's `target`; rate = rate_stages walk (per-stage roundup); qty
      // per QtySpec; value = staged_rate x qty. UNIQUE resolution (EA-2c): zero/multiple -> honest
      // no-compute. A null @attr / a missing qty source -> honest missing-attr (never a guess).
      if (s.rate_stages !== undefined || s.qty !== undefined) {
        // EA-4a-r: a none_skips component whose ref binds a None-able attr set to the "None" sentinel is
        // POSITIVELY ABSENT -> an EXPLICIT ZERO line (NOT a no-compute, NOT a missing-attr). This fires
        // BEFORE the ref lookup, so socket_item="None" (no such master row) yields 0 instead of aborting
        // the whole pipeline. back_box binds @plate_item, so plate=None zeroes back_box by the same rule.
        if (
          s.none_skips &&
          Object.entries(s.ref).some(
            ([k, rawVal]) =>
              k !== "kind" && k !== "attributes" &&
              typeof rawVal === "string" && rawVal.startsWith("@") &&
              selected[rawVal.slice(1)] === NONE_SENTINEL,
          )
        ) {
          components[s.name] = 0;
          steps.push({
            step: stepType,
            label: s.explain || `component: ${s.name}`,
            matchedCondition: "None -> 0",
            produced: { key: s.name, value: 0 },
            runningValues: { ...snapshot(), ...componentEntries(components) },
          });
          continue;
        }
        const resolved: Record<string, string | number> = {};
        let bindMiss: string | null = null;
        for (const [k, rawVal] of Object.entries(s.ref)) {
          if (k === "kind" || k === "attributes") continue;
          let val: string | number;
          if (typeof rawVal === "string" && rawVal.startsWith("@")) {
            const src = rawVal.slice(1);
            // SLICE 2: a module_fit ladder LABEL binding resolves ahead of the selection (see
            // fitLabels above); absent one, this is byte-identical to the pre-slice-2 resolution.
            const bound =
              src === "fitted_size"
                ? ctx["fitted_size"]
                : src in fitLabels
                  ? fitLabels[src]
                  : selected[src];
            if (bound === undefined || bound === null || (typeof bound === "number" && !Number.isFinite(bound))) {
              bindMiss = src;
              break;
            }
            val = bound;
          } else {
            val = rawVal as string | number;
          }
          resolved[k] = val;
        }
        if (bindMiss !== null) {
          steps.push({
            step: stepType,
            label: s.explain || `component: ${s.name}`,
            matchedCondition: `${s.name}: '${bindMiss}' not provided -- not computed`,
            runningValues: { ...snapshot(), ...componentEntries(components) },
          });
          return { pipelineId, outputs: pipeline.output, status: "no_match", steps, finals: {}, matchedItem, note: pipeline.note };
        }
        const refRows = items.filter(
          (it) =>
            it.kind === s.ref.kind &&
            Object.entries(resolved).every(([k, v]) => it.attributes?.[k] === v)
        );
        const refLabel = Object.values(resolved).filter((v) => v !== "" && v !== "NA").join(" ") || s.ref.kind;
        if (refRows.length !== 1) {
          steps.push({
            step: stepType,
            label: s.explain || `component: ${s.name}`,
            refItem: refLabel,
            matchedCondition: `ref ${s.ref.kind}: ${refRows.length === 0 ? "no" : refRows.length} matching row(s) -- not computed`,
            runningValues: { ...snapshot(), ...componentEntries(components) },
          });
          return { pipelineId, outputs: pipeline.output, status: "no_match", steps, finals: {}, matchedItem, note: pipeline.note };
        }
        const base = refRows[0].rates?.[s.target];
        if (typeof base !== "number" || !Number.isFinite(base)) {
          steps.push({
            step: stepType,
            label: s.explain || `component: ${s.name}`,
            refItem: refLabel,
            matchedCondition: `${s.target} not on the referenced row -- not computed`,
            runningValues: { ...snapshot(), ...componentEntries(components) },
          });
          return { pipelineId, outputs: pipeline.output, status: "no_match", steps, finals: {}, matchedItem, note: pipeline.note };
        }
        const qty = resolveQty(s.qty, selected, ctx);
        if (qty === null) {
          steps.push({
            step: stepType,
            label: s.explain || `component: ${s.name}`,
            refItem: refLabel,
            matchedCondition: `${s.name}: quantity not provided -- not computed`,
            runningValues: { ...snapshot(), ...componentEntries(components) },
          });
          return { pipelineId, outputs: pipeline.output, status: "no_match", steps, finals: {}, matchedItem, note: pipeline.note };
        }
        const rate = stageRate(base, s.rate_stages, selected);
        const value = rate * qty;
        components[s.name] = value;
        steps.push({
          step: stepType,
          label: s.explain || `component: ${s.name}`,
          refItem: refLabel,
          matchedCondition: `rate ${fmtNum(rate)} x qty ${fmtNum(qty)}`,
          produced: { key: s.name, value },
          runningValues: { ...snapshot(), ...componentEntries(components) },
        });
        continue;
      }
      // EA-2c LEGACY SHAPE (ref.attributes + formula) -- byte-unchanged below.
      // EA-2c: `base` comes from a SEPARATELY-REFERENCED row matched by kind AND every ref attribute
      // (exact canonical, this discipline). UNIQUE resolution: zero OR multiple matches is an HONEST
      // no-compute (never zero-by-default, never pick-first). Here ref = {earthing_item, type "Bus bar"}
      // -> the existing Bus bar row (one row, two roles: a selectable item AND this adder).
      const refAttrs = s.ref?.attributes ?? {};
      const refRows = items.filter(
        (it) =>
          it.kind === s.ref?.kind &&
          (!matchedItem || it.discipline === matchedItem.discipline) &&
          Object.entries(refAttrs).every(([k, v]) => it.attributes?.[k] === v)
      );
      const refName =
        Object.values(refAttrs).filter((v) => v !== null && v !== undefined && v !== "").join(" ") ||
        (refRows[0] ? Object.values(refRows[0].attributes ?? {}).filter((v) => v !== null && v !== undefined && v !== "").join(" ") : "") ||
        refRows[0]?.name ||
        s.ref?.kind;
      if (refRows.length !== 1) {
        steps.push({
          step: stepType,
          label: s.explain || `component: ${s.name}`,
          refItem: refName,
          matchedCondition: `ref ${s.ref?.kind}: ${refRows.length === 0 ? "no" : refRows.length} matching row(s) -- not computed`,
          runningValues: { ...snapshot(), ...componentEntries(components) },
        });
        return { pipelineId, outputs: pipeline.output, status: "no_match", steps, finals: {}, matchedItem, note: pipeline.note };
      }
      const refRow = refRows[0];
      const baseVal = refRow.rates?.[s.target];
      if (typeof baseVal !== "number" || !Number.isFinite(baseVal)) {
        steps.push({
          step: stepType,
          label: s.explain || `component: ${s.name}`,
          refItem: refName,
          matchedCondition: `${s.target} not on the referenced row -- not computed`,
          runningValues: { ...snapshot(), ...componentEntries(components) },
        });
        return { pipelineId, outputs: pipeline.output, status: "no_match", steps, finals: {}, matchedItem, note: pipeline.note };
      }
      const env: Record<string, number> = { base: baseVal, [s.target]: baseVal };
      let refParams: Record<string, number> = s.params ?? {};
      if (Array.isArray(s.conditions)) {
        const cond = s.conditions.find((c) =>
          Object.entries(c.when).every(([k, v]) => selected[k] === v)
        );
        if (!cond) {
          steps.push({
            step: stepType,
            label: s.explain || `component: ${s.name} (no matching condition)`,
            refItem: refName,
            runningValues: { ...snapshot(), ...componentEntries(components) },
          });
          return { pipelineId, outputs: pipeline.output, status: "no_match", steps, finals: {}, matchedItem, note: pipeline.note };
        }
        refParams = cond.params ?? {};
      }
      for (const [k, v] of Object.entries(refParams)) if (typeof v === "number") env[k] = v;
      // The LEGACY (EA-2c) shape always carries a formula (the assembly shape returned via `continue`
      // above); an empty formula degrades honestly through the Option-C guard rather than mis-computing.
      const value = evalFormula(s.formula ?? "", env);
      components[s.name] = value;
      steps.push({
        step: stepType,
        label: s.explain || `component: ${s.name}`,
        params: refParams,
        refItem: refName,
        produced: { key: s.name, value },
        runningValues: { ...snapshot(), ...componentEntries(components) },
      });
    } else if (stepType === "component_band") {
      const s = raw as import("./rateMasterTypes").ComponentBandStep;
      // band_on may be an ITEM attribute (the wiring gland's thickness_sqmm) OR a pipeline-level
      // SELECTED choice not stored on the row (the tray `cover`); prefer the item's value, fall back
      // to the selection. chooseBand handles string-equality AND numeric comparator bands.
      const bandRaw = matchedItem?.attributes[s.band_on] ?? selected[s.band_on];
      const chosen = chooseBand(s.bands, bandRaw);
      if (!chosen) {
        steps.push({ step: stepType, label: s.explain || `component: ${s.name}`, runningValues: snapshot() });
        return { pipelineId, outputs: pipeline.output, status: "no_match", steps, finals: {}, matchedItem, note: pipeline.note };
      }
      // Bind the chosen column under `base` (the normalized contract), plus the legacy `gland_list`
      // and the column's own name (the wiring gland formula references gland_list).
      const value = evalFormula(s.formula, { base: ctx[chosen.target], gland_list: ctx[chosen.target], [chosen.target]: ctx[chosen.target], ...s.params });
      components[s.name] = value;
      steps.push({
        step: stepType,
        label: s.explain || `component: ${s.name} (banded)`,
        params: s.params,
        bandChosen: `${s.band_on} ${chosen.label} -> ${chosen.target}`,
        produced: { key: s.name, value },
        runningValues: { ...snapshot(), ...componentEntries(components) },
      });
    } else if (stepType === "sum_components") {
      const s = raw as import("./rateMasterTypes").SumComponentsStep;
      const value = Object.values(components).reduce((a, b) => a + b, 0);
      ctx[s.result] = value;
      steps.push({
        step: stepType,
        label: s.explain || "sum components",
        produced: { key: s.result, value },
        runningValues: snapshot(),
      });
    } else if (stepType === "install_as_ratio") {
      const s = raw as import("./rateMasterTypes").InstallAsRatioStep;
      const supplyKey = Object.keys(ctx).find((k) => k.startsWith("supply_"));
      const base = supplyKey ? ctx[supplyKey] : NaN;
      const value = base * s.params.ratio;
      ctx[s.result] = value;
      steps.push({
        step: stepType,
        label: s.explain || `install as ${s.params.ratio * 100}% of supply`,
        params: s.params,
        produced: { key: s.result, value },
        runningValues: snapshot(),
      });
    } else if (stepType === "lookup_or_ratio") {
      // EA-4c: the DB build-up install -- the sheet's EXACT IFERROR three-way, in order:
      //   (a) shell absent (when_shell_absent.attr == equals) -> ROUNDUP(ratio.of x ratio.mult);
      //   (b) else the unique install-table lookup (kind + item attr == the resolved @attr) resolves
      //       -> ROUNDUP(matched[lookup.target] x lookup.mult) [the TABLE-HIT branch];
      //   (c) the lookup MISSES (no unique row, or the target rate is absent) -> ROUNDUP(ratio.of x
      //       ratio.mult) [the IFERROR FALLBACK]. A ratio branch whose ratio.of is not computed is an
      //       HONEST no-compute. The trace names which branch fired. Never throws (Option C; a malformed
      //       shape degrades via the outer try/catch to `unsupported`).
      const s = raw as import("./rateMasterTypes").LookupOrRatioStep;
      // EA-4d: the table-hit branch and the ratio branches round SEPARATELY (the sheet's install-table
      // hit is UNROUNDED `VLOOKUP*1.5`; the shell-absent + fallback ratio branches ROUNDUP tens).
      // round_lookup / round_ratio win; the legacy single `round` is the fallback for BOTH
      // (backwards-compat). A null/undefined round => UNROUNDED (no roundup applied).
      const roundLookup = s.round_lookup !== undefined ? s.round_lookup : s.round;
      const roundRatio = s.round_ratio !== undefined ? s.round_ratio : s.round;
      const applyRoundOpt = (x: number, d: number | null | undefined) =>
        d === null || d === undefined ? x : roundUp(x, d);
      const ratioSrc = ctx[s.ratio.of];
      const ratioOk = typeof ratioSrc === "number" && Number.isFinite(ratioSrc);
      const ratioValue = () => applyRoundOpt(ratioSrc * s.ratio.mult, roundRatio);
      const noRatioSource = (why: string) => {
        steps.push({
          step: stepType,
          label: s.explain || `install: ${why}, '${s.ratio.of}' not computed -- no value`,
          runningValues: snapshot(),
        });
        return { pipelineId, outputs: pipeline.output, status: "no_match" as const, steps, finals: {}, matchedItem, note: pipeline.note };
      };
      if (selected[s.when_shell_absent.attr] === s.when_shell_absent.equals) {
        // (a) the sheet's IF(J9=0) branch -- the shell is positively absent (MCB-only DB)
        if (!ratioOk) return noRatioSource("shell absent");
        const value = ratioValue();
        ctx[s.result] = value;
        steps.push({
          step: stepType,
          label: s.explain || "install (shell absent)",
          matchedCondition: `shell absent -> ${s.ratio.of} x ${s.ratio.mult} (ratio branch)`,
          produced: { key: s.result, value },
          runningValues: snapshot(),
        });
      } else {
        const itemRef = s.lookup.item;
        const itemVal =
          typeof itemRef === "string" && itemRef.startsWith("@") ? selected[itemRef.slice(1)] : itemRef;
        const rows = items.filter((it) => it.kind === s.lookup.kind && it.attributes?.item === itemVal);
        const hitRate = rows.length === 1 ? rows[0].rates?.[s.lookup.target] : undefined;
        if (rows.length === 1 && typeof hitRate === "number" && Number.isFinite(hitRate)) {
          // (b) TABLE-HIT: the shell is in the SPN/TPN install table (round_lookup: null => UNROUNDED)
          const value = applyRoundOpt(hitRate * s.lookup.mult, roundLookup);
          const unrounded = roundLookup === null || roundLookup === undefined;
          ctx[s.result] = value;
          steps.push({
            step: stepType,
            label: s.explain || "install (install-table)",
            refItem: String(itemVal ?? s.lookup.kind),
            matchedCondition: `table-hit: ${s.lookup.target} ${fmtNum(hitRate)} x ${s.lookup.mult}${unrounded ? ", no roundup" : ""} (table branch)`,
            produced: { key: s.result, value },
            runningValues: snapshot(),
          });
        } else {
          // (c) the IFERROR fallback: shell present but NOT in the table (VTPN/custom) -> supply ratio
          if (!ratioOk) return noRatioSource("table miss");
          const value = ratioValue();
          ctx[s.result] = value;
          steps.push({
            step: stepType,
            label: s.explain || "install (fallback)",
            refItem: String(itemVal ?? s.lookup.kind),
            matchedCondition: `table miss -> fallback ${s.ratio.of} x ${s.ratio.mult} (ratio branch)`,
            produced: { key: s.result, value },
            runningValues: snapshot(),
          });
        }
      }
    } else {
      // UNKNOWN step type -> explicit unsupported state, never a silent skip.
      steps.push({
        step: stepType,
        label: `unsupported step '${stepType}'`,
        runningValues: snapshot(),
        unsupported: true,
      });
      return { pipelineId, outputs: pipeline.output, status: "unsupported", steps, finals: {}, matchedItem, note: pipeline.note };
    }
  }
  } catch (err) {
    // Data-shape throw (unbound identifier / malformed formula) -> honest `unsupported`, never a crash.
    steps.push({
      step: lastStepType || "(formula)",
      label: `formula could not be evaluated -- ${err instanceof Error ? err.message : String(err)}`,
      runningValues: snapshot(),
      unsupported: true,
    });
    return { pipelineId, outputs: pipeline.output, status: "unsupported", steps, finals: {}, matchedItem, note: pipeline.note };
  }

  const finals: Record<string, number> = {};
  for (const o of pipeline.output) finals[o] = ctx[o];
  return { pipelineId, outputs: pipeline.output, status: "ok", steps, finals, matchedItem, note: pipeline.note };
}

function componentEntries(components: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(components)) out[`component:${k}`] = v;
  return out;
}

/** Run every pipeline in the config for the selected attributes. */
export function runAllPipelines(
  config: RateCategoryConfig,
  items: RateMasterItem[],
  selected: Record<string, string | number>
): PipelineResult[] {
  return Object.entries(config.pipelines).map(([id, pl]) => runPipeline(id, pl, items, selected));
}
