/**
 * OWNER RULING, 2026-10-04 (final form) -- WHICH FIELDS MUST CARRY A NOTE.
 *
 * "any field on the calculator or pricing helper panel which must be mandatorily filled for a rate
 * to be calculated and the user needs to type it in should have the note explnantion."
 *
 * A note is REQUIRED when ALL THREE hold:
 *   (1) TYPED      -- the user types it, rather than picking from a dropdown
 *   (2) RENDERS    -- it appears on the rate helper panel (the calculator mounts the same panel)
 *   (3) MANDATORY  -- without it the rate cannot be calculated
 *
 * ⚠️ ALL THREE ARE MEASURED FROM THE PRODUCT'S OWN CODE PATHS, never from a list kept beside them.
 * RENDERS is whatever `itemFieldDefs` returns -- the exact call the panel makes. MANDATORY is
 * decided by ASKING THE PRICER: price the item with the field blank and see whether it refuses. A
 * list of "mandatory attributes" written here would be a second source of truth, free to drift from
 * the `needs` the families actually declare, and drift is how a field loses its note silently.
 *
 * A `dropdown_or_other` field counts as TYPED: choosing "Other..." opens a box, and that box is
 * exactly the case the owner's rule is about.
 */
import { itemFieldDefs, listSpecDefs, priceItemList, itemListPricingSpec,
         type ItemListPricingSpec, type ItemFieldDef } from "./itemListPricing";
import type { RateMasterItem } from "@/pages/pricing/rate-master/rateMasterTypes";

export interface AuditedField {
  attr: string;
  label: string;
  /** "dropdown" | "typed" | "dropdown + other" -- what the pricer sees */
  control: string;
  typed: boolean;
  renders: true;
  mandatory: boolean;
  note: string;
  /** where a dropdown's options come from: the live SKUs, or the definition's vocabulary */
  optionsFrom: string;
  families: string[];
  needsNote: boolean;
}

/** A value that will satisfy a field, so the OTHER fields can be tested one at a time. */
function fillerFor(f: ItemFieldDef): string {
  if (f.options && f.options.length) return f.options.find((o) => o !== "None") ?? f.options[0];
  return "1";
}

/**
 * Every field the panel renders for one category, with the three properties measured.
 * `config` is the raw category config; `items` the active catalogue rows.
 */
export function auditPanelFields(
  config: unknown,
  items: readonly RateMasterItem[],
): AuditedField[] {
  const spec = itemListPricingSpec(config as never);
  if (!spec) return [];
  const defs = listSpecDefs(config as never);
  const byAttr = new Map<string, AuditedField>();

  for (const family of Object.keys(spec.families ?? {})) {
    for (const unitClass of Object.keys((spec.families as never as Record<string, { units?: Record<string, unknown> }>)[family]?.units ?? {})) {
      let fields: ItemFieldDef[];
      try {
        fields = itemFieldDefs(spec, defs, family, unitClass, { items: items as RateMasterItem[], answers: {} } as never);
      } catch { continue; }
      const unitWord = (spec.unit_words as Record<string, string> | undefined)?.[unitClass] ?? unitClass;
      for (const f of fields) {
        // MANDATORY, asked of the pricer: fill every OTHER field and leave this one blank
        const attrs: Record<string, { value: string }> = {
          [(spec as ItemListPricingSpec).family_attribute_id ?? "family"]: { value: family },
        };
        for (const g of fields) if (g.id !== f.id) attrs[g.id] = { value: fillerFor(g) };
        let mandatory = false;
        try {
          const r = priceItemList(spec, items as RateMasterItem[], unitWord, [{ attributes: attrs }] as never);
          mandatory = !r.priced;
        } catch { mandatory = true; }

        const typed = f.control === "text" || f.control === "dropdown_or_other";
        const control = f.allowOther ? "dropdown + other" : f.options ? "dropdown" : "typed";
        const prev = byAttr.get(f.skuAttr);
        const entry: AuditedField = {
          attr: f.skuAttr,
          label: f.label,
          control,
          typed,
          renders: true,
          // a field mandatory ANYWHERE is mandatory for this purpose: the note must be there when it is
          mandatory: mandatory || (prev?.mandatory ?? false),
          note: f.typedNote ?? "",
          optionsFrom: f.options ? (f.optionSource ?? "definition") : "-",
          families: [...new Set([...(prev?.families ?? []), family])],
          needsNote: false,
        };
        entry.needsNote = entry.typed && entry.mandatory;
        byAttr.set(f.skuAttr, entry);
      }
    }
  }
  return [...byAttr.values()].sort((a, b) => a.attr.localeCompare(b.attr));
}

/** The fields that MUST carry a note and do not. Empty is the passing state. */
export function missingNotes(config: unknown, items: readonly RateMasterItem[]): string[] {
  return auditPanelFields(config, items).filter((f) => f.needsNote && !f.note.trim()).map((f) => f.attr);
}
