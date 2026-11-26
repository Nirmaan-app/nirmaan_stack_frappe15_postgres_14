/**
 * VAV-2b1 / VAV-2b2 -- THE SUMS OF A SHARED ITEM (share or full-rate block), split out of vavSheetShares.ts in VAV-2c1 (residence S1, the
 * 500-line limit) -- nothing changed in a figure. VAV-2c1 (R5, owner 2026-11-22 10:58 / 11:02): each sum also gives its working for one
 * side (`sideLines`), shown when the row's scope leaves the other side out. PURE.
 */
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import type { RateMasterItem } from "../../pricing/rate-master/rateMasterTypes";
import { fill } from "./vavNotAdded";
import type { ShareSku, SharePart, SheetShareDef, SheetSharesSpec, ShareWholeDef } from "./vavSheetShares";

export type ShareSum = { figures: { supply_rate: number; install_rate: number } | null; sumLines: string[]; sideLines?: { supply: string[]; install: string[] }; reason?: string };

export const fig = (n: number) => formatToRoundedIndianRupee(n).replace(/^₹/, "");
export const up = (x: number) => Math.ceil(x - 1e-9);

/** PURE. The catalogue item a share reads (live), or null. */
export function shareSkuOf(items: readonly RateMasterItem[], sku: ShareSku): RateMasterItem | null {
  return items.find((it) => it.kind === sku.kind && it.attributes?.[sku.attr] === sku.value) ?? null;
}

/** PURE. One unit of a SKU as the Rate Master prices it: ROUNDUP(BCS x (1 + markup), 0), supply and install (the family pipeline). */
export function skuUnitFigures(it: RateMasterItem): { supply: number; install: number; bcsSupply: number; bcsInstall: number; ms: number; mi: number } {
  const r = (it.rates ?? {}) as Record<string, unknown>;
  const n = (k: string) => (typeof r[k] === "number" && Number.isFinite(r[k] as number) ? (r[k] as number) : 0);
  return { supply: up(n("cost_supply") * (1 + n("supply_markup"))), install: up(n("cost_install") * (1 + n("install_markup"))),
           bcsSupply: n("cost_supply"), bcsInstall: n("cost_install"), ms: n("supply_markup"), mi: n("install_markup") };
}

export type PricedPart = { p: SharePart; count: number | null; sku: RateMasterItem | null; per?: number | null; typed?: boolean; fixed?: boolean };

/** VAV-2b1 v80 (owner 01:21 / 01:22 / 01:36 "A"; 01:39 "the helper panel should explain how the price came"). PURE. A full-rate block's
 *  sum, every step in plain words with the real numbers: the VAVs per unit (the pre-fill, on a row), each count from the VAVs, cost and
 *  quoted figures labelled, the markup shown -- PER UNIT, never divided over the boxes. DDC: (panel x 1 + controllers + sensors) cost x
 *  (1 + the panel's markup) = supply; the panel's installation x (1 + its markup) = installation (the controllers' and sensors' installation
 *  is in the panel's). */
function wholeSum(s: SheetShareDef, parts: readonly PricedPart[], vavs: number | null, L: SheetSharesSpec["labels"], w: ShareWholeDef,
  prefillLine: string | null): ShareSum {
  if (parts.some((x) => x.count === null)) return { sumLines: prefillLine ? [prefillLine] : [], figures: null, reason: L.need_vavs_whole ?? L.need_vavs };
  const word = (x: PricedPart) => { const l = x.p.label.toLowerCase(); return x.count === 1 ? l.replace(/s$/, "") : l; };
  const one = (x: PricedPart) => x.p.label.toLowerCase().replace(/s$/, "");
  const countStep = (x: PricedPart) => x.fixed || x.typed || vavs === null || !(vavs > 0) || !x.per
    ? `${x.count} ${word(x)}${x.typed ? ` (${L.changed_by_you.toLowerCase()})` : x.fixed ? "" : vavs === null ? " (type the number of VAVs to work it out)" : ""}`
    : `${vavs} VAVs / ${x.per} per ${one(x)} = ${x.count} ${word(x)} (rounded up)`;
  const lines: string[] = prefillLine ? [prefillLine] : [];
  if (s.bcs_of) {
    const own = parts.find((x) => x.p.id === s.bcs_of)!;
    const ou = skuUnitFigures(own.sku!);
    let bcsS = 0;
    for (const x of parts) {
      const c = skuUnitFigures(x.sku!).bcsSupply;
      bcsS += (x.count as number) * c;
      lines.push(x === own ? `${countStep(x)} x ${fig(c)} cost = ${fig((x.count as number) * c)}`
        : `${countStep(x)} x ${fig(c)} cost = ${fig((x.count as number) * c)} (their installation is in the ${one(own)}'s ${fig(ou.bcsInstall)})`);
    }
    const bcsI = (own.count as number) * ou.bcsInstall;
    const qs = up(bcsS * (1 + ou.ms)), qi = up(bcsI * (1 + ou.mi));
    lines.push(`cost ${fig(bcsS)} x ${1 + ou.ms} = ${fig(qs)} supply`);
    lines.push(`installation ${own.count} ${word(own)} x ${fig(ou.bcsInstall)} cost x ${1 + ou.mi} = ${fig(qi)}`);
    lines.push(`= ${fig(qs)} + ${fig(qi)} = ${fig(qs + qi)} ${w.for_count && own.count !== 1 ? fill(w.for_count, { n: own.count as number, unit: w.unit_word }) : `per ${w.unit_word}`}`);
    const per = w.for_count && own.count !== 1 ? fill(w.for_count, { n: own.count as number, unit: w.unit_word }) : `per ${w.unit_word}`;
    const installLine = `installation ${own.count} ${word(own)} x ${fig(ou.bcsInstall)} cost x ${1 + ou.mi} = ${fig(qi)}`;
    return { figures: { supply_rate: qs, install_rate: qi }, sumLines: lines, sideLines: {
      supply: [...lines.filter((l) => l !== installLine).slice(0, -1).map((l) => l.replace(/ \(their installation is in the [^)]*\)$/, "")), `= ${fig(qs)} supply ${per}`],
      install: [...(prefillLine ? [prefillLine] : []), installLine, `= ${fig(qi)} installation ${per}`] } };
  }
  const x = parts[0];
  const u = skuUnitFigures(x.sku!);
  const ts = (x.count as number) * u.supply, ti = (x.count as number) * u.install;
  lines.push(countStep(x));
  lines.push(`${x.count} x ${fig(u.supply)} supply + ${x.count} x ${fig(u.install)} installation = ${fig(ts)} + ${fig(ti)} = ${fig(ts + ti)}${w.per_unit}`);
  lines.push(`(one ${one(x)}: ${fig(u.bcsSupply)} cost x ${1 + u.ms} = ${fig(u.supply)} supply; ${fig(u.bcsInstall)} cost x ${1 + u.mi} = ${fig(u.install)} installation)`);
  const pre = lines.slice(0, -2);
  return { figures: { supply_rate: ts, install_rate: ti }, sumLines: lines, sideLines: {
    supply: [...pre, `${x.count} x ${fig(u.supply)} supply = ${fig(ts)}${w.per_unit}`, `(one ${one(x)}: ${fig(u.bcsSupply)} cost x ${1 + u.ms} = ${fig(u.supply)} supply)`],
    install: [...pre, `${x.count} x ${fig(u.install)} installation = ${fig(ti)}${w.per_unit}`, `(one ${one(x)}: ${fig(u.bcsInstall)} cost x ${1 + u.mi} = ${fig(u.install)} installation)`] } };
}

/** PURE. The sum of one share (or why it cannot be worked out yet). */
export function shareSum(s: SheetShareDef, parts: readonly PricedPart[], vavs: number | null, L: SheetSharesSpec["labels"],
  w?: { w: ShareWholeDef; prefillLine: string | null }):
  ShareSum {
  const missingSku = parts.find((x) => !x.sku);
  if (missingSku) return { sumLines: [], figures: null, reason: fill(L.no_sku, { item: missingSku.p.sku.value }) };
  if (w) return wholeSum(s, parts, vavs, L, w.w, w.prefillLine);
  if (vavs === null || !(vavs > 0) || parts.some((x) => x.count === null)) {
    return { sumLines: [], figures: null, reason: L.need_vavs };
  }
  const V = vavs;
  if (s.bcs_of) {
    // DDC panel (R3, 14:31 / 15:23): the BCS supply of every part, then the panel SKU's markups; the install = panels x its install
    const own = parts.find((x) => x.p.id === s.bcs_of)!;
    const ou = skuUnitFigures(own.sku!);
    const bcsS = parts.reduce((a, x) => a + (x.count as number) * skuUnitFigures(x.sku!).bcsSupply, 0);
    const bcsI = (own.count as number) * ou.bcsInstall;
    const qs = up(bcsS * (1 + ou.ms)), qi = up(bcsI * (1 + ou.mi));
    const ps = Math.round(qs / V), pi = Math.round(qi / V);
    const terms = parts.map((x) => `${x.p.label.toLowerCase()} ${x.count} x ${fig(skuUnitFigures(x.sku!).bcsSupply)}`).join(" + ");
    const supplyLine = `Supply: ${terms} = ${fig(bcsS)} ${L.cost_word ?? "BCS"} x ${1 + ou.ms} = ${fig(qs)}`;
    const installLine = `Installation: ${own.p.label.toLowerCase()} ${own.count} x ${fig(ou.bcsInstall)} = ${fig(bcsI)} ${L.cost_word ?? "BCS"} x ${1 + ou.mi} = ${fig(qi)}`;
    return { figures: { supply_rate: ps, install_rate: pi }, sumLines: [supplyLine, installLine, `${fig(qs + qi)} / ${V} VAVs = ${fig(ps + pi)}${L.per_box}`],
      sideLines: { supply: [supplyLine, `${fig(qs)} / ${V} VAVs = ${fig(ps)}${L.per_box}`], install: [installLine, `${fig(qi)} / ${V} VAVs = ${fig(pi)}${L.per_box}`] } };
  }
  // one counted part (R1 / R8): count x (supply + install) of one unit, shared over the VAVs
  const x = parts[0];
  const u = skuUnitFigures(x.sku!);
  const ts2 = (x.count as number) * u.supply, ti2 = (x.count as number) * u.install;
  const ps = Math.round(ts2 / V), pi = Math.round(ti2 / V);
  return { figures: { supply_rate: ps, install_rate: pi }, sumLines: [
    `${x.count} x (${fig(u.supply)} + ${fig(u.install)}) = ${fig(ts2 + ti2)} / ${V} VAVs = ${fig(ps + pi)}${L.per_box}`,
  ], sideLines: {
    supply: [`${x.count} x ${fig(u.supply)} = ${fig(ts2)} / ${V} VAVs = ${fig(ps)}${L.per_box}`],
    install: [`${x.count} x ${fig(u.install)} = ${fig(ti2)} / ${V} VAVs = ${fig(pi)}${L.per_box}`] } };
}
