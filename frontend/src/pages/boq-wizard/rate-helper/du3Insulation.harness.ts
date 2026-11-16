/**
 * DU-3 (R1 the 90% rule, R2 which rows count; owner 2026-11-16 16:31-16:38, QR-1 Q1 / Q3 / Q4 18:06): the `sheet_insulation` block and
 * the threshold Pricing Input HVAC v75 carries, for tests that run before / beside the asset. `du3V75.test.ts` pins the asset's own
 * block equal to this one, so the two never drift.
 */
import { CFG, ITEMS } from "./du1Duct.harness";

export const THRESHOLD_INPUT = "ducting_insulation_coverage_threshold";

export const SI_V75 = {
  category: "hvac_insulation",
  section: "insulation",
  duct_words: "\\bducts?\\b|ducting|ductwork",
  insulation_words: "insulat|lining",
  plain_heading_words: "^\\W*(?:[a-z0-9]{1,3}[.)]\\s*)?(?:thermal\\s+|acoustic\\s+)?insulation(?:\\s+works?)?\\W*$",
  never_words: "\\bpipes?\\b|piping|\\bAHUs?\\b|air\\s*handling|plant\\s*room|machine\\s*room|equipment|chillers?\\b|refrigerant|copper",
  surface_words: "under\\s*-?\\s*deck|\\broofs?\\b|\\bwalls?\\b|ceiling|\\bslabs?\\b|\\bfloors?\\b|partition|terrace",
  preamble_chars: 120,
  area_units: ["sqm", "sq.m", "sq m", "sq.mt", "sqmt", "sq.mtr", "sq mtr", "sqmtr", "sqmtrs", "sq.mtrs", "sq. m", "sq.m.", "m2", "m²",
               "sq.mt.", "sqm.", "smt", "sq. mtr", "sqft", "sq.ft", "sq ft", "sft", "SM", "Sq mt", "Sqm/Ro"],
  length_units: ["m", "mt", "mts", "mtr", "mtrs", "rmt", "rmtr", "rm", "r.m", "running metre", "running meter", "metre", "meter",
                 "metres", "meters", "lm", "rft"],
  threshold_input: THRESHOLD_INPUT,
  lines: {
    covered: "Insulation is priced separately in {rows} - not included in this row.",
    double_count: "Possible double counting - insulation is also priced separately in {rows}. Check before quoting.",
    ratio: "(The separate rows cover about {pct}% of the insulated duct quantity on this sheet: {ins} of {area} sq.m; threshold {threshold}%.)",
    threshold_missing: "(The Pricing Input 'Ducting - insulation coverage threshold' is not set - set it in Pricing Inputs.)",
  },
};

/** the v75 Pricing Input item (factor 0.9 = 90%) */
export const THRESHOLD_ITEM = {
  kind: "hvac_pricing_input", discipline: "HVAC",
  attributes: { item: THRESHOLD_INPUT, name: "Ducting - insulation coverage threshold" },
  rates: { factor: 0.9 },
};

/** the newest asset's configs with Ducting's `sheet_insulation` replaced by the v75 block (a no-op once v75 is the asset) */
export function cfgV75(si: Record<string, unknown> = SI_V75): Map<string, unknown> {
  const m = new Map<string, unknown>(CFG as Map<string, unknown>);
  const d = structuredClone(m.get("hvac_ducting")) as { list_spec: { pricing: Record<string, unknown> } };
  d.list_spec.pricing.sheet_insulation = si;
  m.set("hvac_ducting", d);
  return m;
}

/** the newest asset's items with the threshold Pricing Input at `factor` (null = absent) */
export function itemsV75(factor: number | null = 0.9): Array<Record<string, unknown>> {
  const rest = ITEMS.filter((i) => (i.attributes as { item?: unknown } | undefined)?.item !== THRESHOLD_INPUT);
  return factor === null ? rest : [...rest, { ...THRESHOLD_ITEM, rates: { factor } }];
}
