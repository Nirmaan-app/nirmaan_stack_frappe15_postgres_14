/** CERT 9b -- every case, computed IN ADVANCE from the shipped asset, with the price to the rupee. */
import HVAC from "../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v23.json";
import { itemListPricingSpec, priceItemList } from "../../frontend/src/pages/boq-wizard/rate-helper/itemListPricing";
const a = HVAC as any;
const cfg = a.category_configs.find((c: any) => c.category_id === "hvac_insulation");
const spec = itemListPricingSpec(cfg as never)!;
const items = a.items.filter((i: any) => i.kind === "hvac_insulation_item" || i.kind === "hvac_pricing_input");
const NR = "Nitrile Rubber Insulation", PUF = "Tubular Puf Insulation";

function run(label: string, family: string, at: Record<string, string>, unit = "mts") {
  const r = priceItemList(spec, items, unit, [{ attributes: Object.fromEntries(
    Object.entries({ item: family, ...at }).map(([k, v]) => [k, { value: v }])) }] as any);
  const its = (r.items ?? []) as any[];
  const layers = its.map((x) => x.selection?.thickness_mm).join(" + ") || "-";
  const clad = its.map((x) => x.selection?.cladding ?? "-").join(" | ");
  const line = its[0]?.working?.find((l: string) => /You typed|BoQ says/.test(l)) ?? "";
  console.log(`${label.padEnd(30)} ${r.priced ? "PRICED" : "NOT PRICED"}`);
  console.log(`   items=${its.length} thickness=${layers}  cladding=[${clad}]`);
  if (r.priced) console.log(`   supply=${r.supply}  install=${r.install}`);
  else console.log(`   reason: ${r.reason}`);
  if (line) console.log(`   line: ${line}`);
}
const P = "19.05";
console.log("=== NITRILE RUBBER, pipe 19.05, no cladding ===");
run("C1  32", NR, { pipe_size_mm: P, thickness_mm: "32", cladding: "No" });
run("C2  30", NR, { pipe_size_mm: P, thickness_mm: "30", cladding: "No" });
run("C3  27", NR, { pipe_size_mm: P, thickness_mm: "27", cladding: "No" });
run("C4  29", NR, { pipe_size_mm: P, thickness_mm: "29", cladding: "No" });
run("C5  38", NR, { pipe_size_mm: P, thickness_mm: "38", cladding: "No" });
run("C6  50", NR, { pipe_size_mm: P, thickness_mm: "50", cladding: "No" });
run("C7  64", NR, { pipe_size_mm: P, thickness_mm: "64", cladding: "No" });
run("C8  100", NR, { pipe_size_mm: P, thickness_mm: "100", cladding: "No" });
run("C9  110", NR, { pipe_size_mm: P, thickness_mm: "110", cladding: "No" });
run("C10 25 @ 6.35", NR, { pipe_size_mm: "6.35", thickness_mm: "25", cladding: "No" });
run("C12 20 (ladder)", NR, { pipe_size_mm: P, thickness_mm: "20", cladding: "No" });
run("C13 32 @ 3/4in", NR, { pipe_size_mm: '3/4"', thickness_mm: "32", cladding: "No" });
console.log("\n=== THE SAME, WITH 26G ALUMINIUM (outer layer only) ===");
run("C1  32 / 26G", NR, { pipe_size_mm: P, thickness_mm: "32", cladding: "26G Aluminium" });
run("C5  38 / 26G", NR, { pipe_size_mm: P, thickness_mm: "38", cladding: "26G Aluminium" });
run("C6  50 / 26G", NR, { pipe_size_mm: P, thickness_mm: "50", cladding: "26G Aluminium" });
console.log("\n=== TUBULAR PUF ===");
run("PUF 100 @ 50", PUF, { pipe_size_mm: "50", thickness_mm: "100", cladding: "No" });
run("PUF 75  @ 50", PUF, { pipe_size_mm: "50", thickness_mm: "75", cladding: "No" });
run("PUF 25  @ 50", PUF, { pipe_size_mm: "50", thickness_mm: "25", cladding: "No" });
console.log("\n=== SHEET INSULATION (per sq.m) ===");
run("S1 Thermal 30", "Thermal Nitrile Insulation", { thickness_mm: "30", cladding: "No" }, "sqm");
run("S3 Fiberglass 75", " Fiberglass Rigid Board Insulation, Density 48Kg/m3", { thickness_mm: "75", cladding: "No" }, "sqm");
run("S4 Thermal 30 / foil", "Thermal Nitrile Insulation", { thickness_mm: "30", cladding: "Aluminium Foil" }, "sqm");
run("S5 Thermal 60", "Thermal Nitrile Insulation", { thickness_mm: "60", cladding: "No" }, "sqm");
