import { useMemo } from 'react';
import { useFrappeGetDocList } from 'frappe-react-sdk';

import { ASSET_CACHE_KEYS, ASSET_MANAGEMENT_DOCTYPE, ASSET_MASTER_DOCTYPE, AssetCategoryType } from '../assets.constants';
import { useAssetCategoryNamesByType } from './useAssetCategoryNamesByType';

/**
 * How many monthly audits are open, per Project / IT (owner, 2026-10-14) -- the red count on the Asset
 * Audit tab. Open audits are few at a time, so it reads them all and splits them by kind here.
 */
export function useAuditPendingCounts(enabled = true): Record<AssetCategoryType, number> {
    const { data: rows } = useFrappeGetDocList<{ name: string; asset: string }>(
        ASSET_MANAGEMENT_DOCTYPE,
        { fields: ['name', 'asset'], filters: [['audit_status', '=', 'Pending']], limit: 0 },
        enabled ? ASSET_CACHE_KEYS.AUDIT_PENDING : null
    );

    const assetIds = useMemo(() => [...new Set((rows ?? []).map((row) => row.asset))].sort(), [rows]);
    const { data: assets } = useFrappeGetDocList<{ name: string; asset_category: string }>(
        ASSET_MASTER_DOCTYPE,
        { fields: ['name', 'asset_category'], filters: [['name', 'in', assetIds]], limit: 0 },
        enabled && assetIds.length > 0 ? ASSET_CACHE_KEYS.auditPendingAssets(assetIds) : null
    );

    const { categoryNames: projectCategories } = useAssetCategoryNamesByType(enabled ? 'Project' : undefined);
    const { categoryNames: itCategories } = useAssetCategoryNamesByType(enabled ? 'IT' : undefined);

    return useMemo(() => {
        const categoryOf = new Map((assets ?? []).map((asset) => [asset.name, asset.asset_category]));
        const project = new Set(projectCategories);
        const it = new Set(itCategories);
        const counts: Record<AssetCategoryType, number> = { Project: 0, IT: 0 };
        (rows ?? []).forEach((row) => {
            const category = categoryOf.get(row.asset) ?? '';
            if (project.has(category)) counts.Project += 1;
            else if (it.has(category)) counts.IT += 1;
        });
        return counts;
    }, [rows, assets, projectCategories, itCategories]);
}

/**
 * The categories whose assigned assets get the monthly audit ("Monthly audit required" ticked), for
 * the audit line on the asset page and the Assigned tab. Its own key: the shared category dropdown key
 * reads fewer fields.
 */
export function useAuditedCategories(enabled = true): ReadonlySet<string> {
    const { data } = useFrappeGetDocList<{ name: string }>(
        'Asset Category',
        { fields: ['name'], filters: [['audit_required', '=', 1]], limit: 0 },
        enabled ? ASSET_CACHE_KEYS.AUDITED_CATEGORIES : null
    );
    return useMemo(() => new Set((data ?? []).map((row) => row.name)), [data]);
}
