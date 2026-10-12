import { useMemo } from 'react';
import { useFrappeGetDocList } from 'frappe-react-sdk';

import { ASSET_MASTER_DOCTYPE } from '../assets.constants';

interface CategoryCountRow {
    asset_category: string;
    count: number;
}

export interface CategoryUnassigned {
    category: string;
    count: number;
}

const toMap = (rows: CategoryCountRow[] | undefined) => {
    const map: Record<string, number> = {};
    rows?.forEach((row) => {
        map[row.asset_category] = row.count;
    });
    return map;
};

/**
 * Asset counts per category: all assets, and assets someone holds now. Unassigned = all - assigned,
 * which is the same set the summary cards count as unassigned (`current_assignee` not set).
 * The Categories table and the summary card's "most unassigned" list share these two queries and
 * their SWR keys, so their numbers always agree.
 */
export function useCategoryAssetCounts(enabled = true) {
    const { data: totals, isLoading: totalsLoading } = useFrappeGetDocList<CategoryCountRow>(
        ASSET_MASTER_DOCTYPE,
        {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            fields: ['asset_category', 'count(name) as count'] as any,
            groupBy: 'asset_category',
            limit: 0,
        },
        enabled ? 'asset_counts_by_category' : null
    );
    const { data: assigned, isLoading: assignedLoading } = useFrappeGetDocList<CategoryCountRow>(
        ASSET_MASTER_DOCTYPE,
        {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            fields: ['asset_category', 'count(name) as count'] as any,
            // Same "assigned" test as the summary cards (AssetsSummaryCard), so the numbers agree.
            filters: [['current_assignee', '!=', '']],
            groupBy: 'asset_category',
            limit: 0,
        },
        enabled ? 'assigned_asset_counts_by_category' : null
    );

    return useMemo(() => {
        const totalByCategory = toMap(totals);
        const assignedByCategory = toMap(assigned);
        const unassignedOf = (category: string) =>
            Math.max((totalByCategory[category] ?? 0) - (assignedByCategory[category] ?? 0), 0);

        /** The categories with the most unassigned assets, optionally limited to some categories. */
        const topUnassigned = (limit: number, onlyCategories?: string[]): CategoryUnassigned[] => {
            const allowed = onlyCategories ? new Set(onlyCategories) : null;
            return Object.keys(totalByCategory)
                .filter((category) => !allowed || allowed.has(category))
                .map((category) => ({ category, count: unassignedOf(category) }))
                .filter((row) => row.count > 0)
                .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category))
                .slice(0, limit);
        };

        return {
            totalByCategory,
            assignedByCategory,
            topUnassigned,
            isLoading: totalsLoading || assignedLoading,
        };
    }, [totals, assigned, totalsLoading, assignedLoading]);
}
