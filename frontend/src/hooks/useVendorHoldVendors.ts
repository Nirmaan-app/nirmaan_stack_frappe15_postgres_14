import { useFrappeGetDocList } from "frappe-react-sdk";
import { useMemo } from "react";

interface VendorHoldVendorsResult {
  onHoldVendorIds: Set<string>;
  isLoading: boolean;
}

/**
 * Hook to fetch all vendors with "On-Hold" status.
 * Returns a Set for O(1) lookup per row in data tables.
 *
 * Usage:
 * ```tsx
 * const { onHoldVendorIds } = useVendorHoldVendors();
 *
 * const getRowClassName = useCallback((row) => {
 *   if (onHoldVendorIds.has(row.original.vendor)) {
 *     return VENDOR_HOLD_ROW_CLASSES;
 *   }
 *   return undefined;
 * }, [onHoldVendorIds]);
 * ```
 */
export function useVendorHoldVendors(): VendorHoldVendorsResult {
  const { data, isLoading } = useFrappeGetDocList<{ name: string }>(
    "Vendors",
    {
      fields: ["name"],
      filters: [["vendor_status", "=", "On-Hold"]],
      limit: 0, // Fetch all On-Hold vendors
    },
    "vendor-hold-vendors" // Stable query key for caching
  );

  const onHoldVendorIds = useMemo(
    () => new Set(data?.map((v) => v.name) ?? []),
    [data]
  );

  return { onHoldVendorIds, isLoading };
}
