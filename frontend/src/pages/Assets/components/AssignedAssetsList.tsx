import React, { useMemo, useState } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { Link } from 'react-router-dom';
import { useFrappeGetDocList } from 'frappe-react-sdk';

import { DataTable } from '@/components/data-table/new-data-table';
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header';
import { useServerDataTable } from '@/hooks/useServerDataTable';
import { formatDate } from '@/utils/FormatDate';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Hash, User, CheckCircle2, AlertCircle, ExternalLink, Briefcase, MapPin } from 'lucide-react';

import {
    ASSET_MANAGEMENT_DOCTYPE,
    ASSET_MANAGEMENT_FIELDS,
    ASSET_MANAGEMENT_SEARCHABLE_FIELDS,
    ASSET_MANAGEMENT_DATE_COLUMNS,
    AssetCategoryType,
} from '../assets.constants';
import { useAssetMasterNamesByType } from '../hooks/useAssetMasterNamesByType';
import { useAssetProjectOptions } from '../hooks/useAssetProjectOptions';
import { AssetLookupFacetFilter } from './AssetLookupFacetFilter';

interface AssetManagement {
    name: string;
    asset: string;
    asset_assigned_to: string;
    asset_assigned_on: string;
    asset_declaration_attachment: string;
    creation: string;
}

interface AssetMaster {
    name: string;
    asset_name: string;
    asset_category: string;
    project: string;
    asset_city: string;
    asset_state: string;
}

interface NirmaanUser {
    name: string;
    full_name: string;
}

interface AssignedAssetsListProps {
    assetType?: AssetCategoryType;
}

// Outer guard — blocks the table mount until masterNames-by-type is resolved.
// Without this guard useServerDataTable would fire an initial fetch with an
// empty/placeholder filter and the resulting "0 rows" can race past the real
// fetch and leave the table looking empty.
export const AssignedAssetsList: React.FC<AssignedAssetsListProps> = ({ assetType }) => {
    const { masterNames, isLoading: typeMastersLoading } = useAssetMasterNamesByType(assetType);

    if (assetType && typeMastersLoading) {
        return <Skeleton className="h-96 w-full bg-gray-100" />;
    }

    return <AssignedAssetsListInner assetType={assetType} masterNames={masterNames} />;
};

interface AssignedAssetsListInnerProps {
    assetType?: AssetCategoryType;
    masterNames: string[];
}

const AssignedAssetsListInner: React.FC<AssignedAssetsListInnerProps> = ({ assetType, masterNames }) => {
    // Project / City / State are Project-asset concepts. An IT asset never carries
    // a project, so on the IT tab these would be three columns of em-dashes.
    const isProjectTab = assetType === 'Project';
    // Fetch asset details — scope to typed asset names when filtering
    const { data: assetsList } = useFrappeGetDocList<AssetMaster>(
        'Asset Master',
        {
            fields: ['name', 'asset_name', 'asset_category', 'project', 'asset_city', 'asset_state'],
            filters: assetType ? [['name', 'in', masterNames.length ? masterNames : ['__none__']]] : [],
            limit: 0,
        },
        assetType ? `assets_for_assigned_list_${assetType}` : 'assets_for_assigned_list'
    );

    const assetsMap = useMemo(() => {
        const map: Record<string, AssetMaster> = {};
        assetsList?.forEach((asset) => {
            map[asset.name] = asset;
        });
        return map;
    }, [assetsList]);

    // Project names for the Project column (assignments carry the project via
    // their Asset Master row, so it is resolved through assetsMap like Category).
    const { projectsById } = useAssetProjectOptions(true);

    // Fetch user details
    const { data: usersList } = useFrappeGetDocList<NirmaanUser>(
        'Nirmaan Users',
        {
            fields: ['name', 'full_name'],
            limit: 0,
        },
        'users_for_assigned_list'
    );

    const usersMap = useMemo(() => {
        const map: Record<string, string> = {};
        usersList?.forEach((user) => {
            map[user.name] = user.full_name;
        });
        return map;
    }, [usersList]);

    // Project / City / State come from the linked Asset Master, so their funnels
    // live in the columns' own `header` render props with the selection held here
    // (see AssetLookupFacetFilter) and resolved into the `asset` scope below.
    const [projectFilter, setProjectFilter] = useState<string[]>([]);
    const [cityFilter, setCityFilter] = useState<string[]>([]);
    const [stateFilter, setStateFilter] = useState<string[]>([]);

    // Option lists (with counts) built from the same assets the tab is scoped to.
    const lookupFacetOptions = useMemo(() => {
        const project = new Map<string, number>();
        const city = new Map<string, number>();
        const state = new Map<string, number>();
        (assetsList ?? []).forEach((a) => {
            if (a.project) project.set(a.project, (project.get(a.project) ?? 0) + 1);
            const c = a.asset_city?.trim();
            if (c) city.set(c, (city.get(c) ?? 0) + 1);
            const st = a.asset_state?.trim();
            if (st) state.set(st, (state.get(st) ?? 0) + 1);
        });

        const toOptions = (counts: Map<string, number>, label?: (v: string) => string) =>
            Array.from(counts.entries())
                .map(([value, count]) => ({
                    label: `${label ? label(value) : value} (${count})`,
                    value,
                }))
                .sort((a, b) => a.label.localeCompare(b.label));

        return {
            project: toOptions(project, (id) => projectsById[id]?.project_name || id),
            city: toOptions(city),
            state: toOptions(state),
        };
    }, [assetsList, projectsById]);

    // Asset names matching every active lookup filter — null means "no constraint".
    const lookupScopedAssetNames = useMemo<string[] | null>(() => {
        if (!projectFilter.length && !cityFilter.length && !stateFilter.length) return null;
        return (assetsList ?? [])
            .filter((a) => {
                if (projectFilter.length && !projectFilter.includes(a.project || '')) return false;
                if (cityFilter.length && !cityFilter.includes((a.asset_city || '').trim())) return false;
                if (stateFilter.length && !stateFilter.includes((a.asset_state || '').trim())) return false;
                return true;
            })
            .map((a) => a.name);
    }, [assetsList, projectFilter, cityFilter, stateFilter]);

    // Source for facets — distinct `asset` + `asset_assigned_to` for this
    // scope, taken from Asset Management directly (mirrors the table query
    // shape, no row-count or pending filter).
    const facetSourceFilters = useMemo(() => {
        if (!assetType) return [];
        return [['asset', 'in', masterNames.length ? masterNames : ['__none__']]];
    }, [assetType, masterNames]);

    const { data: facetSource } = useFrappeGetDocList<{
        name: string;
        asset: string;
        asset_assigned_to: string;
    }>(
        ASSET_MANAGEMENT_DOCTYPE,
        {
            fields: ['name', 'asset', 'asset_assigned_to'],
            filters: facetSourceFilters,
            limit: 0,
        },
        assetType ? `assigned_facet_source_${assetType}` : 'assigned_facet_source'
    );

    // Count occurrences for the "(N)" suffix on each facet option.
    const facetCounts = useMemo(() => {
        const counts = {
            asset: new Map<string, number>(),
            asset_assigned_to: new Map<string, number>(),
        };
        (facetSource ?? []).forEach((row) => {
            if (row.asset) counts.asset.set(row.asset, (counts.asset.get(row.asset) ?? 0) + 1);
            if (row.asset_assigned_to) counts.asset_assigned_to.set(row.asset_assigned_to, (counts.asset_assigned_to.get(row.asset_assigned_to) ?? 0) + 1);
        });
        return counts;
    }, [facetSource]);

    const assetNameOptions = useMemo(() => {
        const opts: { label: string; value: string }[] = [];
        facetCounts.asset.forEach((count, id) => {
            const name = assetsMap[id]?.asset_name || id;
            opts.push({ label: `${name} (${count})`, value: id });
        });
        return opts.sort((a, b) => a.label.localeCompare(b.label));
    }, [facetCounts, assetsMap]);

    const assigneeOptions = useMemo(() => {
        const opts: { label: string; value: string }[] = [];
        facetCounts.asset_assigned_to.forEach((count, userId) => {
            const name = usersMap[userId] || userId;
            opts.push({ label: `${name} (${count})`, value: userId });
        });
        return opts.sort((a, b) => a.label.localeCompare(b.label));
    }, [facetCounts, usersMap]);

    const columns = useMemo<ColumnDef<AssetManagement>[]>(() => [
        {
            id: 'asset_id_display',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Asset ID" />,
            cell: ({ row }) => (
                <Link
                    to={`/asset-management/${row.original.asset}`}
                    className="inline-flex items-center gap-1.5 text-blue-600 hover:text-blue-800 hover:underline font-medium"
                >
                    <Hash className="h-3 w-3" />
                    <span className="tabular-nums">{row.original.asset.slice(-6)}</span>
                </Link>
            ),
            size: 100,
        },
        {
            // `accessorKey: 'asset'` (and the resulting column id `asset`) lives
            // on the Asset Name column so the Asset Name facet's funnel icon
            // renders here and filters resolve to ["asset", "in", [...ids]].
            accessorKey: 'asset',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Asset Name" />,
            meta: {
                exportValue: (row: any) => assetsMap[row.asset]?.asset_name || row.asset
            },
            cell: ({ row }) => {
                const assetData = assetsMap[row.original.asset];
                return (
                    <Link
                        to={`/asset-management/${row.original.asset}`}
                        className="font-medium text-gray-900 hover:text-blue-600 transition-colors"
                    >
                        {assetData?.asset_name || row.original.asset}
                    </Link>
                );
            },
            size: 200,
        },
        {
            id: 'asset_category',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Category" />,
            meta: {
                exportValue: (row: any) => assetsMap[row.asset]?.asset_category || ''
            },
            cell: ({ row }) => {
                const assetData = assetsMap[row.original.asset];
                return assetData?.asset_category ? (
                    <Badge variant="outline" className="font-normal">
                        {assetData.asset_category}
                    </Badge>
                ) : (
                    <span className="text-gray-400">—</span>
                );
            },
            size: 140,
        },
        {
            accessorKey: 'asset_assigned_to',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Assigned To" />,
            meta: {
                exportValue: (row: any) => usersMap[row.asset_assigned_to] || row.asset_assigned_to
            },
            cell: ({ row }) => {
                const userId = row.getValue<string>('asset_assigned_to');
                const userName = usersMap[userId] || userId;
                return (
                    <span className="inline-flex items-center gap-1.5 text-gray-700 text-sm">
                        <User className="h-3.5 w-3.5 text-emerald-500" />
                        {userName}
                    </span>
                );
            },
            size: 180,
        },
        ...(isProjectTab ? ([
            {
                // Lookup columns off the linked Asset Master (same shape as Category):
                // display-only, so they are id-based rather than accessorKey-based.
                id: 'project',
                enableSorting: false,
                header: ({ column }) => (
                    <div className="flex items-center gap-1">
                        <AssetLookupFacetFilter
                            title="Project"
                            options={lookupFacetOptions.project}
                            onChange={setProjectFilter}
                        />
                        <DataTableColumnHeader column={column} title="Project" />
                    </div>
                ),
                meta: {
                    exportHeaderName: 'Project',
                    exportValue: (row: any) => {
                        const projectId = assetsMap[row.asset]?.project;
                        return projectId ? (projectsById[projectId]?.project_name || projectId) : '';
                    },
                },
                cell: ({ row }) => {
                    const projectId = assetsMap[row.original.asset]?.project;
                    if (!projectId) return <span className="text-gray-400">—</span>;
                    return (
                        <span className="inline-flex items-center gap-1.5 text-sm text-gray-700">
                            <Briefcase className="h-3.5 w-3.5 text-gray-400" />
                            {projectsById[projectId]?.project_name || projectId}
                        </span>
                    );
                },
                size: 200,
            },
            {
                id: 'asset_city',
                enableSorting: false,
                header: ({ column }) => (
                    <div className="flex items-center gap-1">
                        <AssetLookupFacetFilter
                            title="City"
                            options={lookupFacetOptions.city}
                            onChange={setCityFilter}
                        />
                        <DataTableColumnHeader column={column} title="City" />
                    </div>
                ),
                meta: {
                    exportHeaderName: 'City',
                    exportValue: (row: any) => assetsMap[row.asset]?.asset_city || '',
                },
                cell: ({ row }) => {
                    const city = assetsMap[row.original.asset]?.asset_city;
                    if (!city) return <span className="text-gray-400">—</span>;
                    return (
                        <span className="inline-flex items-center gap-1.5 text-sm text-gray-700">
                            <MapPin className="h-3.5 w-3.5 text-gray-400" />
                            {city}
                        </span>
                    );
                },
                size: 140,
            },
            {
                id: 'asset_state',
                enableSorting: false,
                header: ({ column }) => (
                    <div className="flex items-center gap-1">
                        <AssetLookupFacetFilter
                            title="State"
                            options={lookupFacetOptions.state}
                            onChange={setStateFilter}
                        />
                        <DataTableColumnHeader column={column} title="State" />
                    </div>
                ),
                meta: {
                    exportHeaderName: 'State',
                    exportValue: (row: any) => assetsMap[row.asset]?.asset_state || '',
                },
                cell: ({ row }) => {
                    const state = assetsMap[row.original.asset]?.asset_state;
                    return state ? (
                        <span className="text-sm text-gray-700">{state}</span>
                    ) : (
                        <span className="text-gray-400">—</span>
                    );
                },
                size: 140,
            },
        ] as ColumnDef<AssetManagement>[]) : []),
        {
            accessorKey: 'asset_assigned_on',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Assigned On" />,
            cell: ({ row }) => (
                <span className="text-sm text-gray-500 tabular-nums">
                    {formatDate(row.getValue('asset_assigned_on'))}
                </span>
            ),
            size: 120,
        },
        {
            accessorKey: 'asset_declaration_attachment',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Declaration" />,
            cell: ({ row }) => {
                const attachment = row.getValue<string>('asset_declaration_attachment');
                return attachment ? (
                    <a
                        href={attachment}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-emerald-600 hover:text-emerald-700 text-sm"
                    >
                        <CheckCircle2 className="h-4 w-4" />
                        <span className="hidden sm:inline">View</span>
                        <ExternalLink className="h-3 w-3" />
                    </a>
                ) : (
                    <span className="inline-flex items-center gap-1.5 text-amber-600 text-sm">
                        <AlertCircle className="h-4 w-4" />
                        Pending
                    </span>
                );
            },
            size: 120,
        },
        // NOTE: projectFilter / cityFilter / stateFilter are deliberately NOT deps.
        // The funnels own their own selection (see AssetLookupFacetFilter); listing
        // the selection here would rebuild these column defs on every checkbox,
        // remounting the popover and closing it after a single pick.
    ], [assetsMap, usersMap, projectsById, lookupFacetOptions, isProjectTab]);

    const additionalFilters = useMemo(() => {
        // Intersect the type scope (Project/IT tab) with the lookup-filter scope.
        // '__none__' is the existing sentinel for "match nothing" — an empty `in`
        // list would otherwise be dropped and silently show every row.
        let names: string[] | null = assetType ? masterNames : null;

        if (lookupScopedAssetNames) {
            const allowed = new Set(lookupScopedAssetNames);
            names = names ? names.filter((n) => allowed.has(n)) : lookupScopedAssetNames;
        }

        if (names === null) return [];
        return [['asset', 'in', names.length ? names : ['__none__']]];
    }, [assetType, masterNames, lookupScopedAssetNames]);

    const {
        table,
        totalCount,
        isLoading,
        error,
        searchTerm,
        setSearchTerm,
        selectedSearchField,
        setSelectedSearchField,
        exportAllRows,
        isExporting,
    } = useServerDataTable<AssetManagement>({
        doctype: ASSET_MANAGEMENT_DOCTYPE,
        columns,
        fetchFields: ASSET_MANAGEMENT_FIELDS as unknown as string[],
        searchableFields: ASSET_MANAGEMENT_SEARCHABLE_FIELDS,
        defaultSort: 'asset_assigned_on desc',
        urlSyncKey: assetType ? `assigned_assets_${assetType.toLowerCase()}` : 'assigned_assets',
        enableRowSelection: false,
        additionalFilters,
    });

    const facetFilterOptions = useMemo(() => ({
        asset: {
            title: 'Asset Name',
            options: assetNameOptions,
        },
        asset_assigned_to: {
            title: 'Assignee',
            options: assigneeOptions,
        },
    }), [assetNameOptions, assigneeOptions]);

    return (
        <DataTable<AssetManagement>
            table={table}
            columns={columns}
            isLoading={isLoading}
            error={error as Error}
            totalCount={totalCount}
            searchFieldOptions={ASSET_MANAGEMENT_SEARCHABLE_FIELDS}
            selectedSearchField={selectedSearchField}
            onSelectedSearchFieldChange={setSelectedSearchField}
            searchTerm={searchTerm}
            onSearchTermChange={setSearchTerm}
            facetFilterOptions={facetFilterOptions}
            dateFilterColumns={ASSET_MANAGEMENT_DATE_COLUMNS}
            showExportButton={true}
            onExport="default"
            onExportAll={exportAllRows}
            isExporting={isExporting}
            exportFileName={assetType ? `assigned_${assetType.toLowerCase()}_assets_data` : 'assigned_assets_data'}
            showRowSelection={false}
        />
    );
};
