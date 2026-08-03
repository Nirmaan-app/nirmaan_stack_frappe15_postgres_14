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

/** EXACT match on canonical values across every selected attribute key. */
export function matchMasterRow(
  items: RateMasterItem[],
  kind: string,
  selected: Record<string, string | number>
): RateMasterItem | undefined {
  return items.find(
    (it) =>
      it.kind === kind &&
      Object.keys(selected).every((k) => it.attributes[k] === selected[k])
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

  for (const raw of pipeline.steps) {
    const stepType = (raw as { step: string }).step;

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
      const value = evalFormula(s.formula, { base: ctx[s.target], ...s.params });
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
      const value = evalFormula(s.formula, { [s.target]: ctx[s.target], ...s.params });
      components[s.name] = value;
      steps.push({
        step: stepType,
        label: s.explain || `component: ${s.name}`,
        params: s.params,
        produced: { key: s.name, value },
        runningValues: { ...snapshot(), ...componentEntries(components) },
      });
    } else if (stepType === "component_band") {
      const s = raw as import("./rateMasterTypes").ComponentBandStep;
      const bandVal = Number(matchedItem?.attributes[s.band_on]);
      const chosen = bandTargetFor(s.bands, bandVal);
      if (!chosen) {
        steps.push({ step: stepType, label: s.explain || `component: ${s.name}`, runningValues: snapshot() });
        return { pipelineId, outputs: pipeline.output, status: "no_match", steps, finals: {}, matchedItem, note: pipeline.note };
      }
      const value = evalFormula(s.formula, { gland_list: ctx[chosen.target], [chosen.target]: ctx[chosen.target], ...s.params });
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
