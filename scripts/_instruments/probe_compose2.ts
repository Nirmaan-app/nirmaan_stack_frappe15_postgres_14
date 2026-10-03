/** C-R1 (cost tie-break) and C-R2 (PUF must never compose) -- does today's composer satisfy them? */
import HVAC from "../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v18.json";
import { composeSize } from "../../frontend/src/pages/boq-wizard/rate-helper/ladderResolution";
const a = HVAC as any;
const spec = a.category_configs.find((c: any) => c.category_id === "hvac_insulation").list_spec.pricing;
const items = a.items.filter((i: any) => i.kind === "hvac_insulation_item");
const PUF = "Tubular Puf Insulation", NR = "Nitrile Rubber Insulation";
const rungs = (fam: string, pipe?: number) => [...new Set(items
  .filter((i: any) => i.attributes.item === fam && (pipe === undefined || i.attributes.pipe_size_mm === pipe))
  .map((i: any) => i.attributes.thickness_mm))].sort((x:any,y:any)=>x-y) as number[];

console.log("=== C-R2: does Tubular PUF compose where the arithmetic allows? ===");
for (const want of [75, 90, 105, 115, 130]) {
  const r = composeSize(want, rungs(PUF), spec.compose);
  console.log(`  PUF ${String(want).padStart(3)} -> ${r ? r.layers.join(" + ") + "  *** COMPOSES (C-R2 says it must NOT) ***" : "not composed"}`);
}
console.log();
console.log("=== C-R1: the cost of each 2-layer option for Nitrile 38 at pipe 19.05 ===");
const row = (t: number, clad: string) => items.find((i: any) =>
  i.attributes.item === NR && i.attributes.pipe_size_mm === 19.05 &&
  i.attributes.thickness_mm === t && i.attributes.cladding === clad);
for (const pair of [[19,19],[13,25]]) {
  const costs = pair.map((t) => { const r = row(t, "No"); return r ? Number(r.rates.cost_insulation ?? 0) : NaN; });
  console.log(`  ${pair.join(" + ")} -> cost_insulation ${costs.join(" + ")} = ${costs.reduce((x,y)=>x+y,0)}`);
}
console.log("  (today's composer picked 19 + 19 by its own tie-break, NOT by cost)");
