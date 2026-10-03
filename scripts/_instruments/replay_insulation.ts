// SLICE 12c -- INSULATION SWEEP. No AI call, no DB write.
//
// Prices every Insulation SKU through the PRODUCT'S OWN `priceItemList` against a given asset, and
// compares each figure with THE SHEET RULE computed from the SKU's stored parts
// (`rate_composition`: parts -> x(1+wastage) -> ROUNDUP -> x(1+markup) -> ROUNDUP).
//
// That comparison is the point: v16 stops storing `cost_cladding` on the 204 pipe rows and derives it
// from the seven Pricing Inputs instead, so the only honest proof that nothing moved is that the
// pipeline reproduces the rule the sheet has always expressed -- with the cladding taken from the
// BASELINE asset's stored figure, which is what the sheet itself contained.
//
// Usage: node <bundle> <assetPath> <baselineAssetPath> [inputItem=newRate ...]
import * as fs from "fs";
import { itemListPricingSpec, priceItemList } from "../../frontend/src/pages/boq-wizard/rate-helper/itemListPricing";
import type { RateMasterItem, RateCategoryConfig } from "../../frontend/src/pages/pricing/rate-master/rateMasterTypes";

const assetPath = process.argv[2];
const basePath = process.argv[3];
const patches = process.argv.slice(4).map((s) => {
  const [item, v] = s.split("=");
  return { item, value: Number(v) };
});

const asset = JSON.parse(fs.readFileSync(assetPath, "utf-8"));
const base = JSON.parse(fs.readFileSync(basePath, "utf-8"));
const KIND = "hvac_insulation_item";
const cfg: RateCategoryConfig = asset.category_configs.find((c: any) => c.category_id === "hvac_insulation");
const spec = itemListPricingSpec(cfg);
if (!spec) throw new Error("no list_spec.pricing on hvac_insulation");

const items: RateMasterItem[] = asset.items.map((it: any) => ({
  item_uid: it.item_uid, discipline: asset.discipline, kind: it.kind,
  brand: it.brand ?? undefined, unit: it.unit,
  attributes: { ...it.attributes }, rates: { ...it.rates },
}));
// patch a pricing input in memory, exactly as the impact panel does
for (const p of patches) {
  const row = items.find((i) => i.kind === "hvac_pricing_input" && (i.attributes as any)?.item === p.item);
  if (!row) throw new Error(`no pricing input '${p.item}'`);
  const key = ["rate", "factor", "amount"].find((k) => (row.rates as any)[k] !== undefined);
  if (!key) throw new Error(`input '${p.item}' carries no value column`);
  (row.rates as any)[key] = p.value;
}

const ceil = (x: number) => Math.ceil(x - 1e-9);
/** THE SHEET RULE, from the BASELINE asset's stored parts. */
function sheetRule(r: Record<string, number>) {
  const parts = (r.cost_insulation ?? 0) + (r.cost_adhesive ?? 0) + (r.cost_cladding ?? 0);
  const bcs = ceil(parts * (1 + (r.wastage ?? 0)));
  const supply = ceil(bcs * (1 + (r.supply_markup ?? 0)));
  const inst = (r.cost_install_insulation ?? 0) + (r.cost_install_cladding ?? 0);
  const install = ceil(inst * (1 + (r.install_markup ?? 0)));
  return { bcs, supply, install };
}

const baseRates = new Map<string, Record<string, number>>();
for (const it of base.items) if (it.kind === KIND) baseRates.set(it.item_uid, it.rates);

const out: any[] = [];
for (const it of asset.items) {
  if (it.kind !== KIND) continue;
  const attrs: Record<string, { value: string | number | null }> = {};
  for (const [k, v] of Object.entries(it.attributes ?? {})) {
    if (k === "unit_class") continue;
    if (v === null || v === undefined || v === "") continue;
    attrs[k] = { value: String(v) };
  }
  const rowUnit = it.unit === "SQM" ? "sqm" : "mtr";
  const r = priceItemList(spec, items, rowUnit, [{ attributes: attrs } as any]);
  const want = sheetRule(baseRates.get(it.item_uid) || {});
  out.push({
    item_uid: it.item_uid,
    family: (it.attributes || {}).item, cladding: (it.attributes || {}).cladding,
    th: (it.attributes || {}).thickness_mm, pipe: (it.attributes || {}).pipe_size_mm,
    src: (it.source || {}).row,
    priced: r.priced, reason: r.reason ?? null,
    supply: r.priced ? r.supply : null, install: r.priced ? r.install : null,
    want_supply: want.supply, want_install: want.install,
  });
}
out.sort((a, b) => (a.item_uid < b.item_uid ? -1 : 1));
console.log(JSON.stringify(out));
