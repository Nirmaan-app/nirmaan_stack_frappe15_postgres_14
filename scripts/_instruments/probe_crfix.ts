/** C-R1/C-R2/C-R3 verification: the fixed code + the config change, against the owner's cases. */
import HVAC from "../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v20.json";
import { itemListPricingSpec, priceItemList } from "../../frontend/src/pages/boq-wizard/rate-helper/itemListPricing";
const a = HVAC as any;
const base = a.category_configs.find((c: any) => c.category_id === "hvac_insulation");
const patched = structuredClone(base);
patched.list_spec.pricing.ladders = ["pipe_size_mm", "thickness_mm"];   // the SELECTING axis first
patched.list_spec.pricing.compose.cost_key = "cost_insulation";         // C-R1's last tie-break
const spec = itemListPricingSpec(patched as never)!;
const items = a.items.filter((i: any) => i.kind === "hvac_insulation_item" || i.kind === "hvac_pricing_input");
const price = (fam: string, at: Record<string, string>) => priceItemList(spec, items, at.__unit ?? "mts",
  [{ attributes: Object.fromEntries(Object.entries({ item: fam, ...at }).filter(([k]) => k !== "__unit").map(([k, v]) => [k, { value: v }])) } as any]);
const NR = "Nitrile Rubber Insulation", PUF = "Tubular Puf Insulation";
const row = (label: string, want: string, r: any) => {
  const th = (r.items ?? []).map((x: any) => x.selection?.thickness_mm).join(" + ") || "-";
  const ok = r.priced ? th : "NOT PRICED";
  const mark = ok.replace(/\s/g, "") === want.replace(/\s/g, "") ? "MATCH" : "*** DIFFERS ***";
  console.log(`${label.padEnd(34)} want ${want.padEnd(14)} got ${ok.padEnd(14)} ${mark}` +
              (r.priced ? "" : `  | ${(r.reason ?? "").slice(0, 60)}`));
};
console.log("=== Nitrile Rubber, pipe 19.05 (stocked 13/19/25) ===");
row("C1  32", "13 + 19", price(NR, { pipe_size_mm: "19.05", thickness_mm: "32", cladding: "No" }));
row("C2  30", "13 + 19", price(NR, { pipe_size_mm: "19.05", thickness_mm: "30", cladding: "No" }));
row("C3  27", "13 + 13", price(NR, { pipe_size_mm: "19.05", thickness_mm: "27", cladding: "No" }));
row("C4  29", "NOT PRICED", price(NR, { pipe_size_mm: "19.05", thickness_mm: "29", cladding: "No" }));
row("C5  38 (cost: 283<286)", "13 + 25", price(NR, { pipe_size_mm: "19.05", thickness_mm: "38", cladding: "No" }));
row("C6  50", "25 + 25", price(NR, { pipe_size_mm: "19.05", thickness_mm: "50", cladding: "No" }));
row("C7  64", "13 + 25 + 25", price(NR, { pipe_size_mm: "19.05", thickness_mm: "64", cladding: "No" }));
row("C8  100", "25 + 25 + 25 + 25", price(NR, { pipe_size_mm: "19.05", thickness_mm: "100", cladding: "No" }));
row("C9  110", "NOT PRICED", price(NR, { pipe_size_mm: "19.05", thickness_mm: "110", cladding: "No" }));
row("C10 25 @ pipe 6.35", "13 + 13", price(NR, { pipe_size_mm: "6.35", thickness_mm: "25", cladding: "No" }));
row("C12 20 (ladder, not compose)", "25", price(NR, { pipe_size_mm: "19.05", thickness_mm: "20", cladding: "No" }));
console.log("\n=== Tubular PUF (pipe 50 stocks thickness 50 only) ===");
row("PUF 100 @ 50", "50 + 50", price(PUF, { pipe_size_mm: "50", thickness_mm: "100", cladding: "No" }));
row("PUF 75  @ 50", "NOT PRICED", price(PUF, { pipe_size_mm: "50", thickness_mm: "75", cladding: "No" }));
row("PUF 25  @ 50 (C-R3)", "50", price(PUF, { pipe_size_mm: "50", thickness_mm: "25", cladding: "No" }));
console.log("\n=== Sheet insulation (area rows) ===");
row("S1 Thermal 30", "13 + 16", price("Thermal Nitrile Insulation", { __unit: "sqm", thickness_mm: "30", cladding: "No" }));
row("S3 Fiberglass 75", "25 + 50", price(" Fiberglass Rigid Board Insulation, Density 48Kg/m3", { __unit: "sqm", thickness_mm: "75", cladding: "No" }));
