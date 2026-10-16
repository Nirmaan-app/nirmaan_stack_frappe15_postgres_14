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
import { Hash, User, AlertTriangle } from 'lucide-react';

import {
    ASSET_MANAGEMENT_DOCTYPE,
    ASSET_MANAGEMENT_FIELDS,
    ASSET_MANAGEMENT_SEARCHABLE_FIELDS,
    ASSET_MANAGEMENT_DATE_COLUMNS,
    AssetCategoryType,
} from '../assets.constants';
import { assignmentDepartmentColumn, departmentFacetOptions, matchesDepartmentFilter } from '../utils/departmentColumn';
import { useAssetMasterNamesByType } from '../hooks/useAssetMasterNamesByType';
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
    department: string | null;
}

interface NirmaanUser {
    name: string;
    full_name: string;
}

interface PendingActionsListProps {
    assetType?: AssetCategoryType;
}

// Outer guard — blocks the table mount until masterNames-by-type is resolved.
// Without this guard useServerDataTable would fire an initial fetch with a
// placeholder filter and the resulting "0 rows" can race past the real fetch.
export const PendingActionsList: React.FC<PendingActionsListProps> = ({ assetType }) => {
    const { masterNames, isLoading: typeMastersLoading } = useAssetMasterNamesByType(assetType);

    if (assetType && typeMastersLoading) {
        return <Skeleton className="h-96 w-full bg-gray-100" />;
    }

    return (
        <PendingActionsListInner
            assetType={assetType}
            masterNames={masterNames}
        />
    );
};

interface PendingActionsListInnerProps {
    assetType?: AssetCategoryType;
    masterNames: string[];
}

const PendingActionsListInner: React.FC<PendingActionsListInnerProps> = ({
    assetType,
    masterNames,
}) => {
    // Fetch asset details — scope to typed asset names when filtering
    const { data: assetsList } = useFrappeGetDocList<AssetMaster>(
        'Asset Master',
        {
            fields: ['name', 'asset_name', 'asset_category', 'department'],
            filters: assetType ? [['name', 'in', masterNames.length ? masterNames : ['__none__']]] : [],
            limit: 0,
        },
        assetType ? `assets_for_pending_list_${assetType}` : 'assets_for_pending_list'
    );

    const assetsMap = useMemo(() => {
        const map: Record<string, AssetMaster> = {};
        assetsList?.forEach((asset) => {
            map[asset.name] = asset;
        });
        return map;
    }, [assetsList]);

    // Fetch user details
    const { data: usersList } = useFrappeGetDocList<NirmaanUser>(
        'Nirmaan Users',
        {
            fields: ['name', 'full_name'],
            limit: 0,
        },
        'users_for_pending_list'
    );

    const usersMap = useMemo(() => {
        const map: Record<string, string> = {};
        usersList?.forEach((user) => {
            map[user.name] = user.full_name;
        });
        return map;
    }, [usersList]);

    // Source for facets — distinct `asset` + `asset_assigned_to` from Asset
    // Management rows that are pending a declaration upload (scoped to the
    // current asset type). `is not set` catches both NULL and '' — `= ''`
    // alone misses NULL-valued rows.
    const facetSourceFilters = useMemo(() => {
        const filters: any[] = [['asset_declaration_attachment', 'is', 'not set']];
        if (assetType) {
            filters.push(['asset', 'in', masterNames.length ? masterNames : ['__none__']]);
        }
        return filters;
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
        assetType ? `pending_facet_source_${assetType}` : 'pending_facet_source'
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

    // Category and Department live on the Asset Master, not on these rows, so they filter as lookups
    // (AssetLookupFacetFilter): the picked values narrow the `asset` scope below -- as on the Assigned tab.
    const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
    const [departmentFilter, setDepartmentFilter] = useState<string[]>([]);

    // Options with counts, from the pending rows themselves (not every asset).
    const pendingLookupOptions = useMemo(() => {
        const rows = facetSource ?? [];
        const categories = new Map<string, number>();
        rows.forEach((row) => {
            const category = assetsMap[row.asset]?.asset_category;
            if (category) categories.set(category, (categories.get(category) ?? 0) + 1);
        });
        return {
            category: Array.from(categories.entries())
                .map(([value, count]) => ({ label: `${value} (${count})`, value }))
                .sort((a, b) => a.label.localeCompare(b.label)),
            department: departmentFacetOptions(rows.map((row) => assetsMap[row.asset]?.department)),
        };
    }, [facetSource, assetsMap]);

    // Asset names matching both lookup filters -- null means "no constraint".
    const lookupScopedAssetNames = useMemo<string[] | null>(() => {
        if (!categoryFilter.length && !departmentFilter.length) return null;
        return (assetsList ?? [])
            .filter((a) => {
                if (categoryFilter.length && !categoryFilter.includes(a.asset_category || '')) return false;
                if (departmentFilter.length && !matchesDepartmentFilter(a.department, departmentFilter)) return false;
                return true;
            })
            .map((a) => a.name);
    }, [assetsList, categoryFilter, departmentFilter]);

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
            // `accessorKey: 'asset'` (column id `asset`) lives on the Asset Name
            // column so the facet's funnel icon renders here and filters
            // resolve to ["asset", "in", [...ids]].
            accessorKey: 'asset',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Asset Name" />,
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
            enableSorting: false, // not a field of these rows: the server can't sort on it
            header: ({ column }) => (
                <div className="flex items-center gap-1">
                    <AssetLookupFacetFilter
                        title="Category"
                        options={pendingLookupOptions.category}
                        onChange={setCategoryFilter}
                    />
                    <DataTableColumnHeader column={column} title="Category" />
                </div>
            ),
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
        // With a filter the column isn't sortable (it isn't a field of these rows), so no dead sort arrow.
        assignmentDepartmentColumn<AssetManagement>((assetId) => assetsMap[assetId]?.department, {
            options: pendingLookupOptions.department,
            onChange: setDepartmentFilter,
        }),
        {
            accessorKey: 'asset_assigned_to',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Assigned To" />,
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
            id: 'status',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
            // Every holder signs their own declaration in the app (owner, 2026-10-15): nothing to download here.
            cell: () => (
                <div className="flex flex-col items-start gap-1">
                    <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                        <AlertTriangle className="h-3 w-3 mr-1" />
                        Pending Declaration
                    </Badge>
                    <span className="text-xs text-gray-500">User has to sign and submit</span>
                </div>
            ),
            size: 180,
        },
        // categoryFilter / departmentFilter are deliberately NOT deps: the funnels own their selection, and
        // rebuilding the columns on every tick would remount the popover and close it after one pick.
    ], [assetsMap, usersMap, pendingLookupOptions]);

    const additionalFilters = useMemo(() => {
        const filters: any[] = [['asset_declaration_attachment', 'is', 'not set']];
        // The type scope (Project / IT tab) narrowed by the Category / Department picks. '__none__' matches
        // nothing: an empty `in` list would be dropped and show every row.
        let names: string[] | null = assetType ? masterNames : null;
        if (lookupScopedAssetNames) {
            const allowed = new Set(lookupScopedAssetNames);
            names = names ? names.filter((n) => allowed.has(n)) : lookupScopedAssetNames;
        }
        if (names !== null) filters.push(['asset', 'in', names.length ? names : ['__none__']]);
        return filters;
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
    } = useServerDataTable<AssetManagement>({
        doctype: ASSET_MANAGEMENT_DOCTYPE,
        columns,
        fetchFields: ASSET_MANAGEMENT_FIELDS as unknown as string[],
        searchableFields: ASSET_MANAGEMENT_SEARCHABLE_FIELDS,
        defaultSort: 'asset_assigned_on desc',
        urlSyncKey: assetType ? `pending_actions_${assetType.toLowerCase()}` : 'pending_actions',
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
        <>
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
                showExportButton={false}
                showRowSelection={false}
            />
        </>
    );
};
