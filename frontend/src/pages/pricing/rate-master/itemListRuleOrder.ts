/**
 * SLICE 12c, ACCEPTANCE 5 / U10 -- WHAT AN ITEM-LIST CATEGORY'S RULES ARE, IN THE ORDER THEY RUN.
 *
 * The Derivation tab renders `config.pipelines`, and an ITEM-LIST category's pipelines live inside
 * `list_spec` -- so for such a category the tab showed the configurator, "No rules configured for this
 * category", and blank space, while the category in fact carried a complete rule set.
 *
 * ⚠️ PRICING A ROW IS NOT "RUN A PIPELINE" HERE. `priceItemList` resolves the unit class, the family,
 * the block, the facts it needs, the defaults, the ladders and the conversions FIRST, and only then runs
 * the pipeline that combination selects. A reader looking at pipeline steps alone cannot see any of
 * that, which is why this describes the whole order rather than just the steps.
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

/**
 * The resolution order for a category that prices a row as a LIST OF ITEMS, or [] for one that does
 * not. Every line that can name a concrete fact from the config does; a line whose mechanism the
 * category does not use is OMITTED rather than shown as "none", so the list is what this category
 * actually does.
 */
export function itemListRuleOrder(config: unknown): RuleOrderLine[] {
  const pr = (config as any)?.list_spec?.pricing;
  if (!pr || typeof pr !== "object") return [];

  const out: RuleOrderLine[] = [];
  const add = (title: string, detail?: string) => out.push({ n: out.length + 1, title, detail });

  const classes = Object.keys(pr.unit_classes ?? {});
  const factors = Object.keys(pr.unit_factors ?? {});
  add("The row's unit decides which kind of rate applies",
      [classes.length ? `the units it knows: ${list(classes)}` : "",
       factors.length ? `${list(factors, 4)} convert to the catalogue's own unit` : ""]
        .filter(Boolean).join("; ") || undefined);

  const fams = Object.keys(pr.families ?? {});
  const aliases = Object.keys(pr.family_alias ?? {});
  add("The item's own kind decides which products can price it",
      [fams.length ? `${fams.length} kind${fams.length === 1 ? "" : "s"} in the catalogue` : "",
       aliases.length ? `${list(aliases, 3)} price as another kind` : ""]
        .filter(Boolean).join("; ") || undefined);

  add("That kind's rule for that unit",
      "a kind priced per metre and per square metre has a rule for each");

  const needs = new Set<string>();
  for (const f of Object.values<any>(pr.families ?? {})) {
    for (const k of f?.needs ?? []) needs.add(String(k));
    for (const u of Object.values<any>(f?.units ?? {})) for (const k of u?.needs ?? []) needs.add(String(k));
  }
  if (needs.size) {
    add("The facts that rule needs before it can price",
        `${list(Array.from(needs).sort())} -- the first one missing is what the row reports`);
  }

  const defaulted = [
    ...Object.keys(pr.defaults ?? {}),
    ...((pr.derive_when_none ?? []) as any[]).map((d) => String(d?.attr ?? "")).filter(Boolean),
  ];
  if (defaulted.length) {
    add("A fact the row does not mention takes its ruled value",
        `${list(Array.from(new Set(defaulted)).sort())} -- shown as assumed, never silently`);
  }
  const overrides = ((pr.override_when ?? []) as any[]).map((o) => String(o?.attr ?? "")).filter(Boolean);
  if (overrides.length) {
    add("A ruling that replaces a value the row DID state", list(Array.from(new Set(overrides)).sort()));
  }

  const ladders: string[] = (pr.ladders ?? []).map(String);
  const composed = pr.compose?.attr ? String(pr.compose.attr) : "";
  for (const a of ladders) {
    const name = pr.numbers?.[a]?.name ?? a;
    const bits = ["the stated size, else the next size the catalogue stocks"];
    if (pr.size_match?.dp?.length) bits.push("the same size written to a different precision counts as that size");
    if (a === composed) {
      bits.push(`above the largest stocked size, built from ${pr.compose.max_layers} or fewer layers`
                + ` within ${pr.compose.tolerance}`);
    }
    add(`Fitting the stated ${name} to the catalogue`, bits.join("; "));
  }

  const pipelineIds = new Set<string>();
  let hasRateRef = false;
  for (const f of Object.values<any>(pr.families ?? {})) {
    for (const u of Object.values<any>(f?.units ?? {})) {
      for (const [pid, pl] of Object.entries<any>(u?.pipelines ?? {})) {
        pipelineIds.add(pid);
        for (const st of pl?.steps ?? []) if (st?.step === "rate_ref") hasRateRef = true;
      }
    }
  }
  if (!pipelineIds.size) for (const pid of Object.keys((config as any)?.pipelines ?? {})) pipelineIds.add(pid);
  add("Then the priced steps below, in their own order",
      [pipelineIds.size ? list(Array.from(pipelineIds).sort()) : "",
       hasRateRef ? "the pricing inputs are read first" : ""].filter(Boolean).join("; ") || undefined);

  if (factors.length) add("The rate converts to the unit the row is written in");
  add("Multiplied by how many of the item one unit of the row pays for");
  return out;
}
