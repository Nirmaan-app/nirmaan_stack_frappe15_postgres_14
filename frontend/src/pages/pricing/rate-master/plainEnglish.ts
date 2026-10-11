/**
 * SLICE 12d-5 (owner P1 / P2, findings F-C5a / F-C5b) -- THE ONE PLAIN-ENGLISH FUNCTION.
 *
 * Every line a pricer reads on an item-list category -- the Derivation tab's rule list (12d-4c), the
 * rate-helper panel's default / override / note / refusal lines, the working lines, the calculator's
 * working -- passes through here, so no internal code (`R14`, `slice 11`, `(owner 2026-10-07)`) and no
 * internal name (`gi_sheet_rate`, `item_supply:`) reaches a screen. The config keeps its provenance tags;
 * they are dropped at RENDER, in one place.
 *
 * ⚠️ TWO THINGS LIVE HERE AND NOWHERE ELSE: `plainSentence` (the 12d-4c tag stripper, moved from
 * `itemListRuleOrder.ts`, which re-exports it) and `pricingInputLabel` (the 12d-4c label resolver). A
 * second copy of either is how one screen drifts from another.
 *
 * ⚠️ WHAT THIS MUST NOT TOUCH: values the pricing MATCHES on (family names, attribute values, option
 * values). It is applied to DISPLAY strings only -- the caller chooses the fields, never the whole view.
 */

/** An item as the label resolver needs it: the kind and the attributes (a `RateMasterItem` fits). */
export type PlainEnglishItem = { kind?: string; attributes?: Record<string, unknown> };

/** A config sentence as the pricer should read it: the trailing "(R4)" / "(owner ...)" tags dropped. */
export const plainSentence = (s: unknown): string =>
  String(s ?? "")
    .replace(/\s*\((?:R|D|T|S|Q)-?\d+[a-z]?(?:\s*\/\s*(?:R|D|T|S|Q)-?\d+[a-z]?)*\)/g, "")
    .replace(/\s*\(owner[^)]*\)/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();

/**
 * A Pricing Input named by its LABEL -- the `name` its Pricing Inputs row carries (`GI framework sheet
 * factor`), never its item id (`gi_framework_factor`). The label lives on the ITEM, so the caller passes the
 * discipline's items; with no items the id is written as plain words, so no internal name reaches the
 * screen on either path.
 */
export function pricingInputLabel(id: string, items: ReadonlyArray<PlainEnglishItem> = []): string {
  for (const it of items) {
    if (/_pricing_input$/.test(String(it?.kind ?? "")) && String(it?.attributes?.item ?? "") === id) {
      const nm = it.attributes?.name;
      if (typeof nm === "string" && nm.trim()) return nm.trim();
    }
  }
  return id.replace(/_/g, " ");
}

/** The Pricing Input ids the items declare, longest first so `gi_framework_factor` is replaced before `gi_framework`. */
function pricingInputIds(items: ReadonlyArray<PlainEnglishItem>): string[] {
  const ids = new Set<string>();
  for (const it of items) {
    if (/_pricing_input$/.test(String(it?.kind ?? ""))) {
      const id = String(it?.attributes?.item ?? "").trim();
      if (id) ids.add(id);
    }
  }
  return [...ids].sort((a, b) => b.length - a.length);
}

/**
 * SLICE 12e-2b (owner D3 + "a colon form", 2026-10-10) -- ONE FACT OF AN ITEM, IN WORDS.
 *
 * `label` is the field's own label (a choice definition's label, a number reader's name), `value` the value
 * on the item. A with / without value reads before its label ("without damper"); every other fact reads
 * "<label> <value>" ("UL listed no", "width 600"). The label's first letter is lowered unless its first word
 * is all capitals ("Damper" -> "damper", "UL listed" kept). No category, family or attribute is named: the
 * only words tested are the VALUE words "with" / "without", which is English grammar, not catalogue data.
 */
export interface PlainFact { label: string; value: string | number; twoWay?: boolean }

const lowerLabel = (label: string): string => {
  const s = String(label ?? "").trim();
  const first = s.split(/\s+/)[0] ?? "";
  if (first !== "" && first === first.toUpperCase() && /[A-Z]/.test(first)) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
};

export function plainFact(fact: PlainFact): string {
  const value = String(fact.value).trim();
  const label = lowerLabel(fact.label);
  return /^(with|without)$/i.test(value) ? `${value} ${label}` : `${label} ${value}`;
}

/**
 * SLICE 12e-2b (owner D3, Decision 1 "option a", Decision 2 "a colon form"): the sentence EVERY HVAC item-list
 * unstocked-combination refusal reads -- "No SKU for <family>: <facts> - price this row by hand", the two-way
 * facts first, the rest in the order given, comma-joined. Built from existing labels; no config key. A family
 * with no fact to name reads "No SKU for <family> - price this row by hand".
 */
export function noSkuSentence(family: string, facts: readonly PlainFact[]): string {
  const ordered = [...facts.filter((f) => f.twoWay), ...facts.filter((f) => !f.twoWay)];
  const body = ordered.map(plainFact).join(", ");
  return `No SKU for ${String(family).trim()}${body ? `: ${body}` : ""} - price this row by hand`;
}

/**
 * SLICE 12e-3a (owner Q6, 2026-10-11): A MIRRORED VALUE WAS NOT TYPED. A delegated section's mirrored field
 * holds a value the pricer never entered there, so the delegated category's own line -- "You typed 15.875 mm
 * -> priced as 15.88 mm ..." -- opens with the section's own tag instead: "From pipe: 15.875 mm -> priced as
 * 15.88 mm ...". ONLY the lead changes; everything after it is the delegated category's line, byte for byte.
 * `tag` is the config's (`mirror.tag`, "from pipe"). A line that does not open "You typed " comes back as is.
 */
export const TYPED_LEAD = "You typed ";
export function mirroredLead(line: string, tag: string): string {
  if (!line.startsWith(TYPED_LEAD)) return line;
  const t = String(tag ?? "").trim();
  if (t === "") return line;
  return `${t.charAt(0).toUpperCase()}${t.slice(1)}: ${line.slice(TYPED_LEAD.length)}`;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A code token: `R14`, `D9b`, `T1`, `S6`, `Q8`, or `slice 11`. */
const CODE_TOKEN = String.raw`(?:(?:R|D|T|S|Q)-?\d+[a-z]?|slice \d+)`;
/** A run of code tokens joined by " / ": `R5 / R14 / slice 11`. */
const CODE_RUN = String.raw`${CODE_TOKEN}(?:\s*\/\s*${CODE_TOKEN})*`;

/**
 * A pricer-facing line in plain English:
 *   - a leading pipeline id (`item_supply:`) is written as words (`item supply:`);
 *   - every Pricing Input id the items declare is replaced by its label (an undeclared one by its words);
 *   - the trailing `(R15)` / `(owner ...)` tags are dropped (`plainSentence`);
 *   - a code run at the START of a sentence or clause (`R14 / slice 11 VCD = ...`, `(R14 / S6 UL not
 *     mentioned ...`) is dropped, and a code after a comma inside a bracket (`(next size up, R6)`) too.
 * Idempotent: a line already in plain English comes back byte-identical, its indentation included.
 */
export function plainPricerText(text: unknown, items: ReadonlyArray<PlainEnglishItem> = []): string {
  const raw = String(text ?? "");
  if (!raw) return raw;
  // a working line's INDENTATION is layout (a layer's steps sit under their layer line): kept byte-for-byte
  const lead = raw.match(/^\s*/)![0];
  let s = raw.slice(lead.length);
  s = s.replace(/^([A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+):/, (_m, id: string) => `${id.replace(/_/g, " ")}:`);
  for (const id of pricingInputIds(items)) {
    s = s.replace(new RegExp(String.raw`\b${escapeRe(id)}\b`, "g"), pricingInputLabel(id, items));
  }
  // a Pricing Input the items do not carry (no items loaded yet): its id written as plain words, never bare
  s = s.replace(/pricing input: ([A-Za-z0-9]+(?:_[A-Za-z0-9]+)+)/g, (_m, id: string) => `pricing input: ${id.replace(/_/g, " ")}`);
  s = plainSentence(s);
  s = s.replace(new RegExp(String.raw`,\s*${CODE_RUN}(?=\))`, "g"), "");
  s = s.replace(new RegExp(String.raw`(^|\(|;\s*)${CODE_RUN}\s+(?=\S)`, "g"), "$1");
  // nothing else is normalised: a family name may carry a leading space (' Fiberglass Rigid Board ...') and keeps it
  return lead + s.trimEnd();
}
