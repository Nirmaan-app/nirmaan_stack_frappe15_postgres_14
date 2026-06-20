/**
 * PricingGrid -- committed-pricing grid (BoQ Phase 5 Slice 3a read-only -> 3b rate editing).
 *
 * Renders the committed rows of one sheet (from get_priced_rows) with their current saved
 * rates + a priced/un-priced marker. Mirrors ReviewTree's descriptor-render loop but REUSES
 * the extracted reviewRender helpers (design v1.3 Sec.4 path b) -- it does NOT import,
 * reuse, or retune the ReviewTree component.
 *
 * Slice 3b -- INLINE RATE EDITING + LIVE AMOUNT (rates only):
 *   - Each RATE cell (isRateDescriptor) renders a numeric <Input>; qty / amount / any
 *     non-rate descriptor stays read-only; classification + structure stay read-only (frozen).
 *   - Save on BLUR or ENTER (no Apply button, no confirm dialog -- the design's Excel feel).
 *     A cell calls up to the page-owned onSaveRate(cell, rate); the page does the
 *     save_cell_price POST + a mutate() refetch (which re-derives the priced_* markers
 *     authoritatively -- no client-side marker logic).
 *   - LIVE AMOUNT (display-only, NEVER persisted -- the pricing layer stores RATES only):
 *     an amount cell paired to a rate column (same area + kind) shows qty x rate, computed
 *     client-side from the optimistically-typed rate (instant) or, when not editing, the
 *     row's SAVED rate IF the cell is priced. An un-priced, not-editing amount cell keeps
 *     its committed value unchanged (no regression from 3a).
 *
 * Still OUT (later slices): subtotal roll-up (sum of children), auto-save/debounce +
 * force-save (3c), the single-editor lock (editable/lock_info stay INERT here), remarks +
 * the review-flag layer (4a/4b), Excel write-back (5), finalize/revert (6).
 */
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import {
  ClassificationPill,
  computeDepths,
  renderDescriptorCell,
  resolveDescriptorValue,
} from "./reviewRender";
import { ROLE_LABELS } from "./boqTypes";
import type { ColumnDescriptor, PricedRow, RateCellSaveArgs } from "./boqTypes";

// Depth indent step -- mirrors ReviewTree.INDENT_PX (kept in sync; the pricing grid does
// not import ReviewTree per design v1.3 Sec.4 path b).
const INDENT_PX = 20;

// The two roles rendered as fixed anchor columns (Sl.No, Description), excluded from the
// descriptor-driven column set. Mirrors ReviewTree.FIXED_ROLE_DEDUPE (kept in sync; the
// pricing grid does not import ReviewTree -- the locked no-ReviewTree-import design call).
const FIXED_ROLE_DEDUPE = new Set(["sl_no", "description"]);

// A rate cell is the ONLY editable cell. A column_descriptor identifies a rate cell by its
// value_field -- mirrors the backend overlay (pricing.py _PER_AREA_RATE_FIELD /
// _SCALAR_RATE_FIELDS). Amount / qty descriptors are never rate cells.
const PER_AREA_RATE_FIELD = "rate_by_area";
const PER_AREA_AMOUNT_FIELD = "amount_by_area";
const SCALAR_RATE_FIELDS = new Set(["rate_supply", "rate_install", "rate_combined"]);
const SCALAR_AMOUNT_FIELDS = new Set(["amount_total", "amount_supply", "amount_install"]);

// Pairing maps: an amount cell's kind/field -> its corresponding rate kind/field
// (amount = qty x rate). Per-area amount_by_area rate_subkey -> rate_by_area rate_subkey;
// scalar amount value_field -> scalar rate value_field.
const PER_AREA_AMOUNT_TO_RATE_KIND: Record<string, string> = {
  total: "combined_rate",
  supply: "supply_rate",
  install: "install_rate",
};
const SCALAR_AMOUNT_TO_RATE_FIELD: Record<string, string> = {
  amount_total: "rate_combined",
  amount_supply: "rate_supply",
  amount_install: "rate_install",
};
// Scalar rate value_field -> the descriptive rate_kind token (consistent with the per-area
// rate_subkey tokens). rate_kind is a guard field, NOT part of the cell identity key.
const SCALAR_RATE_FIELD_TO_KIND: Record<string, string> = {
  rate_supply: "supply_rate",
  rate_install: "install_rate",
  rate_combined: "combined_rate",
};

/** True iff this descriptor addresses a RATE cell (per-area or scalar). Pure. */
export function isRateDescriptor(d: ColumnDescriptor): boolean {
  return d.value_field === PER_AREA_RATE_FIELD || SCALAR_RATE_FIELDS.has(d.value_field);
}

/** True iff this descriptor addresses an AMOUNT cell (per-area or scalar). Pure. */
export function isAmountDescriptor(d: ColumnDescriptor): boolean {
  return d.value_field === PER_AREA_AMOUNT_FIELD || SCALAR_AMOUNT_FIELDS.has(d.value_field);
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

/**
 * The RATE descriptor an AMOUNT descriptor pairs with (same area + corresponding kind),
 * if such a rate column is mapped in this sheet; else null. Pure -- unit-tested.
 */
export function findPairedRateDescriptor(
  amountD: ColumnDescriptor,
  descriptors: ColumnDescriptor[],
): ColumnDescriptor | null {
  if (amountD.value_field === PER_AREA_AMOUNT_FIELD) {
    const rateKind = PER_AREA_AMOUNT_TO_RATE_KIND[amountD.rate_subkey ?? ""];
    if (!rateKind) return null;
    return (
      descriptors.find(
        (r) =>
          r.value_field === PER_AREA_RATE_FIELD &&
          r.value_key === amountD.value_key &&
          r.rate_subkey === rateKind,
      ) ?? null
    );
  }
  const rateField = SCALAR_AMOUNT_TO_RATE_FIELD[amountD.value_field];
  if (!rateField) return null;
  return descriptors.find((r) => r.value_field === rateField) ?? null;
}

/** amount = qty x rate. Returns null if either operand is missing. Pure -- unit-tested. */
export function computeAmount(
  qty: number | null | undefined,
  rate: number | null | undefined,
): number | null {
  if (qty === null || qty === undefined || rate === null || rate === undefined) return null;
  return qty * rate;
}

/**
 * Build the per-cell save args from a row + a RATE descriptor (the grid's half of the
 * onSaveRate contract; the page fills boq/sheet/version + the rate). Pure -- unit-tested.
 *   excelRow = row.source_row_number; colLetter = d.col;
 *   area = per-area d.value_key (scalar: omitted);
 *   rateKind = per-area d.rate_subkey verbatim / scalar derived token (guard field, not key);
 *   description = row.description (copy-forward MATCH GUARD -- always sent).
 */
export function buildRateCell(row: PricedRow, d: ColumnDescriptor): RateCellSaveArgs {
  const isPerArea = d.value_field === PER_AREA_RATE_FIELD;
  const rateKind = isPerArea
    ? (d.rate_subkey ?? "")
    : (SCALAR_RATE_FIELD_TO_KIND[d.value_field] ?? d.value_field);
  const args: RateCellSaveArgs = {
    excelRow: row.source_row_number,
    colLetter: d.col,
    rateKind,
    description: row.description ?? "",
  };
  if (isPerArea && d.value_key) args.area = d.value_key;
  return args;
}

interface PricingGridProps {
  /** Committed rows for the sheet, prices merged in (get_priced_rows). */
  rows: PricedRow[];
  /** Column descriptors (Excel-column order), passed through from get_priced_rows. */
  columnDescriptors: ColumnDescriptor[];
  /**
   * Slice 3b: save one rate cell. The grid supplies the cell identity (from row +
   * descriptor); the page fills boq/sheet/committed_version + does the POST + mutate
   * refetch. When ABSENT, rate cells render read-only (the 3a behavior). Returns a promise
   * the grid awaits to clear the optimistic draft on success / keep it on failure.
   */
  onSaveRate?: (cell: RateCellSaveArgs, rate: number) => Promise<void>;
  /**
   * RESERVED for the future single-editor-lock slice. INERT here -- the grid does NOT gate
   * editing on these (the lock is a later slice). NOT destructured.
   */
  editable?: boolean;
  lockInfo?: unknown;
}

export function PricingGrid({ rows, columnDescriptors, onSaveRate }: PricingGridProps) {
  // Optimistic per-rate-cell drafts (this session), keyed `${row_index}:${col}`. A draft
  // shows instantly (live amount) until the save's refetch lands, then it is dropped so the
  // cell falls back to the refetched saved rate.
  const [draftRates, setDraftRates] = useState<Record<string, string>>({});
  // Dedupe blur + Enter committing the SAME value (and an in-flight re-commit).
  const committedAttemptRef = useRef<Record<string, string>>({});

  // row_index -> row, for resolving a parent's Excel row number.
  const byIdx = new Map<number, PricedRow>(rows.map((r) => [r.row_index, r]));
  // Effective depth per row (reused helper -- single source of truth with the review tree).
  const depths = computeDepths(rows);

  // Descriptor-driven columns: everything except the sl_no / description anchors.
  const displayDescriptors = columnDescriptors.filter((d) => !FIXED_ROLE_DEDUPE.has(d.role));
  const slNoLetter = columnDescriptors.find((d) => d.role === "sl_no")?.col ?? null;
  const descriptionLetter = columnDescriptors.find((d) => d.role === "description")?.col ?? null;

  // Precompute each amount column's paired rate descriptor (column-level, row-independent),
  // so a live amount can be derived from the paired rate's draft / saved value.
  const pairedRateByAmountCol = new Map<string, ColumnDescriptor>();
  for (const d of displayDescriptors) {
    if (isAmountDescriptor(d)) {
      const rateD = findPairedRateDescriptor(d, displayDescriptors);
      if (rateD) pairedRateByAmountCol.set(d.col, rateD);
    }
  }

  const cellKey = (rowIndex: number, col: string) => `${rowIndex}:${col}`;
  const savedRateStr = (row: PricedRow, d: ColumnDescriptor): string => {
    const v = resolveDescriptorValue(row, d);
    return v === null || v === undefined ? "" : String(v);
  };

  // Commit a rate cell (blur / Enter). No-op when unchanged or a duplicate of the last
  // attempt (blur+Enter). Blank/NaN -> 0 (the endpoint coerces blank -> 0.0, still priced).
  const commitRate = (row: PricedRow, d: ColumnDescriptor, rawValue: string) => {
    if (!onSaveRate) return;
    const saved = savedRateStr(row, d);
    if (rawValue === saved) return; // unchanged vs the saved value -> nothing to do
    const key = cellKey(row.row_index, d.col);
    if (committedAttemptRef.current[key] === rawValue) return; // dedupe blur+Enter same value
    committedAttemptRef.current[key] = rawValue;
    const num = parseFloat(rawValue);
    const rate = Number.isFinite(num) ? num : 0;
    void onSaveRate(buildRateCell(row, d), rate)
      .then(() => {
        // Success: drop the optimistic draft so the cell shows the refetched saved rate.
        setDraftRates((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        delete committedAttemptRef.current[key];
      })
      .catch(() => {
        // Failure: keep the draft (the user sees what they typed; the page shows the error).
        // Clear the dedupe so a retry of the same value is allowed.
        delete committedAttemptRef.current[key];
      });
  };

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
                {/* Descriptor-driven data cells: editable rate inputs, live-amount cells,
                    and read-only qty/other cells. */}
                {displayDescriptors.map((d) => {
                  // ── RATE cell: editable <Input> (save on blur/Enter) ──────────────
                  if (onSaveRate && isRateDescriptor(d)) {
                    const key = cellKey(row.row_index, d.col);
                    const value = draftRates[key] ?? savedRateStr(row, d);
                    const priced = isCellPriced(row, d);
                    return (
                      <td
                        key={d.col}
                        title={priced ? "Priced" : undefined}
                        className={cn(
                          "px-1 py-1 align-top border-l border-border",
                          priced && "bg-emerald-50 dark:bg-emerald-950/30",
                        )}
                      >
                        <div className="flex items-center justify-end gap-1">
                          {priced && (
                            <span
                              aria-hidden
                              className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0"
                            />
                          )}
                          <Input
                            type="number"
                            value={value}
                            onChange={(e) =>
                              setDraftRates((prev) => ({ ...prev, [key]: e.target.value }))
                            }
                            onBlur={() => commitRate(row, d, value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                commitRate(row, d, value);
                                (e.target as HTMLInputElement).blur();
                              }
                            }}
                            className="h-7 text-xs w-20 text-right tabular-nums"
                          />
                        </div>
                      </td>
                    );
                  }

                  // ── AMOUNT cell: live qty x rate (display-only), else committed value ──
                  if (isAmountDescriptor(d)) {
                    const rateD = pairedRateByAmountCol.get(d.col);
                    let amountVal: number | null = null;
                    if (rateD) {
                      const area = d.value_field === PER_AREA_AMOUNT_FIELD ? d.value_key : null;
                      const qty =
                        area !== null && area !== undefined
                          ? (row.qty_by_area?.[area] ?? null)
                          : (row.qty_total ?? null);
                      const draft = draftRates[cellKey(row.row_index, rateD.col)];
                      let effRate: number | null = null;
                      if (draft !== undefined) {
                        // Editing now -> optimistic amount from the typed rate (blank -> 0).
                        const n = parseFloat(draft);
                        effRate = Number.isFinite(n) ? n : 0;
                      } else if (isCellPriced(row, rateD)) {
                        // Not editing but priced -> amount from the saved rate (no refetch flash).
                        const sv = resolveDescriptorValue(row, rateD);
                        effRate = typeof sv === "number" ? sv : null;
                      }
                      // else: un-priced + not editing -> leave amountVal null (committed value).
                      if (effRate !== null) amountVal = computeAmount(qty, effRate);
                    }
                    return (
                      <td
                        key={d.col}
                        className="px-2 py-1.5 text-right align-top border-l border-border tabular-nums"
                      >
                        {amountVal !== null
                          ? renderDescriptorCell(amountVal)
                          : renderDescriptorCell(resolveDescriptorValue(row, d))}
                      </td>
                    );
                  }

                  // ── Default read-only cell (qty / others; rate when no onSaveRate) ───
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
