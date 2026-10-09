/** FA8(j): ADP's panel + calculator against the same rule. READ-ONLY -- nothing in ADP is changed. */
import HVAC from "../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v22.json";
import { itemListPricingSpec, itemFieldDefs, listSpecDefs } from "../../frontend/src/pages/boq-wizard/rate-helper/itemListPricing";
const a = HVAC as any;
const cfg = a.category_configs.find((c: any) => c.category_id === "hvac_adp");
const spec = itemListPricingSpec(cfg as never)!;
const items = a.items.filter((i: any) => i.kind === "hvac_adp_item");
const fams = Object.keys(spec.families ?? {});
const seen = new Map<string, { control: string; source: string; note: string; families: Set<string> }>();
for (const family of fams) {
  for (const uc of Object.keys((spec.families as any)[family]?.units ?? {})) {
    let defs;
    try { defs = itemFieldDefs(spec, listSpecDefs(cfg as never), family, uc, { items, answers: {} } as never); }
    catch { continue; }
    for (const d of defs) {
      const control = d.allowOther ? "dropdown + Other..." : d.options ? "dropdown" : "TYPED";
      const e = seen.get(d.skuAttr) ?? { control, source: d.optionSource ?? "-", note: d.typedNote ?? "", families: new Set<string>() };
      e.families.add(family);
      if (control === "TYPED") e.control = "TYPED";
      seen.set(d.skuAttr, e);
    }
  }
}
console.log("ADP -- every attribute input, as the panel and the calculator render it");
console.log("(the calculator mounts the SAME helper, so one table covers both)\n");
const pad = (s: string, n: number) => s.padEnd(n);
console.log(pad("attribute", 16), pad("control", 20), pad("options from", 14), "note");
let typed = 0, noted = 0;
for (const [attr, e] of [...seen].sort()) {
  if (e.control === "TYPED") { typed++; if (e.note) noted++; }
  console.log(pad(attr, 16), pad(e.control, 20), pad(e.control === "TYPED" ? "-" : e.source, 14),
              e.note ? `"${e.note.slice(0, 54)}"` : (e.control === "TYPED" ? "*** NONE ***" : "n/a"));
}
console.log(`\n  typed fields: ${typed}; with a note: ${noted}`);
console.log("  dropdowns are built from the ACTIVE SKUs (optionSource=catalogue) or, where no SKU");
console.log("  carries the attribute, from the definition's own vocabulary.");
