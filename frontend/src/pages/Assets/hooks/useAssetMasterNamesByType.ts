import { useMemo } from 'react';
import { useFrappeGetDocList } from 'frappe-react-sdk';
import {
    ASSET_MASTER_DOCTYPE,
    AssetCategoryType,
} from '../assets.constants';
import { useAssetCategoryNamesByType } from './useAssetCategoryNamesByType';

interface AssetMasterNameRow {
    name: string;
}

export interface UseAssetMasterNamesByTypeResult {
    masterNames: string[];
    isLoading: boolean;
}

export function useAssetMasterNamesByType(
    type: AssetCategoryType | undefined,
): UseAssetMasterNamesByTypeResult {
    const { categoryNames, isLoading: categoriesLoading } = useAssetCategoryNamesByType(type);

    const enabled = (type === 'Project' || type === 'IT') && categoryNames.length > 0;

    const { data, isLoading } = useFrappeGetDocList<AssetMasterNameRow>(
        ASSET_MASTER_DOCTYPE,
        {
            fields: ['name'],
            filters: enabled ? [['asset_category', 'in', categoryNames]] : [],
            limit: 10000,
        },
        enabled ? `asset_master_names_by_type_${type}_${categoryNames.length}` : null,
    );

    const masterNames = useMemo(
        () => (data ?? []).map((row) => row.name),
        [data],
    );

    return {
        masterNames,
        isLoading: !!type && (categoriesLoading || (enabled && isLoading)),
    };
}
