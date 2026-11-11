import React, { useMemo } from 'react';
import { PackageX } from 'lucide-react';

import { formatHistoryTime, type AssetHistoryRow } from '@/utils/assetHistory';
import { latestLostDamaged } from '@/utils/assetLostDamaged';
import { useAssetHistoryPeople } from '../hooks/useAssetHistoryPeople';

/**
 * The Current Assignment card of a Lost/Damaged asset (owner, 2026-10-31): nobody holds it; who had it, who marked
 * it, when and why, read from its newest "Asset Lost/Damaged" history row.
 */
export const LostDamagedNotice: React.FC<{ rows?: AssetHistoryRow[] }> = ({ rows }) => {
    const { data: users } = useAssetHistoryPeople();
    const marked = latestLostDamaged(rows);
    const nameOf = useMemo(() => {
        const names = new Map((users ?? []).map((user) => [user.name, user.full_name]));
        return (id?: string | null) => (id ? names.get(id) || id : '');
    }, [users]);

    return (
        <div className="flex items-start gap-4 p-4 rounded-lg bg-red-50 border border-red-200">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-red-100">
                <PackageX className="h-6 w-6 text-red-600" />
            </div>
            <div className="min-w-0 space-y-1">
                <p className="font-medium text-red-800">Lost/Damaged: not assigned</p>
                {marked?.reason && <p className="text-sm text-gray-800 break-words">{marked.reason}</p>}
                <p className="text-xs text-gray-600">
                    {marked?.assigned_to ? `Was with ${nameOf(marked.assigned_to)}. ` : 'Was in store. '}
                    {marked && `Marked by ${nameOf(marked.done_by)}${marked.done_on ? ` on ${formatHistoryTime(marked.done_on)}` : ''}.`}
                </p>
                <p className="text-xs text-gray-500">
                    It can't be assigned and isn't audited until Admin or HR marks it Found/Repaired.
                </p>
            </div>
        </div>
    );
};
