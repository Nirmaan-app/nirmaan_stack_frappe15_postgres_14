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

/** Walk a component_ref's rate_stages: rate *= mult, then optional per-stage roundup (in order). */
function stageRate(base: number, stages: import("./rateMasterTypes").RateStage[] | undefined): number {
  let r = base;
  for (const st of stages ?? []) r = roundByMode(r * st.mult, st.round);
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
      for (const [coreAttr, thickAttr] of p.wire_specs) {
        const core = Number(selected[coreAttr]);
        const thick = Number(selected[thickAttr]);
        if (!Number.isFinite(core) || core <= 0 || !Number.isFinite(thick) || thick <= 0) {
          miss = `${coreAttr}/${thickAttr}`;
          break;
        }
        overallDia += Math.sqrt(thick / Math.PI) * 2 * core;
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
    } else if (stepType === "component_ref") {
      const s = raw as import("./rateMasterTypes").ComponentRefStep;
      // EA-4a ASSEMBLY SHAPE (referenced item x quantity): detected by the presence of rate_stages / qty.
      // ref carries the match attrs INLINE (values literal | "@<attr>" from the selection | "@fitted_size"
      // from circuit_fit); base = matched row's `target`; rate = rate_stages walk (per-stage roundup); qty
      // per QtySpec; value = staged_rate x qty. UNIQUE resolution (EA-2c): zero/multiple -> honest
      // no-compute. A null @attr / a missing qty source -> honest missing-attr (never a guess).
      if (s.rate_stages !== undefined || s.qty !== undefined) {
        const resolved: Record<string, string | number> = {};
        let bindMiss: string | null = null;
        for (const [k, rawVal] of Object.entries(s.ref)) {
          if (k === "kind" || k === "attributes") continue;
          let val: string | number;
          if (typeof rawVal === "string" && rawVal.startsWith("@")) {
            const src = rawVal.slice(1);
            const bound = src === "fitted_size" ? ctx["fitted_size"] : selected[src];
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
        const rate = stageRate(base, s.rate_stages);
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
