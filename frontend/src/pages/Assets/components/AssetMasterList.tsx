import React, { useMemo } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { Link } from 'react-router-dom';
import { useFrappeGetDocList } from 'frappe-react-sdk';

import { DataTable } from '@/components/data-table/new-data-table';
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header';
import { useServerDataTable } from '@/hooks/useServerDataTable';
import { formatDate } from '@/utils/FormatDate';
import { formatToRoundedIndianRupee } from '@/utils/FormatPrice';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Package, User, Hash } from 'lucide-react';

import {
    ASSET_MASTER_DOCTYPE,
    ASSET_MASTER_FIELDS,
    ASSET_SEARCHABLE_FIELDS,
    ASSET_DATE_COLUMNS,
    ASSET_CONDITION_OPTIONS,
    ASSET_CATEGORY_DOCTYPE,
    AssetCategoryType,
} from '../assets.constants';

interface AssetMaster {
    name: string;
    asset_name: string;
    asset_description: string;
    asset_category: string;
    asset_condition: string;
    asset_serial_number: string;
    asset_value: number;
    asset_email: string;
    current_assignee: string;
    creation: string;
    modified: string;
}

interface NirmaanUser {
    name: string;
    full_name: string;
}

const conditionColorMap: Record<string, string> = {
    'New': 'bg-emerald-50 text-emerald-700 border-emerald-200',
    'Good': 'bg-blue-50 text-blue-700 border-blue-200',
    'Fair': 'bg-amber-50 text-amber-700 border-amber-200',
    'Poor': 'bg-orange-50 text-orange-700 border-orange-200',
    'Damaged': 'bg-red-50 text-red-700 border-red-200',
};

interface AssetMasterListProps {
    assetType?: AssetCategoryType;
}

// Outer guard: resolves category names for the chosen type, then mounts the
// inner table. Until the category list is loaded we render a skeleton — this
// prevents useServerDataTable from firing a racy first fetch with a sentinel
// (`__none__`) filter that returns 0 rows.
export const AssetMasterList: React.FC<AssetMasterListProps> = ({ assetType }) => {
    const { data: categoryList, isLoading: categoryListLoading } = useFrappeGetDocList(
        ASSET_CATEGORY_DOCTYPE,
        {
            fields: ['name', 'asset_category'],
            filters: assetType ? [['category_type', '=', assetType]] : [],
            orderBy: { field: 'asset_category', order: 'asc' },
            limit: 0,
        },
        assetType ? `asset_categories_for_filter_${assetType}` : 'asset_categories_for_filter'
    );

    if (assetType && (categoryListLoading || !categoryList)) {
        return <Skeleton className="h-96 w-full bg-gray-100" />;
    }

    return <AssetMasterListInner assetType={assetType} categoryList={categoryList ?? []} />;
};

interface AssetMasterListInnerProps {
    assetType?: AssetCategoryType;
    categoryList: { name: string; asset_category: string }[];
}

const AssetMasterListInner: React.FC<AssetMasterListInnerProps> = ({ assetType, categoryList }) => {
    const categoryNames = useMemo(
        () => categoryList.map((c) => c.name),
        [categoryList]
    );

    // Fetch users for displaying assignee names
    const { data: usersList } = useFrappeGetDocList<NirmaanUser>(
        'Nirmaan Users',
        {
            fields: ['name', 'full_name'],
            limit: 0,
        },
        'users_for_asset_list'
    );

    const usersMap = useMemo(() => {
        const map: Record<string, string> = {};
        usersList?.forEach((user) => {
            map[user.name] = user.full_name;
        });
        return map;
    }, [usersList]);

    // Scope filter shared by the table query and the facet-options query so the
    // table and its filter dropdowns see the same Project/IT-bound dataset.
    const scopeFilter = useMemo(() => {
        if (!assetType) return [];
        if (categoryNames.length === 0) return [['asset_category', 'in', ['__none__']]];
        return [['asset_category', 'in', categoryNames]];
    }, [assetType, categoryNames]);

    // Fetch all asset names + assignees + category + condition scoped to the
    // current type, so we can build facet filter options that cover the
    // entire dataset (not just the current page) and embed per-option counts.
    const { data: facetSource } = useFrappeGetDocList<{
        name: string;
        asset_name: string;
        current_assignee: string;
        asset_category: string;
        asset_condition: string;
    }>(
        ASSET_MASTER_DOCTYPE,
        {
            fields: ['name', 'asset_name', 'current_assignee', 'asset_category', 'asset_condition'],
            filters: scopeFilter,
            limit: 0,
        },
        assetType
            ? `asset_master_facet_source_${assetType}`
            : 'asset_master_facet_source'
    );

    // Count occurrences per field value — drives the "(N)" suffix on each
    // facet option (matches the Categories tab pattern).
    const facetCounts = useMemo(() => {
        const counts = {
            asset_name: new Map<string, number>(),
            current_assignee: new Map<string, number>(),
            asset_category: new Map<string, number>(),
            asset_condition: new Map<string, number>(),
        };
        (facetSource ?? []).forEach((row) => {
            const n = row.asset_name?.trim();
            if (n) counts.asset_name.set(n, (counts.asset_name.get(n) ?? 0) + 1);
            if (row.current_assignee) counts.current_assignee.set(row.current_assignee, (counts.current_assignee.get(row.current_assignee) ?? 0) + 1);
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
        const opts: { label: string; value: string; count: number }[] = [];
        facetCounts.asset_name.forEach((count, name) => {
            opts.push({ label: `${name} (${count})`, value: name, count });
        });
        return opts.sort((a, b) => a.label.localeCompare(b.label));
    }, [facetCounts]);

    const assigneeOptions = useMemo(() => {
        const opts: { label: string; value: string }[] = [];
        facetCounts.current_assignee.forEach((count, userId) => {
            const name = usersMap[userId] || userId;
            opts.push({ label: `${name} (${count})`, value: userId });
        });
        return opts.sort((a, b) => a.label.localeCompare(b.label));
    }, [facetCounts, usersMap]);

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
            meta: {
                exportHeaderName: 'Asset ID',
                exportValue: (row: AssetMaster) => row.name,
            },
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
            size: 250,
            meta: {
                exportHeaderName: 'Asset Name',
                exportValue: (row: AssetMaster) => row.asset_name,
            },
        },
        {
            accessorKey: 'asset_category',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Category" />,
            cell: ({ row }) => (
                <Badge variant="outline" className="font-normal">
                    {row.getValue('asset_category')}
                </Badge>
            ),
            size: 150,
            meta: {
                exportHeaderName: 'Category',
                exportValue: (row: AssetMaster) => row.asset_category,
            },
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
            size: 120,
            meta: {
                exportHeaderName: 'Condition',
                exportValue: (row: AssetMaster) => row.asset_condition || '',
            },
        },
        {
            accessorKey: 'asset_serial_number',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Serial No." />,
            cell: ({ row }) => {
                const serial = row.getValue<string>('asset_serial_number');
                return serial ? (
                    <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-mono text-gray-700">
                        {serial}
                    </code>
                ) : (
                    <span className="text-gray-400">—</span>
                );
            },
            size: 140,
            meta: {
                exportHeaderName: 'Serial Number',
                exportValue: (row: AssetMaster) => row.asset_serial_number || '',
            },
        },
        {
            accessorKey: 'asset_value',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Value" />,
            cell: ({ row }) => {
                const value = row.getValue<number>('asset_value');
                return value ? (
                    <span className="inline-flex items-center gap-1 text-sm font-medium text-gray-700 tabular-nums">
                        {formatToRoundedIndianRupee(value)}
                    </span>
                ) : (
                    <span className="text-gray-400">—</span>
                );
            },
            size: 120,
            meta: {
                exportHeaderName: 'Asset Value (₹)',
                exportValue: (row: AssetMaster) => row.asset_value || '',
            },
        },
        {
            accessorKey: 'current_assignee',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Assignee" />,
            cell: ({ row }) => {
                const assigneeId = row.getValue<string>('current_assignee');
                if (!assigneeId) {
                    return (
                        <span className="inline-flex items-center gap-1.5 text-gray-400 text-sm">
                            <User className="h-3.5 w-3.5" />
                            Unassigned
                        </span>
                    );
                }
                const assigneeName = usersMap[assigneeId] || assigneeId;
                return (
                    <span className="inline-flex items-center gap-1.5 text-gray-700 text-sm">
                        <User className="h-3.5 w-3.5 text-emerald-500" />
                        {assigneeName}
                    </span>
                );
            },
            size: 180,
            meta: {
                exportHeaderName: 'Assignee',
                exportValue: (row: AssetMaster) => {
                    if (!row.current_assignee) return 'Unassigned';
                    return usersMap[row.current_assignee] || row.current_assignee;
                },
            },
        },
        {
            accessorKey: 'creation',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Created" />,
            cell: ({ row }) => (
                <span className="text-sm text-gray-500 tabular-nums">
                    {formatDate(row.getValue('creation'))}
                </span>
            ),
            size: 120,
            meta: {
                exportHeaderName: 'Created On',
                exportValue: (row: AssetMaster) => formatDate(row.creation),
            },
        },
    ], [usersMap]);

    const additionalFilters = scopeFilter;

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
    } = useServerDataTable<AssetMaster>({
        doctype: ASSET_MASTER_DOCTYPE,
        columns,
        fetchFields: ASSET_MASTER_FIELDS as unknown as string[],
        searchableFields: ASSET_SEARCHABLE_FIELDS,
        defaultSort: 'creation desc',
        urlSyncKey: assetType ? `asset_master_${assetType.toLowerCase()}` : 'asset_master',
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
        current_assignee: {
            title: 'Assignee',
            options: assigneeOptions,
        },
    }), [assetNameOptions, categoryOptions, conditionOptions, assigneeOptions]);

    return (
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
            exportFileName={assetType ? `asset_master_${assetType.toLowerCase()}_data` : 'asset_master_data'}
            showRowSelection={false}
        />
    );
};
