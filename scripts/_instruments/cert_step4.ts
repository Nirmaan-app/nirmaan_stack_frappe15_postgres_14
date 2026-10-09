/**
 * CERT STEP 4 -- the 26G sheet input 450 -> 500, predicted IN ADVANCE from the shipped asset.
 *
 * Three rows, chosen so the test has a negative half: a 26G-clad row MUST move, a 24G-clad row and a
 * GI-framework row MUST NOT. Read-only; prints what the screen has to show after the save.
 *
 * ⚠️ DO NOT TRUST THIS PROBE OVER THE SCREEN. Its 26G / 24G / no-cladding figures matched the
 * product exactly (623/238/861 -> 639/238/877, and the two negatives unchanged), but its GI-FRAMEWORK
 * figure was WRONG: it predicted supply 1346 where the product quotes 2162, because it under-prices
 * that family's cladding branch. The product's own working is the authority -- it showed
 * `gi_sheet_rate = 450`, `gi_framework_factor = 0.9`, `gi_framework_adder = 150` and cladding = 1110,
 * and it never reads `alu_sheet_26g`, which is the fact step 4's negative half actually needs.
 *
 * The lesson is the standing one (owner, 2026-09-29): re-deriving pricing outside the product's own
 * pricer is the bet that already failed once. This file is a CONVENIENCE for stating a figure in
 * advance, not a second implementation -- where it disagrees with the screen, it is the one that is
 * wrong.
 */
import HVAC from "../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v25.json";
import { itemListPricingSpec, priceItemList } from "../../frontend/src/pages/boq-wizard/rate-helper/itemListPricing";

const a = HVAC as any;
const cfg = a.category_configs.find((c: any) => c.category_id === "hvac_insulation");
const spec = itemListPricingSpec(cfg as never)!;
const base = a.items.filter((i: any) => i.kind === "hvac_insulation_item" || i.kind === "hvac_pricing_input");

/** the catalogue with ONLY the 26G sheet input moved to `rate` */
function patched(rate: number) {
  return base.map((i: any) =>
    i.kind === "hvac_pricing_input" && i.attributes?.item === "alu_sheet_26g"
      ? { ...i, rates: { ...(i.rates ?? {}), rate } }
      : i);
}

const NR = "Nitrile Rubber Insulation";
const FG = " Fiberglass Rigid Board Insulation, Density 48Kg/m3";

function price(items: any[], fam: string, at: Record<string, string>, unit: string) {
  const r: any = priceItemList(spec, items, unit, [{ attributes: Object.fromEntries(
    Object.entries({ item: fam, ...at }).map(([k, v]) => [k, { value: v }])) }] as any);
  return { supply: r.priced ? r.supply : null, install: r.priced ? r.install : null,
           combined: r.priced ? Number(r.supply) + Number(r.install) : null,
           priced: !!r.priced, reason: r.reason };
}

const CASES: Array<[string, string, Record<string, string>, string]> = [
  ["26G clad row  (MUST move)", NR, { pipe_size_mm: "19.05", thickness_mm: "32", cladding: "26G Aluminium" }, "mts"],
  ["24G clad row  (must NOT)",  NR, { pipe_size_mm: "19.05", thickness_mm: "32", cladding: "24G Aluminium" }, "mts"],
  ["GI framework  (must NOT)",  FG, { thickness_mm: "25", cladding: "GI Framework with perforated Al sheet" }, "sqm"],
  ["no cladding   (must NOT)",  NR, { pipe_size_mm: "19.05", thickness_mm: "32", cladding: "No" }, "mts"],
];

const at450 = patched(450), at500 = patched(500);
console.log("case                           | at 450 (now)        | at 500 (after save) | delta");
console.log("-------------------------------|---------------------|---------------------|-------");
for (const [label, fam, at, unit] of CASES) {
  const b = price(at450, fam, at, unit);
  const n = price(at500, fam, at, unit);
  const d = (b.combined != null && n.combined != null) ? (n.combined - b.combined) : null;
  const f = (x: any) => `${x.supply}/${x.install}/${x.combined}`;
  console.log(`${label.padEnd(30)} | ${f(b).padEnd(19)} | ${f(n).padEnd(19)} | ${d === 0 ? "UNCHANGED" : "+" + d}`);
}
