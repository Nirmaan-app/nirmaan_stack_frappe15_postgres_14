// SLICE 8 replay harness -- TEMPORARY, UNTRACKED. No AI call, no DB write.
//
// Replays every stored reply of the slice-7 payload capture through the PURE pricing module
// (`itemListPricing.priceItemList`) against a given rate-master asset, and writes one JSON row per
// BoQ row. Run BEFORE (v10 asset, unmodified module) and AFTER (v11 asset, modified module); the
// two outputs are diffed by `_slice8_replay_diff.py`.
//
// The BEFORE output is ALSO checked against the capture's own PANEL_REFUSAL / PANEL_VALUES, so the
// harness is proven to reproduce the run before any AFTER figure is trusted.
import * as fs from "fs";
import { itemListPricingSpec, priceItemList } from "../../frontend/src/pages/boq-wizard/rate-helper/itemListPricing";
import type { RateMasterItem, RateCategoryConfig } from "../../frontend/src/pages/pricing/rate-master/rateMasterTypes";

const assetPath = process.argv[2];
const capturePath = process.argv[3];
const outPath = process.argv[4];

const asset = JSON.parse(fs.readFileSync(assetPath, "utf-8"));
const discipline: string = asset.discipline;
const cfg: RateCategoryConfig = asset.category_configs.find((c: any) => c.category_id === "hvac_adp");
const spec = itemListPricingSpec(cfg);
if (!spec) throw new Error("no list_spec.pricing on hvac_adp");

// The catalogue as the endpoint hands it to the frontend: the asset's items plus the discipline.
// (`brand` is null on every ADP item, so the read-time brand projection contributes no key.)
const items: RateMasterItem[] = asset.items.map((it: any) => ({
  item_uid: it.item_uid,
  discipline,
  kind: it.kind,
  brand: it.brand ?? undefined,
  unit: it.unit,
  attributes: { ...it.attributes },
  rates: { ...it.rates },
}));

const out: any[] = [];
const lines = fs.readFileSync(capturePath, "utf-8").split(/\r?\n/).filter((l) => l.trim());
for (const line of lines) {
  const rec = JSON.parse(line);
  const extracted = (rec.MODEL_RETURNED_ITEMS ?? []).map((it: any) => ({ attributes: it.attributes ?? {} }));
  const res = priceItemList(spec, items, rec.unit, extracted);
  out.push({
    boq: rec.boq,
    sheet: rec.sheet,
    excel_row: rec.excel_row,
    unit: rec.unit,
    qty: rec.qty,
    row_text: rec.row_text,
    priced: res.priced,
    reason: res.reason ?? null,
    supply: res.priced ? res.supply : null,
    install: res.priced ? res.install : null,
    // the capture's own record of what the run showed, carried through for the BEFORE check
    cap_refusal: rec.PANEL_REFUSAL ?? null,
    cap_values: rec.PANEL_VALUES ?? null,
    pricer_typed: rec.PRICER_TYPED ?? null,
    items: res.items.map((p) => ({
      index: p.index,
      family: p.family,
      state: p.state,
      reason: p.reason ?? null,
      sku: p.sku ? `${p.sku.item_name} / ${p.sku.item_detail} (${p.sku.unit})` : null,
      sku_uid: p.sku?.item_uid ?? null,
      selection: p.selection,
      conversion: p.conversion,
      figures: p.figures,
      working: p.working,
    })),
  });
}
fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
console.log(`rows=${out.length} priced=${out.filter((r) => r.priced).length} refused=${out.filter((r) => !r.priced).length}`);
