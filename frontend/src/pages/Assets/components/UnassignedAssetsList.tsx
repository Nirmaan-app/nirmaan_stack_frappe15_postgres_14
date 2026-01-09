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
} from '../assets.constants';

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
}

export const UnassignedAssetsList: React.FC<UnassignedAssetsListProps> = ({ onAssigned }) => {
    const userData = useUserData();
    const [assignDialogOpen, setAssignDialogOpen] = useState(false);
    const [selectedAsset, setSelectedAsset] = useState<{ id: string; name: string } | null>(null);

    // Fetch categories for facet filter
    const { data: categoryList } = useFrappeGetDocList(
        ASSET_CATEGORY_DOCTYPE,
        {
            fields: ['name', 'asset_category'],
            orderBy: { field: 'asset_category', order: 'asc' },
            limit: 0,
        },
        'asset_categories_for_unassigned_filter'
    );

    const categoryOptions = useMemo(() =>
        categoryList?.map((cat: any) => ({
            label: cat.asset_category,
            value: cat.name,
        })) || [],
        [categoryList]
    );

    const canManageAssets = userData?.user_id === 'Administrator' ||
        ['Nirmaan Admin Profile', 'Nirmaan PMO Executive Profile', 'Nirmaan HR Executive Profile'].includes(userData?.role || '');

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
        ...(canManageAssets ? [{
            id: 'actions',
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
    ], [canManageAssets]);

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
    } = useServerDataTable<AssetMaster>({
        doctype: ASSET_MASTER_DOCTYPE,
        columns,
        fetchFields: ASSET_MASTER_FIELDS as unknown as string[],
        searchableFields: ASSET_SEARCHABLE_FIELDS,
        defaultSort: 'creation desc',
        urlSyncKey: 'unassigned_assets',
        enableRowSelection: false,
        additionalFilters: [['current_assignee', '=', '']],
    });

    const facetFilterOptions = useMemo(() => ({
        asset_category: {
            title: 'Category',
            options: categoryOptions,
        },
        asset_condition: {
            title: 'Condition',
            options: ASSET_CONDITION_OPTIONS,
        },
    }), [categoryOptions]);

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
                exportFileName="unassigned_assets_data"
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
