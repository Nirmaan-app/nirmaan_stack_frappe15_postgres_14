/**
 * CERT 9b -- the owner's 19 composition cases, every figure computed IN ADVANCE from the SHIPPED asset.
 *
 * The owner's set is C1-C13 + S1-S5 + P1 = 19. The 2026-10-04 revision replaced P1 with THREE PUF cases
 * (100 -> 50+50, 75 -> not priced, 25 -> 50), so the table below carries 21 rows for the 19 cases.
 *
 * Per case it prints what the browser must show: the ITEMS, the "You typed ..." composition line, WHICH
 * item carries the cladding, and the price to the rupee.
 */
import HVAC from "../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v25.json";
import { itemListPricingSpec, priceItemList } from "../../frontend/src/pages/boq-wizard/rate-helper/itemListPricing";

const a = HVAC as any;
const cfg = a.category_configs.find((c: any) => c.category_id === "hvac_insulation");
const spec = itemListPricingSpec(cfg as never)!;
const items = a.items.filter((i: any) => i.kind === "hvac_insulation_item" || i.kind === "hvac_pricing_input");
const NR = "Nitrile Rubber Insulation", PUF = "Tubular Puf Insulation", TH = "Thermal Nitrile Insulation";
const FG = " Fiberglass Rigid Board Insulation, Density 48Kg/m3";

function go(fam: string, at: Record<string, string>, unit: string) {
  return priceItemList(spec, items, unit, [{ attributes: Object.fromEntries(
    Object.entries({ item: fam, ...at }).map(([k, v]) => [k, { value: v }])) }] as any);
}

function show(id: string, label: string, fam: string, at: Record<string, string>, unit: string) {
  const r: any = go(fam, at, unit);
  const its: any[] = r.items ?? [];
  const layers = its.map((x) => x.selection?.thickness_mm).join(" + ") || "-";
  const clads = its.map((x, i) => (i + 1) + ":" + String(x.selection?.cladding ?? "-"));
  const typed = (its[0]?.working ?? []).find((l: string) => l.indexOf("You typed") === 0
    || l.indexOf("BoQ says") === 0) ?? "";
  console.log("## " + id + "  " + label);
  console.log("   verdict : " + (r.priced ? "PRICED" : "NOT PRICED"));
  console.log("   items   : " + its.length + "   thickness: " + layers);
  console.log("   cladding: " + clads.join("  "));
  if (r.priced) console.log("   price   : supply=" + r.supply + "  install=" + r.install
    + "  combined=" + (Number(r.supply) + Number(r.install)));
  else console.log("   reason  : " + r.reason);
  if (typed) console.log("   line    : " + typed);
  const notes = (its[0]?.working ?? []).filter((l: string) => l !== typed);
  if (notes.length) console.log("   working : " + notes.join(" | "));
  console.log("");
}

const P = "19.05";
console.log("================ NITRILE RUBBER, pipe 19.05 (stocks 13 / 19 / 25), no cladding ================\n");
show("C1", "thickness 32", NR, { pipe_size_mm: P, thickness_mm: "32", cladding: "No" }, "mts");
show("C2", "thickness 30", NR, { pipe_size_mm: P, thickness_mm: "30", cladding: "No" }, "mts");
show("C3", "thickness 27", NR, { pipe_size_mm: P, thickness_mm: "27", cladding: "No" }, "mts");
show("C4", "thickness 29", NR, { pipe_size_mm: P, thickness_mm: "29", cladding: "No" }, "mts");
show("C5", "thickness 38 -- the C-R1 cost tie-break", NR, { pipe_size_mm: P, thickness_mm: "38", cladding: "No" }, "mts");
show("C6", "thickness 50", NR, { pipe_size_mm: P, thickness_mm: "50", cladding: "No" }, "mts");
show("C7", "thickness 64", NR, { pipe_size_mm: P, thickness_mm: "64", cladding: "No" }, "mts");
show("C8", "thickness 100 -- max_layers 4", NR, { pipe_size_mm: P, thickness_mm: "100", cladding: "No" }, "mts");
show("C9", "thickness 110 -- beyond 4 layers", NR, { pipe_size_mm: P, thickness_mm: "110", cladding: "No" }, "mts");
show("C10", "thickness 25 at pipe 6.35", NR, { pipe_size_mm: "6.35", thickness_mm: "25", cladding: "No" }, "mts");
show("C11", "thickness typed as '13+13' (arithmetic entry)", NR, { pipe_size_mm: P, thickness_mm: "13+13", cladding: "No" }, "mts");
show("C12", "thickness 20 -- the LADDER, not a composition", NR, { pipe_size_mm: P, thickness_mm: "20", cladding: "No" }, "mts");
show("C13", "thickness 32 at pipe typed 3/4 inch", NR, { pipe_size_mm: "3/4\"", thickness_mm: "32", cladding: "No" }, "mts");

console.log("================ THE SAME, WITH 26G ALUMINIUM -- the OUTER layer only ================\n");
show("C1-clad", "32 with 26G Aluminium", NR, { pipe_size_mm: P, thickness_mm: "32", cladding: "26G Aluminium" }, "mts");
show("C5-clad", "38 with 26G Aluminium", NR, { pipe_size_mm: P, thickness_mm: "38", cladding: "26G Aluminium" }, "mts");
show("C6-clad", "50 with 26G Aluminium", NR, { pipe_size_mm: P, thickness_mm: "50", cladding: "26G Aluminium" }, "mts");

console.log("================ SHEET INSULATION, per sq.m ================\n");
show("S1", "Thermal Nitrile 30 -- closeness beats cost", TH, { thickness_mm: "30", cladding: "No" }, "sqm");
show("S2", "Thermal Nitrile 32 -- two exact 2-layer fits, cost decides", TH, { thickness_mm: "32", cladding: "No" }, "sqm");
show("S3", "Fiberglass 48Kg 75", FG, { thickness_mm: "75", cladding: "No" }, "sqm");
show("S4", "Thermal Nitrile 30 with Aluminium Foil", TH, { thickness_mm: "30", cladding: "Aluminium Foil" }, "sqm");
show("S5", "Thermal Nitrile 97 -- unreachable", TH, { thickness_mm: "97", cladding: "No" }, "sqm");

console.log("================ TUBULAR PUF -- pipe 50 stocks thickness 50 ONLY (C-R2 / C-R3) ================\n");
show("P1a", "PUF 100 at pipe 50", PUF, { pipe_size_mm: "50", thickness_mm: "100", cladding: "No" }, "mts");
show("P1b", "PUF 75 at pipe 50 -- cannot mix pipe sizes", PUF, { pipe_size_mm: "50", thickness_mm: "75", cladding: "No" }, "mts");
show("P1c", "PUF 25 at pipe 50 -- C-R3 next size up", PUF, { pipe_size_mm: "50", thickness_mm: "25", cladding: "No" }, "mts");
