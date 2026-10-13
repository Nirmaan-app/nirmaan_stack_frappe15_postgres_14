import { useMemo } from 'react';
import { useFrappeGetDocList } from 'frappe-react-sdk';

import {
    ASSET_CACHE_KEYS,
    ASSET_MANAGEMENT_DOCTYPE,
    ASSET_MANAGEMENT_RETURN_FIELDS,
    ASSET_MASTER_DOCTYPE,
    AssetCategoryType,
} from '../assets.constants';
import { useAssetCategoryNamesByType } from './useAssetCategoryNamesByType';

/** One return waiting for approval: the assignment, its asset and the person, ready for a table row. */
export interface ReturnRequest {
    /** The Asset Management record (what approve / reject act on). */
    name: string;
    asset: string;
    asset_name: string;
    asset_category: string;
    department: string | null;
    project: string | null;
    type: AssetCategoryType | null;
    returned_by: string;
    returned_by_name: string;
    returned_on: string | null;
    received_on: string | null;
    asset_assigned_on: string | null;
}

interface AssignmentRow {
    name: string;
    asset: string;
    asset_assigned_to: string;
    asset_assigned_on: string | null;
    received_on: string | null;
    returned_on: string | null;
}

interface AssetRow {
    name: string;
    asset_name: string;
    asset_category: string;
    department: string | null;
    project: string | null;
}

/**
 * Every return waiting for approval (owner, 2026-10-13): assignments whose holder ticked "Returned".
 * One set of queries feeds the Return By tab's list and count and the summary card's badge, so they
 * always agree. There are few at a time, so it reads them all and splits them by kind here.
 */
export function useReturnRequests(enabled = true) {
    const { data: rows, isLoading: rowsLoading } = useFrappeGetDocList<AssignmentRow>(
        ASSET_MANAGEMENT_DOCTYPE,
        {
            fields: [...ASSET_MANAGEMENT_RETURN_FIELDS] as unknown as (keyof AssignmentRow)[],
            filters: [['returned', '=', 1]],
            orderBy: { field: 'returned_on', order: 'asc' },
            limit: 0,
        },
        enabled ? ASSET_CACHE_KEYS.RETURN_REQUESTS : null
    );

    const assetIds = useMemo(() => [...new Set((rows ?? []).map((row) => row.asset))].sort(), [rows]);
    const { data: assets } = useFrappeGetDocList<AssetRow>(
        ASSET_MASTER_DOCTYPE,
        {
            fields: ['name', 'asset_name', 'asset_category', 'department', 'project'],
            filters: [['name', 'in', assetIds]],
            limit: 0,
        },
        enabled && assetIds.length > 0 ? ASSET_CACHE_KEYS.returnRequestAssets(assetIds) : null
    );

    const { data: users } = useFrappeGetDocList<{ name: string; full_name: string }>(
        'Nirmaan Users',
        { fields: ['name', 'full_name'], limit: 0 },
        enabled && (rows?.length ?? 0) > 0 ? 'users_for_pending_list' : null
    );

    const { categoryNames: projectCategories } = useAssetCategoryNamesByType(enabled ? 'Project' : undefined);
    const { categoryNames: itCategories } = useAssetCategoryNamesByType(enabled ? 'IT' : undefined);

    return useMemo(() => {
        const assetById = new Map((assets ?? []).map((asset) => [asset.name, asset]));
        const nameOf = new Map((users ?? []).map((user) => [user.name, user.full_name]));
        const project = new Set(projectCategories);
        const it = new Set(itCategories);

        const requests: ReturnRequest[] = (rows ?? []).map((row) => {
            const asset = assetById.get(row.asset);
            const category = asset?.asset_category ?? '';
            return {
                name: row.name,
                asset: row.asset,
                asset_name: asset?.asset_name ?? row.asset,
                asset_category: category,
                department: asset?.department ?? null,
                project: asset?.project ?? null,
                type: project.has(category) ? 'Project' : it.has(category) ? 'IT' : null,
                returned_by: row.asset_assigned_to,
                returned_by_name: nameOf.get(row.asset_assigned_to) || row.asset_assigned_to,
                returned_on: row.returned_on,
                received_on: row.received_on,
                asset_assigned_on: row.asset_assigned_on,
            };
        });

        const byType: Record<AssetCategoryType, number> = {
            Project: requests.filter((request) => request.type === 'Project').length,
            IT: requests.filter((request) => request.type === 'IT').length,
        };
        return { requests, byType, isLoading: enabled && rowsLoading };
    }, [rows, assets, users, projectCategories, itCategories, enabled, rowsLoading]);
}
