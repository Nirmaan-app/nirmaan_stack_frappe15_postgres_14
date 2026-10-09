/** Find the REAL values for cert 9b's remaining cases, rather than assuming them. */
import HVAC from "../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v23.json";
import { itemListPricingSpec, priceItemList } from "../../frontend/src/pages/boq-wizard/rate-helper/itemListPricing";
const a = HVAC as any;
const cfg = a.category_configs.find((c: any) => c.category_id === "hvac_insulation");
const spec = itemListPricingSpec(cfg as never)!;
const items = a.items.filter((i: any) => i.kind === "hvac_insulation_item" || i.kind === "hvac_pricing_input");
const go = (fam: string, at: Record<string, string>, unit: string) => priceItemList(spec, items, unit,
  [{ attributes: Object.fromEntries(Object.entries({ item: fam, ...at }).map(([k, v]) => [k, { value: v }])) }] as any);

const TH = "Thermal Nitrile Insulation";
console.log("S5 -- a Thermal thickness NO combination reaches within 2 mm (stocked 9/13/16/19/25):");
const fails: number[] = [];
for (let t = 26; t <= 110; t++) {
  const r = go(TH, { thickness_mm: String(t), cladding: "No" }, "sqm");
  if (!r.priced) fails.push(t);
}
console.log("   unreachable:", fails.length ? fails.join(", ") : "NONE -- every value composes");

console.log("\nS2 -- a Thermal value with TWO equally-close 2-layer options (the cost tie):");
const stocked = [9, 13, 16, 19, 25];
for (let t = 26; t <= 50; t++) {
  const exact = new Set<string>();
  for (const x of stocked) for (const y of stocked) if (x <= y && x + y === t) exact.add(`${x}+${y}`);
  if (exact.size >= 2) {
    const r = go(TH, { thickness_mm: String(t), cladding: "No" }, "sqm");
    const got = (r.items ?? []).map((i: any) => i.selection?.thickness_mm).sort((p: number, q: number) => p - q).join(" + ");
    const cost = (th: number) => Number((items.find((i: any) => i.attributes?.item === TH
      && i.attributes?.thickness_mm === th && i.attributes?.cladding === "No")?.rates ?? {}).cost_insulation);
    const costs = [...exact].map((e) => `${e} = ${e.split("+").reduce((s, x) => s + cost(Number(x)), 0)}`);
    console.log(`   ${t}: options ${[...exact].join(" / ")}  costs ${costs.join(" | ")}  -> chose ${got}`);
  }
}
console.log('\nC11 -- two layers written out ("13+13"):');
for (const txt of ["13+13", "13x2", "13 + 13"]) {
  const r = go("Nitrile Rubber Insulation", { pipe_size_mm: "19.05", thickness_mm: txt, cladding: "No" }, "mts");
  const got = (r.items ?? []).map((i: any) => i.selection?.thickness_mm).join(" + ");
  console.log(`   "${txt}" -> priced=${r.priced} items=${(r.items ?? []).length} thickness=${got || "-"}` +
              (r.priced ? ` supply=${r.supply}` : ` | ${(r.reason ?? "").slice(0, 60)}`));
}
