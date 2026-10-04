import HVAC from "../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v22.json";
import { itemListPricingSpec, itemFieldDefs, listSpecDefs } from "../../frontend/src/pages/boq-wizard/rate-helper/itemListPricing";
const a = HVAC as any;
const cfg = a.category_configs.find((c: any) => c.category_id === "hvac_adp");
const spec = itemListPricingSpec(cfg as never)!;
const items = a.items.filter((i: any) => i.kind === "hvac_adp_item");
console.log("ADP declares these TYPED controls:",
  Object.entries(spec.panel_controls ?? {}).filter(([, v]) => v !== "dropdown").map(([k]) => k).sort().join(", "));
console.log("\nthe `numbers` readers and the MODEL ATTRIBUTE each reads from:");
for (const [k, r] of Object.entries(spec.numbers as Record<string, any>))
  console.log(`   ${k.padEnd(14)} from=${JSON.stringify(r.from)} component=${r.component ?? "-"}`);
const rendered = new Set<string>();
for (const family of Object.keys(spec.families ?? {}))
  for (const uc of Object.keys((spec.families as any)[family]?.units ?? {})) {
    try {
      for (const d of itemFieldDefs(spec, listSpecDefs(cfg as never), family, uc, { items, answers: {} } as never))
        rendered.add(`${d.id} (skuAttr ${d.skuAttr})`);
    } catch { /* a family whose unit cannot resolve renders nothing */ }
  }
console.log("\nFIELDS THE PANEL ACTUALLY RENDERS, across every family and unit:");
for (const r of [...rendered].sort()) console.log("   " + r);
