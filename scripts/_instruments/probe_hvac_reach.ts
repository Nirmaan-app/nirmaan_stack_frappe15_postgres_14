// SLICE 12c -- what each HVAC Pricing Input reaches, through the panel's own reach walk.
// Usage: node <bundle> <assetPath>
import * as fs from "fs";
import { computePricingInputReach } from "../../frontend/src/pages/pricing/rate-master/pricingInputReach";

const asset = JSON.parse(fs.readFileSync(process.argv[2], "utf-8"));
const configs: Record<string, any> = {};
for (const c of asset.category_configs) configs[c.category_id] = c;

const items = asset.items.map((it: any) => ({
  item_uid: it.item_uid, discipline: asset.discipline, kind: it.kind,
  brand: it.brand ?? undefined, unit: it.unit,
  attributes: { ...it.attributes }, rates: { ...it.rates },
}));
const reach: any = computePricingInputReach(configs, items);
const ids = Object.keys(reach).sort();
if (process.argv[3] === "--digest") {
  // a STABLE serialisation of the whole map, for the before/after no-op proof
  const norm = ids.map((id) => {
    const r: any = reach[id];
    return [id, (r.distinctSkus ?? []).slice().sort(),
            (r.columns ?? []).map((c: any) => `${c.itemUid}|${c.kind}|${c.rateKey}|${(c.categories ?? []).join(",")}`).sort(),
            Object.fromEntries(Object.entries(r.byCategory ?? {}).map(([k, v]: any) => [k, v.slice().sort()])),
            (r.pipelines ?? []).map((pp: any) => `${pp.category}|${pp.pipelineId}`).sort(),
            r.isFlatAdder ?? false, r.adder ?? null];
  });
  const crypto = require("crypto");
  console.log("inputs:", ids.length, "digest:",
    crypto.createHash("sha256").update(JSON.stringify(norm)).digest("hex").slice(0, 24));
  process.exit(0);
}
console.log("inputs with reach:", ids.length);
for (const id of ids) {
  const r = reach[id];
  console.log(`\n${id}`);
  console.log("   distinctSkus:", (r.distinctSkus ?? []).length);
  console.log("   byCategory  :", JSON.stringify(Object.fromEntries(
    Object.entries(r.byCategory ?? {}).map(([k, v]: any) => [k, v.length]))));
  console.log("   columns     :", JSON.stringify(Array.from(new Set((r.columns ?? []).map((c: any) => `${c.kind}:${c.rateKey}`)))));
  console.log("   pipelines   :", JSON.stringify((r.pipelines ?? []).map((p: any) => `${p.category}|${p.pipelineId}`)));
  console.log("   flatAdder   :", r.isFlatAdder ?? false);
}
