/** ADP notes (owner 2026-10-04): prove the four strings changed NOTHING about ADP's pricing. */
import V19 from "../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v19.json";
import V20 from "../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v20.json";
import { itemListPricingSpec, priceItemList } from "../../frontend/src/pages/boq-wizard/rate-helper/itemListPricing";

const a19 = V19 as any, a20 = V20 as any;
const cfg = (a: any) => a.category_configs.find((c: any) => c.category_id === "hvac_adp");
const items = (a: any) => a.items.filter((i: any) => i.kind === "hvac_adp_item" || i.kind === "hvac_pricing_input");

// (1) the 95 ADP items, byte-identical
const i19 = a19.items.filter((i: any) => i.kind === "hvac_adp_item");
const i20 = a20.items.filter((i: any) => i.kind === "hvac_adp_item");
console.log("ADP items:", i19.length, "->", i20.length,
  "| byte-identical:", JSON.stringify(i19) === JSON.stringify(i20));

// (2) the config differs ONLY by panel_notes
const c19 = JSON.parse(JSON.stringify(cfg(a19))), c20 = JSON.parse(JSON.stringify(cfg(a20)));
const notes = c20.list_spec.pricing.panel_notes;
delete c20.list_spec.pricing.panel_notes;
console.log("hvac_adp config identical with panel_notes stripped:", JSON.stringify(c19) === JSON.stringify(c20));
console.log("the diff, in full:");
for (const [k, v] of Object.entries(notes as Record<string, string>)) console.log(`   + ${k}: ${v}`);

// (3) EVERY ADP GOLDEN priced through the live path, before and after
const golds = (a20.goldens?.hvac_adp ?? a19.goldens?.hvac_adp ?? []) as any[];
const spec19 = itemListPricingSpec(cfg(a19) as never)!, spec20 = itemListPricingSpec(cfg(a20) as never)!;
let checked = 0, diffs = 0;
for (const g of golds) {
  const ext = [{ attributes: Object.fromEntries(Object.entries(g.attributes ?? g.input ?? {}).map(([k, v]) => [k, { value: v as never }])) }];
  const unit = g.unit ?? g.row_unit ?? "Nos";
  const r19 = priceItemList(spec19, items(a19) as never, unit, ext as never);
  const r20 = priceItemList(spec20, items(a20) as never, unit, ext as never);
  checked++;
  if (JSON.stringify(r19) !== JSON.stringify(r20)) { diffs++; console.log("   DIFFERS:", JSON.stringify(g).slice(0, 90)); }
}
console.log(`ADP goldens priced both ways: ${checked} checked, ${diffs} differences`);

// (4) and every ADP ITEM, priced from its own stored attributes -- a broader population than the goldens
let n = 0, d = 0;
for (const it of i20) {
  const ext = [{ attributes: Object.fromEntries(Object.entries(it.attributes).filter(([k]) => k !== "unit_class").map(([k, v]) => [k, { value: v as never }])) }];
  const u = it.unit ?? "Nos";
  const r19 = priceItemList(spec19, items(a19) as never, u, ext as never);
  const r20 = priceItemList(spec20, items(a20) as never, u, ext as never);
  n++;
  if (JSON.stringify(r19) !== JSON.stringify(r20)) { d++; if (d < 3) console.log("   ITEM DIFFERS:", it.item_uid); }
}
console.log(`ADP items priced both ways: ${n} checked, ${d} differences`);
