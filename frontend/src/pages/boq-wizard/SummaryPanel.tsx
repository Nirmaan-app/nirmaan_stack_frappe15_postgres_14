/**
 * SummaryPanel -- top-down amount-rollup panel for the pricing editor (BoQ Phase 5).
 *
 * An Excel-pivot-style summary that opens ABOVE the pricing grid (NOT a side drawer):
 * a full-width <section>, capped at ~40vh with INTERNAL scroll (never pushes the grid
 * off-screen; the grid stays usable below), toggled by the header "Summary" button.
 *
 * DISPLAY (this is a description-plus-amounts table -- it no longer mirrors the grid's
 * full column set):
 *   - COLUMNS = a fixed-width Description/Item region + ONE column per AMOUNT descriptor
 *     (rollup.columns -- the amount columns the math produced; header + cells agree by
 *     construction). Non-amount descriptors (unit/qty/rate/append) are NOT shown.
 *   - ROWS = only Preamble + Line Item nodes (the qty-bearing/priceable types; design
 *     v1.6 §6). All other classifications (note/spacer/subtotal/header-repeat) are
 *     structural leaves and are NOT rendered. DISPLAY-ONLY: the rollup TOTALS are
 *     unchanged (priced amounts live only on these types), and because non-priceable
 *     types are leaves the filter never disconnects the tree (no re-parenting).
 *   - DEFAULT VIEW = expanded down to the SHALLOWEST preamble tier (defaultCollapsedSet,
 *     computed from the data -- 0 on a level-less sheet, 1 otherwise; never hardcoded);
 *     an "Expand all" / "Collapse all" header toggle flips the whole tree; per-row
 *     chevrons keep working independently.
 *   - DESCRIPTION = fixed width (320px) with WRAP (long text wraps to multiple lines);
 *     amount cells stay right-aligned + top-aligned (level with the first wrapped line).
 *
 * The math (rollupByParent + minPreambleDepth/defaultCollapsedSet) lives in
 * pricingRollup.ts; this file is presentational. Totals roll up from OUR OWN parenting --
 * they may legitimately differ from the client BoQ's printed subtotals (intended).
 */
import { useMemo, useState } from "react";
import { ChevronRight, AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { rollupByParent, defaultCollapsedSet, type RollupNode } from "./pricingRollup";
import type {
  ColumnDescriptor,
  ColumnFormula,
  PricedRow,
  ReconciliationChoiceRef,
} from "./boqTypes";

// Indent step per depth level (mirrors the grid's INDENT_PX feel).
const INDENT_PX = 16;
// Fixed Description/Item column width (owner-delegated; 320px for readable wrapped lines).
const ITEM_W = "w-[320px]";
// Per-amount-column width.
const COL_W = "w-28 min-w-[112px]";

// The only classifications shown as panel rows -- the priceable/qty-bearing types
// (design v1.6 §6). classification is the lowercase taxonomy (effective_classification).
const SHOWN_CLASSIFICATIONS = new Set(["preamble", "line_item"]);

/** Display a rolled amount: blank for absent, "0" for zero, locale-grouped otherwise. */
function fmtAmount(n: number | null | undefined): string {
  if (n === null || n === undefined) return "";
  if (n === 0) return "0";
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

interface FlatRow {
  node: RollupNode;
}

/**
 * Flatten the rollup forest to currently-visible rows. Only Preamble + Line Item nodes
 * are pushed (Change 2). A hidden type is a structural LEAF by design, so excluding it
 * never drops a shown row; the recurse is still guarded so that if a hidden node somehow
 * had children (contradicts the design) its shown descendants are not silently lost.
 */
function flatten(nodes: RollupNode[], collapsed: Set<number>, out: FlatRow[]) {
  for (const node of nodes) {
    const shown = SHOWN_CLASSIFICATIONS.has(node.classification ?? "");
    if (shown) out.push({ node });
    if (node.children.length > 0 && (!shown || !collapsed.has(node.rowIndex))) {
      flatten(node.children, collapsed, out);
    }
  }
}

/** Every node WITH CHILDREN in the forest (for "Collapse all" -> only roots visible). */
function allParentIndexes(roots: RollupNode[]): Set<number> {
  const set = new Set<number>();
  const walk = (n: RollupNode) => {
    if (n.children.length > 0) set.add(n.rowIndex);
    for (const c of n.children) walk(c);
  };
  for (const r of roots) walk(r);
  return set;
}

interface SummaryPanelProps {
  rows: PricedRow[];
  columnDescriptors: ColumnDescriptor[];
  /** Per-column amount formulas (get_priced_rows.column_formulas) -- makes the rollup
   *  formula-aware (the zero-fix), so formula-driven amount columns contribute instead of
   *  rolling up 0. */
  columnFormulas: ColumnFormula[];
  /** Cluster B: per-cell reconciliation choices -- the rollup resolves the CHOSEN value
   *  (document-default), so the Summary totals match what the grid cells show. */
  reconChoices: ReconciliationChoiceRef[];
  sheetName: string;
  onClose: () => void;
}

const SummaryPanel = ({ rows, columnDescriptors, columnFormulas, reconChoices, sheetName, onClose }: SummaryPanelProps) => {
  const { columns, roots, grandTotals, integrityErrors } = useMemo(
    () => rollupByParent(rows, columnDescriptors, columnFormulas, reconChoices),
    [rows, columnDescriptors, columnFormulas, reconChoices],
  );

  // Default view = expanded down to the shallowest preamble tier (computed from data).
  const [collapsed, setCollapsed] = useState<Set<number>>(() => defaultCollapsedSet(roots));

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

  const allExpanded = collapsed.size === 0;
  const toggleAll = () =>
    setCollapsed(allExpanded ? allParentIndexes(roots) : new Set<number>());

  const hasAmountCols = columns.length > 0;

  // Slice 4b-A (fix): the incomplete-subtotal signal is now ONE quiet panel-level message
  // (the per-subtotal review-STRIP entries were removed as noise -- owner option (a)). A
  // root's `incomplete` already ORs its whole subtree (rolledIncomplete), so any node anywhere
  // being incomplete makes some root incomplete. No new prop / fetch -- reads the rollup forest.
  const hasIncomplete = roots.some((r) => r.incomplete);

  return (
    <section className="rounded-md border border-border bg-background">
      {/* Header bar: title + expand/collapse-all + close */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground shrink-0">
          Summary &middot; {sheetName.trim() || sheetName}
        </h2>
        <p className="text-[11px] text-muted-foreground truncate hidden md:block">
          Totals rolled up from this BoQ&rsquo;s own parent hierarchy (may differ from the
          client&rsquo;s printed subtotals &mdash; intended).
        </p>
        <div className="ml-auto shrink-0 flex items-center gap-1">
          {hasAmountCols && (
            <button
              type="button"
              onClick={toggleAll}
              className="text-xs px-2 py-1 rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {allExpanded ? "Collapse all" : "Expand all"}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close summary"
            title="Close summary"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <span aria-hidden className="text-lg leading-none">&times;</span>
          </button>
        </div>
      </div>

      {/* Integrity banner: Option 1 (tree total) disagreed with Option 2 (flat line-item
          sum) for one or more columns -> the parent tree may be corrupted. Diagnostic: the
          grand-total row STILL shows the Option-1 value below. */}
      {integrityErrors.length > 0 && (
        <div className="flex items-start gap-2 px-3 py-2 border-b border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-xs">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300 mt-0.5" />
          <div className="text-amber-900 dark:text-amber-100">
            <p className="font-medium">Summary integrity check failed -- the row structure may be corrupted.</p>
            <ul className="mt-0.5 list-disc pl-4">
              {integrityErrors.map((e) => (
                <li key={e.col}>
                  {e.label}: tree total {fmtAmount(e.option1)} vs line-item total {fmtAmount(e.option2)}.
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Slice 4b-A (fix): ONE calm panel-level note when any priceable line isn't fully
          priced yet -- NOT per-subtotal markers (owner option (a)); muted, not an error. */}
      {hasIncomplete && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 shrink-0" />
          <span>Some priceable lines aren&rsquo;t fully priced yet.</span>
        </div>
      )}

      {!hasAmountCols ? (
        <p className="px-3 py-6 text-sm text-muted-foreground">
          This sheet has no amount columns to summarize.
        </p>
      ) : (
        // Fixed height + internal scroll -- never pushes the grid off-screen.
        <div className="overflow-auto max-h-[40vh]">
          <table className="text-xs border-collapse">
            <thead>
              <tr>
                <th
                  className={cn(
                    "px-2 py-2 text-left font-medium text-muted-foreground border-r border-border whitespace-nowrap sticky top-0 z-20 bg-muted",
                    ITEM_W,
                  )}
                >
                  Item
                </th>
                {columns.map((c) => (
                  <th
                    key={c.col}
                    className={cn(
                      "px-2 py-2 text-right font-medium text-muted-foreground border-l border-border whitespace-nowrap sticky top-0 z-20 bg-muted",
                      COL_W,
                    )}
                    title={c.label}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td
                    colSpan={1 + columns.length}
                    className="px-2 py-6 text-center text-sm text-muted-foreground"
                  >
                    No priceable rows to summarize.
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
                      {/* Left "Item" region: fixed width + WRAP; indent + chevron + text. */}
                      <td className={cn("px-2 py-1.5 align-top border-r border-border", ITEM_W)}>
                        <div
                          className="flex items-start gap-1 min-w-0"
                          style={{ paddingLeft: `${node.depth * INDENT_PX}px` }}
                        >
                          {hasChildren ? (
                            <button
                              type="button"
                              onClick={() => toggle(node.rowIndex)}
                              aria-label={isCollapsed ? "Expand" : "Collapse"}
                              className="shrink-0 mt-0.5 inline-flex h-4 w-4 items-center justify-center rounded hover:bg-muted"
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
                              "min-w-0 break-words whitespace-normal",
                              hasChildren ? "font-medium text-foreground" : "text-muted-foreground",
                            )}
                          >
                            {node.description || (
                              <span className="italic text-muted-foreground">(no description)</span>
                            )}
                          </span>
                        </div>
                      </td>
                      {/* One cell per AMOUNT column; right-aligned, top-aligned. */}
                      {columns.map((c) => (
                        <td
                          key={c.col}
                          className={cn(
                            "px-2 py-1.5 text-right align-top border-l border-border tabular-nums",
                            COL_W,
                          )}
                        >
                          {fmtAmount(node.totals[c.col])}
                        </td>
                      ))}
                    </tr>
                  );
                })
              )}
            </tbody>
            {/* Grand-total row (Option 1: sum of the top-level rolled totals, root orphans
                included; each line item counted once). Sticky to the panel's bottom edge,
                bold + a strong top border so it reads as the project total. */}
            <tfoot>
              <tr className="border-t-2 border-foreground/30 font-semibold sticky bottom-0 z-20 bg-muted">
                <td className={cn("px-2 py-2 text-left border-r border-border", ITEM_W)}>
                  Grand total
                </td>
                {columns.map((c) => (
                  <td
                    key={c.col}
                    className={cn(
                      "px-2 py-2 text-right border-l border-border tabular-nums",
                      COL_W,
                    )}
                  >
                    {fmtAmount(grandTotals[c.col])}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
};

export default SummaryPanel;
export { SummaryPanel };
