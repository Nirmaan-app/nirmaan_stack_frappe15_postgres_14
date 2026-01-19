import { useSWRConfig } from 'swr';
import { useCallback } from 'react';
import { ASSET_CACHE_KEYS } from '../assets.constants';

/**
 * Hook for programmatic cache invalidation across Asset module components.
 * Uses SWR's global mutate to refresh data without prop drilling.
 *
 * Note: We use `mutate(key, undefined, { revalidate: true })` to force
 * immediate revalidation of the cached data.
 */
export const useAssetDataRefresh = () => {
    const { mutate } = useSWRConfig();

    /**
     * Refresh all summary card counts (categories, total, assigned, unassigned, pending)
     */
    const refreshSummaryCards = useCallback(() => {
        // Force revalidation by passing undefined as data and revalidate: true
        mutate(ASSET_CACHE_KEYS.CATEGORIES_COUNT, undefined, { revalidate: true });
        mutate(ASSET_CACHE_KEYS.TOTAL_ASSETS_COUNT, undefined, { revalidate: true });
        mutate(ASSET_CACHE_KEYS.ASSIGNED_ASSETS_COUNT, undefined, { revalidate: true });
        mutate(ASSET_CACHE_KEYS.UNASSIGNED_ASSETS_COUNT, undefined, { revalidate: true });
        mutate(ASSET_CACHE_KEYS.PENDING_DECLARATION_COUNT, undefined, { revalidate: true });
    }, [mutate]);

    /**
     * Refresh category dropdown data across all dialogs (Add, Edit)
     */
    const refreshCategoryDropdowns = useCallback(() => {
        mutate(ASSET_CACHE_KEYS.CATEGORIES_DROPDOWN, undefined, { revalidate: true });
    }, [mutate]);

    /**
     * Refresh asset management/assignment data for a specific asset
     */
    const refreshAssetAssignmentData = useCallback((assetId: string) => {
        mutate(ASSET_CACHE_KEYS.assetManagement(assetId), undefined, { revalidate: true });
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
