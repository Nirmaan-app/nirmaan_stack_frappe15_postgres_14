/**
 * VAV-2c2 (R1 / R2) -- THE SCOPE RULE, ruled by the owner for EVERY category (2026-11-23 13:52 - 13:57; 2026-11-22 20:08 "default is
 * always supply + install and supply only and install only are based on positive identification"), BUILT for VAV Box: a category takes it
 * by declaring `pricing.scope.rule` (only VAV Box does, HVAC v83). PURE. On a BoQ row with its sheet (never the Calculator, never a scope
 * the user picked) it decides the row's scope and the note that says why:
 *   1  work on an existing box / supply by others / the row's own "installation only" (point 3; QR-WORDS (a))    -> Installation only, F
 *   2  SPLIT ACROSS ROWS (point 2): an installation row that names the VAV units, on the same sheet as the box rows --
 *        the box row: SURE (its quantity >= the own-row threshold of the box rows') -> Supply only, D; in doubt -> Supply + installation,
 *        C (quantities) / C (blank or 0); the installation row: Installation only, E (sure) / E-doubt (owner 2026-11-24 00:31 - 00:32)
 *   3  the model says the item needs no installing, with a reason (point 4; QR-ASK)                               -> Supply only, G
 *   4  the row's own "supply only" (QR-WORDS (a): not read from words)                                              -> S + I, its note
 *   5  otherwise the DEFAULT, Supply + installation: note A where the row's own words say "supply of", B where they say installation
 *      (owner 13:57 "give appropriate notes and disclaimrs for each case"), no note on a plain row.
 * Every number in a note is the live one from the sheet; the texts are the config's (`rule.notes`).
 */

import type { RateMasterItem } from "../../pricing/rate-master/rateMasterTypes";

/** a line of the sheet as the page gives it (`sheetLinesOf`) */
export type RuleLine = { row: number; text: string; preamble?: boolean; heading?: string; sheet?: string };

export interface ScopeRuleSpec {
  /** words naming the item the rule is for, in a row's own text or its nearest heading ("VAV", "CAV", "variable air volume") */
  item_words: string;
  /** a row's own text STARTS with installation work */
  install_start: string;
  /** a row's own text starts with supply ("Supply ...", "SITC ...") */
  supply_start: string;
  /** note A: the row's own words read as supply of the item (and name no installation) */
  supply_of: string;
  /** work on an EXISTING item: a line saying so is never an installation row of new boxes, nor a box row (owner (g) 2026-11-24 00:55:
   *  "removal" counts only beside "existing" or "refix") */
  existing_words: string;
  /** point 3: supply clearly in someone else's scope ("3rd party supplied", "supplied by the client") */
  by_others: string;
  /** QR-WORDS (a): the row's own "installation only" / "ITC only" */
  install_only_words: string;
  /** QR-WORDS (a): the row's own "supply only" -- stays Supply + installation, with its note */
  supply_only_words: string;
  /** the item families a box row prices (the rows a split may make Supply only) */
  box_families: string[];
  /** the item an installation row prices on ("VAV installation - any size") */
  install_family: string;
  /** the Pricing Input whose factor is the share of the box rows' quantity an installation row must cover to be SURE (0.9) */
  threshold_input: string;
  /** point 4: the model's answer that the item needs no installing, and its reason */
  needs_installing?: { attr: string; no: string; reason_attr: string };
  /** VAV-2c3 (R5 F4, chat-Claude's call under the owner's 2026-11-23 13:46 word): an INSTALLATION row's own wording of the box-row notes it
   *  carries -- each key one of INSTALL_ROW_TEXT_PATHS, its text in place of that text on an installation row only (`installRowSpec`).
   *  ABSENT => the box-row wording everywhere, as before. */
  install_row_texts?: Record<string, string>;
  notes: {
    A: string; B: string; C: string; C_qty: string; D: string; E: string; E_qty: string; F: string; G: string; words_supply_only: string;
    /** F's {said} by the case: "existing", "refix", "by_others", "install_only" */
    F_said: Record<string, string>;
  };
}

/** `boxRows`: on an installation row, the sheet's box rows it covers (sure or not) -- whose shared items it carries too (owner
 *  2026-11-24 01:22 / 01:23: "all components price move together") */
export type ScopeRuleOutcome = { value: string; note?: string; installRow?: boolean; boxRows?: number[] };

export interface ScopeRuleInput {
  rule: ScopeRuleSpec;
  /** the scope's three values */
  values: { both: string; supply: string; install: string };
  row: number;
  /** the row's own text (its description and its own notes) and its nearest heading */
  own: string;
  heading: string;
  /** the row's own item family (its first priced item), or null */
  family: string | null;
  /** the sheet's lines (`sheetLinesOf`), the category of a row, the quantity of a row */
  lines: readonly RuleLine[];
  catOf: (row: number) => string | null;
  qtyOf: (row: number) => number | null;
  /** the category the rule is wired for ("hvac_vav_box") */
  category: string;
  threshold: number | null;
  /** the existing-box kind the row's own words name (the existing-box rule's own reading), or null */
  existingKind: string | null;
  /** point 4: the model's answer on this row */
  needsNo?: { reason: string } | null;
}

const rx = (s: string | undefined): RegExp | null => { if (!s) return null; try { return new RegExp(s, "i"); } catch { return null; } };
const fill = (t: string, v: Record<string, string>): string => Object.entries(v).reduce((a, [k, x]) => a.split(`{${k}}`).join(x), t);
/** "166, 167, 168, 169 and 10 more" (the owner's form, 2026-11-24 00:32) */
export function rowList(rows: readonly number[]): string {
  const rs = [...new Set(rows)].sort((a, b) => a - b);
  return `${rs.slice(0, 4).join(", ")}${rs.length > 4 ? ` and ${rs.length - 4} more` : ""}`;
}
/** "row 193" / "rows 175, 176, 177, 178 and 10 more" */
export const rowsWord = (rows: readonly number[]): string => `${new Set(rows).size > 1 ? "rows" : "row"} ${rowList(rows)}`;
const num = (n: number): string => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

/** PURE. Whether a line of the sheet is an installation row of the rule's item: its own words START with installation work, name the item
 *  (or its nearest heading does), start with no supply word, and are not work on an existing item or supply by others. */
export function isInstallationRow(rule: ScopeRuleSpec, text: string, heading: string | undefined, existing: boolean): boolean {
  const ins = rx(rule.install_start), item = rx(rule.item_words), sup = rx(rule.supply_start), oth = rx(rule.by_others);
  if (!ins?.test(text) || sup?.test(text) || existing || oth?.test(text)) return false;
  return !!item?.test(text) || (!!heading && !!item?.test(heading));
}

/** PURE. The rule's decision for one BoQ row (see the file head), or null when the rule does not apply (no sheet). */
export function scopeRuleOf(i: ScopeRuleInput): ScopeRuleOutcome | null {
  const { rule, values: V } = i;
  const N = rule.notes;
  const own = i.own;
  const F = (said: string): ScopeRuleOutcome => ({ value: V.install, note: fill(N.F, { said: N.F_said[said] ?? said }) });
  // 1. point 3 -- work on an existing box (the existing-box rule's own reading), supply by others, the row's own "installation only"
  if (i.existingKind) return F(/refix/i.test(i.existingKind) ? "refix" : "existing");
  const installStart = !!rx(rule.install_start)?.test(own);
  if (installStart && rx(rule.by_others)?.test(own)) return F("by_others");
  if (rx(rule.install_only_words)?.test(own)) return F("install_only");
  // 2. the split across rows
  const sheet = i.lines.filter((l) => l.sheet === undefined && !l.preamble);
  const existingWords = (t: string) => !!rx(rule.existing_words)?.test(t);
  const covering = sheet.filter((l) => l.row !== i.row && isInstallationRow(rule, l.text, l.heading, existingWords(l.text)));
  const meCovering = isInstallationRow(rule, own, i.heading, existingWords(own));
  const boxRows = sheet.filter((l) => i.catOf(l.row) === i.category && !rx(rule.install_start)?.test(l.text) && !existingWords(l.text)
    && !isInstallationRow(rule, l.text, l.heading, false)).map((l) => l.row);
  const sum = (rows: readonly number[]): number | null => rows.reduce<number | null>((a, r) => { const q = i.qtyOf(r); return a === null || q === null ? null : a + q; }, 0);
  const verdict = (inst: readonly number[]) => {
    const qi = sum(inst), qb = sum(boxRows);
    if (qi === null || qb === null || !(qi > 0) || !(qb > 0) || i.threshold === null) return { sure: false, qty: false, qi, qb };
    return { sure: qi >= i.threshold * qb, qty: true, qi, qb };
  };
  if (meCovering && boxRows.length) {
    const v = verdict([i.row]);
    const note = v.sure ? fill(N.E, { rows: rowsWord(boxRows) })
      : v.qty ? fill(N.E_qty, { q_inst: num(v.qi!), q_box: num(v.qb!), row_list: rowList(boxRows), rows: rowsWord(boxRows) })
      : fill(N.E, { rows: rowsWord(boxRows) });
    return { value: V.install, note, installRow: true, boxRows };
  }
  const isBox = i.family !== null && rule.box_families.includes(i.family) && boxRows.includes(i.row);
  if (isBox && covering.length) {
    const inst = covering.map((l) => l.row);
    const v = verdict(inst);
    const n = inst.length === 1 ? String(inst[0]) : rowList(inst);
    if (v.sure) return { value: V.supply, note: fill(N.D, { n }) };
    return { value: V.both, note: v.qty ? fill(N.C_qty, { n, q_inst: num(v.qi!), q_box: num(v.qb!) }) : fill(N.C, { n }) };
  }
  // 3. point 4: the model's reading that the item needs no installing, with its reason
  if (i.needsNo && i.needsNo.reason.trim() !== "") return { value: V.supply, note: fill(N.G, { reason: i.needsNo.reason.trim() }) };
  // 4. the row's own "supply only" is not read from words: Supply + installation, said
  if (rx(rule.supply_only_words)?.test(own)) return { value: V.both, note: N.words_supply_only };
  // 5. the default
  if (rx(rule.supply_of)?.test(own)) return { value: V.both, note: N.A };
  if (installStart) return { value: V.both, note: N.B };
  return { value: V.both };
}

/** the slice of a row's context and model reading the rule reads (structural: pricingSheetHelper's RowContextWithUnit and
 *  ExtractionRowWithItems fit it) */
export type RuleCtx = { excelRow: number; description?: string | null; ownNotes?: readonly string[]; headings?: readonly string[];
  sheetLines?: readonly RuleLine[]; sheetCategories?: Readonly<Record<number, string>>; rowQuantities?: Readonly<Record<number, number>>; noRow?: boolean };
type RuleItem = { attributes?: Record<string, { value?: unknown } | undefined> };
type RuleSpec = { family_attribute_id?: string; scope?: { options: string[]; supply_only: string; install_only: string; model_attr?: string; rule?: ScopeRuleSpec };
  existing_boxes?: { kinds: Array<{ id: string; words: string }> }; no_sku_named_by?: string };

/** PURE. A Pricing Input's factor by its id (a finite number >= 0), else null -- as the scope's own uplift reads it. */
export function inputFactor(items: readonly RateMasterItem[], id: string): number | null {
  const it = items.find((x) => /_pricing_input$/.test(String(x?.kind ?? "")) && String(x?.attributes?.item ?? "") === id);
  const raw = (it?.rates as Record<string, unknown> | undefined)?.factor;
  const f = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  return Number.isFinite(f) && f >= 0 ? f : null;
}

/** PURE. The rule on one BoQ row of a config declaring `pricing.scope.rule`, from the row's context, its model items and the sheet; null
 *  when the config has no rule, or there is no sheet (the Calculator). `rowCats`: the run's categories, where the page gives none. */
export function scopeRuleForRow(spec: RuleSpec, ctx: RuleCtx, extItems: readonly RuleItem[] | undefined, rowCats: ReadonlyMap<number, string> | undefined,
  items: readonly RateMasterItem[], category: string): ScopeRuleOutcome | null {
  const sc = spec.scope, rule = sc?.rule;
  if (!sc || !rule || ctx.noRow === true || !ctx.sheetLines) return null;
  const own = [ctx.description ?? "", ...(ctx.ownNotes ?? [])].join(" | ");
  const fa = spec.family_attribute_id ?? "item";
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const it0 = (extItems ?? []).find((it) => str(it.attributes?.[fa]?.value) !== "");
  const family = it0 ? str(it0.attributes?.[fa]?.value) : null;
  const kind = (spec.existing_boxes?.kinds ?? []).find((k) => { try { return new RegExp(k.words, "i").test(own); } catch { return false; } });
  const ni = rule.needs_installing;
  const said = ni && extItems?.length ? str(extItems[0].attributes?.[ni.attr]?.value) : "";
  const reason = ni && extItems?.length ? str(extItems[0].attributes?.[ni.reason_attr]?.value) : "";
  const qty = (r: number) => { const v = ctx.rowQuantities?.[r]; return typeof v === "number" && Number.isFinite(v) ? v : null; };
  return scopeRuleOf({
    rule, values: { both: sc.options[0], supply: sc.supply_only, install: sc.install_only }, row: ctx.excelRow, own,
    heading: (ctx.headings ?? [])[(ctx.headings ?? []).length - 1] ?? "", family, lines: ctx.sheetLines,
    catOf: (r) => ctx.sheetCategories?.[r] ?? rowCats?.get(r) ?? null, qtyOf: qty, category, threshold: inputFactor(items, rule.threshold_input),
    existingKind: kind ? kind.id : null, needsNo: ni && said === ni.no && reason !== "" && reason !== "None" ? { reason } : null,
  });
}

/** PURE. An installation row's model items as the rule prices them: each box item becomes the installation item (`install_family`, scope
 *  Installation only); every other item (a thermostat the row names) stays. */
export function installRowItems<T extends RuleItem>(spec: RuleSpec, extItems: readonly T[]): T[] {
  const rule = spec.scope?.rule, fa = spec.family_attribute_id ?? "item", ma = spec.scope?.model_attr ?? "scope";
  if (!rule) return [...extItems];
  return extItems.map((it) => {
    const f = typeof it.attributes?.[fa]?.value === "string" ? String(it.attributes?.[fa]?.value).trim() : "";
    if (!rule.box_families.includes(f)) return it;
    // as the existing-box rule prices its installation item (pricingSheetHelper.vavSheetRules)
    return { ...it, attributes: { [fa]: { value: rule.install_family, confidence: 1 }, ...(spec.no_sku_named_by ? { [spec.no_sku_named_by]: { value: rule.install_family, confidence: 1 } } : {}),
      [ma]: { value: spec.scope!.install_only, confidence: 1 } } } as T;
  });
}

/** VAV-2c3 (R5 F4): the texts an installation row words for itself -- the sheet's blank box rows, the integrator cabling a separate row
 *  prices, and the share block's "per box" labels (true on a box row, out of place on an installation row: VAV-2c2 review F4). */
export const INSTALL_ROW_TEXT_PATHS = ["sheet_shares.lines.blank_rows", "integrator_cabling.lines.priced_separately", "sheet_shares.labels.per_box",
  "sheet_shares.labels.typed"] as const;

/** PURE. The pricing spec an INSTALLATION row is priced with: `spec` with each `scope.rule.install_row_texts` text in place of the text at
 *  its path (only INSTALL_ROW_TEXT_PATHS, only where the spec holds a text there). No text declared => `spec` itself, untouched. Texts only:
 *  every figure, rule and item stays the box rows'. */
export function installRowSpec<T>(spec: T): T {
  const texts = (spec as { scope?: { rule?: { install_row_texts?: Record<string, string> } } }).scope?.rule?.install_row_texts;
  if (!texts) return spec;
  const out = structuredClone(spec) as unknown as Record<string, unknown>;
  for (const path of INSTALL_ROW_TEXT_PATHS) {
    const t = texts[path];
    if (typeof t !== "string") continue;
    const keys = path.split(".");
    let node = out as Record<string, unknown> | undefined;
    for (const k of keys.slice(0, -1)) node = node?.[k] as Record<string, unknown> | undefined;
    const last = keys[keys.length - 1];
    if (node && typeof node[last] === "string") node[last] = t;
  }
  return out as unknown as T;
}
