/** FA8(c)/(d): what the size fields actually say, generated live from the catalogue. */
import HVAC from "../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v22.json";
import { itemListPricingSpec, itemFieldDefs, listSpecDefs, sizeFieldHelp } from "../../frontend/src/pages/boq-wizard/rate-helper/itemListPricing";
const a = HVAC as any;
const cfg = a.category_configs.find((c: any) => c.category_id === "hvac_insulation");
const spec = itemListPricingSpec(cfg as never)!;
const items = a.items.filter((i: any) => i.kind === "hvac_insulation_item");
for (const [family, unitClass] of [["Nitrile Rubber Insulation", "length"], ["Thermal Nitrile Insulation", "area"]] as const) {
  const defs = itemFieldDefs(spec, listSpecDefs(cfg as never), family, unitClass, { items, answers: {} } as never);
  console.log(`\n=== ${family} (${unitClass}) ===`);
  for (const d of defs) {
    const kind = d.allowOther ? "dropdown + Other..." : d.options ? "dropdown" : "typed";
    console.log(`  ${d.label} [${kind}] options=${JSON.stringify(d.options ?? [])}`);
    if (d.typedNote) console.log(`      note: ${d.typedNote}`);
    const h = d.allowOther ? sizeFieldHelp(spec, d.skuAttr, d.options ?? []) : null;
    for (const line of h?.lines ?? []) console.log(`      - ${line}`);
  }
}
