import HVAC from "../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v19.json";
import { itemListPricingSpec, priceItemList } from "../../frontend/src/pages/boq-wizard/rate-helper/itemListPricing";
const a = HVAC as any;
const cfg = a.category_configs.find((c: any) => c.category_id === "hvac_insulation");
const spec = itemListPricingSpec(cfg as never)!;
const items = a.items.filter((i: any) => i.kind === "hvac_insulation_item" || i.kind === "hvac_pricing_input");
const price = (fam: string, attrs: Record<string, string>) => priceItemList(spec, items, "mts",
  [{ attributes: Object.fromEntries(Object.entries({ item: fam, ...attrs }).map(([k, v]) => [k, { value: v }])) } as any]);
const show = (label: string, r: any) => {
  const layers = (r.items ?? []).map((x: any) => x.selection?.thickness_mm).join(" + ");
  console.log(`${label.padEnd(40)} priced=${String(r.priced).padEnd(5)} items=${r.items?.length ?? 0} th=${layers || "-"} ${r.priced ? "" : "| " + (r.reason ?? "")}`);
};
console.log("PUF stocks ONLY thickness 25 at pipes 25/32/40, and ONLY 50 at pipes 50/65/80.");
console.log("So a composition built from the ALL-PIPE thickness set can use a size that pipe does not stock:\n");
show("PUF pipe 25, thickness 75", price("Tubular Puf Insulation", { pipe_size_mm: "25", thickness_mm: "75", cladding: "No" }));
show("PUF pipe 25, thickness 50", price("Tubular Puf Insulation", { pipe_size_mm: "25", thickness_mm: "50", cladding: "No" }));
show("PUF pipe 25, thickness 20 (C-R3)", price("Tubular Puf Insulation", { pipe_size_mm: "25", thickness_mm: "20", cladding: "No" }));
show("PUF pipe 50, thickness 25 (C-R3)", price("Tubular Puf Insulation", { pipe_size_mm: "50", thickness_mm: "25", cladding: "No" }));
console.log();
console.log("Nitrile @6.35 stocks 13/19 only; @19.05 stocks 13/19/25:");
show("NR pipe 6.35, thickness 25 (C10)", price("Nitrile Rubber Insulation", { pipe_size_mm: "6.35", thickness_mm: "25", cladding: "No" }));
show("NR pipe 6.35, thickness 44", price("Nitrile Rubber Insulation", { pipe_size_mm: "6.35", thickness_mm: "44", cladding: "No" }));
