/**
 * DU-1 -- THE DERIVATION COVERAGE CHECK (owner 2026-11-15 13:30-13:41, verbatim: "we need to make sutre that the derivatrion screen
 * captures all th erules" / "going forwrad we need to add a derivation coverage check before deployment to ensure all rules (model +
 * code+ anywhere else) are captured in the dderivation tab for that category in the rate master").
 *
 * PURE. Given a category's config (and the discipline's items, and the configs its delegated sections borrow) it answers, for the
 * Rate Master > <discipline> > <category> > Derivation tab:
 *   MISSING  a rule the category prices by that no line states:
 *            (a) a CONFIG rule -- every rule-bearing key under `list_spec.pricing` (and each entry of a list / map key, and each
 *                delegated section) must move the tab when it is taken out (structural vacuity: delete the key, its line must go);
 *            (b) a CODE rule -- every rule id `CODE_RULES` registers for the category's item kind must have a declared line
 *                (`list_spec.pricing.rule_lines[].rule`, FIX-3);
 *            (c) a BORROWED section of a borrow-only category must carry that category's own lines nested (FIX-4).
 *   ORPHAN   a declared line naming no registered code rule.
 *   UNREASONED (a category that declares `derivation_reasons`) a line whose reason is "reason not recorded".
 * WRONG WORDING is a reading of the words against the rulings -- not a machine check; the build's guard test pins the declared
 * wording of each code rule.
 *
 * ⚠️ `CODE_RULES` is the register of every rule written in CODE per item kind. A code rule added without registering it is caught by
 * the guard test's SOURCE scan (every "(owner X)" tag inside the gated reading-rule function must be registered here).
 */
import { itemListRuleOrder, type RuleOrderItem, type RuleOrderLine } from "./itemListRuleOrder";

/** Rules written in CODE, by the item kind whose rows run them (`pricingSheetHelper`): each needs a declared Derivation line. */
export const CODE_RULES: Readonly<Record<string, readonly string[]>> = {
  // VP-3 / VP-4 / VP-5 `valveReviewNets` (gated `spec.kind === VALVE_NETS_KIND`) + VP-4 T1 (`NB_NOTE_KINDS`)
  hvac_valve_item: ["D1", "D2", "D3", "D4", "D5", "D7b", "D7c", "R1", "R2", "R3", "R4", "W1", "W2",
                    "E1", "E2", "E3", "E4", "E6", "E7", "E8", "E9", "E10", "T1"],
  // VP-4 T1 on a Misc block (`NB_NOTE_KINDS`); Misc's other rules are config shapes
  hvac_misc_item: ["T1"],
  // DU-1 Part B: the Ducting rules written in code -- the sheet-gauge axis (DR2 / DR3 / DR4 / DR12, `readGauge` / `gaugeBandFor`),
  // the per-sheet insulation check (DR7 / G3, `sheetInsulationOf` / `ductInsulationDecision`), the gauge-word mask of a borrowed
  // section (G1, `SECTION_GAUGE_WORDS`), removal / refixing (DR14, `existing_work`) and the scope's own uplift on a supply row (O10)
  // DU-3: G3 became R1 (the 90% rule); R-GAUGE-FORMS / R-OWN-BAND / R-LABOUR-GAUGE / R-REVERSE-PAIR added (pricingSheetHelper / itemListPricing)
  hvac_duct_item: ["DR3", "DR12", "DR4", "DR2", "DR7", "R1", "G1", "DR14", "O10",
                   // DU-2: the not-a-duct re-file sentence before any unit check (R-NOTE-ORDER, `priceItemListRow` gated on no_sku_refusals)
                   "R-NOTE-ORDER",
                   // DU-2 K1b: a PIR row's thickness from its own words (owner R-DUCT / R-DOUBT); a labour row = the duct's installation only (QR-1 Q1 (a))
                   "R-PIR", "R-LABOUR",
                   "R-GAUGE-FORMS", "R-OWN-BAND", "R-LABOUR-GAUGE", "R-REVERSE-PAIR"],
};

/** Keys under `list_spec.pricing` that carry no pricing rule of their own (display / matching plumbing). Every OTHER key is a rule
 *  source the tab must state. */
export const NON_RULE_KEYS: ReadonlySet<string> = new Set([
  "kind", "label_attr", "unit_class_attr", "match_attrs", "unit_words", "panel_controls", "panel_notes", "panel_readonly",
  "panel_optional", "reason_names", "rule_lines", "derivation_reasons", "typed_cladding", "qty_label",
  // VAV-2a2 (B4): a field's source tag ("from BoQ") is display only
  "source_tags",
]);

/** Keys checked as a whole only: their entries are attribute ids the matching reads, not rules of their own. */
export const KEY_LEVEL_ONLY: ReadonlySet<string> = new Set(["choice_attrs", "ladders"]);

export interface CoverageResult {
  lines: RuleOrderLine[];
  /** each MISSING rule, as "<where>: <what>" */
  missing: string[];
  orphan: string[];
  unreasoned: string[];
  /** VAV-2a2 (B6, owner 2026-11-19 18:21 "ok b"): a line whose reason is present but WRONG -- see `wrongReasons`. */
  wrong: string[];
  /** VAV-2a2 (B6): a declared reason the tab shows on NO line (its pattern is shadowed or matches nothing) -- see `deadReasons`.
   *  The guard fails on it for the categories it names; others are reported. */
  dead: string[];
}

const canon = (l: RuleOrderLine[]): string => JSON.stringify(l.map((x) => [x.title, x.detail ?? "", (x.sub ?? []).map((s) => [s.title, s.detail ?? ""])]));

function linesOf(config: unknown, items: ReadonlyArray<RuleOrderItem>, sections?: Readonly<Record<string, unknown>>): RuleOrderLine[] | null {
  try { return itemListRuleOrder(config, items, sections); } catch { return null; }
}

/** The config with one rule source taken out: a pricing key, one entry of a list / map key, or one delegated section. */
type Json = Record<string | number, unknown>;
function without(config: unknown, path: Array<string | number>): unknown {
  const c = structuredClone(config);
  let o: unknown = c;
  for (let i = 0; i < path.length - 1; i++) o = o && typeof o === "object" ? (o as Json)[path[i]] : undefined;
  const last = path[path.length - 1];
  if (Array.isArray(o) && typeof last === "number") o.splice(last, 1);
  else if (o && typeof o === "object") delete (o as Json)[last];
  return c;
}

export function derivationCoverage(config: unknown, items: ReadonlyArray<RuleOrderItem> = [],
                                   sectionConfigs?: Readonly<Record<string, unknown>>): CoverageResult {
  type Sec = { id?: unknown; category_id?: unknown };
  type CovCfg = { list_spec?: { sections?: Sec[]; pricing?: Record<string, unknown> & { kind?: unknown; derivation_reasons?: unknown } } };
  const cfg = config as CovCfg | null | undefined;
  const pr = cfg?.list_spec?.pricing ?? {};
  const lines = linesOf(cfg, items, sectionConfigs) ?? [];
  const base = canon(lines);
  const missing: string[] = [];
  const moved = (path: Array<string | number>) => {
    const l = linesOf(without(cfg, path), items, sectionConfigs);
    return l === null || canon(l) !== base;
  };
  // (a) config rule sources -- the key, then each entry of a list / map key
  for (const k of Object.keys(pr)) {
    if (NON_RULE_KEYS.has(k)) continue;
    const v = pr[k];
    // an empty key carries no rule
    if (v === undefined || v === null || v === false || (Array.isArray(v) && !v.length) || (typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length)) continue;
    if (!moved(["list_spec", "pricing", k])) { missing.push(`config ${k}: no line states it`); continue; }
    if (KEY_LEVEL_ONLY.has(k)) continue;
    if (Array.isArray(v)) v.forEach((_, i) => { if (!moved(["list_spec", "pricing", k, i])) missing.push(`config ${k}[${i}]: no line of its own`); });
    else if (v && typeof v === "object" && ["families", "numbers", "defaults", "number_defaults", "unit_factors", "unit_lines"].includes(k)) {
      for (const sub of Object.keys(v)) if (!moved(["list_spec", "pricing", k, sub])) missing.push(`config ${k}.${sub}: no line of its own`);
    }
  }
  // (a') the delegated sections
  (cfg?.list_spec?.sections ?? []).forEach((s, i) => {
    if (s?.category_id && !moved(["list_spec", "sections", i])) missing.push(`section ${String(s.id ?? i)}: no line states it`);
  });
  // (b) code rules -> declared lines
  // keyed by the category's OWN item kind: the code gates on `spec.kind` (VALVE_NETS_KIND, NB_NOTE_KINDS), never on extra_kinds
  const kinds = [String(pr.kind ?? "")];
  const registered = new Set(kinds.flatMap((k) => CODE_RULES[k] ?? []));
  const declared = new Set(lines.filter((l) => l.rule).map((l) => String(l.rule)));
  for (const r of registered) if (!declared.has(r)) missing.push(`code rule ${r}: no declared line`);
  const orphan = [...declared].filter((r) => !registered.has(r)).map((r) => `declared line ${r}: names no code rule of ${kinds.join(" / ")}`);
  // (c) borrowed sections of a borrow-only category: that category's own lines, nested
  for (const s of cfg?.list_spec?.sections ?? []) {
    const sc = s?.category_id ? sectionConfigs?.[String(s.category_id)] : undefined;
    if (!sc) continue;
    const want = canon(itemListRuleOrder(sc, items));
    const line = lines.find((l) => (l.sub ?? []).length && canon(l.sub!) === want);
    if (!line) missing.push(`section ${String(s.id)}: ${String(s.category_id)}'s own rules are not nested under its line`);
    // and the borrowed category's own coverage, nested (its code rules too)
    const inner = derivationCoverage(sc, items);
    for (const m of inner.missing) missing.push(`${String(s.category_id)} (borrowed) ${m}`);
    for (const o of inner.orphan) orphan.push(`${String(s.category_id)} (borrowed) ${o}`);
  }
  const unreasoned = Array.isArray(pr.derivation_reasons)
    ? lines.filter((l) => l.reason === "reason not recorded").map((l) => `line ${l.n}: ${l.title}`) : [];
  const wrong = Array.isArray(pr.derivation_reasons) ? wrongReasons(lines, pr.derivation_reasons as ReasonEntry[]) : [];
  const dead = Array.isArray(pr.derivation_reasons) ? deadReasons(lines, pr.derivation_reasons as ReasonEntry[]) : [];
  return { lines, missing, orphan, unreasoned, wrong, dead };
}

type ReasonEntry = { rule?: unknown; title?: unknown; why?: unknown };

/**
 * VAV-2a2 (B6; owner 2026-11-19 18:21 "ok b": the coverage check must FAIL on a reason that is present but WRONG, for every category it
 * covers). The tab gives a line the FIRST reason whose `title` pattern matches its title (itemListRuleOrder, DU-1). A reason is WRONG on
 * a line when ANY other reason's pattern matches MORE of that line's title than the shown one does -- the shown reason is the broader one,
 * and the reason written for the line is hidden behind it (VAV-2a: lines 9 / 11 showed VAV-1's "^The misc item section" reason while
 * VAV-2a's "^The (misc item|sensor) section's quantity per vav item ..." reason matched the whole title). A rule-id line is WRONG when
 * two entries name its rule. PURE.
 */
export function wrongReasons(lines: readonly RuleOrderLine[], reasons: readonly ReasonEntry[]): string[] {
  const out: string[] = [];
  const span = (r: ReasonEntry, title: string): number => {
    if (typeof r?.why !== "string" || typeof r.title !== "string") return -1;
    try { const m = new RegExp(r.title, "i").exec(title); return m ? m[0].length : -1; } catch { return -1; }
  };
  for (const l of lines) {
    if (l.rule) {
      const n = reasons.filter((r) => typeof r?.why === "string" && r.rule === l.rule).length;
      if (n > 1) out.push(`line ${l.n}: rule ${String(l.rule)} has ${n} reasons; the first is shown`);
      continue;
    }
    const spans = reasons.map((r) => span(r, l.title));
    const shown = spans.findIndex((x) => x >= 0);
    if (shown < 0) continue;
    // ANY other reason (chat-Claude's review of the rule, 2026-11-19 23:45: order must not matter to the check, order caused the defect)
    const better = spans.findIndex((x, i) => i !== shown && x > spans[shown]);
    if (better >= 0) out.push(`line ${l.n}: ${l.title} -- shows reason ${shown} (${String(reasons[shown].title)}) but reason ${better} (${String(reasons[better].title)}) matches more of its title`);
  }
  return out;
}

/** VAV-2a2 (B6). PURE. Each declared reason the tab gives to NO line (first-match never picks it), as "reason <i> (<title or rule>)". */
export function deadReasons(lines: readonly RuleOrderLine[], reasons: readonly ReasonEntry[]): string[] {
  const used = new Set<number>();
  for (const l of lines) {
    const i = reasons.findIndex((r) => typeof r?.why === "string" && ((l.rule && r.rule === l.rule)
      || (!l.rule && typeof r.title === "string" && (() => { try { return new RegExp(r.title, "i").test(l.title); } catch { return false; } })())));
    if (i >= 0) used.add(i);
  }
  return reasons.flatMap((r, i) => (used.has(i) ? [] : [`reason ${i} (${String(r.title ?? r.rule ?? "")})`]));
}
