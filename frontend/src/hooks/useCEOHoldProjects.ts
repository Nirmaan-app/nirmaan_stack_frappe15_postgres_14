import { useFrappeGetDocList } from "frappe-react-sdk";
import { useMemo } from "react";

interface CEOHoldProjectsResult {
  ceoHoldProjectIds: Set<string>;
  isLoading: boolean;
}

/**
 * Hook to fetch all projects with "CEO Hold" status.
 * Returns a Set for O(1) lookup per row in data tables.
 *
 * Usage:
 * ```tsx
 * const { ceoHoldProjectIds } = useCEOHoldProjects();
 *
 * const getRowClassName = useCallback((row) => {
 *   if (ceoHoldProjectIds.has(row.original.project)) {
 *     return CEO_HOLD_ROW_CLASSES;
 *   }
 *   return undefined;
 * }, [ceoHoldProjectIds]);
 * ```
 */
export function useCEOHoldProjects(): CEOHoldProjectsResult {
  const { data, isLoading } = useFrappeGetDocList<{ name: string }>(
    "Projects",
    {
      fields: ["name"],
      filters: [["status", "=", "CEO Hold"]],
      limit: 0, // Fetch all CEO Hold projects
    },
    "ceo-hold-projects" // Stable query key for caching
  );

  const ceoHoldProjectIds = useMemo(
    () => new Set(data?.map((p) => p.name) ?? []),
    [data]
  );

  return { ceoHoldProjectIds, isLoading };
}
