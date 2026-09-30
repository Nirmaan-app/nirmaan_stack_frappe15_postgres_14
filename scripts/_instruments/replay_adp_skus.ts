// SLICE 12c (owner O3-a) -- ADP SKU SWEEP. No AI call, no DB write, no asset change.
//
// The owner's proof for generalising the hardcoded `family` attribute was "pricing EVERY ADP item
// through its live path before and after, 0 differences". The slice-8 capture that
// `replay_itemlist.ts` consumes was temporary and is gone, so this sweep derives its rows from the
// CATALOGUE itself: one extracted item per ADP SKU, built from that SKU's OWN attributes, priced
// through the same pure `priceItemList` the panel and the calculator call.
//
// ⚠️ IT IS A DIFFERENT KIND OF EVIDENCE FROM A REPLY REPLAY, and the difference matters. A reply
// replay exercises what the MODEL returned (including partial and unreadable answers); this sweep
// exercises every SKU the catalogue can reach, from a perfectly-stated row. It is the right shape
// for THIS change -- an attribute-id generalisation touches how a selection is keyed, which is
// exercised by any well-formed row -- and it covers SKUs no capture happened to contain. It is not
// a substitute for a reply replay when the change is about reading the model's answers.
//
// Usage: node <bundle> <assetPath> <outPath>
import * as fs from "fs";
import { itemListPricingSpec, priceItemList } from "../../frontend/src/pages/boq-wizard/rate-helper/itemListPricing";
import type { RateMasterItem, RateCategoryConfig } from "../../frontend/src/pages/pricing/rate-master/rateMasterTypes";

const assetPath = process.argv[2];
const outPath = process.argv[3];

const asset = JSON.parse(fs.readFileSync(assetPath, "utf-8"));
const discipline: string = asset.discipline;
const cfg: RateCategoryConfig = asset.category_configs.find((c: any) => c.category_id === "hvac_adp");
const spec = itemListPricingSpec(cfg);
if (!spec) throw new Error("no list_spec.pricing on hvac_adp");

const items: RateMasterItem[] = asset.items.map((it: any) => ({
  item_uid: it.item_uid,
  discipline,
  kind: it.kind,
  brand: it.brand ?? undefined,
  unit: it.unit,
  attributes: { ...it.attributes },
  rates: { ...it.rates },
}));

const kind: string = (spec as any).kind;
const unitClassAttr: string = (spec as any).unit_class_attr;
const unitClasses: Record<string, string[]> = (spec as any).unit_classes ?? {};

const out: any[] = [];
for (const it of asset.items) {
  if (it.kind !== kind) continue;
  // the row a perfectly-stated BoQ line would produce for THIS SKU: every attribute the SKU carries,
  // written as the model writes them (text), minus the unit class (which comes from the row's unit)
  const attributes: Record<string, { value: string | number | null }> = {};
  for (const [k, v] of Object.entries(it.attributes ?? {})) {
    if (k === unitClassAttr) continue;
    if (v === null || v === undefined || v === "") continue;
    attributes[k] = { value: String(v) };
  }
  // the row unit: the first spelling declared for the SKU's own unit class
  const cls = String((it.attributes ?? {})[unitClassAttr] ?? "");
  const rowUnit = (unitClasses[cls] ?? [])[0] ?? it.unit ?? "";
  const r = priceItemList(spec, items, rowUnit, [{ attributes } as any]);
  out.push({
    item_uid: it.item_uid,
    unit: rowUnit,
    priced: r.priced,
    reason: r.reason ?? null,
    supply: r.priced ? r.supply : null,
    install: r.priced ? r.install : null,
    // the SKUs actually matched, so a change that prices the same TOTAL off different rows is visible
    skus: r.items.map((p: any) => p.sku?.item_uid ?? null),
    selections: r.items.map((p: any) => p.selection ?? null),
  });
}
out.sort((a, b) => (a.item_uid < b.item_uid ? -1 : a.item_uid > b.item_uid ? 1 : 0));
fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
console.error(`swept ${out.length} ADP SKUs -> ${outPath} (priced: ${out.filter((o) => o.priced).length})`);
