import React, { useMemo } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { Link } from 'react-router-dom';
import { useFrappeGetDocList } from 'frappe-react-sdk';

import { DataTable } from '@/components/data-table/new-data-table';
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header';
import { useServerDataTable } from '@/hooks/useServerDataTable';
import { formatDate } from '@/utils/FormatDate';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Hash, User, CheckCircle2, AlertCircle, ExternalLink } from 'lucide-react';

import {
    ASSET_MANAGEMENT_DOCTYPE,
    ASSET_MANAGEMENT_FIELDS,
    ASSET_MANAGEMENT_SEARCHABLE_FIELDS,
    ASSET_MANAGEMENT_DATE_COLUMNS,
    AssetCategoryType,
} from '../assets.constants';
import { useAssetMasterNamesByType } from '../hooks/useAssetMasterNamesByType';

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
    // Fetch asset details — scope to typed asset names when filtering
    const { data: assetsList } = useFrappeGetDocList<AssetMaster>(
        'Asset Master',
        {
            fields: ['name', 'asset_name', 'asset_category'],
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
    ], [assetsMap, usersMap]);

    const additionalFilters = useMemo(() => {
        if (!assetType) return [];
        if (masterNames.length === 0) return [['asset', 'in', ['__none__']]];
        return [['asset', 'in', masterNames]];
    }, [assetType, masterNames]);

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
