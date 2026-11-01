import { useMemo } from 'react';
import { useFrappeGetDocList } from 'frappe-react-sdk';

import { ASSET_CACHE_KEYS, ASSET_MASTER_DOCTYPE } from '../assets.constants';

interface CategoryCountRow {
    asset_category: string;
    count: number;
}

export interface CategoryUnassigned {
    category: string;
    count: number;
}

// An aggregate field the SDK's field type doesn't know; one cast, shared by the three per-category counts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const COUNT_FIELDS = ['asset_category', 'count(name) as count'] as any;

const toMap = (rows: CategoryCountRow[] | undefined) => {
    const map: Record<string, number> = {};
    rows?.forEach((row) => {
        map[row.asset_category] = row.count;
    });
    return map;
};

/**
 * Asset counts per category: all assets, assets someone holds now, and Lost/Damaged ones (owner, 2026-10-31).
 * Unassigned = all - assigned - Lost/Damaged, which is the same set the summary cards count as unassigned
 * (`current_assignee` not set, not Lost/Damaged; a Lost/Damaged asset never has a holder).
 * The Categories table and the summary card's "most unassigned" list share these two queries and
 * their SWR keys, so their numbers always agree.
 */
export function useCategoryAssetCounts(enabled = true) {
    const { data: totals, isLoading: totalsLoading } = useFrappeGetDocList<CategoryCountRow>(
        ASSET_MASTER_DOCTYPE,
        {
            fields: COUNT_FIELDS,
            groupBy: 'asset_category',
            limit: 0,
        },
        enabled ? ASSET_CACHE_KEYS.CATEGORY_ASSET_COUNTS : null
    );
    const { data: assigned, isLoading: assignedLoading } = useFrappeGetDocList<CategoryCountRow>(
        ASSET_MASTER_DOCTYPE,
        {
            fields: COUNT_FIELDS,
            // Same "assigned" test as the summary cards (AssetsSummaryCard), so the numbers agree.
            filters: [['current_assignee', '!=', '']],
            groupBy: 'asset_category',
            limit: 0,
        },
        enabled ? ASSET_CACHE_KEYS.CATEGORY_ASSIGNED_COUNTS : null
    );
    const { data: lostDamaged, isLoading: lostDamagedLoading } = useFrappeGetDocList<CategoryCountRow>(
        ASSET_MASTER_DOCTYPE,
        {
            fields: COUNT_FIELDS,
            filters: [['lost_damaged', '=', 1]],
            groupBy: 'asset_category',
            limit: 0,
        },
        enabled ? ASSET_CACHE_KEYS.CATEGORY_LOST_DAMAGED_COUNTS : null
    );

    return useMemo(() => {
        const totalByCategory = toMap(totals);
        const assignedByCategory = toMap(assigned);
        const lostDamagedByCategory = toMap(lostDamaged);
        const unassignedOf = (category: string) =>
            Math.max(
                (totalByCategory[category] ?? 0) - (assignedByCategory[category] ?? 0) - (lostDamagedByCategory[category] ?? 0),
                0
            );

        /** Every category with unassigned assets, most first, optionally limited to some categories. */
        const unassignedByCategory = (onlyCategories?: string[]): CategoryUnassigned[] => {
            const allowed = onlyCategories ? new Set(onlyCategories) : null;
            return Object.keys(totalByCategory)
                .filter((category) => !allowed || allowed.has(category))
                .map((category) => ({ category, count: unassignedOf(category) }))
                .filter((row) => row.count > 0)
                .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
        };

        return {
            totalByCategory,
            assignedByCategory,
            unassignedByCategory,
            isLoading: totalsLoading || assignedLoading || lostDamagedLoading,
        };
    }, [totals, assigned, lostDamaged, totalsLoading, assignedLoading, lostDamagedLoading]);
}
