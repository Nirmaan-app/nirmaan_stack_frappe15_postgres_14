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
 * Idempotent: a line already in plain English comes back byte-identical.
 */
export function plainPricerText(text: unknown, items: ReadonlyArray<PlainEnglishItem> = []): string {
  let s = String(text ?? "");
  if (!s) return s;
  s = s.replace(/^([A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+):/, (_m, id: string) => `${id.replace(/_/g, " ")}:`);
  for (const id of pricingInputIds(items)) {
    s = s.replace(new RegExp(String.raw`\b${escapeRe(id)}\b`, "g"), pricingInputLabel(id, items));
  }
  // a Pricing Input the items do not carry (no items loaded yet): its id written as plain words, never bare
  s = s.replace(/pricing input: ([A-Za-z0-9]+(?:_[A-Za-z0-9]+)+)/g, (_m, id: string) => `pricing input: ${id.replace(/_/g, " ")}`);
  s = plainSentence(s);
  s = s.replace(new RegExp(String.raw`,\s*${CODE_RUN}(?=\))`, "g"), "");
  s = s.replace(new RegExp(String.raw`(^|\(|;\s*)${CODE_RUN}\s+(?=\S)`, "g"), "$1");
  return s.replace(/\s{2,}/g, " ").replace(/\(\s+/g, "(").trim();
}
