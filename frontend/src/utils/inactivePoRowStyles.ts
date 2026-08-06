/**
 * Tailwind classes for Inactive PO row highlighting in vendor tables.
 * Uses light red to clearly mark rows belonging to an Inactive (superseded) PO.
 *
 * Used with DataTable's getRowClassName prop:
 * ```tsx
 * const getRowClassName = useCallback((row) => {
 *   if (row.original.status === "Inactive") {
 *     return INACTIVE_PO_ROW_CLASSES;
 *   }
 *   return undefined;
 * }, []);
 * ```
 * and directly on the vendor-ledger `<TableRow>` for transactions linked to an Inactive PO.
 */
export const INACTIVE_PO_ROW_CLASSES =
  "bg-red-50 hover:bg-red-100 dark:bg-red-950/30 dark:hover:bg-red-950/50";
