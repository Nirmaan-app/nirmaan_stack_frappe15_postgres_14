/**
 * Tailwind classes for CEO Hold row highlighting in data tables.
 * Matches the amber theme of CEOHoldBanner component.
 *
 * Used with DataTable's getRowClassName prop:
 * ```tsx
 * const getRowClassName = useCallback((row) => {
 *   if (ceoHoldProjectIds.has(row.original.project)) {
 *     return CEO_HOLD_ROW_CLASSES;
 *   }
 *   return undefined;
 * }, [ceoHoldProjectIds]);
 * ```
 */
export const CEO_HOLD_ROW_CLASSES =
  "bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/30 dark:hover:bg-amber-950/50";
