/**
 * VAV-2c1 (R5) -- THE WORKING LINES FOLLOW THE ROW'S SCOPE.
 *
 * Owner 2026-11-22 10:58 "thi soption should be be given in both helper panel and calculaor and the workings should chang ebased on the
 * selction"; 11:02 "yes for both": under "Installation only" each item shows supply 0 "not in scope", under "Supply only" each item shows
 * install 0 "not in scope", and the lines add up to the row total. The total itself never moves: it is the scope step's
 * (`withScopeCore`), and the lines are fitted to it.
 *
 * ONE place for the helper panel and the Calculator, and for every category: the last step of the scope rule hands the row's view here,
 * and only when its scope config declares `lines_follow` (a category without it is untouched). A LINE is an item of the row, a section of
 * another category's item, an extra, or a shared item. PURE.
 */
import type { ItemListPricingSpec } from "./itemListPricing";
import type { RateKind } from "./rateHelperTypes";
import type { ExtraLineView, ItemBlockView, ItemListView, SectionBlockView } from "./pricingSheetHelper";
import type { SharedItemView } from "./vavSheetShares";
import { fig } from "./vavShareSums";

export interface ScopeFollow {
  /** "not in scope" (`scope.lines_follow.word`) */
  word: string;
  supplyOnly: boolean;
  /** the installation-only uplift that applied to this row (0 = the normal rate) and how the note writes it ("50%") */
  uplift: number;
  pct: string;
  /** the scope step already scaled each item and extra by itself (every line of the row is one of them) */
  perLine: boolean;
}

/** The side a line's figures leave out: the panel writes "Supply 0 per Nos - not in scope". */
export interface NotInScope { kind: "supply_rate" | "install_rate"; word: string }

type Figures = Partial<Record<RateKind, number>>;
type Side = "supply" | "install";
const SIDE_LINE: Record<Side, RegExp> = { supply: /^\s*(?:item )?supply\s*:/i, install: /^\s*(?:item )?install\s*:/i };

/** PURE. A line's working with one side's steps replaced by "<side>: 0 - <word>" where the first of them stood; a working that writes both
 *  sides in one line keeps it and gets the line after it. */
export function workingWithoutSide(working: readonly string[], side: Side, word: string): string[] {
  const line = `${side}: 0 - ${word}`;
  const at = working.findIndex((l) => SIDE_LINE[side].test(l));
  if (at < 0) return [...working, line];
  return working.filter((l, i) => i === at || !SIDE_LINE[side].test(l)).map((l, i) => (i === at ? line : l));
}

const sup = (f: Figures | null | undefined) => f?.supply_rate ?? 0;
const ins = (f: Figures | null | undefined) => f?.install_rate ?? 0;
const ceil = (n: number) => Math.ceil(n - 1e-9) + 0;

/**
 * PURE. The scoped view with every line's figures and working following the scope. `before` = the row before the scope step (each line at
 * its supply + installation figures), `after` = the scope step's own result. Where the step scaled the ROW (a section or a shared item is
 * on it), the installation of each line is its share of the row's one rounding: cumulative, so the lines add up to the total exactly.
 */
export function withScopeLines(before: ItemListView, after: ItemListView, f: ScopeFollow): ItemListView {
  const out: Side = f.supplyOnly ? "install" : "supply";
  const notInScope: NotInScope = { kind: f.supplyOnly ? "install_rate" : "supply_rate", word: f.word };
  let cum = 0, given = 0;
  const scoped = (b: Figures, own?: Figures): Figures => {
    if (f.supplyOnly) return { supply_rate: sup(b), install_rate: 0, combined_rate: sup(b) };
    if (f.perLine && own) return own;
    cum += ins(b);
    const upTo = ceil(cum * (1 + f.uplift));
    const i = upTo - given;
    given = upTo;
    return { supply_rate: 0, install_rate: i, combined_rate: i };
  };
  const workingOf = (working: readonly string[], b: Figures, a: Figures): string[] => {
    // VRF-8 (owner R-F2): an item whose catalogue installation is 0 charged at its full cost -- the cost steps are the installation's
    if (!f.supplyOnly && ins(b) === 0 && sup(b) > 0 && ins(a) === sup(b)) {
      return [...working.filter((l) => !SIDE_LINE.install.test(l)).map((l) => l.replace(SIDE_LINE.supply, "full cost:")),
        `supply: 0 - ${f.word}`, `install: ${ins(a)} - its full cost (its catalogue installation rate is 0)`];
    }
    const lines = workingWithoutSide(working, out, f.word);
    if (f.supplyOnly || !(f.uplift > 0) || !(ins(b) > 0)) return lines;
    const alone = ceil(ins(b) * (1 + f.uplift));
    return [...lines, `install: ${ins(b)} x (1 + ${f.pct}) = ${ins(a)}${alone === ins(a) ? "" : " (rounded with the row's other lines)"}`];
  };
  const section = (sv: SectionBlockView): SectionBlockView => {
    const items = sv.view.items.map((b) => block(b));
    const priced = items.filter((b) => b.state === "priced");
    return { ...sv, view: { ...sv.view, items, ...(sv.view.totals ? { totals: sumOf(priced.map((b) => b.figures)) } : {}) } };
  };
  const block = (b: ItemBlockView, own?: ItemBlockView): ItemBlockView => {
    const figures = b.state === "priced" ? scoped(b.figures, own?.figures) : b.figures;
    return {
      ...(own ?? b),
      ...(b.state === "priced" ? { figures, working: workingOf(b.working, b.figures, figures), notInScope } : {}),
      ...(b.sections ? { sections: b.sections.map(section) } : {}),
      ...(b.extras ? { extras: { ...b.extras, lines: b.extras.lines.map((l, j) => extra(l, own?.extras?.lines[j])) } } : {}),
    };
  };
  const extra = (l: ExtraLineView, own?: ExtraLineView): ExtraLineView => {
    if (l.state !== "priced") return own ?? l;
    const figures = scoped(l.figures, own?.figures);
    return { ...(own ?? l), figures, working: workingOf(l.working, l.figures, figures), notInScope };
  };
  const share = (b: SharedItemView): SharedItemView => {
    if (!b.figures) return b;
    const a = scoped(b.figures);
    const kept = b.amountTyped ? b.sumLines : (b.sideLines?.[f.supplyOnly ? "supply" : "install"] ?? b.sumLines);
    const up = !f.supplyOnly && f.uplift > 0 && ins(b.figures) > 0 ? [`install ${fig(ins(b.figures))} x (1 + ${f.pct}) = ${fig(ins(a))}`] : [];
    return { ...b, figures: { supply_rate: sup(a), install_rate: ins(a) }, sumLines: [...kept, ...up], notInScope };
  };
  const items = before.items.map((b, i) => block(b, after.items[i]));
  const independent = before.sections?.independent.map(section);
  const blocks = before.shares?.blocks.map(share);
  return {
    ...after,
    items,
    ...(after.sections && independent ? { sections: { ...after.sections, independent } } : {}),
    ...(after.shares && blocks ? { shares: { ...after.shares, blocks, totals: {
      supply_rate: blocks.reduce((t, b) => t + sup(b.figures ?? undefined), 0), install_rate: blocks.reduce((t, b) => t + ins(b.figures ?? undefined), 0) } } } : {}),
  };
}

/** VAV-2c1 (QR-SC2, owner 2026-11-22 20:09 "option a fopr 3"). PURE. The "Review before using" text of a row whose scope leaves a side out: the
 *  same block, each extra at the amount its line shows, the total as the row's. `view` = the scoped view (its lines already follow). */
export function scopedWarning(cw: NonNullable<ItemListPricingSpec["combination_warning"]>, view: ItemListView): string {
  const boxes = new Set(cw.box_families);
  const both = (f: Figures | null | undefined) => sup(f) + ins(f);
  const priced = view.items.filter((b) => b.state === "priced");
  const isBox = (b: ItemBlockView) => b.family !== null && boxes.has(b.family);
  const named = [
    ...priced.filter((b) => b.family !== null && !isBox(b)).map((b) => ({ label: b.familyLabel ?? b.family ?? "", amount: both(b.figures) })),
    ...[...view.items.flatMap((b) => b.sections ?? []), ...(view.sections?.independent ?? [])].flatMap((sv) => sv.view.items.filter((b) => b.state === "priced")
      .map((b) => ({ label: b.familyLabel ?? b.family ?? sv.heading, amount: both(b.figures) }))),
    ...(view.shares?.blocks ?? []).filter((b) => b.figures).map((b) => ({ label: b.label, amount: both(b.figures) })),
  ];
  const y = both(view.totals), x = y - priced.filter(isBox).reduce((t, b) => t + both(b.figures), 0);
  const put = (t: string) => t.split("{n}").join(String(named.length)).split("{x}").join(fig(x)).split("{y}").join(fig(y));
  if (cw.names) {
    return [named.length === 1 ? cw.names.intro_one : put(cw.names.intro), ...named.map((e) => cw.names!.extra.split("{label}").join(e.label).split("{x}").join(fig(e.amount))), put(cw.names.total)].join("\n");
  }
  return put(named.length === 1 && cw.line_one ? cw.line_one : cw.line);
}

function sumOf(figures: readonly Figures[]): Figures {
  const s = figures.reduce<number>((t, f) => t + sup(f), 0), i = figures.reduce<number>((t, f) => t + ins(f), 0);
  return { supply_rate: s, install_rate: i, combined_rate: s + i };
}

/** PURE. Every line's figures of a view (the items, their sections and extras, the independent sections, the shared items): what adds up
 *  to the row total. */
export function lineFigures(view: ItemListView): Figures[] {
  const of = (sv: SectionBlockView) => sv.view.items.filter((b) => b.state === "priced").map((b) => b.figures);
  return [
    ...view.items.flatMap((b) => [...(b.state === "priced" ? [b.figures] : []), ...(b.sections ?? []).flatMap(of),
      ...(b.extras?.lines ?? []).filter((l) => l.state === "priced").map((l) => l.figures)]),
    ...(view.sections?.independent ?? []).flatMap(of),
    ...(view.shares?.blocks ?? []).flatMap((b) => (b.figures ? [b.figures] : [])),
  ];
}
