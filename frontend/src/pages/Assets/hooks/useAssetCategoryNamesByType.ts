import { useMemo } from 'react';
import { useFrappeGetDocList } from 'frappe-react-sdk';
import {
    ASSET_CATEGORY_DOCTYPE,
    ASSET_CACHE_KEYS,
    AssetCategoryType,
} from '../assets.constants';

interface AssetCategoryNameRow {
    name: string;
}

export interface UseAssetCategoryNamesByTypeResult {
    categoryNames: string[];
    isLoading: boolean;
}

export function useAssetCategoryNamesByType(
    type: AssetCategoryType | undefined,
): UseAssetCategoryNamesByTypeResult {
    const enabled = type === 'Project' || type === 'IT';
    const cacheKey = !enabled
        ? null
        : type === 'Project'
            ? ASSET_CACHE_KEYS.PROJECT_CATEGORIES_NAMES
            : ASSET_CACHE_KEYS.IT_CATEGORIES_NAMES;

    const { data, isLoading } = useFrappeGetDocList<AssetCategoryNameRow>(
        ASSET_CATEGORY_DOCTYPE,
        {
            fields: ['name'],
            filters: enabled ? [['category_type', '=', type as string]] : [],
            limit: 1000,
        },
        cacheKey,
    );

    const categoryNames = useMemo(
        () => (data ?? []).map((row) => row.name),
        [data],
    );

    return {
        categoryNames,
        isLoading: enabled && isLoading,
    };
}
