/** FA8 / C-R1 + C-R2 -- does the SHIPPED composer already obey the owner's composition rulings? */
import HVAC from "../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v18.json";
import { composeSize } from "../../frontend/src/pages/boq-wizard/rate-helper/ladderResolution";

const a = HVAC as any;
const cfg = a.category_configs.find((c: any) => c.category_id === "hvac_insulation");
const spec = cfg.list_spec.pricing;
const compose = spec.compose;
const items = a.items.filter((i: any) => i.kind === "hvac_insulation_item");

const rungsFor = (fam: string, pipe?: number) => [...new Set(items
  .filter((i: any) => i.attributes.item === fam && (pipe === undefined || i.attributes.pipe_size_mm === pipe))
  .map((i: any) => i.attributes.thickness_mm).filter((x: any) => typeof x === "number"))].sort((x:any,y:any)=>x-y) as number[];

const NR = "Nitrile Rubber Insulation";
console.log("compose spec:", JSON.stringify(compose));
console.log("Nitrile @19.05 rungs:", rungsFor(NR, 19.05));
console.log("Nitrile @6.35  rungs:", rungsFor(NR, 6.35));
console.log("Tubular PUF    rungs:", rungsFor("Tubular Puf Insulation"));
console.log("Thermal Nitrile rungs:", rungsFor("Thermal Nitrile Insulation"));
console.log("Fiberglass      rungs:", rungsFor(" Fiberglass Rigid Board Insulation, Density 48Kg/m3"));
console.log();
const cases: Array<[string, number, number[]]> = [
  ["C1  32", 32, rungsFor(NR,19.05)], ["C2  30", 30, rungsFor(NR,19.05)],
  ["C3  27", 27, rungsFor(NR,19.05)], ["C4  29", 29, rungsFor(NR,19.05)],
  ["C5  38", 38, rungsFor(NR,19.05)], ["C6  50", 50, rungsFor(NR,19.05)],
  ["C7  64", 64, rungsFor(NR,19.05)], ["C8  100",100, rungsFor(NR,19.05)],
  ["C9  110",110, rungsFor(NR,19.05)], ["C10 25@6.35", 25, rungsFor(NR,6.35)],
  ["P1  PUF 30", 30, rungsFor("Tubular Puf Insulation")],
  ["S1  Thermal 30", 30, rungsFor("Thermal Nitrile Insulation")],
  ["S3  Fiberglass 75", 75, rungsFor(" Fiberglass Rigid Board Insulation, Density 48Kg/m3")],
];
for (const [label, want, rungs] of cases) {
  const r = composeSize(want, rungs, compose);
  console.log(`${label.padEnd(16)} -> ${r ? r.layers.join(" + ") + `  (sum ${r.layers.reduce((x,y)=>x+y,0)}, delta ${r.delta})` : "NOT COMPOSED"}`);
}
