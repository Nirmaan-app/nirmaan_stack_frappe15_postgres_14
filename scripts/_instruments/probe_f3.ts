import HVAC from "../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v18.json";
import { computePricingInputReach } from "../../frontend/src/pages/pricing/rate-master/pricingInputReach";
const INS="hvac_insulation";
const cfgs=(HVAC as any).category_configs;
const ins=cfgs.find((c:any)=>c.category_id===INS);
const items=(HVAC as any).items;
const co=new Set(items.filter((i:any)=>i.attributes?.item==="Cladding Only").map((i:any)=>i.item_uid));
const reach=computePricingInputReach({[INS]:ins} as any, items);
console.log("inputs reached:", Object.keys(reach).join(", "));
for (const [id,r] of Object.entries(reach as any)) {
  const cols=(r as any).columns ?? [];
  const uids=new Set(cols.map((c:any)=>c.itemUid));
  const coHit=[...uids].filter(u=>co.has(u));
  const keys=[...new Set(cols.map((c:any)=>c.rateKey))];
  console.log(`  ${id}: ${cols.length} columns, ${uids.size} SKUs, cladding-only among them: ${coHit.length}`);
  console.log(`      rate keys: ${keys.join(", ")}`);
}
