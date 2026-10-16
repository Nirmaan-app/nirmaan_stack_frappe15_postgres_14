/**
 * SLICE 12c, ACCEPTANCE 5 / U10 -- WHAT AN ITEM-LIST CATEGORY'S RULES ARE, IN THE ORDER THEY RUN.
 * SLICE 12d-4c (owner C5, finding F6): EVERY rule the config declares is listed, not only the mechanisms.
 *
 * The Derivation tab renders `config.pipelines`, and an ITEM-LIST category's pipelines live inside
 * `list_spec` -- so for such a category the tab showed the configurator, "No rules configured for this
 * category", and blank space, while the category in fact carried a complete rule set. 12c added the
 * resolution ORDER (unit class, kind, needs, defaults, ladders, composition, conversions) but named the
 * mechanisms only; 12d-4c makes each line say what the config actually rules -- the default VALUES, the
 * materials that refuse by name, the cladding words, the sheet families that refuse glass cloth, the
 * foil-on-a-pipe mapping, the density line, the derived cells -- in the order `priceOneItem` applies them.
 *
 * ⚠️ PRICING A ROW IS NOT "RUN A PIPELINE" HERE. `priceItemList` resolves the unit class, the family,
 * the block, the facts it needs, the defaults, the ladders and the conversions FIRST, and only then runs
 * the pipeline that combination selects. A reader looking at pipeline steps alone cannot see any of
 * that, which is why this describes the whole order rather than just the steps.
 *
 * ⚠️ DERIVED FROM THE CONFIG, NEVER A SECOND LIST. Every line is a TEMPLATE keyed on the PRESENCE of a
 * config key and filled with that key's own values (the owner's standing rule for the tab: "lists every
 * rule in the order it runs, in plain English"). A mechanism the category does not declare is OMITTED;
 * no category, attribute id or internal code ("R4", "D3") is written here -- attributes are named by their
 * definition LABEL, numbers by their reader NAME, and a config sentence's trailing "(R4)" / "(owner ...)"
 * tag is stripped before it reaches the screen.
 *
 * PURE and unit-tested, so the tab stays thin over it (ADR-0010 F4). It reads the CONFIG and names the
 * category's own vocabulary -- no category is named here, and a config with no `list_spec` yields [],
 * which is what keeps every Electrical tab byte-identical.
 */

/** One line of the order: a short title and, where the config has something concrete to say, a detail. */
export interface RuleOrderLine {
  n: number;
  title: string;
  detail?: string;
}

const list = (xs: readonly string[], max = 6): string =>
  xs.length <= max ? xs.join(", ") : `${xs.slice(0, max).join(", ")} and ${xs.length - max} more`;

const quoteList = (xs: readonly string[], max = 6): string => list(xs.map((x) => `'${x}'`), max);

/**
 * SLICE 12d-5: `plainSentence` and the Pricing-Input label resolver moved to `plainEnglish.ts` -- the ONE
 * plain-English function the panel and the calculator now share with this tab. Re-exported so every
 * 12d-4c caller and pin stands; do not copy either back here.
 */
import { plainSentence, pricingInputLabel } from "./plainEnglish";
export { plainSentence };

/**
 * The resolution order for a category that prices a row as a LIST OF ITEMS, or [] for one that does
 * not. Every line that can name a concrete fact from the config does; a line whose mechanism the
 * category does not use is OMITTED rather than shown as "none", so the list is what this category
 * actually does.
 */
/**
 * SLICE 12d-4c (owner, on approving 5d): a Pricing Input is named on the tab by its LABEL -- the `name` the
 * Pricing Inputs row carries (`GI framework sheet factor`), never its item id (`gi_framework_factor`). The
 * label lives on the ITEM, not in the config, so the caller passes the discipline's items (the SAME live
 * read the Derivation tab already holds); with no items the id is written as plain words, so no internal
 * name reaches the screen on either path.
 */
export type RuleOrderItem = { kind?: string; attributes?: Record<string, unknown> };

/**
 * SLICE 12d-5 (owner P1, finding F-C5a): whether the Derivation tab draws the "Rules" card -- the EXTRACTION
 * rules (`config.rules`, the owner-authored estimator guidance the prompt receives). An item-list category
 * keeps its rules inside `list_spec` and lists them in "How a row is priced", so beneath that list an empty
 * "No rules configured" card read as a contradiction. Decided by the CONFIG, never by a category name: the
 * card is hidden iff the category prices as a list of items (a `list_spec` is present) AND declares no
 * extraction rules; a category that carries rules keeps its card whatever its shape, and every
 * non-item-list category (Electrical) keeps its empty state exactly as before.
 */
export function extractionRulesCardShown(config: unknown): boolean {
  const c = config as any;
  const rules = Array.isArray(c?.rules) ? c.rules : [];
  const itemList = !!(c?.list_spec && typeof c.list_spec === "object");
  return rules.length > 0 || !itemList;
}

export function itemListRuleOrder(config: unknown, items: ReadonlyArray<RuleOrderItem> = []): RuleOrderLine[] {
  const inputLabel = (id: string): string => pricingInputLabel(id, items);
  const ls = (config as any)?.list_spec;
  const pr = ls?.pricing;
  if (!pr || typeof pr !== "object") return [];

  const out: RuleOrderLine[] = [];
  const add = (title: string, detail?: string) => out.push({ n: out.length + 1, title, detail });

  // the category's own words for its attributes and numbers -- never an id on screen
  const labels: Record<string, string> = {};
  for (const d of (ls?.attribute_definitions ?? []) as any[]) if (d?.id) labels[String(d.id)] = String(d.label ?? d.id);
  const name = (attr: string): string => {
    const n = pr.numbers?.[attr]?.name;
    if (n) return String(n);
    const l = labels[attr];
    if (!l) return attr.replace(/_/g, " ");
    const bare = l.replace(/\s*\(.*\)\s*$/, "");
    // a Title-cased label reads as a word mid-sentence ("Cladding" -> "cladding"); an acronym keeps its case ("UL listed")
    return /^[A-Z][a-z]/.test(bare) ? bare.charAt(0).toLowerCase() + bare.slice(1) : bare;
  };
  const famWord = (f: string) => String(f).trim();

  // ── 1. the row's unit ──────────────────────────────────────────────────────────────────────────────
  const classes = Object.keys(pr.unit_classes ?? {});
  const factors = Object.keys(pr.unit_factors ?? {});
  add("The row's unit decides which kind of rate applies",
      [classes.length ? `the units it knows: ${list(classes)}` : "",
       factors.length ? `${list(factors, 4)} convert to the catalogue's own unit` : "",
       classes.length ? "a row with no unit, or a rate-only unit (R/O, QRO), is priced in the item's own unit and says so; a row stating several units refuses, naming them" : "",
       // SLICE 12e-2 (owner Q19 / C2): the configured refusal for any other unit, in its own words
       typeof pr.unit_refusal === "string" && pr.unit_refusal.trim() ? `any other unit refuses: ${plainSentence(String(pr.unit_refusal).replace("{unit}", "nos"))}` : ""]
        .filter(Boolean).join("; ") || undefined);

  // ── 2. the kind ───────────────────────────────────────────────────────────────────────────────────
  const fams = Object.keys(pr.families ?? {});
  const aliases = Object.keys(pr.family_alias ?? {});
  add("The item's own kind decides which products can price it",
      [fams.length ? `${fams.length} kind${fams.length === 1 ? "" : "s"} in the catalogue` : "",
       aliases.length ? `${list(aliases, 3)} price as another kind` : ""]
        .filter(Boolean).join("; ") || undefined);

  // ── 2b. SLICE 12e-2 (owner Q16 / Q15 / Q18): a kind written as the BoQ writes it ─────────────────
  const famAttrId = String(ls?.family_attribute_id ?? "family");
  const ft = pr.family_text;
  if (ft && typeof ft === "object") {
    const maps = ((ft.map ?? []) as any[]).filter((m) => m?.from && m?.to);
    if (maps.length) {
      add(`A ${name(famAttrId)} written as ${list(maps.map((m) => String(m.from)), 4)} is priced as the kind it means`,
          `${list(maps.map((m) => `${String(m.from)} -> ${famWord(String(m.to))}`), 4)} -- with a line saying so`);
    }
    const refuses = ((ft.refuse ?? []) as any[]).filter((r) => r?.from && r?.refuse);
    add(`A ${name(famAttrId)} the catalogue does not stock refuses by name`,
        [...refuses.map((r) => `${String(r.from)}: ${plainSentence(r.refuse)}`), "any other spelling: no SKU in the catalogue for it -- the pricer decides"].join("; "));
    if (ft.from_row && typeof ft.from_row === "object" && ft.from_row.refuse) {
      add(`A row naming one ${name(famAttrId)} prices as it; two different ones with none chosen refuse`,
          `the names in the row's own text, read through the same map; ${plainSentence(String(ft.from_row.refuse).replace("{types}", "the names found"))}`);
      // SLICE 12e-6 (owner R2, amended 2026-10-16 14:22; U9): ADDED -- the line above keeps its words
      add(`One ${name(famAttrId)} written as two stocked kinds prices one of them`,
          "CPVC named with PVC or uPVC prices as CPVC; any other two stocked kinds price the lower cost for the row's size -- with a line saying so; the pricer can change it");
    }
    // SLICE 12e-4b (owner D-3; decisions 2 / 3 / 7): the family as the BoQ writes it, where the config names
    // the attribute that carries it
    if (typeof ft.from_attr === "string" && ft.from_attr.trim()) {
      const asWritten = labels[String(ft.from_attr)] ?? String(ft.from_attr).replace(/_/g, " ");
      add(`A ${name(famAttrId)} left unanswered is read from '${asWritten}'`,
          [`the BoQ's own word, from the row or else its headings, read exactly as the same word typed in the ${name(famAttrId)} box`,
           `a word naming several kinds prices as the one they all mean and refuses when they differ`,
           `an answered ${name(famAttrId)} always wins over it`,
           `shown read-only, and only where it differs from the kind priced`].join("; "));
      // SLICE 12e-6b (owner R1, 2026-10-16 23:43 IST; owner U9 precedent): ADDED -- the lines above keep their words
      if (pr.families?.CPVC) {
        add(`A drain pipe whose material the BoQ does not name prices as CPVC`,
            "a pipe the row or a heading calls a drain (drain, drainage, condensate) with no type told and no pipe material named -- in amber: 'drain pipe, no material stated -> priced as CPVC'; a material the BoQ names keeps its rule; the pricer can change it");
      }
    }
  }

  const fwn = pr.family_when_none;
  if (fwn && typeof fwn === "object") {
    const byClass = Object.entries<any>(fwn.by_unit_class ?? {}).map(([cls, f]) => `per ${pr.unit_words?.[cls] ?? cls}: ${famWord(f)}`);
    const byWords = ((fwn.when_words ?? []) as any[]).map((w) => `${quoteList(w.words ?? [], 4)} in the row or its headings${w.unit_class ? ` (per ${pr.unit_words?.[w.unit_class] ?? w.unit_class})` : ""}: ${famWord(w.family)}`);
    add("A row that names no material takes the kind its row implies",
        [...byClass, ...byWords].join("; ") + " -- shown as assumed, never silently");
  }
  const noSku: string[] = (pr.no_sku_families ?? []).map(String);
  if (noSku.length) {
    const by = pr.no_sku_named_by ? `, naming the material as the row wrote it` : "";
    add("A material the model could not match to any kind refuses",
        `the kind ${quoteList(noSku)} is a refusal for a person${by}`);
  }
  // SLICE 12e-6 (AC2; U9): ADDED
  if (noSku.length && fwn && typeof fwn === "object") {
    add(`A ${quoteList(noSku)} answer where the BoQ names no material takes the kind its row implies`,
        "nothing copied as the material and no unstocked material in the row or its headings -- shown as assumed; a material the BoQ names keeps the refusal");
  }
  const um = pr.unstocked_materials;
  if (um && Array.isArray(um.words) && um.words.length) {
    add("A material the catalogue does not stock refuses by name, whatever kind was picked",
        `${quoteList(um.words, 12)} in the row's own text${um.from_attr ? ` or in the ${name(String(um.from_attr))}` : ""}`);
    // SLICE 12e-6 (owner R1 / R3 / R5 / R8; U9): ADDED
    if (pr.no_sku_named_by) {
      add("A material written with an alternative prices the stocked one",
          "an unstocked material beside a stocked one ('nitrile rubber/XLPE', 'rockwool/glasswool') prices the stocked one; two stocked ones ('open-cell acoustic foam / fiberglass board') price the lower cost -- with a line saying so");
    }
    add("Cross-linked polyethylene, XPE, FR-XPE and a co-extruded jacket or covering are XLPE and refuse by name",
        "before closed cell polyethylene could be read as nitrile: 'No SKU in the catalogue for <the words as written> - price this row by hand'");
  }

  // ── 3. the rule for the unit, the facts it needs ──────────────────────────────────────────────────
  // SLICE 12e-2b (12e-2 cert finding 6, AC7): the unit words come from the config's own unit classes. A
  // category priced in ONE class (Piping: per metre) never reads "per square metre"; a category with several
  // keeps the sentence it has always had, byte for byte.
  add("That kind's rule for that unit",
      classes.length === 1
        ? "a kind is priced per " + String(pr.unit_words?.[classes[0]] ?? classes[0]) + " and has one rule for it"
        : "a kind priced per metre and per square metre has a rule for each");
  // SLICE 12e-6 (AC5; U9): ADDED
  const byKind = Object.entries<any>(fwn?.by_unit_class ?? {});
  if (byKind.length >= 2) {
    add("A row-kind material on the other row kind prices as the one for the row's unit",
        `${byKind.map(([cls, f]) => `per ${pr.unit_words?.[cls] ?? cls}: ${famWord(f)}`).join("; ")} -- with a line saying so ('priced as ... (row is per ...)')`);
  }
  const notOffered: string[] = [];
  for (const [f, fv] of Object.entries<any>(pr.families ?? {})) {
    for (const u of fv?.units_not_offered ?? []) notOffered.push(`${famWord(f)} is not offered per ${pr.unit_words?.[u] ?? u}`);
  }
  if (notOffered.length) add("A kind the catalogue does not price in the row's unit", list(notOffered, 4));

  const needs = new Set<string>();
  for (const f of Object.values<any>(pr.families ?? {})) {
    for (const k of f?.needs ?? []) needs.add(String(k));
    for (const u of Object.values<any>(f?.units ?? {})) for (const k of u?.needs ?? []) needs.add(String(k));
  }
  if (needs.size) {
    add("The facts that rule needs before it can price",
        `${list(Array.from(needs).sort().map(name))} -- the first one missing is what the row reports`);
  }

  // ── 4. how the facts are read ─────────────────────────────────────────────────────────────────────
  const composed = pr.compose?.attr ? String(pr.compose.attr) : "";
  if (composed) {
    const outer = pr.compose.outer_only?.attr
      ? `, the ${name(String(pr.compose.outer_only.attr))} on the outer layer only`
      : "";
    add(`A ${name(composed)} the model writes as layers is priced as those layers`,
        `'a + b', 'a x 2', '2 layers of a', 'a mm - 2 layers', 'double layer of a' -- each layer at the row's own size${outer}; a value the pricer types is never read as layers`);
  }
  // SLICE 12e-6 (owner R7: "mm = NB and NB = mm"; U9): ADDED
  const os = pr.compose?.outer_surface;
  if (os?.pipe) {
    add(`A ${name(String(os.pipe))} in mm or NB is one size: the cladding is measured on the matched size`,
        "'50 mm', '50 mm dia', '50 NB' and '50 mm NB' are the same size; only an outside diameter -- written OD / O.D. / outer dia, an inch size, or a copper, refrigerant, VRF or VRV pipe -- is measured as read");
  }
  for (const [attr, rd] of Object.entries<any>(pr.numbers ?? {})) {
    if (rd?.several === "highest") {
      // SLICE 12d-8 (owner R5): the wording follows the code -- a range is read as its TOP value, not refused
      add(`Several ${name(attr)} values stated take the highest`,
          "a bare slash list ('19 / 25 / 32'); a size range ('25 to 50') takes its top value; a comma list and a tolerance ('25 +/- 2') still refuse");
      // SLICE 12e-6 (owner R10; U9): ADDED
      add(`A ${name(attr)} range takes the higher value`, "'25-50 mm' or '25 to 50' prices 50, with a line saying 'states a range - the higher, 50, is taken'");
    }
    if (rd?.inches) {
      // SLICE 12e-2 (owner Q14): the second conversion, where the reader declares one
      const alt = typeof rd.inch_mm_alt === "number" ? `; converted at 25.4 ${rd.unit ?? "mm"} to the inch, then at ${rd.inch_mm_alt} where the first lands on no stocked size` : "";
      add(`A ${name(attr)} written in inches is converted to millimetres`, `a bare fraction (7/8") is read as inches on this reader${alt}`);
    }
    // SLICE 12e-2 (owner P2): a typed entry on this axis is ONE size
    if (rd?.typed_entry === "one_size") {
      add(`A typed ${name(attr)} is one size, in ${rd.unit ?? "mm"} or inches`,
          // SLICE 12e-3b (owner 2026-10-11): two or more sizes price the higher / highest (REPLACES "refuses naming the two sizes")
          "a number (an NB number is mm) or an inch size (5/8\", 1-1/4\", 2 inch); 'two inch' and '40-50' refuse: Type one pipe size, in mm or inches; two or more sizes written with a slash take the higher ('25/32' prices 32, '25/32/40' prices 40, 1\"/2\" prices 2\"), typed or read from the BoQ, with a line saying so; a slash is an inch fraction only when its top number is 16 or less and its bottom is 2, 4, 8, 16, 32 or 64");
    }
  }

  // ── 5. the defaults (what is assumed) ─────────────────────────────────────────────────────────────
  const defaultLines: string[] = [];
  for (const [attr, d] of Object.entries<any>(pr.defaults ?? {})) {
    if (d && typeof d === "object" && d.value !== undefined) defaultLines.push(`${name(attr)} not mentioned -> ${String(d.value)}`);
    else if (d && typeof d === "object" && d.by_family) defaultLines.push(`${name(attr)} not mentioned -> by kind (${list(Object.entries<any>(d.by_family).map(([f, v]) => `${famWord(f)}: ${String(v)}`), 3)})`);
    else if (d && typeof d === "object") defaultLines.push(`${name(attr)} not mentioned -> its ruled value`);
  }
  for (const [attr, d] of Object.entries<any>(pr.number_defaults ?? {})) {
    if (d && d.value !== undefined) defaultLines.push(`${name(attr)} not mentioned at all -> ${String(d.value)} mm, then the ladder; a ${name(attr)} the row itself states always wins, over a heading's too`);
  }
  for (const d of (pr.derive_when_none ?? []) as any[]) {
    if (d?.attr) defaultLines.push(`${name(String(d.attr))} not mentioned on ${list((d.families ?? []).map(famWord), 3)} when ${d.when?.attr ? name(String(d.when.attr)) : "a fact"} is ${String(d.when?.equals ?? "stated")} -> ${String(d.then)}`);
  }
  if (defaultLines.length) {
    add("A fact the row does not mention takes its ruled value",
        `${list(defaultLines, 6)} -- shown as assumed, never silently`);
  }
  const overrides = ((pr.override_when ?? []) as any[]).filter((o) => o?.attr);
  if (overrides.length) {
    add("A ruling that replaces a value the row DID state",
        list(overrides.map((o) => `${name(String(o.attr))} on ${list((o.families ?? []).map(famWord), 3)} becomes ${String(o.display ?? o.then)} when ${o.when?.attr ? name(String(o.when.attr)) : "a fact"} is ${String(o.when?.equals ?? "stated")}`), 4));
  }

  // ── 6. a stated value mapped or refused ───────────────────────────────────────────────────────────
  for (const m of (pr.value_map ?? []) as any[]) {
    if (!m?.attr) continue;
    const where = `${String(m.from)} as the ${name(String(m.attr))} on ${list((m.families ?? []).map(famWord), 3)}`;
    if (m.to !== undefined) add(`${where} is priced as ${String(m.display ?? m.to)}`);
    else if (m.refuse) add(`${where} refuses`, plainSentence(m.refuse));
  }
  for (const r of (pr.refuse_on_unit_class ?? []) as any[]) {
    if (!r?.attr) continue;
    const unitWord = pr.unit_words?.[r.unit_class] ?? r.unit_class;
    const words = Array.isArray(r.words) && r.words.length ? `; the same when the model read no ${name(String(r.attr))} but the row's own words say ${quoteList(r.words, 4)}` : "";
    add(`${String(r.value_contains)} as the ${name(String(r.attr))} on a per-${unitWord} row of ${list((r.families ?? []).map(famWord), 3)} refuses`,
        `${plainSentence(r.refuse)}${words}`);
  }
  for (const r of (pr.named_in_row ?? []) as any[]) {
    if (!r?.attr) continue;
    add(`A ${name(String(r.attr))} named in the row's own text but read as not mentioned refuses`,
        `${plainSentence(r.refuse)} -- the words: ${quoteList(r.words ?? [], 8)}; a heading never triggers it`);
    // SLICE 12e-6 (AC4; U9): ADDED
    add(`Fixings and duct material in the row are not a ${name(String(r.attr))}`,
        "GI strip, GI grid, a 'C' shape GI frame, GI bolts, clamps, channels, angles and an aluminium or GI duct never trigger the line above");
  }
  // SLICE 12e-6 (owner R4; U9): ADDED
  for (const c of (pr.choice_text ?? []) as any[]) {
    if (!c?.attr) continue;
    add(`A ${name(String(c.attr))} written as a coating with no glass cloth refuses by name`,
        `polyshield, fire retardant or protective coating, a paint: 'No SKU in the catalogue for <the coating as written> - price this row by hand'; a ${name(String(c.attr))} the model answered stands`);
  }
  for (const r of (pr.read_notes ?? []) as any[]) {
    if (!r?.line) continue;
    add(`A ${list((r.families ?? []).map(famWord), 2)} row stating its own figure in the ${name(String(r.from_attr ?? ""))} carries a line saying what was priced`,
        `'${String(r.line).replace("{match}", "<the stated figure>").replace("{family}", (r.families ?? []).map(famWord).join(" / "))}'${r.unless ? ` (not when the figure is ${String(r.unless)})` : ""}`);
  }

  // ── 6b. a second key beside the primary size ─────────────────────────────────────────────────────
  // SLICE 12d-8 (owner R6): the square diffuser's OUTER size (`second_key`, A-4 / A-5) executes on real rows
  // and had no line. Generated from the key's own words, in the order `priceOneItem` applies it.
  for (const sk of (pr.second_key ?? []) as any[]) {
    if (!sk?.primary || !sk?.name) continue;
    add(`A stated ${String(sk.name)} is matched beside the ${name(String(sk.primary))} on ${list((sk.families ?? []).map(famWord), 3)}`,
        `both stated: the ${String(sk.name)} narrows the products the ${name(String(sk.primary))} then fits; `
        + `${String(sk.name)} only: the one product behind it is used as it stands, else the largest ${name(String(sk.primary))} behind it; `
        + `an ${String(sk.name)} the catalogue does not stock is set aside and the ${name(String(sk.primary))} prices the row`
        + (Array.isArray(sk.alt_key) && sk.alt_key.length ? `; the catalogue's alternative wording of the same size counts as that size` : ""));
  }

  // ── 7. fitting the sizes ──────────────────────────────────────────────────────────────────────────
  const ladders: string[] = (pr.ladders ?? []).map(String);
  for (const a of ladders) {
    const bits = ["the stated size, else the next size the catalogue stocks"];
    if (pr.size_match?.dp?.length) bits.push("the same size written to a different precision counts as that size");
    // SLICE 12e-2 (owner Q14a / Q17): the two declared rungs, in the order the ladder tries them
    if (typeof pr.size_match?.near === "number") bits.push(`a size within ${pr.size_match.near} ${pr.numbers?.[a]?.unit ?? "mm"} of a stocked size counts as that size`);
    if (pr.size_match?.below_smallest === "smallest") bits.push("below the smallest stocked size takes the smallest");
    if (a === composed) {
      bits.push(`above the largest stocked size, built from ${pr.compose.max_layers} or fewer layers`
                + ` within ${pr.compose.tolerance} -- the fewest layers, then the closest, then the cheapest, all at one ${ladders.filter((x) => x !== composed).map(name).join(" / ") || "size"}`);
    } else {
      bits.push("above the largest stocked size refuses, naming the size");
    }
    add(`Fitting the stated ${name(a)} to the catalogue`, bits.join("; "));
    // SLICE 12e-4b (owner F-1): the nearest-size rule declared for THIS axis alone
    const axisNear = pr.numbers?.[a]?.near;
    if (typeof axisNear === "number") {
      const unit = String(pr.numbers?.[a]?.unit ?? "mm");
      add(`A ${name(a)} within ${axisNear} ${unit} of a stocked size counts as that size`,
          `with a line saying so: '${name(a)} <stated> is <stocked> on the sheet (within ${axisNear} ${unit})'; a size further away takes the next size the catalogue stocks, as before`);
    }
    // SLICE 12e-4b (owner F-3): a bare number that could be an inch size, on an axis that reads inches two ways
    // and rules below-the-smallest
    const inchAlt = pr.numbers?.[a]?.inch_mm_alt;
    if (typeof inchAlt === "number" && pr.size_match?.below_smallest === "smallest") {
      add(`A ${name(a)} written as a bare number that could be inches refuses`,
          [`a number with no unit, below the smallest stocked size, whose reading in inches (at 25.4 or ${inchAlt} ${String(pr.numbers?.[a]?.unit ?? "mm")} to the inch) falls within the stocked sizes: 'size <number> has no unit - price this row by hand'`,
           `the same number written with its unit ('1 inch', '1 mm') prices`,
           `a bare number that cannot be an inch size takes the smallest size, as before`].join("; "));
    }
  }

  // ── 8. the priced steps ───────────────────────────────────────────────────────────────────────────
  const pipelineIds = new Set<string>();
  const inputs = new Set<string>();
  const crossRow = new Set<string>();
  const computed = new Set<string>();
  const walk = (pl: any) => {
    for (const st of pl?.steps ?? []) {
      if (st?.step === "rate_ref" && st?.ref?.item) {
        // a Pricing Input (its kind ends in `_pricing_input`) is read first; a ref to ANOTHER catalogue row is a live cross-row read
        if (/_pricing_input$/.test(String(st.ref.kind ?? ""))) inputs.add(String(st.ref.item)); else crossRow.add(String(st.ref.item));
      }
      if (st?.step === "component" && st?.target && typeof st?.formula === "string" && st.formula.trim() !== "base" && st?.name) computed.add(String(st.name));
    }
  };
  for (const f of Object.values<any>(pr.families ?? {})) {
    for (const u of Object.values<any>(f?.units ?? {})) {
      for (const [pid, pl] of Object.entries<any>(u?.pipelines ?? {})) { pipelineIds.add(pid); walk(pl); }
    }
    for (const opts of Object.values<any>(f?.convert ?? {})) for (const o of opts ?? []) for (const [pid, pl] of Object.entries<any>(o?.pipelines ?? {})) { pipelineIds.add(pid); walk(pl); }
  }
  for (const pl of Object.values<any>(pr.default_pipelines ?? {})) walk(pl);
  if (!pipelineIds.size) for (const pid of Object.keys((config as any)?.pipelines ?? {})) pipelineIds.add(pid);
  add("Then the priced steps below, in their own order",
      [pipelineIds.size ? list(Array.from(pipelineIds).sort().map((p) => p.replace(/_/g, " "))) : "",
       inputs.size ? `the pricing inputs are read first (${list(Array.from(inputs).map(inputLabel).sort(), 8)})` : ""].filter(Boolean).join("; ") || undefined);
  if (crossRow.size) {
    add("A rate read live from another catalogue row", `${list(Array.from(crossRow).sort(), 4)} -- a change to that row's rate flows through`);
  }
  if (computed.size) {
    add("A cost the rules compute from the Pricing Inputs and the row's own geometry is shown greyed, never typed",
        `${list(Array.from(computed).sort(), 4)} -- a change to a Pricing Input moves it; the catalogue stores no figure for it`);
  }
  const derived = Object.keys((config as any)?.derived_rates ?? {});
  if (derived.length) {
    const cells = Object.values<any>((config as any).derived_rates).reduce((n: number, v: any) => n + Object.keys(v ?? {}).length, 0);
    add("A catalogue cell derived from another row's cell follows its base",
        `${cells} cell${cells === 1 ? "" : "s"} on ${derived.length} row${derived.length === 1 ? "" : "s"} (the grey 'derived' cells): editing the base row moves them; typing into them is refused`);
  }

  // ── 9. back to the row ────────────────────────────────────────────────────────────────────────────
  if (factors.length) add("The rate converts to the unit the row is written in");
  add("Multiplied by how many of the item one unit of the row pays for");

  // ── 10. SLICE 12e-3b (AC6): the sections another category prices (owner D1 / D1a / D3b / 13:40 / 13:42) ──
  // Each line is the section's own declaration in words: the toggle, whose rules price it, the kinds offered,
  // the mirror, the total. A config that declares no delegated section adds nothing.
  const sections = ((ls?.sections ?? []) as any[]).filter((sec) => sec && typeof sec === "object");
  const ownSec = sections.find((sec) => !sec.category_id);
  const ownWord = String(ownSec?.label ?? "item").toLowerCase();
  const delegated = sections.filter((sec) => sec.category_id);
  for (const sec of delegated) {
    const label = String(sec.label ?? sec.id);
    const low = label.toLowerCase();
    const inc = sec.include_when;
    if (inc?.attr) {
      add(`Each ${ownWord} says whether it has ${low}: ${labels[String(inc.attr)] ?? String(inc.attr)} ${String(inc.equals)} opens the ${low} section under that ${ownWord}`,
          [sec.absent?.line ? `${plainSentence(sec.absent.line)}, shown as assumed on a BoQ row` : "",
           `any other answer removes only that section`,
           sec.add_label ? `'${String(sec.add_label)}' adds a section that belongs to no ${ownWord}` : "",
           `in the calculator a section opens with nothing picked`].filter(Boolean).join("; "));
      // SLICE 12e-6 (AC3, owner D1b / D5b; U9): ADDED
      add(`${labels[String(inc.attr)] ?? String(inc.attr)} ${String(inc.equals)} with no ${low} facts opens the ${low} section on ${label}'s defaults`,
          "the material its row kind implies, the ruled thickness then the ladder, the cladding 'No' -- each shown as assumed with its line");
    }
    add(`The ${low} section is priced by ${label}'s rules`,
        [`its own catalogue, pricing inputs, defaults, ladders and refusals -- no rule of it is copied here`,
         Array.isArray(sec.families) && sec.families.length ? `the kinds offered: ${list(sec.families.map(famWord), 6)}` : ""].filter(Boolean).join("; "));
    if (sec.mirror?.from) {
      add(`The ${low} section takes the ${name(String(sec.mirror.from))} its ${ownWord} priced as`,
          [`shown '${String(sec.mirror.tag ?? "")}'`,
           `a ${ownWord} written as two sizes gives the one it priced`,
           sec.mirror.line ? `a size chosen in the section is kept and says so: '${String(sec.mirror.line).replace("{chosen}", "<chosen>").replace("{pipe}", `<${ownWord}>`)}'` : "",
           `a section that belongs to no ${ownWord} takes the first ${ownWord}'s`].filter(Boolean).join("; "));
    }
    // SLICE 12e-3c (owner F10, U6): a section that sits under an item takes that item's quantity
    if (inc?.attr) {
      add(`The ${low} section's quantity is its ${ownWord}'s until the pricer types their own`,
          [`shown '${String(sec.mirror?.tag ?? `from ${ownWord}`)}' and following the ${ownWord}'s box`,
           `a quantity typed in the section is kept`,
           `a section that belongs to no ${ownWord} keeps its own, 1 unless typed`].join("; "));
    }
  }
  if (delegated.length) {
    add(`The row total adds every ${ownWord} and every section`,
        "each line rounded by its own rules; one line that cannot price stops the row, and the count of lines that need a person is shown");
  }
  return out;
}
