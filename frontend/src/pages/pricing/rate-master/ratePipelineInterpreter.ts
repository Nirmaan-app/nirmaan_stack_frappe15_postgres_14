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
  CatalogFitOutcome,
  DerivedAttrOutcome,
  MapAttributeOutcome,
  ModuleFitOutcome,
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
      // F-18 (R4) -- THE RIDER THAT MAKES THE DOC COMMENT ABOVE TRUE.
      // `in` tests KEY PRESENCE, not value-hood: `"base" in { base: undefined }` is TRUE. So a
      // binding assigned `undefined` used to sail past this guard, return `undefined` into the
      // arithmetic, and reach the caller as NaN under `status: "ok"` -- the exact opposite of
      // "surfaces config problems rather than silently mis-computing". An identifier bound to
      // NOTHING says no more than an unbound one, so it raises the SAME error and degrades through
      // the Option-C wrapper to the honest `unsupported`.
      // This is a BACKSTOP, not the primary fix: every call site that could bind an absent rate now
      // guards its own target first (E1/E2/E3 below) and returns the better-worded `no_match`. What
      // this covers is a FUTURE formula site written without that guard.
      if (!(tk.v in env) || env[tk.v] === undefined) {
        throw new Error(`Unknown identifier '${tk.v}' in formula '${expr}'`);
      }
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

/**
 * Render a formula with every bound identifier replaced by its value -- "base + (n - 1) * per_extra"
 * with n=7 becomes "15 + (7 - 1) * 5". This is how a `derive_attribute` trace SHOWS ITS WORKING
 * instead of merely asserting a result.
 *
 * It reuses the ONE tokenizer rather than adding a second parser, and it is called only AFTER
 * `evalFormula` has already succeeded on the same expression and env -- so every identifier is bound
 * and `tokenize` cannot throw here. PURE; display only, never a parsing contract.
 */
function substituteFormula(expr: string, env: Record<string, number>): string {
  let out = "";
  for (const tk of tokenize(expr)) {
    const text = tk.t === "id" && tk.v in env ? fmtNum(env[tk.v]) : tk.v;
    // Readable spacing: nothing after "(", nothing before ")", single spaces elsewhere.
    if (out === "" || out.endsWith("(") || tk.t === "rp") out += text;
    else out += ` ${text}`;
  }
  return out;
}

/** The param-key suffix pairing a `scale` step's `<ident>_from_attr` binding with a step divisor.
 * `runs_from_attr: "runs"` + `runs_step_divisor: 3` => the `runs` identifier binds ceil(runs/3). */
export const STEP_DIVISOR_SUFFIX = "_step_divisor";

/**
 * SLICE 5 -- the param suffix that binds ANOTHER COMPUTED (`ctx`) value into a `scale` formula env,
 * as `<ident>`. `{"modules_from_ctx": "module_supply", "formula": "base + modules"}`.
 *
 * ⚠️ IT MUST NOT COLLIDE WITH `_from_attr`, WHICH READS THE SELECTION. Two different sources, two
 * different failure messages: an ATTRIBUTE the row never stated is the pricer's gap to fill, while a
 * ctx key that was never computed is a PIPELINE ordering problem -- a step that should have produced
 * it did not run, or ran after this one. Collapsing them into one message would point the reader at
 * the wrong half of the system.
 */
export const CTX_PARAM_SUFFIX = "_from_ctx";

/**
 * RULING 2 (owner 2026-08-09) -- THE STEP FUNCTION, the ONE definition, shared by both sites that can
 * carry an attribute-bound multiplier (a `component_ref` rate stage and a `scale` param binding) so
 * they can never drift apart.
 *
 *   divisor absent / non-finite / <= 0  ->  the raw factor, UNCHANGED (this is what makes the whole
 *                                           capability additive: every shipped config is byte-identical)
 *   divisor d                           ->  ceil(raw / d)
 *
 * Three runs of wire is three times the WIRE but not three times the LABOUR: 1-3 runs bill one unit of
 * install, 4-6 two, 7-9 three. **The divisor is CONFIG, never hardcoded** (the `module_fit` `terms`
 * precedent) -- 3 is this ruling's number and another category may want another.
 *
 * ⚠️ NEVER A SILENT ZERO. The floor at 1 is EXPLICIT rather than incidental: callers only ever pass a
 * positive raw factor (absentMeansOne guarantees it), so the ceiling is already >= 1 for every real
 * input -- but a multiplier that could round DOWN to nothing would delete a line's labour silently,
 * which is the one failure this must not have. The epsilon mirrors roundUp()'s: without it a
 * float-imprecise exact multiple (6/3) could tip to the next rung and bill 3x for 6 runs.
 *
 * PURE.
 */
export function stepFactor(raw: number, divisor?: number): number {
  if (typeof divisor !== "number" || !Number.isFinite(divisor) || divisor <= 0) return raw;
  const stepped = Math.ceil(raw / divisor - 1e-9);
  return stepped >= 1 ? stepped : 1;
}

/** THE WORKING, as one line: `wire1_runs 4 -> ceil(4/3) = 2x`. A price must show how it was built, and
 * a stepped multiplier is exactly the kind of quiet arithmetic that otherwise looks like a wrong rate.
 * Written by BOTH consumers from this one formatter. PURE; display only, never a parsing contract. */
function stepFactorNote(attr: string, raw: number, divisor: number, factor: number): string {
  return `${attr} ${fmtNum(raw)} -> ceil(${fmtNum(raw)}/${fmtNum(divisor)}) = ${fmtNum(factor)}x`;
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
  notes?: string[],
): number {
  let r = base;
  for (const st of stages ?? []) {
    // RULING 2: absentMeansOne resolves the factor EXACTLY as before (so an absent runs attribute is
    // still 1), and the step divisor then transforms it. With no divisor stepFactor is the identity,
    // so this line is arithmetically byte-identical to the pre-ruling one.
    const raw = absentMeansOne(selected, st.mult_from_attr);
    const factor = stepFactor(raw, st.mult_step_divisor);
    if (notes && st.mult_from_attr && st.mult_step_divisor !== undefined) {
      notes.push(stepFactorNote(st.mult_from_attr, raw, st.mult_step_divisor, factor));
    }
    r = roundByMode(r * st.mult * factor, st.round);
  }
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
  // SLICE 5 (B5, the F-12 recon) -- UNIQUE RESOLUTION, matching both `component_ref` paths.
  //
  // This used to be `items.find(...)`: PICK-FIRST. Two rows satisfying the same selection meant the
  // price came from whichever the catalogue happened to list first, and a re-import that reordered
  // rows could change a price with nothing failing and nothing in the trace to show it. Both
  // `component_ref` resolvers already refuse on `refRows.length !== 1` and call it an honest
  // no-compute; this is the third resolver and it now says the same thing.
  //
  // ⚠️ ZERO AND MULTIPLE COLLAPSE TO THE SAME `undefined` HERE, DELIBERATELY. The `match_master_row`
  // step's caller already renders `undefined` as an honest `no_match` naming the kind, so widening
  // the return type would buy a distinction no caller consumes -- and this stays a pure two-line
  // predicate. Ambiguity is reported at the step, not invented here.
  const matches = items.filter(
    (it) =>
      it.kind === kind &&
      Object.keys(it.attributes).every((k) => !(k in selected) || it.attributes[k] === selected[k])
  );
  return matches.length === 1 ? matches[0] : undefined;
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
  spec: {
    kind: string;
    /** SLICE 2b: a value may be a LIST, matching any member. Values arrive ALREADY "@"-resolved --
     * resolution needs the run's binding scopes, and keeping it out here keeps this pure. */
    where?: Record<string, string | number | Array<string | number>>;
    label_attr?: string;
    /** SLICE 2b: where a rung's SIZE comes from. Absent => parse the label, the behaviour every
     * pre-2b caller relies on and the reason `module_fit` is byte-unaffected by this change. */
    size_from?: { attr: string } | { label: true };
  }
): ModuleRung[] {
  const labelAttr = spec.label_attr || "item";
  const where = spec.where ?? {};
  const sizeAttr =
    spec.size_from && "attr" in spec.size_from ? spec.size_from.attr : undefined;
  // SLICE 2b: list-valued `where` keys, in sorted key order, define the PREFERENCE vector -- the
  // index of the member each row matched. Two rows tying on the same SIZE are settled by comparing
  // those vectors lexicographically (earlier member wins), and only then by the original (size,
  // label) order. With no list-valued key every vector is empty and the comparison collapses to the
  // pre-2b sort exactly.
  const listKeys = Object.keys(where).filter((k) => Array.isArray(where[k])).sort();
  const rungs: Array<ModuleRung & { pref: number[] }> = [];
  for (const it of items) {
    if (it.kind !== spec.kind) continue;
    let matched = true;
    const pref: number[] = [];
    for (const [k, v] of Object.entries(where)) {
      const got = it.attributes?.[k];
      if (Array.isArray(v)) {
        const idx = v.indexOf(got as string | number);
        if (idx < 0) { matched = false; break; }
      } else if (got !== v) {
        matched = false;
        break;
      }
    }
    if (!matched) continue;
    for (const k of listKeys) {
      pref.push((where[k] as Array<string | number>).indexOf(it.attributes?.[k] as string | number));
    }
    const label = it.attributes?.[labelAttr];
    if (typeof label !== "string" && typeof label !== "number") continue;
    if (sizeAttr) {
      // SIZE FROM A NUMERIC ATTRIBUTE. A row whose size attribute is missing or non-numeric is not a
      // rung -- it is skipped silently here, and an EMPTY ladder is what the caller reports.
      const raw = it.attributes?.[sizeAttr];
      const n = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(n)) continue;
      rungs.push({ size: n, label: String(label), pref });
    } else {
      for (const size of moduleSizesFromLabel(String(label))) rungs.push({ size, label: String(label), pref });
    }
  }
  const prefCmp = (a: number[], b: number[]) => {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const d = (a[i] ?? 0) - (b[i] ?? 0);
      if (d !== 0) return d;
    }
    return 0;
  };
  rungs.sort(
    (a, b) =>
      (a.size - b.size) ||
      prefCmp(a.pref, b.pref) ||
      (a.label < b.label ? -1 : a.label > b.label ? 1 : 0)
  );
  return rungs
    .filter((r, i) => i === 0 || rungs[i - 1].size !== r.size)
    .map(({ size, label }) => ({ size, label }));
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
export function fitModuleLadder(
  rungs: ModuleRung[],
  count: number,
  /** SLICE 2b. "up" (the DEFAULT, and every pre-2b caller's behaviour) = exact else the next HIGHER
   * rung. "down" = exact else the next LOWER, for a future consumer whose oversize is the unsafe
   * direction. `module_fit` never passes this and is byte-unaffected. */
  direction: "up" | "down" = "up"
): { label: string; modules: number; exact: boolean } | null {
  const exact = rungs.find((r) => r.size === count);
  if (exact) return { label: exact.label, modules: exact.size, exact: true };
  if (direction === "down") {
    // rungs are ascending, so the last one below the count is the nearest lower.
    let lower: ModuleRung | undefined;
    for (const r of rungs) {
      if (r.size < count) lower = r;
      else break;
    }
    return lower ? { label: lower.label, modules: lower.size, exact: false } : null;
  }
  const next = rungs.find((r) => r.size > count);
  return next ? { label: next.label, modules: next.size, exact: false } : null;
}

/**
 * The `module_fit` OUTCOME carried by a set of pipeline results -- the FIRST one that fitted.
 *
 * This is the ONE reader of the structured carrier, so no consumer ever parses the trace prose and
 * no consumer ever re-derives the fit. Scanning several results mirrors `derivedQtyValue`: a
 * category may split supply and install across separate pipelines and each runs the SAME module_fit
 * over the same selection, so the first that published an outcome answers for all of them.
 *
 * Returns undefined when no pipeline ran a module_fit, or when every module_fit BAILED (an honest
 * no-compute -- nothing was fitted, so there is nothing to display). PURE.
 */
export function moduleFitOutcome(results: Array<{ steps: StepTrace[] }>): ModuleFitOutcome | undefined {
  for (const r of results) {
    for (const st of r.steps ?? []) {
      if (st.moduleFit) return st.moduleFit;
    }
  }
  return undefined;
}

/**
 * The `derive_attribute` OUTCOMES carried by a set of pipeline results, keyed by attribute id -- the
 * FIRST result that published each one.
 *
 * The `moduleFitOutcome` twin, for the same reason: it is the ONE reader of the structured carrier, so
 * no consumer parses the trace prose and no consumer re-derives the arithmetic. Scanning several
 * results matches how a category splits supply and install across separate pipelines -- each runs the
 * SAME derive_attribute over the same selection, so the first to publish answers for all of them.
 *
 * A STATED-WINS outcome is included (with `stated: true` and a null `value`): "the row said so" is
 * exactly what a display surface needs in order to show the value and say whose it is. PURE.
 */
export function derivedAttrOutcomes(
  results: Array<{ steps: StepTrace[] }>
): Map<string, DerivedAttrOutcome> {
  const out = new Map<string, DerivedAttrOutcome>();
  for (const r of results) {
    for (const st of r.steps ?? []) {
      if (st.derivedAttr && !out.has(st.derivedAttr.attr)) out.set(st.derivedAttr.attr, st.derivedAttr);
    }
  }
  return out;
}

/**
 * SLICE 2c: the `catalog_fit` OUTCOMES carried by a set of pipeline results, keyed by the attribute
 * each ladder BINDS -- the third reader of a structured step outcome, mirroring `moduleFitOutcome`
 * and `derivedAttrOutcomes` exactly.
 *
 * WHY A READER AND NOT A NEW RESULT FIELD: `runPipeline` builds its result at 28 separate return
 * sites and its selection overlay / label binds are function-local, so publishing an "effective
 * selection" would mean touching every one of them. The outcome each step already publishes on its
 * own trace is the established channel -- so this adds a pure function and changes NO existing code
 * path. A caller that ignores it is not merely byte-identical; it is untouched.
 *
 * FIRST-WINS, like `derivedAttrOutcomes`: a category may run the same `catalog_fit` in several
 * pipelines (supply + install), and they compute the identical bind, so the first is the answer.
 *
 * ⚠️ IT RETURNS EVERY VERDICT, NOT ONLY A FITTED ONE. A stated-wins outcome (`stated` set,
 * `fitted` null) and a positively-absent one (`absent` true) are both real answers about what
 * pricing used -- a consumer that wants "was a value computed?" must test `fitted`, never mere
 * presence in this map. PURE.
 */
export function catalogFitOutcomes(
  results: Array<{ steps: StepTrace[] }>
): Map<string, CatalogFitOutcome> {
  const out = new Map<string, CatalogFitOutcome>();
  for (const r of results) {
    for (const st of r.steps ?? []) {
      if (st.catalogFit && !out.has(st.catalogFit.bind)) out.set(st.catalogFit.bind, st.catalogFit);
    }
  }
  return out;
}

/**
 * SLICE 2d -- the ONE reader over `StepTrace.mapAttribute`, keyed by `result_attr`, first-wins across
 * pipelines (supply and install carry the identical map steps). The `catalogFitOutcomes` shape, third
 * instance of the same contract: read the structured data, never the prose, never re-derive.
 *
 * It exists so option B can answer *"was the fact this item rests on STATED, or did we work it out?"*
 * -- the question that separates a plain marker from "(computed)" when the ladder itself hit exactly.
 */
export function mapAttributeOutcomes(
  results: Array<{ steps: StepTrace[] }>
): Map<string, MapAttributeOutcome> {
  const out = new Map<string, MapAttributeOutcome>();
  for (const r of results) {
    for (const st of r.steps ?? []) {
      if (st.mapAttribute) {
        // ⚠️ LAST-WINS, and it used to be FIRST-WINS. The docstring's reason for first-wins was
        // deduping the SAME step across supply and install -- identical steps write identical
        // values, so last-wins answers that case identically. What it could NOT handle is a CHAIN:
        // point_wiring writes `conduit_type` twice (the PVC default, then the drop to "None" when
        // the run is handed off), and first-wins kept the default. The panel therefore read "PVC
        // (computed)" while pricing used "None" and charged no conduit -- the owner found it on
        // screen. THE LAST WRITE IS THE EFFECTIVE VALUE; the panel must show what pricing used.
        //
        // ⚠️ MEASURED REACH: across all 12 Electrical category_configs, `conduit_type` on
        // point_wiring is the ONLY displayed attribute written more than once by a map chain, so
        // this moves exactly one value on exactly one screen. Re-measure before assuming that holds.
        out.set(st.mapAttribute.result_attr, st.mapAttribute);
      }
    }
  }
  return out;
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
  selectedInput: Record<string, string | number>
): PipelineResult {
  // THE SELECTION OVERLAY (circuit length part 1). `circuit_fit` and `resolveQty` read the SELECTION,
  // never `ctx`, and nothing used to write into the selection -- so a computed value could not reach
  // either of them. This ONE line is the crossing: a private, run-local copy that a `derive_attribute`
  // step may write into, and that every existing read site already sees because it is what `selected`
  // now names. Two properties make it safe:
  //   (1) The CALLER'S OBJECT IS NEVER MUTATED. `selected` means "what the user or extraction
  //       supplied"; writing a computed value back into it would make the two indistinguishable to
  //       every later reader -- the rule the derived-display contract already turns on.
  //   (2) With no `derive_attribute` step the copy is value-identical to the input and NOT ONE READ
  //       SITE CHANGES, so all 13 categories stay byte-identical. Every value is a primitive, so a
  //       shallow copy is a complete one.
  // The shared readers are deliberately UNTOUCHED -- see the DeriveAttributeStep note in the types.
  const selected: Record<string, string | number> = { ...selectedInput };
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

  /** Resolve a component_ref "@name" reference. THE ONE resolution order, shared by the two places
   * that read one -- the none_skips positive-absence check and the ref binding itself -- so they can
   * never disagree about what "@box_item" means. Byte-identical to the pre-PW-FIX inline form. */
  const resolveAtRef = (src: string): string | number | undefined =>
    src === "fitted_size" ? ctx["fitted_size"] : src in fitLabels ? fitLabels[src] : selected[src];

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
      // F-18 (E3) -- the matched row must actually CARRY the rate this step multiplies.
      // ⚠️ THE MULTIPLY IS OUTSIDE `evalFormula`, so the identifier guard up in the evaluator can
      // never see this one: `undefined * <number>` is NaN with nothing thrown, and that NaN reached
      // `finals` under `status: "ok"`. Guarded here, in the `component_ref` idiom (its check AND its
      // message shape), because a missing rate on a row we DID match is a data gap -- `no_match` --
      // not a config gap (`unsupported`).
      const effBase = ctx[s.target];
      if (typeof effBase !== "number" || !Number.isFinite(effBase)) {
        steps.push({
          step: stepType,
          label: s.explain || "apply effective multiplier",
          matchedCondition: `${s.target} not on the matched row -- not computed`,
          runningValues: snapshot(),
        });
        return { pipelineId, outputs: pipeline.output, status: "no_match", steps, finals: {}, matchedItem, note: pipeline.note };
      }
      const value = effBase * evalFormula(s.formula, { ...cond.params });
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
      let ctxMissing: string | null = null;
      for (const [pk, pv] of Object.entries(s.params ?? {})) {
        if (pk.endsWith(CTX_PARAM_SUFFIX)) {
          // SLICE 5 (owner-authorised, the ADDITION PRIMITIVE) -- bind ANOTHER COMPUTED value into
          // this formula's env, so two independently computed figures can finally meet in one
          // expression. Until now `scale` bound exactly one `ctx` key (as `base`), so a pipeline
          // could scale a value, round it, or take a ratio of it, but could never ADD two of them:
          // the popup box's price and the module assembly's price had no way to combine.
          //
          // ⚠️ ABSENT => byte-identical. No shipped pipeline carries a `_from_ctx` param, so every
          // existing category is unaffected -- the same gating discipline as `_from_attr`,
          // `_step_divisor`, `size_from` and `weight_from`.
          //
          // A missing or non-numeric ctx value is an HONEST NO-COMPUTE naming the key, never a zero:
          // "the other half has not been computed" is not "the other half is nothing".
          const ident = pk.slice(0, -CTX_PARAM_SUFFIX.length);
          const cv = ctx[String(pv)];
          if (typeof cv !== "number" || !Number.isFinite(cv)) {
            ctxMissing = String(pv);
            break;
          }
          env[ident] = cv;
        } else if (pk.endsWith("_from_attr")) {
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
      if (ctxMissing !== null) {
        steps.push({
          step: stepType,
          label: `'${ctxMissing}' has not been computed -- no value computed`,
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
      // RULING 2: the STEP FUNCTION, applied in a SECOND pass over the params. It must not ride inside
      // the binding loop above -- object key order is not a contract, so a divisor listed before its
      // `_from_attr` partner would silently do nothing. Every binding is present by now, so this pass
      // can never miss one. With no `_step_divisor` param it does nothing and `env` is untouched.
      const stepNotes: string[] = [];
      for (const [pk, pv] of Object.entries(s.params ?? {})) {
        if (!pk.endsWith("_from_attr")) continue;
        const ident = pk.slice(0, -"_from_attr".length);
        const divisor = (s.params ?? {})[`${ident}${STEP_DIVISOR_SUFFIX}`];
        if (typeof divisor !== "number") continue;
        const raw = env[ident];
        const factor = stepFactor(raw, divisor);
        env[ident] = factor;
        stepNotes.push(stepFactorNote(String(pv), raw, divisor, factor));
      }
      const value = evalFormula(s.formula, env);
      ctx[s.result] = value;
      steps.push({
        step: stepType,
        label: s.explain || "scale",
        params: s.params,
        ...(stepNotes.length ? { matchedCondition: stepNotes.join("; ") } : {}),
        produced: { key: s.result, value },
        runningValues: snapshot(),
      });
    } else if (stepType === "derive_attribute") {
      // CIRCUIT LENGTH part 1 -- compute an ATTRIBUTE value and put it where the readers look.
      //   value = evalFormula(config formula, {each term's attribute value} + {config constants})
      // and it lands in the SELECTION OVERLAY, not ctx -- which is the whole point of the step, since
      // `circuit_fit`'s length and a component's `{from_attr}` quantity both read the selection.
      const s = raw as import("./rateMasterTypes").DeriveAttributeStep;
      const p = s.params;
      const bail = (label: string) => {
        steps.push({ step: stepType, label, runningValues: snapshot() });
        return { pipelineId, outputs: pipeline.output, status: "no_match" as const, steps, finals: {}, matchedItem, note: pipeline.note };
      };
      if (!p || typeof p.result_attr !== "string" || !p.result_attr || typeof p.formula !== "string" || !p.formula) {
        // OPTION C: a malformed step declared no target or no arithmetic. That is not the same
        // statement as "the inputs could not be read", so it stays its own honest refusal.
        return bail("derive_attribute declares no result_attr / formula -- no value computed");
      }

      // (a) STATED WINS -- no floor, no warning (owner-locked). The pricer's own number is
      // authoritative and is adopted VERBATIM; the terms are not even read, so a row that states a
      // length still prices when the input the rule would have used is unreadable. This DELIBERATELY
      // DIVERGES from the plate's take-the-larger, where a stated value is only a floor and a
      // too-small one is upgraded loudly: there is no "too small" circuit length to detect.
      const statedRaw = selected[p.result_attr];
      if (statedRaw !== undefined && statedRaw !== null && statedRaw !== "") {
        steps.push({
          step: stepType,
          label: s.explain || `derive ${p.result_attr}`,
          matchedCondition: `${p.result_attr} stated as ${String(statedRaw)}${p.unit ? ` ${p.unit}` : ""} -- kept (a stated value wins)`,
          derivedAttr: { attr: p.result_attr, value: null, stated: true, statedValue: statedRaw, ...(p.unit ? { unit: p.unit } : {}) },
          runningValues: snapshot(),
        });
        continue;
      }

      // (b) bind the formula env from CONFIG -- term idents from attributes, constants by name.
      const env: Record<string, number> = {};
      const termParts: string[] = [];
      let termMiss: string | null = null;
      for (const t of p.terms ?? []) {
        if (!t || typeof t.ident !== "string" || !t.ident || typeof t.attr !== "string" || !t.attr) {
          return bail("derive_attribute has a malformed term (needs 'ident' + 'attr') -- no value computed");
        }
        const rawVal = selected[t.attr];
        const v = Number(rawVal);
        // HONEST NO-COMPUTE. Blank / absent / non-numeric (including the "None" sentinel) is UNKNOWN,
        // never zero and never a guess -- the same hard-fail `scale`'s `_from_attr` and `module_fit`'s
        // terms take. A row whose input genuinely cannot be read must refuse, not invent a length.
        if (rawVal === undefined || rawVal === null || rawVal === "" || !Number.isFinite(v)) {
          termMiss = t.attr;
          break;
        }
        env[t.ident] = v;
        termParts.push(`${t.attr} ${fmtNum(v)}`);
      }
      if (termMiss !== null) {
        return bail(`attribute '${termMiss}' missing or non-numeric -- no ${p.result_attr} computed`);
      }
      for (const [k, cv] of Object.entries(p.constants ?? {})) {
        if (typeof cv !== "number" || !Number.isFinite(cv)) {
          return bail(`derive_attribute constant '${k}' is not a finite number -- no value computed`);
        }
        env[k] = cv;
      }

      // (c) compute. An unbound identifier throws out to the Option-C wrapper (honest `unsupported`).
      const derived = evalFormula(p.formula, env);
      if (!Number.isFinite(derived)) {
        return bail(`${p.result_attr} computed to ${String(derived)} -- no value computed`);
      }
      // THE CROSSING. Into the overlay, so `circuit_fit` / `resolveQty` see it; NOT into ctx, where
      // neither looks. Domain limits stay with the reader that owns them -- `circuit_fit` already
      // refuses a non-positive length -- so this step invents no rule of its own.
      selected[p.result_attr] = derived;
      steps.push({
        step: stepType,
        label: s.explain || `derive ${p.result_attr}`,
        // THE WORKING: the rule with its numbers substituted in, e.g. "15 + (7 - 1) * 5 = 45 m". The
        // derivation view exists so a pricer can watch a number get built, and this one multiplies
        // into both the wire and the conduit. Substitution reuses the ONE tokenizer -- and runs only
        // AFTER evalFormula succeeded, so it can never be the thing that throws.
        matchedCondition: `${termParts.join(", ")} -> ${p.result_attr} = ${substituteFormula(p.formula, env)} = ${fmtNum(derived)}${p.unit ? ` ${p.unit}` : ""}`,
        derivedAttr: { attr: p.result_attr, value: derived, stated: false, ...(p.unit ? { unit: p.unit } : {}) },
        produced: { key: p.result_attr, value: derived },
        runningValues: snapshot(),
      });
    } else if (stepType === "map_attribute") {
      // SLICE 2b: resolve ONE string attribute -- stated wins, else a config table, else a default.
      // A CONVERSION belongs in code (the owner's standing principle), and `derive_attribute` cannot
      // serve because its formula language is arithmetic and a pole is a string.
      const s = raw as import("./rateMasterTypes").MapAttributeStep;
      const p = s.params;
      // Same shape as every other step's local refusal (bail is block-scoped by design, so each
      // step owns its own and none can leak into another).
      const bail = (label: string) => {
        steps.push({ step: stepType, label, runningValues: snapshot() });
        return { pipelineId, outputs: pipeline.output, status: "no_match" as const, steps, finals: {}, matchedItem, note: pipeline.note };
      };
      if (!p || typeof p.result_attr !== "string" || !p.result_attr) {
        // OPTION C: a malformed step declared no target. Its own honest refusal, distinct from
        // "the inputs could not be read".
        return bail("map_attribute declares no result_attr -- no value computed");
      }
      const isStated = (v: string | number | undefined) =>
        v !== undefined && v !== null && v !== "" && v !== NONE_SENTINEL;

      // (a) STATED-WINS, checked FIRST -- before the source is even read, so a stated value resolves
      // even when the attribute the table would have mapped is blank or unreadable.
      const stated = p.prefer_attr ? selected[p.prefer_attr] : undefined;
      if (isStated(stated)) {
        selected[p.result_attr] = stated as string | number;
        steps.push({
          step: stepType,
          label: s.explain || `map ${p.result_attr}`,
          matchedCondition: `${p.prefer_attr} stated as ${String(stated)} -- kept (a stated value wins)`,
          // SLICE 2d: the row supplied it, so nothing was substituted -- the option-B "plain" case.
          mapAttribute: { result_attr: p.result_attr, stated: true, value: stated as string | number },
          runningValues: snapshot(),
        });
        continue;
      }

      // (b) the table, then the default. An unmapped source is NOT an error when a default exists --
      // that is the curve-else-C shape, where "nothing stated" has a right answer.
      let mapped: string | number | undefined;
      let how = "";
      const src = p.from_attr ? selected[p.from_attr] : undefined;
      if (p.table && isStated(src) && Object.prototype.hasOwnProperty.call(p.table, String(src))) {
        mapped = p.table[String(src)];
        how = `${p.from_attr} ${String(src)} -> ${String(mapped)}`;
      } else if (p.default !== undefined) {
        mapped = p.default;
        how = `nothing stated -> ${String(mapped)} (default)`;
      }

      if (mapped === undefined) {
        if (p.on_miss === "skip") {
          steps.push({
            step: stepType,
            label: s.explain || `map ${p.result_attr}`,
            matchedCondition: `${p.result_attr} not resolved -- skipped`,
            runningValues: snapshot(),
          });
          continue;
        }
        // HONEST NO-COMPUTE, naming the attribute -- never a guess and never a silent blank.
        return bail(
          p.from_attr
            ? `${p.from_attr} ("${String(src ?? "")}") maps to no ${p.result_attr} -- no value computed`
            : `${p.result_attr} has nothing to resolve from -- no value computed`
        );
      }

      selected[p.result_attr] = mapped;
      steps.push({
        step: stepType,
        label: s.explain || `map ${p.result_attr}`,
        matchedCondition: `${how} -> ${p.result_attr} = ${String(mapped)}`,
        // SLICE 2d: this value came from the TABLE or from a DEFAULT, not from the row. Both are
        // substitutions, and option B marks the item they feed as "(computed)".
        mapAttribute: { result_attr: p.result_attr, stated: false, value: mapped },
        runningValues: snapshot(),
      });
    } else if (stepType === "catalog_fit") {
      // SLICE 2b: fit a stated NUMBER onto a catalog-derived ladder and BIND the chosen row's label.
      // The generic half of `module_fit`, reusable by slice 3's tray width and F-10's converted
      // thickness. Binds into `fitLabels`, so "@<bind>" resolves through the ONE existing order.
      const s = raw as import("./rateMasterTypes").CatalogFitStep;
      const p = s.params;
      const bail = (label: string) => {
        steps.push({ step: stepType, label, runningValues: snapshot() });
        return { pipelineId, outputs: pipeline.output, status: "no_match" as const, steps, finals: {}, matchedItem, note: pipeline.note };
      };
      if (!p || typeof p.bind !== "string" || !p.bind || typeof p.kind !== "string" || !p.kind
          || !p.fit_from || typeof p.fit_from.attr !== "string" || !p.fit_from.attr) {
        // OPTION C: "declared nothing to fit" is not the same statement as "the inputs were
        // unreadable", so a malformed step keeps its own refusal.
        return bail("catalog_fit declares no bind / kind / fit_from -- no value computed");
      }
      const isStated = (v: string | number | undefined) =>
        v !== undefined && v !== null && v !== "";

      // SLICE 2d -- the attribute ids behind this step's `where` "@" references, collected ONCE and in
      // config order. Computed here, before any early return, so the stated and absent paths publish
      // the same join key as the fitted path: a consumer must never have to care WHICH branch ran to
      // know which facts this fit rests on. List members are included -- `["@mcb_curve", "NA"]` rests
      // on the curve just as much as a bare ref does.
      const whereRefs: string[] = [];
      for (const v of Object.values(p.where ?? {})) {
        for (const m of Array.isArray(v) ? v : [v]) {
          if (typeof m === "string" && m.startsWith("@")) whereRefs.push(m.slice(1));
        }
      }

      const pushFit = (
        matchedCondition: string,
        outcome: import("./rateMasterTypes").CatalogFitOutcome
      ) => {
        steps.push({
          step: stepType,
          label: s.explain || `catalog fit: ${p.bind}`,
          matchedCondition,
          catalogFit: outcome,
          runningValues: snapshot(),
        });
      };

      // (a) STATED-WINS. Bind NOTHING, so `resolveAtRef` falls through to the selection and the
      // stated item is what prices. THIS IS WHAT KEEPS THE PRICER'S OVERRIDE SURFACE ALIVE -- the
      // mechanism that corrected rows 98 and 87 by hand. Checked before anything is read.
      const statedItem = p.prefer_attr ? selected[p.prefer_attr] : undefined;
      if (isStated(statedItem)) {
        pushFit(`${p.prefer_attr} stated as ${String(statedItem)} -- kept (a stated value wins)`, {
          bind: p.bind, fitted: null, size: null, requested: null, exact: false,
          absent: statedItem === NONE_SENTINEL, stated: String(statedItem),
          // OPTION B: the row's own value is what prices -- this step fitted nothing, so it
          // substituted nothing. The panel renders it PLAIN.
          substituted: false, whereRefs,
        });
        continue;
      }

      // (b) POSITIVE ABSENCE. Bind the sentinel so a `none_skips` component zeroes its line; an
      // UNBOUND "@" ref would be a bindMiss and refuse the whole row (the module_fit lesson).
      if (p.absent_when && selected[p.absent_when.attr] === p.absent_when.equals) {
        fitLabels[p.bind] = NONE_SENTINEL;
        pushFit(`${p.absent_when.attr} is ${String(p.absent_when.equals)} -> no ${p.bind}`, {
          bind: p.bind, fitted: null, size: null, requested: null, exact: false, absent: true,
          // A CONCLUDED ABSENCE is a computed verdict, not a missing one -- "None (computed)".
          substituted: false, whereRefs,
        });
        continue;
      }

      // (c) resolve every `where` value: literals pass through, "@refs" resolve, LISTS resolve
      // member-wise. An unresolved ref is an HONEST no-compute NAMING THE KEY -- never a silent skip,
      // which would quietly widen the ladder to the whole family.
      const resolvedWhere: Record<string, string | number | Array<string | number>> = {};
      let whereMiss: string | null = null;
      const resolveOne = (v: string | number): string | number | undefined =>
        typeof v === "string" && v.startsWith("@") ? resolveAtRef(v.slice(1)) : v;
      for (const [k, v] of Object.entries(p.where ?? {})) {
        if (Array.isArray(v)) {
          const members: Array<string | number> = [];
          for (const m of v) {
            const r = resolveOne(m);
            // A list member that does not resolve is DROPPED, not fatal: `["@mcb_curve", "NA"]` must
            // still offer "NA" when no curve was resolved. An empty list IS fatal (below).
            if (r !== undefined && r !== null && r !== "") members.push(r);
          }
          if (!members.length) { whereMiss = k; break; }
          resolvedWhere[k] = members;
        } else {
          const r = resolveOne(v);
          if (r === undefined || r === null || r === "") { whereMiss = k; break; }
          resolvedWhere[k] = r;
        }
      }
      if (whereMiss !== null) {
        return bail(`'${whereMiss}' not provided -- no ${p.bind} computed`);
      }

      // (d) the value being fitted.
      const rawFit = selected[p.fit_from.attr];
      const want = typeof rawFit === "number" ? rawFit : Number(rawFit);
      if (!isStated(rawFit) || !Number.isFinite(want)) {
        // SLICE 2b (owner ruling A-ii): a category may OPT IN to treating an unreadable fact as
        // POSITIVE ABSENCE rather than a refusal. Refusing discards the rest of the row -- the socket
        // priced perfectly well and only its pairing is unknown -- which is the over-wide action the
        // PW-FIX ruling reversed for module_fit. With `on_missing_fact: "none"` the bind takes the
        // sentinel, `none_skips` zeroes the MCB line, and the row prices honestly short.
        //
        // ⚠️ DEFAULT IS UNCHANGED: absent the key this still refuses, so every other config is
        // byte-identical. The opt-in is per-step CONFIG, never a global softening.
        //
        // The two cases are handled together on purpose. A `number` attribute cannot reach here
        // "present but unreadable" from extraction -- `_coerce_value` already nulls a non-numeric --
        // so the only way in is a hand-typed override, and inventing a third behaviour for it would
        // add a branch no row exercises.
        if (p.on_missing_fact === "none") {
          fitLabels[p.bind] = NONE_SENTINEL;
          pushFit(`${p.fit_from.attr} not stated -> no ${p.bind}`, {
            bind: p.bind, fitted: null, size: null, requested: null, exact: false, absent: true,
            substituted: false, whereRefs,
          });
          continue;
        }
        return bail(`attribute '${p.fit_from.attr}' missing or non-numeric -- no ${p.bind} computed`);
      }

      // (e) build + fit.
      const rungs = buildModuleLadder(items, {
        kind: p.kind, where: resolvedWhere, label_attr: p.label_attr, size_from: p.size_from,
      });
      if (!rungs.length) {
        return bail(`no '${p.kind}' rows match -- no ${p.bind} computed`);
      }
      const fit = fitModuleLadder(rungs, want, p.direction);
      if (!fit) {
        // A MISS IS NOT AUTOMATICALLY FATAL. `on_miss: "none"` binds the sentinel so the rest of the
        // row still prices -- a missing MCB leaves the socket un-paired, it does not make the socket
        // wrong. `module_fit`'s refusal is the other choice, kept available for a plate-like ladder.
        if (p.on_miss === "no_compute") {
          const top = rungs[rungs.length - 1];
          return bail(
            `${fmtNum(want)} exceeds the largest '${p.bind}' the catalog carries (${top.label}) -- no value computed`
          );
        }
        fitLabels[p.bind] = NONE_SENTINEL;
        pushFit(`${fmtNum(want)} -> nothing in the catalog fits -> no ${p.bind}`, {
          bind: p.bind, fitted: null, size: null, requested: want, exact: false, absent: true,
          substituted: false, whereRefs,
        });
        continue;
      }

      fitLabels[p.bind] = fit.label;
      // SLICE 3a -- THE NUMERIC HALF. `fitLabels` is string-typed by contract (a rung's LABEL), and
      // `match_master_row` compares `selected` values with `===` against the stored attribute. A
      // category whose ladder attribute IS its match key (cable tray's `width_mm`, stored as a
      // NUMBER) therefore needs the fitted SIZE, not the label, and it needs it in `selected` --
      // the only state `matchMasterRow` reads. Writing it here, on the FITTED path alone, is what
      // makes next-higher reach the matcher at all.
      //
      // `selected` is the run-local overlay (`{ ...selectedInput }`), so the caller's object is
      // never mutated and `value` keeps meaning "what the user or extraction supplied" -- the same
      // contract `derive_attribute` writes under.
      if (p.fit_into) selected[p.fit_into] = fit.modules;
      // THE WORKING: the request, the hop (or its absence), and the row chosen -- one line. The
      // " (next higher)" wording is the SAME string module_fit emits, so the two read alike.
      const whereParts = Object.entries(resolvedWhere)
        .map(([k, v]) => `${k} ${Array.isArray(v) ? v.join("/") : String(v)}`)
        .join(", ");
      pushFit(
        `${p.fit_from.attr} ${fmtNum(want)} at ${whereParts} -> ` +
          (fit.exact
            ? `${fit.label}`
            : `${fmtNum(want)} not carried -> ${fmtNum(fit.modules)} (next ${p.direction === "down" ? "lower" : "higher"}) -> ${fit.label}`),
        { bind: p.bind, fitted: fit.label, size: fit.modules, requested: want, exact: fit.exact, absent: false,
          // OPTION B: a HOP is a substitution -- the catalog did not carry what was asked for, so a
          // different rung is being priced and the panel must say so.
          substituted: !fit.exact, whereRefs }
      );
    } else if (stepType === "roundup") {
      const s = raw as import("./rateMasterTypes").RoundupStep;
      // F-18 (E4) -- THE CHAIN, and the one site that must NOT refuse.
      // `roundUp(undefined, d)` is `Math.ceil(undefined * f - 1e-9) / f` = NaN, written straight back
      // into `ctx`. The absence it reads is almost never this step's fault: an upstream `scale` that
      // HONESTLY declined to write its result (the EA-1b honest partial) leaves exactly this hole,
      // and the next unguarded step turned that honesty into a NaN. That is why the same missing key
      // used to give an honest partial in `conduit_bcs` and a NaN in `conduit_boq` -- the two differ
      // only in having a `roundup` downstream.
      // ⚠️ HONEST PARTIAL, NOT A REFUSAL (owner ruling): refusing the pipeline would discard sibling
      // outputs that computed correctly -- `conduit_boq`'s `supply_per_mtr` is right even when
      // `install_per_mtr` was never produced. That is the over-wide action the PW-FIX ruling reversed
      // for `module_fit`. So this takes `scale`'s own `continue` shape: skip, leave the output
      // ABSENT (renders "-"), and SAY SO in the trace -- never a zero, never a NaN.
      const roundBase = ctx[s.target];
      if (typeof roundBase !== "number" || !Number.isFinite(roundBase)) {
        steps.push({
          step: stepType,
          label: `${s.target} not available to round -- ${s.target} not computed`,
          runningValues: snapshot(),
        });
        continue;
      }
      const value = roundUp(roundBase, s.params.digits);
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
        // F-18 (E1) -- THE ORIGINAL FINDING. The matched row must CARRY the rate this component
        // prices. Without this, `ctx[s.target]` is `undefined`, both bindings below are `undefined`,
        // the evaluator's `in` guard passes (the KEY exists), the formula returns NaN, and
        // `sum_components` carries that NaN into `finals` under `status: "ok"`.
        // Guarded in the `component_ref` idiom -- the same check and the same message shape it has
        // used at two sites all along; the only thing new here is applying it to the MATCHED row.
        // ⚠️ REFUSAL, not a partial (unlike E4): this value feeds `sum_components`, so a missing
        // component does not merely lose one line -- it makes the SUM wrong, which is precisely why
        // `component_ref` refuses the whole pipeline in the same situation.
        const compBase = ctx[s.target];
        if (typeof compBase !== "number" || !Number.isFinite(compBase)) {
          steps.push({
            step: stepType,
            label: s.explain || `component: ${s.name}`,
            matchedCondition: `${s.target} not on the matched row -- not computed`,
            runningValues: { ...snapshot(), ...componentEntries(components) },
          });
          return { pipelineId, outputs: pipeline.output, status: "no_match", steps, finals: {}, matchedItem, note: pipeline.note };
        }
        // Bind the target value under BOTH `base` (the normalized contract) and its own name (the
        // legacy wiring `lug` component's formula references `lug_list`).
        env.base = compBase;
        env[s.target] = compBase;
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
      // PW-CONDUIT-OPTIONAL. POSITIVE ABSENCE, checked BEFORE the unknown-type refusal below and
      // AFTER the wire read above -- so a row whose WIRES cannot be read still refuses honestly and
      // is never mistaken for a no-conduit row.
      //
      // MIRRORS `catalog_fit`'s `absent_when` EXACTLY: bind the "None" sentinel so a `none_skips`
      // component zeroes its line, and let everything else price. Binding is what makes it safe --
      // an UNBOUND "@fitted_size" would be a bindMiss and would refuse the whole row (the module_fit
      // lesson), which is the very failure this branch exists to prevent.
      //
      // ⚠️ THE REST OF THE ROW MUST STILL PRICE. The wires take their quantity from
      // `circuit_length_m` directly and the switch/socket/plate/box never read the fit at all, so
      // zeroing the conduit cannot touch them. Cert row C is exactly this claim on real data.
      //
      // ⚠️ AN UNKNOWN TYPE IS NOT THIS. It falls through to the refusal below, unchanged.
      if (p.absent_when && selected[p.absent_when.attr] === p.absent_when.equals) {
        const absentBinds = s.binds ?? ["fitted_size", "circuits", "conduit_qty"];
        absentBinds.forEach((b) => { ctx[b] = NONE_SENTINEL; });
        steps.push({
          step: stepType,
          label: s.explain || "circuit fit",
          // A CONCLUDED ABSENCE is a computed verdict, not a missing one -- "None (computed)".
          matchedCondition: `${p.absent_when.attr} is ${String(p.absent_when.equals)} -> no conduit (positive absence)`,
          runningValues: snapshot(),
        });
        continue;
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
        // SLICE 5 (R9s-c, the ONE authorised interpreter change) -- PER-SKU MODULE WIDTH.
        //
        // A term's weight used to be a CONSTANT PER SLOT: "a socket occupies 2 modules" held for
        // every socket in the catalogue. It is not true of the catalogue we actually have -- a
        // telephone outlet and a USB charger occupy one, a 2M switch occupies two -- so the width
        // belongs to the SKU, not to the slot it was dropped into.
        //
        // ⚠️ OPT-IN, AND ABSENT MEANS BYTE-IDENTICAL. Without `weight_from` this is `t.weight`
        // exactly as before, which is what keeps `point_wiring` -- the only other `module_fit`
        // caller -- untouched BY CONSTRUCTION rather than by measurement. Same discipline as
        // `size_from`, `decay`, `matching_surface` and `routing_policy`.
        let weight = t.weight;
        if (t.weight_from) {
          const wf = t.weight_from;
          const label = selected[wf.from_attr];
          // A slot whose item is BLANK keeps the declared weight. The positively-absent ("None")
          // case never reaches here -- the short-circuit above already contributed 0 -- so this is
          // only the "row too vague to name an item" path, which fails downstream at the
          // component_ref bindMiss exactly as it does today. Bailing here instead would move that
          // refusal to a different step for no gain.
          if (label !== undefined && label !== null && label !== "") {
            const matchAttr = wf.match_attr || "item";
            // ⚠️ DISTINCT VALUES, NEVER A UNIQUE ROW. One SKU label spans a row per colour, so
            // "find the one matching row" would refuse every single time. Colour is deliberately
            // NOT part of the match: width does not vary by colour, and one catalogue label
            // (`USB Charger - C+C Type`) exists in White only -- matching on colour would make its
            // width unresolvable on a Grey assembly.
            const widths = new Set<number>();
            for (const it of items) {
              if (it.kind !== wf.kind) continue;
              if (it.attributes?.[matchAttr] !== label) continue;
              let ok = true;
              for (const [k, wv] of Object.entries(wf.where ?? {})) {
                if (it.attributes?.[k] !== wv) { ok = false; break; }
              }
              if (!ok) continue;
              const n = Number(it.attributes?.[wf.value_attr]);
              if (Number.isFinite(n)) widths.add(n);
            }
            if (widths.size === 0) {
              // A SEEDING GAP FAILS LOUDLY. This is the runtime half of the completeness rule: an
              // unseeded SKU must never quietly fall back to the slot weight, because that is
              // exactly the wrong answer this whole mechanism exists to stop.
              return bail(
                `'${String(label)}' carries no ${wf.value_attr} in the catalog -- no module count computed`
              );
            }
            if (widths.size > 1) {
              return bail(
                `'${String(label)}' carries conflicting ${wf.value_attr} values (${[...widths].sort((a, b) => a - b).join(", ")}) -- no module count computed`
              );
            }
            weight = [...widths][0];
          }
        }
        occupied += weight * v;
        termParts.push(`${fmtNum(weight)} x ${t.attr}(${fmtNum(v)})`);
      }
      if (termMiss !== null) {
        return bail(`attribute '${termMiss}' missing or non-numeric -- no module count computed`);
      }
      if (!(p?.terms?.length)) {
        // OPTION C: a MALFORMED step (no params / no terms at all) declared nothing to count, which is
        // NOT the same statement as a row that counted to zero. Without this the two collapse together
        // and a broken config silently reports a priced row -- so the malformed case stays a refusal.
        return bail("module_fit declares no terms -- no module count computed");
      }
      if (!Number.isFinite(occupied) || occupied < 0) {
        // A non-finite or NEGATIVE count is a CONTRADICTION in the source data -- there is no such
        // product -- so it stays an honest no-compute.
        return bail(`module count ${fmtNum(occupied)} is not a valid count -- no value computed`);
      }
      // PW-FIX -- ZERO IS A REAL PRODUCT, NOT A DATA ERROR.
      // A light point wired straight to an MCB carries no switch, no socket and no plate, so the
      // weighted sum is 0. The old guard was RIGHT that the next-higher rule must not manufacture a
      // plate for a row carrying nothing -- but its ACTION was far too wide: it returned no_match for
      // the WHOLE pipeline, discarding a circuit_fit that had already succeeded. Wire and conduit have
      // nothing to do with module counts.
      // So a zero count yields NO plate, NO box and NO blanks, while every other component prices
      // normally. It is expressed with the mechanism a "None" plate ALREADY uses (`absentLadders`),
      // one level up: EVERY ladder is positively absent rather than merely the one whose floor is None.
      const noModules = occupied === 0;

      // (b) resolve each ladder ------------------------------------------------------------------
      // SLICE 2 part 2: a ladder may take a stated attribute as a FLOOR -- TAKE-THE-LARGER. The
      // count fitted is max(stated, computed): a stated plate too small for its contents is
      // UPGRADED (never refused), and a stated plate bigger than needed is what gets bought. The
      // resolved count is RE-FIT on THIS ladder; it is never copied across as a label.
      const fittedByBind: Record<string, number> = {};
      const absentLadders = new Set<string>();
      const ladderParts: string[] = [];
      // DERIVED DISPLAY: the same decisions the prose line below narrates, published as STRUCTURED
      // data on the trace. Written ALONGSIDE `ladderParts` -- one push per ladder, at the identical
      // points -- so the two can never disagree about what was fitted. It reads nothing and decides
      // nothing; every branch below is byte-unchanged.
      const ladderOutcomes: import("./rateMasterTypes").ModuleFitLadderOutcome[] = [];
      for (const L of p?.ladders ?? []) {
        if (noModules) {
          // RULING 1 (owner 2026-08-09) -- THE ZERO-MODULE FALLBACK, **STATE A ONLY**.
          // A light point on an MCB carries no switch and no socket, so nothing fits any ladder and the
          // back box was suppressed along with the plate. But a light point still needs a junction box.
          // A ladder may declare the module COUNT it falls back to here; the CATALOG still names the
          // rung, so this resolves through the ordinary fit (exact, else next higher) and retiring a
          // size needs no config edit.
          //
          // ⚠️ THIS IS THE ONLY PLACE THE KEY IS READ, WHICH IS WHAT CONFINES IT TO STATE A. A row whose
          // plate is "None" but whose module count is NON-ZERO never reaches this branch -- it is
          // already served correctly by `on_none: "computed"` below, and letting the fallback fire there
          // would DOWNGRADE a correctly-sized box (7 modules -> 8M) to the fallback size.
          //
          // ⚠️ It does NOT gate on `back_box`. The component's own `qty: {if_attr: {back_box: "Yes"}}`
          // is where that question is already answered; asking it twice would be two definitions of one
          // rule. With back_box "No" the label binds, the qty is 0, and the line is 0 exactly as before.
          const zeroFit =
            typeof L.on_zero_modules === "number" && Number.isFinite(L.on_zero_modules) && L.on_zero_modules > 0
              ? L.on_zero_modules
              : null;
          if (zeroFit !== null) {
            const rungs = buildModuleLadder(items, L);
            if (!rungs.length) {
              return bail(`ladder '${L.bind}' (${L.kind}) has no catalog rows -- no value computed`);
            }
            const fit = fitModuleLadder(rungs, zeroFit);
            if (!fit) {
              const top = rungs[rungs.length - 1];
              return bail(
                `${fmtNum(zeroFit)} modules exceeds the largest '${L.bind}' the catalog carries (${top.label}) -- no value computed`
              );
            }
            fitLabels[L.bind] = fit.label;
            fittedByBind[L.bind] = fit.modules;
            if (L.bind_modules) ctx[L.bind_modules] = fit.modules;
            ladderParts.push(
              `${L.bind} ${fit.label} (nothing to fit -- default ${fmtNum(zeroFit)})${fit.exact ? "" : " (next higher)"}`
            );
            ladderOutcomes.push({ bind: L.bind, floorFrom: L.floor_from, label: fit.label, modules: fit.modules, absent: false });
            continue;
          }
          // Nothing to fit on ANY ladder. Bind the None sentinel so a `none_skips` component reading
          // this ladder ("@box_item") resolves to positive absence and zeroes its line -- WITHOUT it
          // the "@" reference is simply unbound, which aborts the whole pipeline on a missing bind
          // and would reinstate the very refusal this fix removes. `bind_modules` binds a truthful 0.
          absentLadders.add(L.bind);
          fitLabels[L.bind] = NONE_SENTINEL;
          if (L.bind_modules) ctx[L.bind_modules] = 0;
          ladderParts.push(`no ${L.bind} (nothing to fit)`);
          ladderOutcomes.push({ bind: L.bind, floorFrom: L.floor_from, label: null, modules: null, absent: true });
          continue;
        }
        let fitCount = occupied;
        let floorNote = "";
        let upgraded: { stated: string; statedHolds: number; occupied: number } | undefined;
        if (L.floor_from) {
          const statedRaw = selected[L.floor_from];
          if (statedRaw === NONE_SENTINEL) {
            if ((L.on_none ?? "none") !== "computed") {
              // POSITIVELY ABSENT: bind nothing. The component's own none_skips zeroes its line,
              // and a `blanks` block keyed here is absent too -- positive absence propagates.
              absentLadders.add(L.bind);
              ladderParts.push(`${L.bind} None`);
              ladderOutcomes.push({ bind: L.bind, floorFrom: L.floor_from, label: null, modules: null, absent: true });
              continue;
            }
            // on_none "computed": a back box can exist with no face plate -> the computed count.
          } else if (statedRaw !== undefined && statedRaw !== null && statedRaw !== "") {
            const statedSizes = moduleSizesFromLabel(String(statedRaw));
            if (!statedSizes.length) {
              return bail(`stated '${L.floor_from}' ("${String(statedRaw)}") carries no module size -- no value computed`);
            }
            // A stated rung's CAPACITY is the largest size it offers ("1M & 2M" holds 2).
            const statedCap = statedSizes[statedSizes.length - 1];
            if (statedCap < occupied) {
              // THE UPGRADE. It must never be silent: the BoQ said one size and we price another.
              fitCount = occupied;
              floorNote = ` (stated ${String(statedRaw)} holds ${fmtNum(statedCap)}, contents occupy ${fmtNum(occupied)} -- UPGRADED)`;
              upgraded = { stated: String(statedRaw), statedHolds: statedCap, occupied };
            } else {
              // The stated plate is a FLOOR, never a ceiling: a bigger plate than needed is bought.
              fitCount = statedSizes.find((n) => n >= occupied) ?? statedCap;
              floorNote = ` (stated ${String(statedRaw)})`;
            }
          }
        }
        const rungs = buildModuleLadder(items, L);
        if (!rungs.length) {
          return bail(`ladder '${L.bind}' (${L.kind}) has no catalog rows -- no value computed`);
        }
        const fit = fitModuleLadder(rungs, fitCount);
        if (!fit) {
          const top = rungs[rungs.length - 1];
          return bail(
            `${fmtNum(fitCount)} modules exceeds the largest '${L.bind}' the catalog carries (${top.label}) -- no value computed`
          );
        }
        fitLabels[L.bind] = fit.label;
        fittedByBind[L.bind] = fit.modules;
        if (L.bind_modules) ctx[L.bind_modules] = fit.modules;
        ladderParts.push(`${L.bind} ${fit.label}${floorNote}${fit.exact ? "" : " (next higher)"}`);
        ladderOutcomes.push({
          bind: L.bind,
          floorFrom: L.floor_from,
          label: fit.label,
          modules: fit.modules,
          absent: false,
          ...(upgraded ? { upgraded } : {}),
        });
      }

      // (c) the blank (filler) count --------------------------------------------------------------
      // THE ITEM BIND. A `blanks` block may publish the blanker's ITEM alongside its count, through
      // the SAME fitLabels scope a ladder publishes its fitted rung into -- so the blank component's
      // ref stays an ordinary "@"-reference and NOTHING SHARED CHANGES: `resolveAtRef` already reads
      // fitLabels, and the `none_skips` short-circuit already treats an "@"-ref resolving to the
      // sentinel as positive absence (the PW-FIX contract, line ~1086).
      //
      // ⚠️ IT MUST BIND ON EVERY PATH THAT REACHES A COMPONENT, INCLUDING THE TWO ABSENT ONES. An
      // unbound "@" reference is `bindMiss`, which refuses the WHOLE PIPELINE -- so a plate-less row
      // would stop pricing its wire and conduit too. Binding the sentinel is what lets `none_skips`
      // zero the line instead. This is the same reasoning that makes the zero-module branch below
      // bind a 0 count rather than binding nothing.
      let blanksOutcome: import("./rateMasterTypes").ModuleFitBlanksOutcome | undefined;
      const bindBlankItem = (label: string) => {
        if (p?.blanks?.bind_item) fitLabels[p.blanks.bind_item] = label;
      };
      let blankPart = "";
      if (noModules && p?.blanks) {
        // PW-FIX: with nothing on the plate there is no plate, and a filler fills a plate -- so there
        // are ZERO blanks. It binds 0 rather than binding nothing, because the blank line reads its
        // quantity via {from_fit} and an UNBOUND key is "quantity not provided", which aborts the row.
        // Zero is the honest number here, and it is a number we actually know.
        ctx[p.blanks.bind] = 0;
        // Nothing on the plate means no plate, so there is no blanker either -- positive absence.
        bindBlankItem(NONE_SENTINEL);
        blankPart = "; no plate -> 0 blanks";
      } else if (p?.blanks && absentLadders.has(p.blanks.from_ladder)) {
        // SLICE 2 part 2: the ladder the blanks are counted against is POSITIVELY ABSENT (a None
        // plate). Blanks fill a plate, so with no plate there are none -- that is an absence, not a
        // failure, and it must NOT refuse the row (a lone socket with no plate still prices).
        // The COUNT still binds nothing -- an uncomputed blank count must render EMPTY on the form,
        // never 0, because "no plate to fill" is a different statement from "zero needed"
        // (owner-locked). The ITEM binds the sentinel, which is what zeroes the line now that the ref
        // no longer reads the row's own `blank_item`; without it the "@" reference would be unbound
        // and this row -- the `s1` shape -- would stop pricing entirely.
        bindBlankItem(NONE_SENTINEL);
        blankPart = `; no ${p.blanks.from_ladder} -> no blanks`;
      } else if (p?.blanks) {
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
        // Blanks derive from the plate ACTUALLY SELECTED, which under take-the-larger always holds
        // the contents -- so on the primary path this can never go negative (pinned by an
        // exhaustive sweep). The check REMAINS as a backstop for any path that reaches it with a
        // smaller base (e.g. a `blanks.stated_attr` config, which does not floor its ladder), and
        // its action is the owner's CLAMP TO ZERO, never a refusal: a BoQ typo must not kill a row.
        // The clamp is NOT silent -- the trace says the plate was over-full.
        const rawBlanks = base - occupied;
        const spare = rawBlanks < 0 ? 0 : rawBlanks;
        // THE ARBITRATION -- the EFFECTIVE count, which is what prices and what decides the item.
        //
        // ⚠️ THE TWO DIRECTIONS ARE DELIBERATELY DIFFERENT AND MUST NOT BE FLATTENED. Above the spare
        // is PHYSICALLY IMPOSSIBLE -- a blanker cannot go where a socket sits -- so it is CORRECTED
        // down. Below the spare is merely untidy, so the row's own number is HONOURED and the
        // consequence is reported instead. A clamp in both directions would silently overwrite a
        // pricer's deliberate choice; a pass-through in both would price a plate that cannot exist.
        //
        // ⚠️ THE CEILING IS THE SPARE, NEVER THE PLATE'S TOTAL. An 8M plate holding 7 modules has ONE
        // spare, so a stated 2 prices 1 -- not 8, and not 2.
        let effective = spare;
        let statedCount: number | undefined;
        let capped = false;
        if (b.qty_attr) {
          const rawQty = selected[b.qty_attr];
          const n = Number(rawQty);
          // A blank / absent / non-numeric / NEGATIVE / "None" entry is NOT a statement of a count,
          // so it defers to the computed spare (which is also what SEEDS the field on screen).
          if (
            rawQty !== undefined && rawQty !== null && rawQty !== "" &&
            rawQty !== NONE_SENTINEL && Number.isFinite(n) && n >= 0
          ) {
            statedCount = n;
            if (n > spare) { effective = spare; capped = true; } else { effective = n; }
          }
        }
        const uncovered = spare - effective;
        ctx[b.bind] = effective;
        // POSITIVE => the blanker; ZERO => positive absence, so the line reads as deliberately absent
        // rather than as a blanker bought zero times. This follows the EFFECTIVE count, which is what
        // makes editing the quantity to zero revert the item to None.
        if (b.bind_item) {
          if (effective > 0 && !b.item_when_positive) {
            // A MALFORMED step: it promises to bind an item and names none. Matching the "declares no
            // terms" precedent above, that is a refusal rather than a silent zero -- silently binding
            // the sentinel would price 0 blankers on a row that needs them and look deliberate.
            return bail("module_fit blanks declares bind_item with no item_when_positive -- no value computed");
          }
          bindBlankItem(effective > 0 ? b.item_when_positive! : NONE_SENTINEL);
        }
        blanksOutcome = {
          spare, effective, capped, uncovered,
          ...(statedCount === undefined ? {} : { stated: statedCount }),
          // SLICE 5 (B1's display half, owner-authorised 2026-08-21). The ITEM the count belongs
          // to, published beside it so the panel can SHOW the bind instead of rendering an empty
          // field next to a filled quantity. The blanker is inferred from the effective count and
          // NEVER selected by extraction (owner-locked), so this is the pricer's only way to learn
          // which item they are being charged for -- exactly why a ladder publishes its fitted rung.
          // Absent when the step binds no item, so a config without `bind_item` is unaffected.
          ...(b.bind_item ? { item: effective > 0 ? b.item_when_positive! : NONE_SENTINEL } : {}),
        };
        // The base sentence is UNCHANGED when nothing was stated (effective === spare), so every
        // pre-existing trace pin still reads byte-identically; the arbitration appends its own clause.
        blankPart =
          rawBlanks < 0
            ? `; 0 blanks (${baseWhat} holds ${fmtNum(base)}, contents occupy ${fmtNum(occupied)} -- over-full, clamped)`
            : `; ${fmtNum(spare)} blank${spare === 1 ? "" : "s"} (${baseWhat} ${fmtNum(base)} - ${fmtNum(occupied)})`;
        if (capped) {
          blankPart += ` (stated ${fmtNum(statedCount!)} exceeds the spare -- pricing ${fmtNum(effective)})`;
        } else if (statedCount !== undefined && uncovered > 0) {
          blankPart += ` (stated ${fmtNum(statedCount)} -- pricing ${fmtNum(effective)}, ${fmtNum(uncovered)} left uncovered)`;
        }
      }

      steps.push({
        step: stepType,
        label: s.explain || "module fit",
        // (d) THE WORKING: the arithmetic AND the ladder hop, in one line.
        matchedCondition: `${termParts.join(" + ")} = ${fmtNum(occupied)} modules -> ${ladderParts.join(", ")}${blankPart}`,
        // (e) THE SAME WORKING AS DATA -- so a surface that must RENDER the fitted plate reads it
        // here instead of parsing (d). (d) stays the human sentence; this stays the contract.
        moduleFit: { occupied, ladders: ladderOutcomes, ...(blanksOutcome ? { blanks: blanksOutcome } : {}) },
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
              // PW-FIX: resolved through the SHARED resolver, so a module_fit ladder bound to the None
              // sentinel (a zero module count) zeroes this line exactly as a "None" ATTRIBUTE does.
              // `fitLabels` only ever held real catalog labels before, so this is byte-identical for
              // every pre-PW-FIX pipeline.
              resolveAtRef(rawVal.slice(1)) === NONE_SENTINEL,
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
            const bound = resolveAtRef(src);
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
        // RULING 2: `stageNotes` is filled ONLY by a stage carrying a step divisor, so a config without
        // one produces the identical `rate N x qty M` string it always did.
        const stageNotes: string[] = [];
        const rate = stageRate(base, s.rate_stages, selected, stageNotes);
        const value = rate * qty;
        components[s.name] = value;
        steps.push({
          step: stepType,
          label: s.explain || `component: ${s.name}`,
          refItem: refLabel,
          matchedCondition:
            `rate ${fmtNum(rate)} x qty ${fmtNum(qty)}` +
            (stageNotes.length ? ` (${stageNotes.join("; ")})` : ""),
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
      // F-18 (E2) -- the band CHOSE a column; the matched row must carry it. Guarded BEFORE the bind
      // below, which would otherwise plant the same `undefined` under THREE identifiers at once and
      // let the evaluator's `in` guard wave all three through into a NaN.
      // Same `component_ref` check and message shape as E1, and a refusal for the same reason: this
      // value feeds `sum_components`, so losing it makes the sum wrong rather than merely shorter.
      const bandBase = ctx[chosen.target];
      if (typeof bandBase !== "number" || !Number.isFinite(bandBase)) {
        steps.push({
          step: stepType,
          label: s.explain || `component: ${s.name} (banded)`,
          bandChosen: `${s.band_on} ${chosen.label} -> ${chosen.target}`,
          matchedCondition: `${chosen.target} not on the matched row -- not computed`,
          runningValues: { ...snapshot(), ...componentEntries(components) },
        });
        return { pipelineId, outputs: pipeline.output, status: "no_match", steps, finals: {}, matchedItem, note: pipeline.note };
      }
      // Bind the chosen column under `base` (the normalized contract), plus the legacy `gland_list`
      // and the column's own name (the wiring gland formula references gland_list).
      const value = evalFormula(s.formula, { base: bandBase, gland_list: bandBase, [chosen.target]: bandBase, ...s.params });
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
      // F-18 (E5) -- THE ONE SITE THAT DID NOT FAIL INTO NaN, IT ASSIGNED ONE.
      // `const base = supplyKey ? ctx[supplyKey] : NaN` was a deliberate literal: with no `supply_*`
      // key in `ctx` this step multiplied NaN by the ratio and handed the result on under
      // `status: "ok"`. There is nothing to take a ratio OF, so it refuses -- and it NAMES the
      // missing key, because "install is a share of supply" is unreadable without saying which
      // supply was looked for.
      const supplyKey = Object.keys(ctx).find((k) => k.startsWith("supply_"));
      const base = supplyKey === undefined ? undefined : ctx[supplyKey];
      if (typeof base !== "number" || !Number.isFinite(base)) {
        steps.push({
          step: stepType,
          label: s.explain || `install as ${s.params.ratio * 100}% of supply`,
          matchedCondition:
            supplyKey === undefined
              ? "no supply_* value computed -- install not computed"
              : `${supplyKey} not computed -- install not computed`,
          runningValues: snapshot(),
        });
        return { pipelineId, outputs: pipeline.output, status: "no_match", steps, finals: {}, matchedItem, note: pipeline.note };
      }
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

  // F-18 (R3) -- THE BACKSTOP. `status: "ok"` used to mean only "the step loop ran to the end without
  // an early return and without throwing"; it made NO claim about the numbers, while every consumer
  // reads it as "these numbers are good". A non-finite number is now never labelled ok, whatever
  // route produced it -- including one no per-step guard above covers, such as a malformed config
  // value reaching `stageRate` (the loader does not validate; only `update_rate_config` does).
  //
  // ⚠️ THE PREDICATE IS `typeof v === "number" && !Number.isFinite(v)` -- A NUMBER THAT IS NOT
  // FINITE, NEVER A MISSING VALUE. An `undefined` final passes through UNTOUCHED, because
  // `status: "ok"` with an absent output is the SHIPPED EA-1b honest-partial contract, live today on
  // the `miscellaneous` CEIG / AS Built rows (4 combinations across misc_boq + misc_bcs, measured).
  // A backstop written as "no non-value may pass with ok" would break those four while fixing
  // nothing that was ever broken. The two cases look alike and mean opposite things: absent is "this
  // row has no such rate", NaN is "we computed nonsense".
  const finals: Record<string, number> = {};
  const nonFinite: string[] = [];
  for (const o of pipeline.output) {
    const v = ctx[o];
    if (typeof v === "number" && !Number.isFinite(v)) {
      // Drop it. Consumers read finals BY `outputs`, so an absent key and a present-undefined one
      // are indistinguishable to every one of them -- the output renders "-" exactly as an honest
      // partial does, which is the truthful rendering for a value we could not compute.
      nonFinite.push(o);
      continue;
    }
    finals[o] = v;
  }
  if (nonFinite.length) {
    // Never silent: something upstream produced a non-finite number and the trace has to say so, or
    // the dropped output is indistinguishable from a rate the row genuinely does not carry.
    steps.push({
      step: "(finalize)",
      label: `${nonFinite.join(", ")} computed to a non-finite value -- dropped, not priced`,
      runningValues: snapshot(),
    });
  }
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
