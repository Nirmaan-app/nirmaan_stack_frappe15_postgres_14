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

/**
 * SLICE 12e-3b (block 38; owner 2026-10-12 "Strip them too") -- A RULE TAG WRITTEN WITH HYPHENS. The numbered
 * tags ("(R15)", "(D9b)") were always dropped; a tag spelled with a hyphen -- "(R-M-b)", "(R-M-c)" in the
 * config, "(A-4)", "(A-5)" written by the pricer's own code -- matched nothing and reached the screen. One
 * capital from the tag letters, then one or two hyphenated parts of at most two characters, in brackets. A
 * bracket that is not a tag ("(UL-555)", "(M-10)", "(W x H)") is left alone.
 */
export const HYPHEN_TAG = /\s*\((?:R|A|D|T|S|Q)(?:-[A-Za-z0-9]{1,2}){1,2}\)/g;

/**
 * ADP-4a (owner D4, 2026-10-21 "Yes"): the ADP-1 / ADP-2 rule names "H3" / "H4" / "H7" are codes like any other --
 * "H" joins the tag letters, and a bracket of codes joined by commas ("(S7, H4)") is a tag too. Measured before
 * this change: no Insulation, Piping or Electrical config sentence carries either form.
 */
const TAG = String.raw`(?:R|D|T|S|Q|H)-?\d+[a-z]?`;
const TAG_BRACKET = new RegExp(String.raw`\s*\(${TAG}(?:\s*[/,]\s*${TAG})*\)`, "g");

/** A config sentence as the pricer should read it: the trailing "(R4)" / "(R-M-b)" / "(owner ...)" tags dropped,
 *  and an H-code opening the sentence ("H4 per-number mixing box ...") with them. */
export const plainSentence = (s: unknown): string =>
  String(s ?? "")
    .replace(TAG_BRACKET, "")
    .replace(HYPHEN_TAG, "")
    .replace(/\s*\(owner[^)]*\)/gi, "")
    .replace(/^H\d+[a-z]?\s+(?=\S)/, "")
    .replace(/\s{2,}/g, " ")
    .trim();

/**
 * SLICE 12e-3b (owner Q13) -- THE STANDARD SPELLING OF A UNIT. A config writes a unit as a key ("nm"); a
 * pricer reads the unit ("Nm"). The table names units, never a category: a number followed by a unit written
 * all in lower case is given its standard spelling. A unit the BoQ wrote in its own capitals ("10 NM",
 * "N.m") is the BoQ's wording and is kept; a spelling that is already standard is untouched.
 */
export const UNIT_SPELLINGS: Readonly<Record<string, string>> = { nm: "Nm", mm: "mm", kg: "kg" };
export const unitSpellings = (s: string): string =>
  s.replace(/(\d\s?)([a-z]+)\b/g, (m, lead: string, unit: string) => {
    const std = Object.prototype.hasOwnProperty.call(UNIT_SPELLINGS, unit) ? UNIT_SPELLINGS[unit] : undefined;
    return std !== undefined && std !== unit ? `${lead}${std}` : m;
  });

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

/**
 * SLICE 12e-3c (owner F7 "fix"; block 38) -- A FIELD'S LABEL AS A WORD IN A SENTENCE. "Thickness (mm)" reads
 * "thickness": the trailing unit bracket is dropped and a Title-cased first letter is lowered; an acronym keeps
 * its case ("UL listed"). The same reading the Derivation tab gives a label.
 */
export function labelAsWord(label: string): string {
  const bare = String(label ?? "").replace(/\s*\(.*\)\s*$/, "").trim();
  return /^[A-Z][a-z]/.test(bare) ? bare.charAt(0).toLowerCase() + bare.slice(1) : bare;
}

/** A field id written with an underscore (`thickness_mm`) -- the only kind that can be told from a word. */
const isSnakeId = (id: string) => /^[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+$/.test(id);

/** How the pricer opens a default's working line after the field: "<field> not mentioned -> <value> (<rule>)". */
const NOT_MENTIONED_LEAD = " not mentioned -> ";

/**
 * SLICE 12e-4b (owner G2, 2026-10-12 "yes") -- NO WORKING LINE REPEATS ITSELF. The pricer writes a default as
 * "<field> not mentioned -> <value> (<rule>)", and the rule a config carries is usually that same statement
 * in the owner's words -- so the screen read "thickness not mentioned -> 9 (thickness not mentioned -> 9 mm,
 * then the ladder)". Where the bracketed rule is itself a "... not mentioned ..." statement, only what it
 * ADDS is kept:
 *   the rule's outcome extends the value   -> "thickness not mentioned -> 9 mm, then the ladder"
 *   the rule's outcome IS the value        -> "damper not mentioned -> without"
 *   the rule's outcome says something else -> "cladding not mentioned -> No (without cladding)"
 * A rule that is not such a statement ("VCD = GI rectangular; fire damper = without sleeve") is left as it
 * is, and so is every line of any other shape. Idempotent.
 */
export function onceOnly(line: string): string {
  const m = line.match(/^(.+?) not mentioned -> (.+?) \((.*\bnot mentioned\b.*)\)$/);
  if (!m) return line;
  const [, field, value, rule] = m;
  const said = rule.match(/\bnot mentioned\b(?:\s*\([^)]*\))?\s*(?:->|=)\s*(.+)$/);
  if (!said) return line;
  const outcome = said[1].trim();
  const v = value.trim();
  if (outcome.toLowerCase() === v.toLowerCase()) return `${field}${NOT_MENTIONED_LEAD}${v}`;
  if (outcome.toLowerCase().startsWith(v.toLowerCase()) && !/[A-Za-z0-9.]/.test(outcome.charAt(v.length))) return `${field}${NOT_MENTIONED_LEAD}${outcome}`;
  return `${field}${NOT_MENTIONED_LEAD}${v} (${outcome})`;
}

/** A code token: `R14`, `D9b`, `T1`, `S6`, `Q8`, `H4` (ADP-4a, owner D4), or `slice 11`. */
const CODE_TOKEN = String.raw`(?:(?:R|D|T|S|Q|H)-?\d+[a-z]?|slice \d+)`;
/** A run of code tokens joined by " / ": `R5 / R14 / slice 11`. */
const CODE_RUN = String.raw`${CODE_TOKEN}(?:\s*\/\s*${CODE_TOKEN})*`;

/**
 * A catalogue's Pricing Inputs as `plainPricerText` writes them -- each id's whole-word pattern and its label,
 * longest id first -- built ONCE per catalogue array. Built per line, it scanned the whole catalogue once per id
 * on every display string, and the badge pass prices every row of a sheet: 379 HVAC items x 11 inputs per line
 * froze BOQ-26-00393's sheets for 2-4 s. The catalogue is one array per load (SWR data, never mutated), so the
 * array is the key; a new catalogue is a new array and gets its own labels.
 */
const inputLabelsByCatalogue = new WeakMap<ReadonlyArray<PlainEnglishItem>, ReadonlyArray<{ re: RegExp; label: string }>>();
function pricingInputReplacements(items: ReadonlyArray<PlainEnglishItem>): ReadonlyArray<{ re: RegExp; label: string }> {
  if (items.length === 0) return [];
  let found = inputLabelsByCatalogue.get(items);
  if (!found) {
    found = pricingInputIds(items).map((id) => ({ re: new RegExp(String.raw`\b${escapeRe(id)}\b`, "g"), label: pricingInputLabel(id, items) }));
    inputLabelsByCatalogue.set(items, found);
  }
  return found;
}

/**
 * A pricer-facing line in plain English:
 *   - a leading pipeline id (`item_supply:`) is written as words (`item supply:`);
 *   - every Pricing Input id the items declare is replaced by its label (an undeclared one by its words);
 *   - the trailing `(R15)` / `(owner ...)` tags are dropped (`plainSentence`);
 *   - a code run at the START of a sentence or clause (`R14 / slice 11 VCD = ...`, `(R14 / S6 UL not
 *     mentioned ...`) is dropped, and a code after a comma inside a bracket (`(next size up, R6)`) too.
 * SLICE 12e-3c (owner F7): `fieldLabels` is the category's own field ids and labels (its config's attribute
 * definitions). A field id written with an underscore that appears as a word in the line -- "thickness_mm not
 * mentioned -> 9" -- is written as its field's label ("thickness not mentioned -> 9"). The label comes from
 * the config, never from a word list here; an id with no underscore cannot be told from a word and is left.
 * Idempotent: a line already in plain English comes back byte-identical, its indentation included.
 */
export function plainPricerText(text: unknown, items: ReadonlyArray<PlainEnglishItem> = [], fieldLabels: Readonly<Record<string, string>> = {}): string {
  const raw = String(text ?? "");
  if (!raw) return raw;
  // a working line's INDENTATION is layout (a layer's steps sit under their layer line): kept byte-for-byte
  const lead = raw.match(/^\s*/)![0];
  let s = raw.slice(lead.length);
  s = s.replace(/^([A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+):/, (_m, id: string) => `${id.replace(/_/g, " ")}:`);
  for (const { re, label } of pricingInputReplacements(items)) s = s.replace(re, label);
  // SLICE 12e-3c (F7): a field id reads as its field's label -- longest id first, so `insulation_thickness_mm`
  // is replaced before `thickness_mm`
  for (const id of Object.keys(fieldLabels).filter(isSnakeId).sort((a, b) => b.length - a.length)) {
    const word = labelAsWord(fieldLabels[id]);
    if (word !== "") s = s.replace(new RegExp(String.raw`(?<![A-Za-z0-9_])${escapeRe(id)}(?![A-Za-z0-9_])`, "g"), word);
  }
  // SLICE 12e-4b (owner G3, 2026-10-12 "yes"): a field id WITHOUT an underscore ("item", "ul") cannot be told
  // from a word anywhere in a sentence -- but the pricer writes a default's line as "<id> not mentioned -> ...",
  // so at the START of such a line the id is known and reads as its field's label ("insulation material not
  // mentioned -> ...", never "item not mentioned -> ..."). Only there; a word elsewhere is left alone.
  for (const id of Object.keys(fieldLabels).filter((k) => !isSnakeId(k)).sort((a, b) => b.length - a.length)) {
    const word = labelAsWord(fieldLabels[id]);
    if (word !== "" && s.startsWith(`${id}${NOT_MENTIONED_LEAD}`)) { s = `${word}${s.slice(id.length)}`; break; }
  }
  // a Pricing Input the items do not carry (no items loaded yet): its id written as plain words, never bare
  s = s.replace(/pricing input: ([A-Za-z0-9]+(?:_[A-Za-z0-9]+)+)/g, (_m, id: string) => `pricing input: ${id.replace(/_/g, " ")}`);
  s = plainSentence(s);
  // SLICE 12e-3b (owner Q13): a unit key reads as the unit ("6 nm" -> "6 Nm")
  s = unitSpellings(s);
  s = s.replace(new RegExp(String.raw`,\s*${CODE_RUN}(?=\))`, "g"), "");
  s = s.replace(new RegExp(String.raw`(^|\(|;\s*)${CODE_RUN}\s+(?=\S)`, "g"), "$1");
  // SLICE 12e-4b (owner G2): a default's line never says the same thing twice
  s = onceOnly(s);
  // nothing else is normalised: a family name may carry a leading space (' Fiberglass Rigid Board ...') and keeps it
  return lead + s.trimEnd();
}
