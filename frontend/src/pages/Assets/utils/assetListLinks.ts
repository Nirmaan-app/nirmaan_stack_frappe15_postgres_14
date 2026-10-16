import { encodeFiltersForUrl } from '@/hooks/useServerDataTable';
import { urlStateManager } from '@/utils/urlStateManager';
import { AssetCategoryType } from '../assets.constants';

/** The sub-tabs of the Project / IT tabs (AssetsPage's `?view=`). */
export type AssetListView = 'all' | 'assigned' | 'unassigned' | 'pending' | 'returns';

export interface AssetListTarget {
    type: AssetCategoryType;
    view: AssetListView;
    /** Filter the list to this category (the category's name, which is what the Category facet holds). */
    category?: string;
}

/** Each sub-tab's table, as its list passes it to useServerDataTable (`urlSyncKey`, plus `_<type>`). */
const LIST_SYNC_KEY: Partial<Record<AssetListView, string>> = {
    all: 'asset_master',
    assigned: 'assigned_assets',
    unassigned: 'unassigned_assets',
    pending: 'pending_actions',
    returns: 'return_requests',
};

export const assetListSyncKey = (type: AssetCategoryType, view: AssetListView): string | null =>
    LIST_SYNC_KEY[view] ? `${LIST_SYNC_KEY[view]}_${type.toLowerCase()}` : null;

/**
 * The URL params that open a list from the summary card: its tab and sub-tab, on page 1, with the
 * list's search and filters cleared -- except the category filter a category chip asks for.
 * The defaults (Project, All) stay out of the URL, as AssetsPage's `useUrlTab` writes them.
 */
export function assetListParams({ type, view, category }: AssetListTarget): Record<string, string | null> {
    const listKey = assetListSyncKey(type, view);
    return {
        ...(listKey
            ? {
                  [`${listKey}_q`]: null,
                  [`${listKey}_pageIdx`]: '0',
                  [`${listKey}_filters`]: category
                      ? encodeFiltersForUrl([{ id: 'asset_category', value: [category] }])
                      : null,
              }
            : {}),
        view: view === 'all' ? null : view,
        tab: type === 'IT' ? 'it' : null,
    };
}

/**
 * Open a list from the summary card, as a new history entry so Back returns to where the user was.
 *
 * urlStateManager only replaces the current entry, so the current URL is pushed again first and the
 * params then replace that copy. Each param notifies its subscribers: the tabs (`useUrlTab`) and an
 * open list follow at once, and a list that mounts afterwards reads them from the URL. The list's
 * params are written before `view` and `tab`, so a list is never shown with the old ones.
 */
export function openAssetList(target: AssetListTarget): void {
    const params = assetListParams(target);
    const current = new URLSearchParams(window.location.search);
    if (Object.entries(params).every(([key, value]) => current.get(key) === value)) return;

    window.history.pushState(window.history.state, '', window.location.href);
    Object.entries(params).forEach(([key, value]) => urlStateManager.updateParam(key, value));
}
