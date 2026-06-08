import React, { useMemo, useState } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { Link } from 'react-router-dom';
import { useFrappeGetDocList } from 'frappe-react-sdk';

import { DataTable } from '@/components/data-table/new-data-table';
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header';
import { useServerDataTable } from '@/hooks/useServerDataTable';
import { formatDate } from '@/utils/FormatDate';
import { formatToRoundedIndianRupee } from '@/utils/FormatPrice';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useUserData } from '@/hooks/useUserData';
import { Package, Hash, UserPlus } from 'lucide-react';

import { AssignAssetDialog } from './AssignAssetDialog';

import {
    ASSET_MASTER_DOCTYPE,
    ASSET_MASTER_FIELDS,
    ASSET_SEARCHABLE_FIELDS,
    ASSET_DATE_COLUMNS,
    ASSET_CONDITION_OPTIONS,
    ASSET_CATEGORY_DOCTYPE,
    AssetCategoryType,
} from '../assets.constants';
import { getAssetPermissions } from '../utils/permissions';

interface AssetMaster {
    name: string;
    asset_name: string;
    asset_description: string;
    asset_category: string;
    asset_condition: string;
    asset_serial_number: string;
    asset_value: number;
    current_assignee: string;
    creation: string;
}

const conditionColorMap: Record<string, string> = {
    'New': 'bg-emerald-50 text-emerald-700 border-emerald-200',
    'Good': 'bg-blue-50 text-blue-700 border-blue-200',
    'Fair': 'bg-amber-50 text-amber-700 border-amber-200',
    'Poor': 'bg-orange-50 text-orange-700 border-orange-200',
    'Damaged': 'bg-red-50 text-red-700 border-red-200',
};

interface UnassignedAssetsListProps {
    onAssigned?: () => void;
    assetType?: AssetCategoryType;
}

// Outer guard — blocks table mount until typed categoryList is loaded so the
// inner useServerDataTable doesn't fire a racy first fetch with a placeholder.
export const UnassignedAssetsList: React.FC<UnassignedAssetsListProps> = ({ onAssigned, assetType }) => {
    const { data: categoryList, isLoading: categoryListLoading } = useFrappeGetDocList(
        ASSET_CATEGORY_DOCTYPE,
        {
            fields: ['name', 'asset_category'],
            filters: assetType ? [['category_type', '=', assetType]] : [],
            orderBy: { field: 'asset_category', order: 'asc' },
            limit: 0,
        },
        assetType ? `asset_categories_for_unassigned_filter_${assetType}` : 'asset_categories_for_unassigned_filter'
    );

    if (assetType && (categoryListLoading || !categoryList)) {
        return <Skeleton className="h-96 w-full bg-gray-100" />;
    }

    return (
        <UnassignedAssetsListInner
            assetType={assetType}
            categoryList={categoryList ?? []}
            onAssigned={onAssigned}
        />
    );
};

interface UnassignedAssetsListInnerProps {
    assetType?: AssetCategoryType;
    categoryList: { name: string; asset_category: string }[];
    onAssigned?: () => void;
}

const UnassignedAssetsListInner: React.FC<UnassignedAssetsListInnerProps> = ({
    assetType,
    categoryList,
    onAssigned,
}) => {
    const userData = useUserData();
    const [assignDialogOpen, setAssignDialogOpen] = useState(false);
    const [selectedAsset, setSelectedAsset] = useState<{ id: string; name: string } | null>(null);

    const categoryNames = useMemo(
        () => categoryList.map((c) => c.name),
        [categoryList]
    );

    // Source for facets — all unassigned assets in the current type scope.
    // `is not set` catches both NULL and ''; `in ["", null]` would drop
    // nulls at the REST API boundary.
    const facetSourceFilters = useMemo(() => {
        const filters: any[] = [['current_assignee', 'is', 'not set']];
        if (assetType) {
            if (categoryNames.length === 0) filters.push(['asset_category', 'in', ['__none__']]);
            else filters.push(['asset_category', 'in', categoryNames]);
        }
        return filters;
    }, [assetType, categoryNames]);

    const { data: facetSource } = useFrappeGetDocList<{
        name: string;
        asset_name: string;
        asset_category: string;
        asset_condition: string;
    }>(
        ASSET_MASTER_DOCTYPE,
        {
            fields: ['name', 'asset_name', 'asset_category', 'asset_condition'],
            filters: facetSourceFilters,
            limit: 0,
        },
        assetType ? `unassigned_facet_source_${assetType}` : 'unassigned_facet_source'
    );

    const facetCounts = useMemo(() => {
        const counts = {
            asset_name: new Map<string, number>(),
            asset_category: new Map<string, number>(),
            asset_condition: new Map<string, number>(),
        };
        (facetSource ?? []).forEach((row) => {
            const n = row.asset_name?.trim();
            if (n) counts.asset_name.set(n, (counts.asset_name.get(n) ?? 0) + 1);
            if (row.asset_category) counts.asset_category.set(row.asset_category, (counts.asset_category.get(row.asset_category) ?? 0) + 1);
            if (row.asset_condition) counts.asset_condition.set(row.asset_condition, (counts.asset_condition.get(row.asset_condition) ?? 0) + 1);
        });
        return counts;
    }, [facetSource]);

    const categoryOptions = useMemo(() =>
        categoryList.map((cat) => ({
            label: `${cat.asset_category} (${facetCounts.asset_category.get(cat.name) ?? 0})`,
            value: cat.name,
        })),
        [categoryList, facetCounts]
    );

    const conditionOptions = useMemo(() =>
        ASSET_CONDITION_OPTIONS.map((opt) => ({
            label: `${opt.label} (${facetCounts.asset_condition.get(opt.value) ?? 0})`,
            value: opt.value,
        })),
        [facetCounts]
    );

    const assetNameOptions = useMemo(() => {
        const opts: { label: string; value: string }[] = [];
        facetCounts.asset_name.forEach((count, name) => {
            opts.push({ label: `${name} (${count})`, value: name });
        });
        return opts.sort((a, b) => a.label.localeCompare(b.label));
    }, [facetCounts]);

    const { canAssignAsset } = getAssetPermissions(userData?.user_id, userData?.role);

    const handleAssignClick = (asset: AssetMaster) => {
        setSelectedAsset({ id: asset.name, name: asset.asset_name });
        setAssignDialogOpen(true);
    };

    const handleAssigned = () => {
        refetchTable();
        onAssigned?.();
    };

    const columns = useMemo<ColumnDef<AssetMaster>[]>(() => [
        {
            accessorKey: 'name',
            header: ({ column }) => <DataTableColumnHeader column={column} title="ID" />,
            cell: ({ row }) => (
                <Link
                    to={`/asset-management/${row.original.name}`}
                    className="inline-flex items-center gap-1.5 text-blue-600 hover:text-blue-800 hover:underline font-medium"
                >
                    <Hash className="h-3 w-3" />
                    <span className="tabular-nums">{row.getValue<string>('name').slice(-6)}</span>
                </Link>
            ),
            size: 100,
        },
        {
            accessorKey: 'asset_name',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Asset Name" />,
            cell: ({ row }) => (
                <Link
                    to={`/asset-management/${row.original.name}`}
                    className="group flex items-center gap-2"
                >
                    <Package className="h-4 w-4 text-gray-400 group-hover:text-gray-600 transition-colors" />
                    <span className="font-medium text-gray-900 group-hover:text-blue-600 transition-colors">
                        {row.getValue('asset_name')}
                    </span>
                </Link>
            ),
            size: 220,
        },
        {
            accessorKey: 'asset_category',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Category" />,
            cell: ({ row }) => (
                <Badge variant="outline" className="font-normal">
                    {row.getValue('asset_category')}
                </Badge>
            ),
            size: 140,
        },
        {
            accessorKey: 'asset_condition',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Condition" />,
            cell: ({ row }) => {
                const condition = row.getValue<string>('asset_condition');
                if (!condition) return <span className="text-gray-400">—</span>;
                return (
                    <Badge
                        variant="outline"
                        className={`font-medium ${conditionColorMap[condition] || ''}`}
                    >
                        {condition}
                    </Badge>
                );
            },
            size: 110,
        },
        {
            accessorKey: 'asset_value',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Value" />,
            cell: ({ row }) => {
                const value = row.getValue<number>('asset_value');
                return value ? (
                    <span className="text-sm font-medium text-gray-700 tabular-nums">
                        {formatToRoundedIndianRupee(value)}
                    </span>
                ) : (
                    <span className="text-gray-400">—</span>
                );
            },
            size: 110,
        },
        {
            accessorKey: 'creation',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Created" />,
            cell: ({ row }) => (
                <span className="text-sm text-gray-500 tabular-nums">
                    {formatDate(row.getValue('creation'))}
                </span>
            ),
            size: 110,
        },
        ...(canAssignAsset ? [{
            id: 'actions',
            meta: {
                excludeFromExport: true
            },
            header: () => <span className="sr-only">Actions</span>,
            cell: ({ row }: { row: any }) => (
                <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1.5 text-emerald-600 border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700"
                    onClick={() => handleAssignClick(row.original)}
                >
                    <UserPlus className="h-3.5 w-3.5" />
                    Assign
                </Button>
            ),
            size: 100,
        }] : []),
    ], [canAssignAsset]);

    // Match the summary card's Unassigned filter so the table, the Asset
    // Name facet, and the summary count all agree. Uses `is not set` (matches
    // NULL or '') — `in ["", null]` would drop nulls at the REST API.
    const additionalFilters = useMemo(() => {
        const filters: any[] = [['current_assignee', 'is', 'not set']];
        if (assetType) {
            if (categoryNames.length === 0) {
                filters.push(['asset_category', 'in', ['__none__']]);
            } else {
                filters.push(['asset_category', 'in', categoryNames]);
            }
        }
        return filters;
    }, [assetType, categoryNames]);

    const {
        table,
        totalCount,
        isLoading,
        error,
        searchTerm,
        setSearchTerm,
        selectedSearchField,
        setSelectedSearchField,
        refetch: refetchTable,
        exportAllRows,
        isExporting,
    } = useServerDataTable<AssetMaster>({
        doctype: ASSET_MASTER_DOCTYPE,
        columns,
        fetchFields: ASSET_MASTER_FIELDS as unknown as string[],
        searchableFields: ASSET_SEARCHABLE_FIELDS,
        defaultSort: 'creation desc',
        urlSyncKey: assetType ? `unassigned_assets_${assetType.toLowerCase()}` : 'unassigned_assets',
        enableRowSelection: false,
        additionalFilters,
    });

    const facetFilterOptions = useMemo(() => ({
        asset_name: {
            title: 'Asset Name',
            options: assetNameOptions,
        },
        asset_category: {
            title: 'Category',
            options: categoryOptions,
        },
        asset_condition: {
            title: 'Condition',
            options: conditionOptions,
        },
    }), [assetNameOptions, categoryOptions, conditionOptions]);

    return (
        <>
            <DataTable<AssetMaster>
                table={table}
                columns={columns}
                isLoading={isLoading}
                error={error as Error}
                totalCount={totalCount}
                searchFieldOptions={ASSET_SEARCHABLE_FIELDS}
                selectedSearchField={selectedSearchField}
                onSelectedSearchFieldChange={setSelectedSearchField}
                searchTerm={searchTerm}
                onSearchTermChange={setSearchTerm}
                facetFilterOptions={facetFilterOptions}
                dateFilterColumns={ASSET_DATE_COLUMNS}
                showExportButton={true}
                onExport="default"
                onExportAll={exportAllRows}
                isExporting={isExporting}
                exportFileName={assetType ? `unassigned_${assetType.toLowerCase()}_assets_data` : 'unassigned_assets_data'}
                showRowSelection={false}
            />

            {selectedAsset && (
                <AssignAssetDialog
                    isOpen={assignDialogOpen}
                    onOpenChange={setAssignDialogOpen}
                    assetId={selectedAsset.id}
                    assetName={selectedAsset.name}
                    onAssigned={handleAssigned}
                />
            )}
        </>
    );
};
