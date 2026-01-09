import React, { useMemo } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { Link } from 'react-router-dom';
import { useFrappeGetDocList } from 'frappe-react-sdk';

import { DataTable } from '@/components/data-table/new-data-table';
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header';
import { useServerDataTable } from '@/hooks/useServerDataTable';
import { formatDate } from '@/utils/FormatDate';
import { Badge } from '@/components/ui/badge';
import { Hash, User, FileText, CheckCircle2, AlertCircle, ExternalLink } from 'lucide-react';

import {
    ASSET_MANAGEMENT_DOCTYPE,
    ASSET_MANAGEMENT_FIELDS,
    ASSET_MANAGEMENT_SEARCHABLE_FIELDS,
    ASSET_MANAGEMENT_DATE_COLUMNS,
} from '../assets.constants';

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

export const AssignedAssetsList: React.FC = () => {
    // Fetch asset details
    const { data: assetsList } = useFrappeGetDocList<AssetMaster>(
        'Asset Master',
        {
            fields: ['name', 'asset_name', 'asset_category'],
            limit: 0,
        },
        'assets_for_assigned_list'
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

    const columns = useMemo<ColumnDef<AssetManagement>[]>(() => [
        {
            accessorKey: 'asset',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Asset ID" />,
            cell: ({ row }) => (
                <Link
                    to={`/asset-management/${row.original.asset}`}
                    className="inline-flex items-center gap-1.5 text-blue-600 hover:text-blue-800 hover:underline font-medium"
                >
                    <Hash className="h-3 w-3" />
                    <span className="tabular-nums">{row.getValue<string>('asset').slice(-6)}</span>
                </Link>
            ),
            size: 100,
        },
        {
            id: 'asset_name',
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
            header: ({ column }) => <DataTableColumnHeader column={column} title="Category" />,
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
        urlSyncKey: 'assigned_assets',
        enableRowSelection: false,
    });

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
            dateFilterColumns={ASSET_MANAGEMENT_DATE_COLUMNS}
            showExportButton={true}
            onExport="default"
            exportFileName="assigned_assets_data"
            showRowSelection={false}
        />
    );
};
