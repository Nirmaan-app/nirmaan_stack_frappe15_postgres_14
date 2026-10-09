/** C-R2 through the REAL pricer: does a PUF row compose across pipe sizes in the product? */
import HVAC from "../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v19.json";
import { itemListPricingSpec, priceItemList } from "../../frontend/src/pages/boq-wizard/rate-helper/itemListPricing";
const a = HVAC as any;
const cfg = a.category_configs.find((c: any) => c.category_id === "hvac_insulation");
const spec = itemListPricingSpec(cfg as never)!;
const items = a.items.filter((i: any) => i.kind === "hvac_insulation_item" || i.kind === "hvac_pricing_input");

const price = (fam: string, attrs: Record<string, string>) => priceItemList(spec, items, "mts",
  [{ attributes: Object.fromEntries(Object.entries({ item: fam, ...attrs }).map(([k, v]) => [k, { value: v }])) } as any]);

const show = (label: string, r: any) => {
  const it = r.items?.[0];
  const layers = r.items?.length > 1 ? r.items.map((x: any) => x.selection?.thickness_mm).join(" + ") : (it?.selection?.thickness_mm ?? "-");
  console.log(`${label.padEnd(44)} priced=${String(r.priced).padEnd(5)} items=${r.items?.length ?? 0}  thickness=${layers}  ${r.priced ? "" : "reason: " + (r.reason ?? "")}`);
};

console.log("=== Tubular PUF: stocked thicknesses are 25/50/65/80, but NOT all at every pipe size ===");
const puf = items.filter((i: any) => i.attributes?.item === "Tubular Puf Insulation");
const byPipe: Record<string, number[]> = {};
for (const i of puf) { const p = String(i.attributes.pipe_size_mm); (byPipe[p] ??= []).push(i.attributes.thickness_mm); }
for (const p of Object.keys(byPipe).sort((x,y)=>Number(x)-Number(y)).slice(0,6)) {
  console.log(`   pipe ${p.padStart(5)}: thicknesses ${[...new Set(byPipe[p])].sort((x,y)=>x-y).join(", ")}`);
}
console.log();
show("PUF  pipe 50, thickness 75 (C-R2 probe)", price("Tubular Puf Insulation", { pipe_size_mm: "50", thickness_mm: "75", cladding: "No" }));
show("PUF  pipe 50, thickness 100", price("Tubular Puf Insulation", { pipe_size_mm: "50", thickness_mm: "100", cladding: "No" }));
show("PUF  pipe 50, thickness 25", price("Tubular Puf Insulation", { pipe_size_mm: "50", thickness_mm: "25", cladding: "No" }));
show("NR   pipe 19.05, thickness 38 (C5)", price("Nitrile Rubber Insulation", { pipe_size_mm: "19.05", thickness_mm: "38", cladding: "No" }));
