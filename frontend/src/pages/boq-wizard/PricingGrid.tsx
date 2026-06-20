/**
 * PricingGrid -- READ-ONLY committed-pricing grid (BoQ Phase 5 Slice 3a).
 *
 * The first on-screen pricing surface. Renders the committed rows of one sheet (from
 * get_priced_rows) with their current saved rates shown + a basic priced/un-priced
 * marker on rate cells. Mirrors ReviewTree's descriptor-render loop but REUSES the
 * extracted reviewRender helpers (design v1.3 Sec.4 path b) -- it does NOT import,
 * reuse, or retune the ReviewTree component.
 *
 * READ-ONLY: no detail panel, no inline edit, no reclassify, no AI columns, no
 * restructure modal, no remarks, no search/filter, no column-subset selector. Inline
 * rate editing is Slice 3b; the rich review-flag layer ("needs a rate" / "won't
 * compute") is Slice 4b.
 */
import { cn } from "@/lib/utils";
import {
  ClassificationPill,
  computeDepths,
  renderDescriptorCell,
  resolveDescriptorValue,
} from "./reviewRender";
import { ROLE_LABELS } from "./boqTypes";
import type { ColumnDescriptor, PricedRow } from "./boqTypes";

// Depth indent step -- mirrors ReviewTree.INDENT_PX (kept in sync; the pricing grid does
// not import ReviewTree per design v1.3 Sec.4 path b).
const INDENT_PX = 20;

// The two roles rendered as fixed anchor columns (Sl.No, Description), excluded from the
// descriptor-driven column set. Mirrors ReviewTree.FIXED_ROLE_DEDUPE (kept in sync; the
// pricing grid does not import ReviewTree -- the locked no-ReviewTree-import design call).
const FIXED_ROLE_DEDUPE = new Set(["sl_no", "description"]);

// A rate cell is the ONLY cell that carries a price + a priced marker. A column_descriptor
// identifies a rate cell by its value_field -- mirrors the backend overlay
// (pricing.py _PER_AREA_RATE_FIELD / _SCALAR_RATE_FIELDS). Amount / qty descriptors are
// never rate cells and never get a marker.
const PER_AREA_RATE_FIELD = "rate_by_area";
const SCALAR_RATE_FIELDS = new Set(["rate_supply", "rate_install", "rate_combined"]);

/** True iff this descriptor addresses a RATE cell (per-area or scalar). Pure. */
export function isRateDescriptor(d: ColumnDescriptor): boolean {
  return d.value_field === PER_AREA_RATE_FIELD || SCALAR_RATE_FIELDS.has(d.value_field);
}

/**
 * True iff this (row, descriptor) RATE cell carries a saved price -- driven SOLELY by the
 * overlay's priced_* markers (which the backend sets from the pricing layer's is_filled),
 * NEVER by a zero-check on the value (a committed 0.0 rate can be a valid priced value).
 * Returns false for non-rate descriptors. Pure -- unit-tested in PricingGrid.test.ts.
 */
export function isCellPriced(row: PricedRow, d: ColumnDescriptor): boolean {
  if (d.value_field === PER_AREA_RATE_FIELD) {
    if (d.value_key === null || d.rate_subkey === null) return false;
    return row.priced_by_area?.[d.value_key]?.[d.rate_subkey] === true;
  }
  if (SCALAR_RATE_FIELDS.has(d.value_field)) {
    // Marker field name: priced_<value_field> -> priced_rate_supply / _install / _combined.
    return (row as unknown as Record<string, unknown>)[`priced_${d.value_field}`] === true;
  }
  return false;
}

interface PricingGridProps {
  /** Committed rows for the sheet, prices merged in (get_priced_rows). */
  rows: PricedRow[];
  /** Column descriptors (Excel-column order), passed through from get_priced_rows. */
  columnDescriptors: ColumnDescriptor[];
  /**
   * RESERVED for the future single-editor-lock slice (3b). INERT in 3a -- the grid is
   * read-only and does not consult these. Threaded through so 3b can gate inline edit on
   * them without reshaping the prop contract. NOT destructured (read-only this slice).
   */
  editable?: boolean;
  lockInfo?: unknown;
}

export function PricingGrid({ rows, columnDescriptors }: PricingGridProps) {
  // row_index -> row, for resolving a parent's Excel row number.
  const byIdx = new Map<number, PricedRow>(rows.map((r) => [r.row_index, r]));
  // Effective depth per row (reused helper -- single source of truth with the review tree).
  const depths = computeDepths(rows);

  // Descriptor-driven columns: everything except the sl_no / description anchors.
  const displayDescriptors = columnDescriptors.filter((d) => !FIXED_ROLE_DEDUPE.has(d.role));
  const slNoLetter = columnDescriptors.find((d) => d.role === "sl_no")?.col ?? null;
  const descriptionLetter = columnDescriptors.find((d) => d.role === "description")?.col ?? null;

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        This committed sheet has no rows to price.
      </p>
    );
  }

  return (
    <div className="rounded-md border border-border overflow-auto max-h-[calc(100vh-14rem)]">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr>
            <th className="px-2 py-2 text-left font-medium text-muted-foreground w-16 border-r border-border whitespace-nowrap sticky top-0 z-20 bg-muted">
              Excel Row
            </th>
            <th className="px-2 py-2 text-left font-medium text-muted-foreground w-16 border-r border-border whitespace-nowrap sticky top-0 z-20 bg-muted">
              {slNoLetter ? `Sl.No (${slNoLetter})` : "Sl.No"}
            </th>
            <th className="px-2 py-2 text-left font-medium text-muted-foreground w-16 border-r border-border whitespace-nowrap sticky top-0 z-20 bg-muted">
              Parent
            </th>
            <th className="px-2 py-2 text-left font-medium text-muted-foreground w-36 border-r border-border whitespace-nowrap sticky top-0 z-20 bg-muted">
              Classification
            </th>
            <th className="px-2 py-2 text-left font-medium text-muted-foreground min-w-[280px] whitespace-nowrap sticky top-0 z-20 bg-muted">
              {descriptionLetter ? `Description (${descriptionLetter})` : "Description"}
            </th>
            {displayDescriptors.map((d) => {
              const label = `${d.col} — ${ROLE_LABELS[d.role] ?? d.role}${d.area ? ` · ${d.area}` : ""}`;
              return (
                <th
                  key={d.col}
                  className="px-2 py-2 text-right font-medium text-muted-foreground w-28 min-w-[112px] border-l border-border whitespace-nowrap sticky top-0 z-20 bg-muted"
                >
                  {label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const depth = depths.get(row.row_index) ?? 0;
            const isPreamble = row.effective_classification === "preamble";
            const isLineItem = row.effective_classification === "line_item";
            const pIdx = row.effective_parent_index ?? -1;
            const parentExcelRow =
              pIdx >= 0 ? (byIdx.get(pIdx)?.source_row_number ?? null) : null;

            return (
              <tr key={row.row_index} className="border-b border-border hover:bg-muted/30">
                {/* Excel Row */}
                <td className="px-2 py-1.5 text-muted-foreground align-top w-16 border-r border-border tabular-nums">
                  {row.source_row_number}
                </td>
                {/* Sl.No */}
                <td className="px-2 py-1.5 text-muted-foreground align-top w-16 border-r border-border">
                  {row.sl_no_value ?? ""}
                </td>
                {/* Parent: parent's Excel row number (muted; read-only -- no scroll-to nav). */}
                <td className="px-2 py-1.5 align-top w-16 border-r border-border">
                  {parentExcelRow !== null ? (
                    <span className="text-[11px] font-mono text-muted-foreground whitespace-nowrap">
                      ↑ {parentExcelRow}
                    </span>
                  ) : null}
                </td>
                {/* Classification pill (read-only -- no chevron / reclassify). */}
                <td className="px-2 py-1.5 align-top w-36 border-r border-border">
                  <ClassificationPill cls={row.effective_classification} />
                </td>
                {/* Description: depth indent + per-classification styling (mirrors ReviewTree). */}
                <td className="px-2 py-1.5 align-top">
                  <div style={{ paddingLeft: `${depth * INDENT_PX}px` }}>
                    <span
                      className={cn(
                        "leading-snug break-words min-w-0",
                        isPreamble && "font-medium text-foreground",
                        isLineItem && "text-foreground",
                        !isPreamble && !isLineItem && "text-muted-foreground italic text-[11px]",
                      )}
                    >
                      {row.description || (
                        <span className="not-italic text-muted-foreground">(no description)</span>
                      )}
                    </span>
                  </div>
                </td>
                {/* Descriptor-driven data cells. Rate cells that carry a saved price get a
                    subtle priced tint (driven by the priced_* markers, never a zero-check). */}
                {displayDescriptors.map((d) => {
                  const val = resolveDescriptorValue(row, d);
                  const priced = isRateDescriptor(d) && isCellPriced(row, d);
                  return (
                    <td
                      key={d.col}
                      title={priced ? "Priced" : undefined}
                      className={cn(
                        "px-2 py-1.5 text-right align-top border-l border-border tabular-nums",
                        priced && "bg-emerald-50 dark:bg-emerald-950/30",
                      )}
                    >
                      {priced && (
                        <span
                          aria-hidden
                          className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 align-middle"
                        />
                      )}
                      {renderDescriptorCell(val)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
