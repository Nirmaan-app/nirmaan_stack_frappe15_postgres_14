/** FA8(d): does an INCH entry parse for the insulation pipe size? Measured, not assumed. */
import HVAC from "../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v22.json";
import { itemListPricingSpec, priceItemList } from "../../frontend/src/pages/boq-wizard/rate-helper/itemListPricing";
const a = HVAC as any;
const cfg = a.category_configs.find((c: any) => c.category_id === "hvac_insulation");
const spec = itemListPricingSpec(cfg as never)!;
const items = a.items.filter((i: any) => i.kind === "hvac_insulation_item" || i.kind === "hvac_pricing_input");
const NR = "Nitrile Rubber Insulation";
for (const pipe of ['7/8"', "7/8", '3/4"', "22.2", "22.23", "22", "abc"]) {
  const r = priceItemList(spec, items, "mts", [{ attributes: Object.fromEntries(
    Object.entries({ item: NR, pipe_size_mm: pipe, thickness_mm: "19", cladding: "No" })
      .map(([k, v]) => [k, { value: v }])) }] as any);
  const used = (r.items?.[0] as any)?.selection?.pipe_size_mm;
  console.log(`  pipe "${pipe}"`.padEnd(20), `priced=${String(r.priced).padEnd(5)} used=${used ?? "-"}`,
              r.priced ? "" : `| ${(r.reason ?? "").slice(0, 70)}`);
}
