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
    } else if (stepType === "component_ref") {
      const s = raw as import("./rateMasterTypes").ComponentRefStep;
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
      const value = evalFormula(s.formula, env);
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
