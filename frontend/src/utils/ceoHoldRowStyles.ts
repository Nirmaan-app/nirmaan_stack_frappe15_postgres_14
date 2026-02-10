/**
 * Tailwind classes for CEO Hold row highlighting in data tables.
 * Uses light red to clearly indicate blocked/held status.
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
  "bg-red-50 hover:bg-red-100 dark:bg-red-950/30 dark:hover:bg-red-950/50";
