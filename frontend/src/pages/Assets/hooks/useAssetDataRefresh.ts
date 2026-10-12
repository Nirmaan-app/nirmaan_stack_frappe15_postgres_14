import { useSWRConfig } from 'frappe-react-sdk';
import { useCallback } from 'react';
import { ASSET_CACHE_KEYS } from '../assets.constants';

/**
 * Hook for programmatic cache invalidation across Asset module components.
 * Uses SWR's global mutate to refresh data without prop drilling.
 *
 * `useSWRConfig` must come from frappe-react-sdk, which bundles its own SWR: the one from 'swr' holds
 * a different cache, so its mutate refreshed nothing. `mutate(key)` revalidates and keeps the numbers
 * on screen meanwhile; `mutate(key, undefined, ...)` would blank them first.
 */
export const useAssetDataRefresh = () => {
    const { mutate } = useSWRConfig();

    /**
     * Refresh all summary card counts — global + per-type (Project/IT) variants.
     * Called both on data mutations and on tab switches to honor the
     * "refetch on every tab switch" behavior of AssetsSummaryCards.
     */
    const refreshSummaryCards = useCallback(() => {
        // Global summary (Categories tab)
        mutate(ASSET_CACHE_KEYS.CATEGORIES_COUNT);
        mutate(ASSET_CACHE_KEYS.TOTAL_ASSETS_COUNT);
        mutate(ASSET_CACHE_KEYS.ASSIGNED_ASSETS_COUNT);
        mutate(ASSET_CACHE_KEYS.UNASSIGNED_ASSETS_COUNT);
        mutate(ASSET_CACHE_KEYS.PENDING_DECLARATION_COUNT);

        // Project Assets tab
        mutate(ASSET_CACHE_KEYS.PROJECT_TOTAL_ASSETS_COUNT);
        mutate(ASSET_CACHE_KEYS.PROJECT_ASSIGNED_ASSETS_COUNT);
        mutate(ASSET_CACHE_KEYS.PROJECT_UNASSIGNED_ASSETS_COUNT);
        mutate(ASSET_CACHE_KEYS.PROJECT_PENDING_DECLARATION_COUNT);

        // IT Assets tab
        mutate(ASSET_CACHE_KEYS.IT_TOTAL_ASSETS_COUNT);
        mutate(ASSET_CACHE_KEYS.IT_ASSIGNED_ASSETS_COUNT);
        mutate(ASSET_CACHE_KEYS.IT_UNASSIGNED_ASSETS_COUNT);
        mutate(ASSET_CACHE_KEYS.IT_PENDING_DECLARATION_COUNT);

        // Per-category counts (Categories table + the summary card's "most unassigned" list)
        mutate(ASSET_CACHE_KEYS.CATEGORY_ASSET_COUNTS);
        mutate(ASSET_CACHE_KEYS.CATEGORY_ASSIGNED_COUNTS);
    }, [mutate]);

    /**
     * Refresh category dropdown data across all dialogs (Add, Edit)
     * and per-type category-name lists used by Project / IT tabs.
     */
    const refreshCategoryDropdowns = useCallback(() => {
        mutate(ASSET_CACHE_KEYS.CATEGORIES_DROPDOWN);
        mutate(ASSET_CACHE_KEYS.PROJECT_CATEGORIES_NAMES);
        mutate(ASSET_CACHE_KEYS.IT_CATEGORIES_NAMES);
    }, [mutate]);

    /**
     * Refresh asset management/assignment data for a specific asset
     */
    const refreshAssetAssignmentData = useCallback((assetId: string) => {
        mutate(ASSET_CACHE_KEYS.assetManagement(assetId));
    }, [mutate]);

    /**
     * Refresh all asset-related data (summary + dropdowns)
     */
    const refreshAllAssetData = useCallback(() => {
        refreshSummaryCards();
        refreshCategoryDropdowns();
    }, [refreshSummaryCards, refreshCategoryDropdowns]);

    return {
        refreshSummaryCards,
        refreshCategoryDropdowns,
        refreshAssetAssignmentData,
        refreshAllAssetData,
    };
};
