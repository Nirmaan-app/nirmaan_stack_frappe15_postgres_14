import { useMemo } from 'react';
import { useFrappeGetCall, useFrappeGetDocList } from 'frappe-react-sdk';

import { useUserData } from '@/hooks/useUserData';
import { ASSET_CACHE_KEYS } from '../assets.constants';
import { getAssetPermissions } from '../utils/permissions';

export interface AssetProjectRow {
    name: string;
    project_name: string;
    project_city: string;
    project_state: string;
    tendering_status: string;
}

export interface AssetProjectOption {
    value: string;
    label: string;
    city: string;
    state: string;
}

export interface UseAssetProjectOptionsResult {
    /** SELECTABLE projects — every Won tender, whatever projects the viewer is allowed on. For pickers. */
    projectOptions: AssetProjectOption[];
    /** EVERY project, keyed by id. For resolving a stored id to a name. */
    projectsById: Record<string, AssetProjectRow>;
    isLoading: boolean;
}

/**
 * Projects for the Project-Asset surfaces. `project_city` / `project_state` are
 * read-only fetch fields on Projects (sourced from the linked Project Address),
 * so we can echo City/State in the form the moment a project is picked — the
 * server re-fetches them onto the Asset Master anyway on save.
 *
 * The FETCH is deliberately unfiltered so `projectsById` can resolve any stored
 * project id to its name; only `projectOptions` (what a picker offers) is
 * narrowed to Won tenders. Filtering the fetch instead would make an asset
 * already linked to a non-Won project render as a raw id.
 *
 * That fetch follows the viewer's project User Permissions, so a procurement user allowed on one
 * project was offered only that one. The picker now lists every Won project from
 * `api/assets/projects.get_won_projects` (owner, 2026-10-13), for people who may assign assets; for
 * anyone else (no picker) it stays the Won part of the fetch.
 */
export function useAssetProjectOptions(enabled: boolean): UseAssetProjectOptionsResult {
    const { data, isLoading } = useFrappeGetDocList<AssetProjectRow>(
        'Projects',
        {
            fields: ['name', 'project_name', 'project_city', 'project_state', 'tendering_status'],
            orderBy: { field: 'project_name', order: 'asc' },
            limit: 0,
        },
        enabled ? ASSET_CACHE_KEYS.PROJECTS_DROPDOWN : null,
    );

    const { user_id, role } = useUserData();
    const { canAssignAsset } = getAssetPermissions(user_id, role);
    const { data: wonData, isLoading: wonLoading } = useFrappeGetCall<{ message: AssetProjectRow[] }>(
        'nirmaan_stack.api.assets.projects.get_won_projects',
        undefined,
        enabled && canAssignAsset ? ASSET_CACHE_KEYS.WON_PROJECTS : null,
    );
    const won = wonData?.message;

    const projectOptions = useMemo(
        () =>
            (won ?? (data ?? []).filter((p) => p.tendering_status === 'Won')).map((p) => ({
                value: p.name,
                label: p.project_name || p.name,
                city: p.project_city || '',
                state: p.project_state || '',
            })),
        [won, data],
    );

    // Both lists, so a project picked from the full Won list resolves to its name too.
    const projectsById = useMemo(() => {
        const map: Record<string, AssetProjectRow> = {};
        [...(data ?? []), ...(won ?? [])].forEach((p) => {
            map[p.name] = p;
        });
        return map;
    }, [data, won]);

    return { projectOptions, projectsById, isLoading: enabled && (isLoading || (canAssignAsset && wonLoading)) };
}
