/**
 * SummaryPanel -- top-down, grid-aligned amount-rollup panel for the pricing editor
 * (BoQ Phase 5).
 *
 * An Excel-pivot-style summary that opens ABOVE the pricing grid (NOT a side drawer):
 *   - FULL-WIDTH, TOP-DOWN: a plain <section> in the page flow above the grid.
 *   - GRID-ALIGNED (best-effort, owner-accepted -- NOT pixel-perfect): the panel renders
 *     a <table> mirroring the grid's column STRUCTURE -- it reproduces the grid's
 *     non-anchor descriptor columns (displayDescriptors, same Excel order) with the SAME
 *     width classes the grid uses (`w-28 min-w-[112px]`), preceded by ONE left "Item"
 *     region whose min-width (~616px) matches the grid's 5 anchor columns combined. Both
 *     tables are `w-full` auto-layout, so they stretch alike. A rollup number sits in the
 *     same column position as the grid amount column it totals; non-amount columns
 *     (unit/qty/rate/append) render as blank spacer cells so the amount columns line up.
 *     (Pixel-perfect alignment was NOT pursued -- it would require making the grid
 *     `table-fixed` / a shared colgroup, an out-of-scope PricingGrid change. Owner chose
 *     "same column order, best-effort widths".)
 *   - FIXED HEIGHT + INTERNAL SCROLL: capped at ~40vh; the tree scrolls inside; the grid
 *     stays usable below and is never pushed off-screen.
 *
 * The collapsible parent tree uses a flat `collapsed` Set + a visibility flatten (the
 * ReviewTree/PricingGrid table-tree idiom) rather than the Collapsible primitive, because
 * wrapping <tr> rows in a Collapsible div is invalid table markup. Behaviour is unchanged:
 * expand/collapse a parent; expansion depth = aggregation level.
 *
 * Presentational: it memoizes rollupByParent (pure, page-side, no backend call) and
 * renders it. The summing rule (priced-preamble own-row-only, amount-presence selection,
 * column-by-column, cycle-safe) lives entirely in pricingRollup.ts.
 *
 * Totals roll up from OUR OWN parenting -- they may legitimately differ from the client
 * BoQ's printed subtotals (those are unreliable; we aggregate by our hierarchy). Intended.
 */
import { useMemo, useState } from "react";
import { ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { isAmountDescriptor } from "./PricingGrid";
import { rollupByParent, type RollupNode } from "./pricingRollup";
import { ROLE_LABELS } from "./boqTypes";
import type { ColumnDescriptor, PricedRow } from "./boqTypes";

// Indent step per depth level (mirrors the grid's INDENT_PX feel).
const INDENT_PX = 16;

// The two roles the grid renders as fixed anchors (excluded from its descriptor columns).
// Mirrors PricingGrid.FIXED_ROLE_DEDUPE (kept in sync; not exported there -- the same
// local-mirror pattern PricingGrid itself uses to mirror ReviewTree).
const FIXED_ROLE_DEDUPE = new Set(["sl_no", "description"]);

// The grid's left region = 5 anchor columns (Excel Row/Sl.No/Parent = w-16 each = 64px,
// Classification w-36 = 144px, Description min-w-[280px]) -> ~616px combined min-width.
// The panel's single "Item" region uses the same min so it best-effort aligns under w-full.
const ITEM_MIN_W = "min-w-[616px]";
// Per-descriptor-column width -- byte-identical to the grid's descriptor <th>/<td>.
const COL_W = "w-28 min-w-[112px]";

/** Display a rolled amount: blank for absent, "0" for zero, locale-grouped otherwise. */
function fmtAmount(n: number | null | undefined): string {
  if (n === null || n === undefined) return "";
  if (n === 0) return "0";
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** Mirror the grid header label for a descriptor (`${col} — ${role}${ · area}`). */
function columnLabel(d: ColumnDescriptor): string {
  return `${d.col} — ${ROLE_LABELS[d.role] ?? d.role}${d.area ? ` · ${d.area}` : ""}`;
}

interface FlatRow {
  node: RollupNode;
}

/** Flatten the rollup forest to the currently-visible rows (children hidden when an
 *  ancestor is collapsed). Mirrors the ReviewTree table-tree visibility idiom. */
function flatten(nodes: RollupNode[], collapsed: Set<number>, out: FlatRow[]) {
  for (const node of nodes) {
    out.push({ node });
    if (node.children.length > 0 && !collapsed.has(node.rowIndex)) {
      flatten(node.children, collapsed, out);
    }
  }
}

interface SummaryPanelProps {
  rows: PricedRow[];
  columnDescriptors: ColumnDescriptor[];
  sheetName: string;
  onClose: () => void;
}

const SummaryPanel = ({ rows, columnDescriptors, sheetName, onClose }: SummaryPanelProps) => {
  // collapsed Set (default empty = fully expanded). Toggling a parent hides its subtree.
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  // displayDescriptors = the grid's non-anchor columns, same Excel order -> the panel
  // reproduces them all (amounts filled, the rest blank) so amount columns line up.
  const displayDescriptors = useMemo(
    () => columnDescriptors.filter((d) => !FIXED_ROLE_DEDUPE.has(d.role)),
    [columnDescriptors],
  );

  const { columns, roots } = useMemo(
    () => rollupByParent(rows, columnDescriptors),
    [rows, columnDescriptors],
  );

  const visible = useMemo(() => {
    const out: FlatRow[] = [];
    flatten(roots, collapsed, out);
    return out;
  }, [roots, collapsed]);

  const toggle = (rowIndex: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(rowIndex)) next.delete(rowIndex);
      else next.add(rowIndex);
      return next;
    });

  const hasAmountCols = columns.length > 0;

  return (
    <section className="rounded-md border border-border bg-background">
      {/* Header bar: title + close */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground">
          Summary &middot; {sheetName.trim() || sheetName}
        </h2>
        <p className="text-[11px] text-muted-foreground truncate hidden sm:block">
          Totals rolled up from this BoQ&rsquo;s own parent hierarchy (may differ from the
          client&rsquo;s printed subtotals &mdash; intended).
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close summary"
          title="Close summary"
          className="ml-auto shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {!hasAmountCols ? (
        <p className="px-3 py-6 text-sm text-muted-foreground">
          This sheet has no amount columns to summarize.
        </p>
      ) : (
        // Fixed height + internal scroll -- never pushes the grid off-screen.
        <div className="overflow-auto max-h-[40vh]">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr>
                <th
                  className={cn(
                    "px-2 py-2 text-left font-medium text-muted-foreground border-r border-border whitespace-nowrap sticky top-0 z-20 bg-muted",
                    ITEM_MIN_W,
                  )}
                >
                  Item
                </th>
                {displayDescriptors.map((d) => (
                  <th
                    key={d.col}
                    className={cn(
                      "px-2 py-2 text-right font-medium text-muted-foreground border-l border-border whitespace-nowrap sticky top-0 z-20 bg-muted",
                      COL_W,
                    )}
                    title={columnLabel(d)}
                  >
                    {columnLabel(d)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td
                    colSpan={1 + displayDescriptors.length}
                    className="px-2 py-6 text-center text-sm text-muted-foreground"
                  >
                    No rows to summarize.
                  </td>
                </tr>
              ) : (
                visible.map(({ node }) => {
                  const hasChildren = node.children.length > 0;
                  const isCollapsed = collapsed.has(node.rowIndex);
                  return (
                    <tr
                      key={node.rowIndex}
                      className="border-b border-border hover:bg-muted/30"
                    >
                      {/* Left "Item" region: indent + expand chevron + description. */}
                      <td className={cn("px-2 py-1.5 align-top border-r border-border", ITEM_MIN_W)}>
                        <div
                          className="flex items-center gap-1 min-w-0"
                          style={{ paddingLeft: `${node.depth * INDENT_PX}px` }}
                        >
                          {hasChildren ? (
                            <button
                              type="button"
                              onClick={() => toggle(node.rowIndex)}
                              aria-label={isCollapsed ? "Expand" : "Collapse"}
                              className="shrink-0 inline-flex h-4 w-4 items-center justify-center rounded hover:bg-muted"
                            >
                              <ChevronRight
                                className={cn(
                                  "h-3.5 w-3.5 transition-transform",
                                  !isCollapsed && "rotate-90",
                                )}
                              />
                            </button>
                          ) : (
                            <span className="inline-block h-4 w-4 shrink-0" aria-hidden />
                          )}
                          <span
                            className={cn(
                              "truncate",
                              hasChildren ? "font-medium text-foreground" : "text-muted-foreground",
                            )}
                            title={node.description ?? undefined}
                          >
                            {node.description || (
                              <span className="italic text-muted-foreground">(no description)</span>
                            )}
                          </span>
                        </div>
                      </td>
                      {/* One cell per grid descriptor column; amounts filled, rest blank. */}
                      {displayDescriptors.map((d) => (
                        <td
                          key={d.col}
                          className={cn(
                            "px-2 py-1.5 text-right align-top border-l border-border tabular-nums",
                            COL_W,
                          )}
                        >
                          {isAmountDescriptor(d) ? fmtAmount(node.totals[d.col]) : ""}
                        </td>
                      ))}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};

export default SummaryPanel;
export { SummaryPanel };
