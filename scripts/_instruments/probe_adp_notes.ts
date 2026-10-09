/** ADP notes (owner 2026-10-04): prove the four strings changed NOTHING about ADP's pricing. */
import V22 from "../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v22.json";
import V23 from "../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v23.json";
import { itemListPricingSpec, priceItemList } from "../../frontend/src/pages/boq-wizard/rate-helper/itemListPricing";

const a22 = V22 as any, a23 = V23 as any;
const cfg = (a: any) => a.category_configs.find((c: any) => c.category_id === "hvac_adp");
const items = (a: any) => a.items.filter((i: any) => i.kind === "hvac_adp_item" || i.kind === "hvac_pricing_input");

// (1) the 95 ADP items, byte-identical
const i22 = a22.items.filter((i: any) => i.kind === "hvac_adp_item");
const i23 = a23.items.filter((i: any) => i.kind === "hvac_adp_item");
console.log("ADP items:", i22.length, "->", i23.length,
  "| byte-identical:", JSON.stringify(i22) === JSON.stringify(i23));

// (2) the config differs ONLY by panel_notes
const c22 = JSON.parse(JSON.stringify(cfg(a22))), c23 = JSON.parse(JSON.stringify(cfg(a23)));
const notes = c23.list_spec.pricing.panel_notes;
// ⚠️ STRIPPED FROM BOTH SIDES. When this probe was written the OLD side carried no notes, so
// stripping one side was enough; from v22 on both sides have them and a one-sided strip reports a
// difference that is only the probe's own doing.
delete c23.list_spec.pricing.panel_notes;
delete c22.list_spec.pricing.panel_notes;
console.log("hvac_adp config identical with panel_notes stripped:", JSON.stringify(c22) === JSON.stringify(c23));
console.log("the diff, in full:");
for (const [k, v] of Object.entries(notes as Record<string, string>)) console.log(`   + ${k}: ${v}`);

// (3) EVERY ADP GOLDEN priced through the live path, before and after
const golds = (a23.goldens?.hvac_adp ?? a22.goldens?.hvac_adp ?? []) as any[];
const spec22 = itemListPricingSpec(cfg(a22) as never)!, spec23 = itemListPricingSpec(cfg(a23) as never)!;
let checked = 0, diffs = 0;
for (const g of golds) {
  const ext = [{ attributes: Object.fromEntries(Object.entries(g.attributes ?? g.input ?? {}).map(([k, v]) => [k, { value: v as never }])) }];
  const unit = g.unit ?? g.row_unit ?? "Nos";
  const r22 = priceItemList(spec22, items(a22) as never, unit, ext as never);
  const r23 = priceItemList(spec23, items(a23) as never, unit, ext as never);
  checked++;
  if (JSON.stringify(r22) !== JSON.stringify(r23)) { diffs++; console.log("   DIFFERS:", JSON.stringify(g).slice(0, 90)); }
}
console.log(`ADP goldens priced both ways: ${checked} checked, ${diffs} differences`);

// (4) and every ADP ITEM, priced from its own stored attributes -- a broader population than the goldens
let n = 0, d = 0;
for (const it of i23) {
  const ext = [{ attributes: Object.fromEntries(Object.entries(it.attributes).filter(([k]) => k !== "unit_class").map(([k, v]) => [k, { value: v as never }])) }];
  const u = it.unit ?? "Nos";
  const r22 = priceItemList(spec22, items(a22) as never, u, ext as never);
  const r23 = priceItemList(spec23, items(a23) as never, u, ext as never);
  n++;
  if (JSON.stringify(r22) !== JSON.stringify(r23)) { d++; if (d < 3) console.log("   ITEM DIFFERS:", it.item_uid); }
}
console.log(`ADP items priced both ways: ${n} checked, ${d} differences`);
