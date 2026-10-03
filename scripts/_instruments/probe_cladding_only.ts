// SLICE 12c FINISH -- price the five CLADDING-ONLY SKUs through the product's own pricer.
// Usage: node <bundle> <assetPath>
import * as fs from "fs";
import { itemListPricingSpec, priceItemList } from "../../frontend/src/pages/boq-wizard/rate-helper/itemListPricing";
import type { RateMasterItem, RateCategoryConfig } from "../../frontend/src/pages/pricing/rate-master/rateMasterTypes";

const asset = JSON.parse(fs.readFileSync(process.argv[2], "utf-8"));
const cfg: RateCategoryConfig = asset.category_configs.find((c: any) => c.category_id === "hvac_insulation");
const spec = itemListPricingSpec(cfg)!;
const items: RateMasterItem[] = asset.items.map((it: any) => ({
  item_uid: it.item_uid, discipline: asset.discipline, kind: it.kind,
  brand: it.brand ?? undefined, unit: it.unit,
  attributes: { ...it.attributes }, rates: { ...it.rates },
}));

const ext = (attrs: Record<string, string>) =>
  [{ attributes: Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, { value: v }])) } as never];

const CLAD = ["24G Aluminium", "26G Aluminium", "Glass Cloth with paint",
              "24G Aluminium with Glass Cloth", "26G Aluminium with Glass Cloth"];

console.log("=== FA2: per-METRE cladding-only, pipe 63.5, thickness 19 ===");
for (const c of CLAD) {
  const r = priceItemList(spec, items, "mtr",
    ext({ item: "Cladding Only", cladding: c, pipe_size_mm: "63.5", thickness_mm: "19" }));
  console.log("  %s  priced=%s supply=%s install=%s %s", c.padEnd(32), r.priced,
    String(r.supply ?? "-").padStart(6), String(r.install ?? "-").padStart(6), r.reason ?? "");
}

console.log("\n=== F2: per-SQ.M cladding-only (no overlap, no girth) ===");
for (const c of CLAD) {
  const r = priceItemList(spec, items, "sqm", ext({ item: "Cladding Only", cladding: c }));
  console.log("  %s  priced=%s supply=%s install=%s %s", c.padEnd(32), r.priced,
    String(r.supply ?? "-").padStart(6), String(r.install ?? "-").padStart(6), r.reason ?? "");
}

console.log("\n=== F1 edge cases ===");
const noPipe = priceItemList(spec, items, "mtr",
  ext({ item: "Cladding Only", cladding: "26G Aluminium", thickness_mm: "19" }));
console.log("  per-metre, NO pipe size  -> priced=%s  %s", noPipe.priced, noPipe.reason ?? "");
const noTh = priceItemList(spec, items, "mtr",
  ext({ item: "Cladding Only", cladding: "26G Aluminium", pipe_size_mm: "63.5" }));
console.log("  per-metre, NO thickness  -> priced=%s supply=%s", noTh.priced, noTh.supply);
console.log("     defaulted:", JSON.stringify(noTh.items?.[0]?.defaulted ?? []));
console.log("     working  :", JSON.stringify((noTh.items?.[0]?.working ?? []).slice(0, 4)));

console.log("\n=== NEGATIVE: a composite row is untouched (Nitrile 26G, pipe 34.93, th 19) ===");
const comp = priceItemList(spec, items, "mtr",
  ext({ item: "Nitrile Rubber Insulation", cladding: "26G Aluminium", pipe_size_mm: "34.93", thickness_mm: "19" }));
console.log("  priced=%s supply=%s install=%s", comp.priced, comp.supply, comp.install);
