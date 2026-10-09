/**
 * U9/F3 DIAGNOSIS -- which side drops the cladding-only SKUs: the reach walk, or exactRows?
 * Read-only. Runs against the asset that matches the live config (v25).
 */
import HVAC from "../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v25.json";
import { computePricingInputReach } from "../../frontend/src/pages/pricing/rate-master/pricingInputReach";
import { confirmedCandidateSkus } from "../../frontend/src/pages/pricing/rate-master/pricingInputExact";

const INS = "hvac_insulation";
const cfgs = (HVAC as any).category_configs;
const ins = cfgs.find((c: any) => c.category_id === INS);
const items = (HVAC as any).items as any[];

// the cladding-only population: no pipe size, no thickness, and NO supply cost column
const cladOnly = items.filter(
  (i: any) => String(i.kind ?? "").includes("insulation")
    && !i.attributes?.pipe_size_mm && !i.attributes?.thickness_mm
    && i.attributes?.cladding && i.attributes?.cladding !== "No",
);
console.log(`cladding-only SKUs in the asset: ${cladOnly.length}`);
for (const c of cladOnly) {
  console.log(`  ${c.item_uid}  cladding=${c.attributes.cladding}  unit=${c.unit}  rate keys=[${Object.keys(c.rates ?? {}).sort().join(", ")}]`);
}

const reach = computePricingInputReach({ [INS]: ins } as any, items);
const coUids = new Set(cladOnly.map((c: any) => c.item_uid));
const inputName = new Map<string, string>();
for (const it of items) if (String(it.kind ?? "").endsWith("pricing_input")) inputName.set(it.item_uid, String(it.attributes?.item ?? it.item_uid));

console.log(`\n--- SIDE A: does the REACH WALK carry them? ---`);
for (const [id, r] of Object.entries(reach as any)) {
  const cols = (r as any).columns ?? [];
  const uids = new Set(cols.map((c: any) => c.itemUid));
  const hit = [...uids].filter((u: any) => coUids.has(u));
  const keys = [...new Set(cols.map((c: any) => c.rateKey))].sort();
  console.log(`  ${(inputName.get(id) ?? id).padEnd(26)} ${String(uids.size).padStart(4)} SKUs | cladding-only: ${hit.length} | adder=${(r as any).isFlatAdder} | rate keys: ${keys.join(", ")}`);
}

console.log(`\n--- the test that excludes them (pricingInputReach matching()) ---`);
const allKeys = new Set<string>();
for (const r of Object.values(reach as any)) for (const c of ((r as any).columns ?? [])) allKeys.add(c.rateKey);
console.log(`  rate keys any reach column asks for: ${[...allKeys].sort().join(", ")}`);
for (const c of cladOnly.slice(0, 2)) {
  const stored = new Set(Object.keys(c.rates ?? {}));
  const missing = [...allKeys].filter((k) => !stored.has(k));
  console.log(`  ${c.item_uid}: stores none of [${missing.sort().join(", ")}] -> dropped by \`rates[rateKey] === undefined\``);
}

console.log(`
--- SIDE A2: the CANDIDATE channel + confirmation (post-fix) ---`);
const byUid = new Map(items.map((i: any) => [i.item_uid, i]));
for (const [id, r] of Object.entries(reach as any)) {
  const cands = (r as any).candidateSkus ?? [];
  const confirmed = confirmedCandidateSkus(cands, byUid as any, { [INS]: ins } as any, items as any, id);
  const names = confirmed.map((c: any) => String(byUid.get(c.itemUid)?.attributes?.cladding ?? "?"));
  console.log(`  ${(inputName.get(id) ?? id).padEnd(26)} candidates=${String(cands.length).padStart(2)} confirmed=${confirmed.length}  ${names.join(" | ")}`);
}
