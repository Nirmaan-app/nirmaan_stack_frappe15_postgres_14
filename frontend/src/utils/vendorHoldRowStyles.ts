/**
 * Tailwind classes for Vendor Hold row highlighting in data tables.
 * Uses amber to indicate vendor on-hold status.
 *
 * Used with DataTable's getRowClassName prop:
 * ```tsx
 * const getRowClassName = useCallback((row) => {
 *   if (onHoldVendorIds.has(row.original.vendor)) {
 *     return VENDOR_HOLD_ROW_CLASSES;
 *   }
 *   return undefined;
 * }, [onHoldVendorIds]);
 * ```
 */
export const VENDOR_HOLD_ROW_CLASSES =
  "bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/30 dark:hover:bg-amber-950/50";
