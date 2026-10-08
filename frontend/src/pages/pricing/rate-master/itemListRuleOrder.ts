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
       classes.length ? "a row with no unit, or a rate-only unit (R/O, QRO), is priced in the item's own unit and says so; a row stating several units refuses, naming them" : ""]
        .filter(Boolean).join("; ") || undefined);

  // ── 2. the kind ───────────────────────────────────────────────────────────────────────────────────
  const fams = Object.keys(pr.families ?? {});
  const aliases = Object.keys(pr.family_alias ?? {});
  add("The item's own kind decides which products can price it",
      [fams.length ? `${fams.length} kind${fams.length === 1 ? "" : "s"} in the catalogue` : "",
       aliases.length ? `${list(aliases, 3)} price as another kind` : ""]
        .filter(Boolean).join("; ") || undefined);

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
  const um = pr.unstocked_materials;
  if (um && Array.isArray(um.words) && um.words.length) {
    add("A material the catalogue does not stock refuses by name, whatever kind was picked",
        `${quoteList(um.words, 12)} in the row's own text${um.from_attr ? ` or in the ${name(String(um.from_attr))}` : ""}`);
  }

  // ── 3. the rule for the unit, the facts it needs ──────────────────────────────────────────────────
  add("That kind's rule for that unit",
      "a kind priced per metre and per square metre has a rule for each");
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
  for (const [attr, rd] of Object.entries<any>(pr.numbers ?? {})) {
    if (rd?.several === "highest") {
      add(`Several ${name(attr)} values stated take the highest`,
          "a bare slash list ('19 / 25 / 32'); a size range ('25 to 50'), a comma list and a tolerance ('25 +/- 2') still refuse");
    }
    if (rd?.inches) add(`A ${name(attr)} written in inches is converted to millimetres`, "a bare fraction (7/8\") is read as inches on this reader");
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
  }
  for (const r of (pr.read_notes ?? []) as any[]) {
    if (!r?.line) continue;
    add(`A ${list((r.families ?? []).map(famWord), 2)} row stating its own figure in the ${name(String(r.from_attr ?? ""))} carries a line saying what was priced`,
        `'${String(r.line).replace("{match}", "<the stated figure>")}'${r.unless ? ` (not when the figure is ${String(r.unless)})` : ""}`);
  }

  // ── 7. fitting the sizes ──────────────────────────────────────────────────────────────────────────
  const ladders: string[] = (pr.ladders ?? []).map(String);
  for (const a of ladders) {
    const bits = ["the stated size, else the next size the catalogue stocks"];
    if (pr.size_match?.dp?.length) bits.push("the same size written to a different precision counts as that size");
    if (a === composed) {
      bits.push(`above the largest stocked size, built from ${pr.compose.max_layers} or fewer layers`
                + ` within ${pr.compose.tolerance} -- the fewest layers, then the closest, then the cheapest, all at one ${ladders.filter((x) => x !== composed).map(name).join(" / ") || "size"}`);
    } else {
      bits.push("above the largest stocked size refuses, naming the size");
    }
    add(`Fitting the stated ${name(a)} to the catalogue`, bits.join("; "));
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
  return out;
}
