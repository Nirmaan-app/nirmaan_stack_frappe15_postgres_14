import React from 'react';
import { Outlet } from 'react-router-dom';

import { useUserData } from '@/hooks/useUserData';
import { getAssetPermissions } from './utils/permissions';

/** The "no access" panel, the same one the app's other route guards show. */
export const AssetsAccessDenied: React.FC = () => (
    <div className="flex items-center justify-center h-[50vh]">
        <div className="text-center">
            <h2 className="text-xl font-semibold text-gray-800">Access Denied</h2>
            <p className="text-gray-600 mt-2">You don't have permission to access Assets.</p>
        </div>
    </div>
);

/**
 * Guard for the Assets list and category pages: only the profiles that have Assets in the sidebar
 * (`getAssetPermissions().canViewAssets` -- Admin, PMO, HR Executive, Procurement). The pages hide
 * nothing by role themselves, so without this a typed URL let anyone browse every asset.
 *
 * It waits for the role to load first, or a typed URL would flash "Access Denied". One asset's own
 * page is guarded in AssetOverview instead, because its holder may open it too (to sign).
 */
export const AssetsRoute: React.FC = () => {
    const { role, user_id } = useUserData();
    if (role === 'Loading') return null;
    return getAssetPermissions(user_id, role).canViewAssets ? <Outlet /> : <AssetsAccessDenied />;
};
