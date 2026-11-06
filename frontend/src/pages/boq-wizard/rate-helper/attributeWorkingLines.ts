/**
 * ELR-2 -- THE ATTRIBUTE PATH'S WORKING LINES IN PLAIN ENGLISH.
 *
 * Owner R-SCOPE (2026-10-27 16:54, "7- ok"): the internal names on Electrical's panel and calculator working lines
 * ("pi_switchgear_discount: switchgear = 0.7") go, the HVAC rows Electrical's engines price included. R-WORD
 * (2026-10-27 22:48, "6 ok"), the ELR-R0 "InternalNames" pattern:
 *   - a Pricing Input line is "<the Pricing Input's own name> <rate word> = <value>", a percentage as % ("Switchgear
 *     discount = 70%"), an amount as Rs with its unit ("Cable tray ceiling accessories (Rs per metre) = Rs 106 per metre");
 *   - a component line is "<the bound field's label>: <item> x <qty> = <amount>" ("DB (shell): VTPN DB 12WAY WITH MCB
 *     INCOMER x 1 = 30,090").
 * R-MISC: the Miscellaneous supply-ratio line stays and reads "Miscellaneous supply BCS ratio = 80%". The Phase A answer
 * (2026-10-28, "(B): all as recommended"): D1-D8, C1-C3, today's item text, Q3 (a) (a component with no single bound
 * field carries its label on the STEP, `display_label`, in the asset), Q4 (a) (the quantity is the trace's own `qty`).
 *
 * ⚠️ NOT `plainPricerText`. ELR-R0 measured its id-to-name replacement against these lines and it garbles them
 * ("pi Switchgear discount & supply markup discount: ..."); the item-list path keeps it, untouched.
 *
 * ⚠️ THE PRICING INPUT'S NAME IS READ FROM THE ITEM, NEVER FROM A LIST HERE, so a rename on the Rate Master page shows
 * on the next price with no code change. A name ending in its own column words ("Switchgear discount & supply markup")
 * swaps them for THIS line's word ("Switchgear discount"); a name without them is shown whole, then the word.
 *
 * Display only: nothing here is read by a price.
 */
import { PRICING_INPUT_COLUMN_LABELS, PRICING_INPUT_NON_PERCENT_COLUMNS } from "@/pages/pricing/rate-master/rateMasterSpec";
import type { Pipeline, RateCategoryConfig, RateMasterItem, StepTrace } from "@/pages/pricing/rate-master/rateMasterTypes";
import { evalFormula } from "@/pages/pricing/rate-master/ratePipelineInterpreter";

/** The line a working value falls back to when nothing can name it -- never a raw id (owner AC7). */
export const UNNAMED_INPUT = "(unnamed input)";

const NON_PERCENT = new Set<string>(PRICING_INPUT_NON_PERCENT_COLUMNS as readonly string[]);

/** Rupee amounts in Indian grouping, up to 2 decimals (owner C3: 30,090; 1,00,000). */
export function amountText(v: number): string {
  return v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}
/** A quantity as the pricer typed it: whole numbers plain, else up to 2 decimals (owner C3). */
export function qtyText(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(2)));
}
/** A stored fraction as a percentage, up to 2 decimals (owner C3: 0.57 -> 57%, 1 -> 100%). */
export function percentText(v: number): string {
  return `${Number((v * 100).toFixed(2))}%`;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const COLUMN_WORDS = Object.values(PRICING_INPUT_COLUMN_LABELS).sort((a, b) => b.length - a.length).map(escapeRe).join("|");
// a name's TRAILING list of column words: "discount & supply markup", "discount, supply markup & wastage", "BCS ratio"
const COLUMN_WORD_TAIL = new RegExp(`^(.*?)\\s+(?:${COLUMN_WORDS})(?:(?:\\s*,\\s*|\\s*&\\s*|\\s+and\\s+)(?:${COLUMN_WORDS}))*$`, "i");

/** A column's word as it sits mid-sentence: "Discount" -> "discount"; "BCS ratio" keeps its capitals. */
function columnWord(column: string): string {
  const label = PRICING_INPUT_COLUMN_LABELS[column] ?? column;
  return /^[A-Z][a-z]/.test(label) ? label[0].toLowerCase() + label.slice(1) : label;
}

/** "<the Pricing Input's own name> <rate word> = <value>" -- the row and its column, as the pipeline read them. */
export function pricingInputLine(row: RateMasterItem | undefined, column: string, value: number): string {
  const name = String(row?.attributes?.name ?? "").trim();
  if (!name) return `${UNNAMED_INPUT} = ${NON_PERCENT.has(column) ? amountText(value) : percentText(value)}`;
  if (NON_PERCENT.has(column)) {
    const unit = String(row?.unit ?? "").trim();
    // the approved form: "Cable tray ceiling accessories (Rs per metre) = Rs 106 per metre"
    if (/^Rs\b/.test(unit)) return `${name} (${unit}) = ${unit.replace(/^Rs\b/, `Rs ${amountText(value)}`)}`;
    return `${name} = ${amountText(value)}${unit ? ` ${unit}` : ""}`;
  }
  const m = COLUMN_WORD_TAIL.exec(name);
  return `${m ? m[1] : name} ${columnWord(column)} = ${percentText(value)}`;
}

type StepConfig = {
  step?: string;
  name?: string;
  result?: string;
  target?: string;
  qty?: unknown;
  display_label?: unknown;
  ref?: Record<string, unknown>;
};

/** A component's label: the step's own `display_label` (Q3 (a)), else the label of the field its catalogue item is
 *  bound to (`ref.item: "@<field>"`), else "" -- nothing to name it by. */
export function componentLabel(step: StepConfig, config: RateCategoryConfig): string {
  if (typeof step.display_label === "string" && step.display_label.trim()) return step.display_label.trim();
  const item = step.ref?.item;
  if (typeof item === "string" && item.startsWith("@")) {
    const d = (config.attribute_definitions ?? []).find((x) => x.id === item.slice(1));
    if (d?.label) return d.label;
  }
  return "";
}

/**
 * The plain-English line for one pipeline step that produced a value from a referenced row (the attribute path's
 * `matchedRows` source: a `rate_ref` Pricing Input or a `component_ref` component).
 *   rate_ref                     -> pricingInputLine
 *   component_ref with a qty     -> "<label>: <item> x <qty> = <amount>"
 *   component_ref, formula shape -> "<item> = <amount>" (owner D8: no bound field, no quantity -- "Bus bar = 3,000")
 *     ... whose matched condition gives it a factor of 0 -> "<item>: not included" (ELR-4b, owner (g) 2026-10-29:
 *     "Bus bar: not included" when Without, in place of "Bus bar = 0"; display only -- the step's own `params` are the
 *     condition the interpreter matched, so the words follow the price, never a second reading of the answers)
 *   anything it cannot name      -> "(unnamed input) = <value>"
 * `resolveBound` reads an `@`-bound ref value the way the pipeline did (the row's selected answers).
 */
export function attributeWorkingLine(
  st: StepTrace,
  pipeline: Pipeline | undefined,
  config: RateCategoryConfig,
  items: readonly RateMasterItem[],
  resolveBound: (attr: string) => string | number | undefined,
): string {
  const produced = st.produced;
  const value = produced?.value ?? 0;
  const steps = ((pipeline as { steps?: unknown[] } | undefined)?.steps ?? []) as StepConfig[];
  const cfg = produced ? steps.find((s) => s.step === st.step && (s.result ?? s.name) === produced.key) : undefined;
  if (!cfg) return `${UNNAMED_INPUT} = ${amountText(value)}`;
  if (st.step === "rate_ref") {
    const ref = cfg.ref ?? {};
    const want: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(ref)) {
      if (k === "kind" || k === "attributes") continue;
      want[k] = typeof v === "string" && v.startsWith("@") ? resolveBound(v.slice(1)) : v;
    }
    const rows = items.filter((it) => it.kind === ref.kind && Object.entries(want).every(([k, v]) => it.attributes?.[k] === v));
    return pricingInputLine(rows.length === 1 ? rows[0] : undefined, String(cfg.target ?? ""), value);
  }
  if (st.step === "component_ref") {
    const item = st.refItem ?? "";
    if (cfg.qty === undefined && typeof st.qty !== "number") return st.params?.factor === 0 ? `${item}: not included` : `${item} = ${amountText(value)}`;
    const label = componentLabel(cfg, config);
    if (!label || typeof st.qty !== "number") return `${UNNAMED_INPUT} = ${amountText(value)}`;
    return `${label}: ${item} x ${qtyText(st.qty)} = ${amountText(value)}`;
  }
  return `${UNNAMED_INPUT} = ${amountText(value)}`;
}

/**
 * ELR-4c (owner R-FLOAT, 2026-10-30 "ok"; P6 "Q3 a"): money as the screen shows it -- to 2 decimals, so a computed
 * 216.04999999999998 reads 216.05 and 59.49999999999999 reads 59.5. The figure on screen, the "Use this value" box, the copy
 * control and the feedback log's computed value all carry this value (Q3b a); the price itself is never rounded here.
 * Anything that is not a finite number (a pipeline output that was not produced) passes through untouched, so its line
 * reads exactly as before.
 */
export function moneyValue(v: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Number(v.toFixed(2)) : v;
}

/** ELR-4c (owner R-ELR2 (c), 2026-10-29): what a "used input" line ends with. */
export const USED_INPUT_MARK = "(Pricing Input)";

type ArmStep = StepConfig & { params?: Record<string, unknown>; binds?: unknown };

/**
 * ELR-4c (owner R-ELR2 (c), "one line per input used"; P6 "Q1 b", 2026-10-30) -- the ctx keys of the ASSEMBLY-ONLY Pricing
 * Inputs (`assemblyOnlyCtxKeys`) this row's pipeline actually USED, read from the step traces it produced. Display only.
 *   map_attribute    `table_from_ctx` -- the entry the source value picked, when the table (not a stated value) resolved
 *                    it; `default_from_ctx` -- when the default resolved it
 *   derive_attribute `constants_from_ctx` -- each constant that moves the result: the formula evaluated again with that
 *                    constant at 0 gives a different value (Q1 b: a 1-point row's further length is x 0, so it is not shown)
 *   circuit_fit      `usable_from_ctx` -- the fill of the size the conduit was fitted to, at the type it was fitted for
 * A stated value, a skipped map, an absent conduit and a refusal use none, so they add no line.
 */
export function usedAssemblyInputs(
  pipeline: Pipeline | undefined,
  traces: readonly StepTrace[],
  selected: Readonly<Record<string, string | number>>,
): Set<string> {
  const used = new Set<string>();
  const steps = ((pipeline as { steps?: unknown[] } | undefined)?.steps ?? []) as ArmStep[];
  // the values the pipeline resolved so far (a map's or a derive's result), over the row's own answers
  const now: Record<string, string | number> = { ...selected };
  let cursor = 0;
  const configOf = (st: StepTrace): ArmStep | undefined => {
    for (let i = cursor; i < steps.length; i++) {
      if (steps[i].step === st.step) { cursor = i + 1; return steps[i]; }
    }
    return undefined;
  };
  for (const st of traces) {
    if (st.step !== "map_attribute" && st.step !== "derive_attribute" && st.step !== "circuit_fit") continue;
    const cfg = configOf(st);
    const p = cfg?.params ?? {};
    if (st.step === "map_attribute" && st.mapAttribute) {
      if (!st.mapAttribute.stated) {
        const tfc = p.table_from_ctx as Record<string, string> | undefined;
        const table = p.table as Record<string, unknown> | undefined;
        const src = typeof p.from_attr === "string" ? now[p.from_attr] : undefined;
        const hit = (t: Record<string, unknown> | undefined) => !!t && src !== undefined && Object.prototype.hasOwnProperty.call(t, String(src));
        if (hit(tfc)) used.add(tfc![String(src)]);
        else if (typeof p.default_from_ctx === "string" && !hit(table)) used.add(p.default_from_ctx);
      }
      now[st.mapAttribute.result_attr] = st.mapAttribute.value;
    } else if (st.step === "derive_attribute" && st.derivedAttr) {
      const constants = st.derivedAttr.constants;
      if (!st.derivedAttr.stated && constants && typeof p.formula === "string") {
        const env: Record<string, number> = { ...constants };
        for (const t of (p.terms ?? []) as Array<{ ident?: string; attr?: string }>) {
          if (t.ident && t.attr) env[t.ident] = Number(now[t.attr]);
        }
        const keys = (p.constants_from_ctx ?? {}) as Record<string, string>;
        for (const [k, key] of Object.entries(keys)) {
          try {
            if (evalFormula(p.formula, { ...env, [k]: 0 }) !== st.derivedAttr.value) used.add(key);
          } catch {
            used.add(key);
          }
        }
      }
      if (st.derivedAttr.value !== null) now[st.derivedAttr.attr] = st.derivedAttr.value;
    } else if (st.step === "circuit_fit") {
      const ufc = p.usable_from_ctx as Record<string, string[]> | undefined;
      const sizes = (p.sizes ?? []) as number[];
      const bind = (Array.isArray(cfg?.binds) ? (cfg!.binds as string[])[0] : undefined) ?? "fitted_size";
      const fitted = st.runningValues?.[bind];
      const type = typeof p.conduit_type_attr === "string" ? now[p.conduit_type_attr] : undefined;
      const i = typeof fitted === "number" ? sizes.indexOf(fitted) : -1;
      if (ufc && type !== undefined && i >= 0 && ufc[String(type)]?.[i]) used.add(ufc[String(type)][i]);
    }
  }
  return used;
}
