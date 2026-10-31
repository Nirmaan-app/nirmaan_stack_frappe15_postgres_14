import { useMemo } from 'react';
import { useFrappeGetCall } from 'frappe-react-sdk';

import { ASSET_LOST_DAMAGED_EVENT } from '@/utils/assetLostDamaged';
import type { AssetCategoryType } from '../assets.constants';

/** One "Asset Lost/Damaged" history row as `api/assets/history.get_asset_history` returns it. */
export interface LostDamagedMark {
    name: string;
    asset: string;
    assigned_to: string | null;
    done_by: string | null;
    done_on: string | null;
    reason: string | null;
}

/**
 * Each asset's newest "Asset Lost/Damaged" row -- who had it, who marked it, when and why -- for the Lost/Damaged
 * sub-tab (owner, 2026-10-31). The history is Admin and HR only (`ASSET_HISTORY_PROFILES`), so it is read only when
 * `enabled`; others see the list without this column.
 */
export function useLostDamagedMarks(assetType: AssetCategoryType | undefined, enabled: boolean): Map<string, LostDamagedMark> {
    const { data } = useFrappeGetCall<{ message: { rows: LostDamagedMark[] } }>(
        'nirmaan_stack.api.assets.history.get_asset_history',
        { event: ASSET_LOST_DAMAGED_EVENT, category_type: assetType, page_length: 10000 },
        enabled ? `asset_lost_damaged_marks:${assetType ?? 'all'}` : null
    );
    return useMemo(() => {
        const marks = new Map<string, LostDamagedMark>();
        // Rows come newest first, so the first row seen for an asset is its latest marking.
        for (const row of data?.message?.rows ?? []) if (!marks.has(row.asset)) marks.set(row.asset, row);
        return marks;
    }, [data]);
}
