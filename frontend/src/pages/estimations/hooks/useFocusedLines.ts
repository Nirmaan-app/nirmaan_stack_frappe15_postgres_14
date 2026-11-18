import { useCallback, useEffect, useRef, useState } from "react";

import type { SheetRow } from "@/utils/estimations/estimateTypes";

/**
 * Which line items are expanded, plus the one named by the URL's `estRow` (Excel row): once that sheet's rows
 * arrive it is expanded, highlighted and scrolled into view, so a shared link, a Save or Open line lands on it.
 * A ▸ click also writes `estRow` (so the link can be shared) but never scrolls: the row is already under the
 * pointer, and re-centring the page on every click made it jump (review issue 3).
 */
export function useFocusedLines(rows: SheetRow[], focusRow: string | null, onFocusRow: (row: number | null) => void) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [highlight, setHighlight] = useState<string | null>(null);
  /** The Excel row a ▸ click just opened; the focus effect below skips its scroll once. */
  const clickedRow = useRef<string | null>(null);
  const rowCount = rows.length;

  useEffect(() => {
    const fromClick = focusRow != null && clickedRow.current === focusRow;
    clickedRow.current = null;
    if (!focusRow || !rowCount) return;
    const target = rows.find((r) => String(r.source_row_number) === focusRow && r.classification === "line_item");
    if (!target) return;
    setExpanded((prev) => (prev.has(target.name) ? prev : new Set(prev).add(target.name)));
    setHighlight(target.name);
    if (fromClick) return;
    const el = document.getElementById(`est-row-${target.name}`);
    el?.scrollIntoView({ block: "center" });
    // Depends on primitives only (frontend standard, React effects rule 1): a sheet's rows arriving show up as a
    // new rowCount, and a new link as a new focusRow; `rows` itself changes identity on every render.
  }, [focusRow, rowCount]);

  const toggle = useCallback(
    (node: string, excelRow: number | null) => {
      const wasOpen = expanded.has(node);
      setExpanded((prev) => {
        const next = new Set(prev);
        if (wasOpen) next.delete(node);
        else next.add(node);
        return next;
      });
      if (!wasOpen) clickedRow.current = excelRow == null ? null : String(excelRow);
      onFocusRow(wasOpen ? null : excelRow);
    },
    [expanded, onFocusRow],
  );

  const expandMany = useCallback((nodes: string[]) => setExpanded(new Set(nodes)), []);
  const collapseAll = useCallback(() => {
    setExpanded(new Set());
    onFocusRow(null);
  }, [onFocusRow]);

  return { expanded, highlight, toggle, expandMany, collapseAll };
}
