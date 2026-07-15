/**
 * AreaQtyCells -- isolated per-row per-area quantity cells for the template-origin
 * multi-area review grid (ADR-0013 A2-D1 / decision D5).
 *
 * WHY this exists: ReviewTree is NOT React.memo, so a keystroke in any cell would
 * re-render the WHOLE tree if the per-area draft state lived on ReviewTree. To make
 * the "Total Quantity" cell update LIVE as the user types per-area quantities WITHOUT
 * a grid-wide draft plumbing / memo refactor, this small component owns its OWN local
 * per-area draft state -- a keystroke re-renders ONLY this one row's qty cells.
 *
 * It renders, for ONE row, the ordered per-area qty <td> inputs (CONTROLLED) plus the
 * read-only Total <td> whose value is the LIVE running sum of the draft-or-saved per-area
 * values. Persistence stays on ReviewTree (onSaveArea wraps saveAreaQtyInline, which POSTs
 * field="qty_by_area"; the server re-sums qty_total for template origin, and the fresh sum
 * arrives on the next mutate() refetch).
 *
 * Column-alignment contract: the caller (ReviewTree descriptor loop) delegates the
 * CONTIGUOUS qty_by_area cells + the qty_total cell to this component at the FIRST
 * qty_by_area descriptor position and skips the rest, so this fragment MUST emit the SAME
 * set of <td>s in the SAME order the loop would have (area cols in letter order, then Total).
 * Each <td> is gated by `visibleCols` exactly as the loop's own `visibleCols.has(d.col)`
 * guard would gate it -- but the live Total always sums over ALL area descriptors,
 * regardless of visibility.
 */
import { useState, useEffect, useRef, Fragment } from "react";
import type { ReviewRow, ColumnDescriptor } from "./boqTypes";
import { renderDescriptorCell } from "./reviewRender";

interface AreaQtyCellsProps {
  row: ReviewRow;
  // The ordered per-area qty descriptors (value_field === "qty_by_area", value_key !== null),
  // in Excel-letter/display order. Ref-stable per sheet (derived in ReviewTree's memo).
  areaDescriptors: ColumnDescriptor[];
  // The single flat qty_total descriptor (value_field === "qty_total", value_key === null).
  // May be undefined for a defensive/degenerate sheet -> the Total <td> is simply not emitted.
  totalDescriptor: ColumnDescriptor | null | undefined;
  // Column-subset visibility set (letters). A <td> renders only when visibleCols.has(d.col),
  // mirroring the descriptor loop's own guard so columns stay aligned.
  visibleCols: Set<string>;
  // Persist one per-area edit (wraps ReviewTree.saveAreaQtyInline). Fires on blur/Enter.
  onSaveArea: (row: ReviewRow, d: ColumnDescriptor, raw: string) => void;
}

export function AreaQtyCells({ row, areaDescriptors, totalDescriptor, visibleCols, onSaveArea }: AreaQtyCellsProps) {
  // LOCAL per-area draft (area name -> raw string). Isolated to THIS row's cells so a
  // keystroke re-renders only here. Empty until the user types; each area falls back to
  // its saved value when its draft entry is absent.
  const [draft, setDraft] = useState<Record<string, string>>({});

  // Reconcile drafts with server values after a refetch: when a saved area value changes
  // (post-save mutate() refreshes row.qty_by_area), drop THAT area's draft so its input
  // shows the fresh (possibly server-normalized) value. This mirrors the old uncontrolled
  // input's trick, where the input's `key` embedded the stored value so a change remounted
  // it and reset defaultValue. Per-area (not blanket) so an in-progress edit to a DIFFERENT
  // area survives a sibling area's save round-trip. `savedSig` captures every area's saved
  // value; the effect body reads the live row + descriptors.
  const prevSavedRef = useRef<Record<string, string> | null>(null);
  const savedSig = areaDescriptors
    .map(d => `${d.value_key}=${row.qty_by_area?.[d.value_key as string] ?? ""}`)
    .join("|");
  useEffect(() => {
    const next: Record<string, string> = {};
    const changed: string[] = [];
    for (const d of areaDescriptors) {
      const area = d.value_key as string;
      const saved = String(row.qty_by_area?.[area] ?? "");
      next[area] = saved;
      const prev = prevSavedRef.current;
      if (prev && prev[area] !== undefined && prev[area] !== saved) changed.push(area);
    }
    if (changed.length > 0) {
      setDraft(prevDraft => {
        const copy = { ...prevDraft };
        for (const a of changed) delete copy[a];
        return copy;
      });
    }
    prevSavedRef.current = next;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- savedSig is the value-change signal
  }, [savedSig]);

  // LIVE Total: sum draft-else-saved per area; blank / NaN -> 0 (partial running sum).
  // Summed over ALL area descriptors, independent of visibleCols.
  let liveTotal = 0;
  for (const d of areaDescriptors) {
    const area = d.value_key as string;
    const raw = draft[area] ?? String(row.qty_by_area?.[area] ?? "");
    const n = Number(raw);
    if (raw.trim() !== "" && Number.isFinite(n)) liveTotal += n;
  }

  // A row is qty-bearing iff the clone seeded it (line_item / preamble -> qty_by_area is a
  // non-null dict). Non-qty "other" rows (section headers, subtotals, notes) have
  // qty_by_area === null; their Total must stay BLANK, matching the pre-A2 read-only cell
  // (renderDescriptorCell(row.qty_total === null) -> ""). Without this guard fmtNum(0) would
  // print a spurious "0" on every structural row. A user-entered draft forces it qty-bearing.
  const isQtyBearing = row.qty_by_area != null || Object.keys(draft).length > 0;

  return (
    <Fragment>
      {areaDescriptors.map(d => {
        if (!visibleCols.has(d.col)) return null;
        const area = d.value_key as string;
        const value = draft[area] ?? String(row.qty_by_area?.[area] ?? "");
        return (
          <td
            key={d.col}
            className="px-2 py-1.5 text-right align-top border-l border-border tabular-nums"
          >
            <input
              type="number"
              inputMode="decimal"
              value={value}
              onChange={(e) => {
                const v = e.target.value;
                setDraft(prev => ({ ...prev, [area]: v }));
              }}
              onBlur={(e) => onSaveArea(row, d, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  (e.target as HTMLInputElement).blur();
                }
              }}
              placeholder="0"
              className="w-20 rounded border border-input bg-background px-1.5 py-0.5 text-right text-xs tabular-nums focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </td>
        );
      })}
      {totalDescriptor && visibleCols.has(totalDescriptor.col) && (
        <td
          key={totalDescriptor.col}
          className="px-2 py-1.5 text-right align-top border-l border-border tabular-nums"
        >
          {/* Read-only LIVE sum -- formatted identically to the descriptor cell
              (renderDescriptorCell of a number -> fmtNum), so display matches. A non-qty
              "other" row stays BLANK (parity with the pre-A2 row.qty_total === null cell). */}
          {isQtyBearing ? renderDescriptorCell(liveTotal) : renderDescriptorCell(null)}
        </td>
      )}
    </Fragment>
  );
}
