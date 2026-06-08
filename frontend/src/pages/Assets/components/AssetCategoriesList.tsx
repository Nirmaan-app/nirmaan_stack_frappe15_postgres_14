import React, { useMemo, useState, useCallback } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { Link } from 'react-router-dom';
import { useFrappeGetDocList, useFrappeUpdateDoc } from 'frappe-react-sdk';

import { DataTable } from '@/components/data-table/new-data-table';
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header';
import { useServerDataTable } from '@/hooks/useServerDataTable';
import { formatDate } from '@/utils/FormatDate';
import { useUserData } from '@/hooks/useUserData';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { Pencil, Boxes, Briefcase, Laptop } from 'lucide-react';

import {
    ASSET_CATEGORY_DOCTYPE,
    ASSET_CATEGORY_FIELDS,
    ASSET_MASTER_DOCTYPE,
    ASSET_CATEGORY_TYPE_OPTIONS,
    AssetCategoryType,
} from '../assets.constants';
import { getAssetPermissions } from '../utils/permissions';
import { useAssetDataRefresh } from '../hooks/useAssetDataRefresh';

interface AssetCategory {
    name: string;
    asset_category: string;
    category_type: AssetCategoryType | null;
    creation: string;
    modified: string;
}

const typeBadgeClass: Record<AssetCategoryType, string> = {
    Project: 'bg-blue-50 text-blue-700 border-blue-200',
    IT: 'bg-purple-50 text-purple-700 border-purple-200',
};

const typeIconMap: Record<AssetCategoryType, React.ReactNode> = {
    Project: <Briefcase className="h-3 w-3 mr-1" />,
    IT: <Laptop className="h-3 w-3 mr-1" />,
};

export const AssetCategoriesList: React.FC = () => {
    const { toast } = useToast();
    const userData = useUserData();

    const { refreshCategoryDropdowns } = useAssetDataRefresh();

    // Edit dialog state
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [editingCategory, setEditingCategory] = useState<AssetCategory | null>(null);
    const [editCategoryName, setEditCategoryName] = useState('');
    const [editCategoryType, setEditCategoryType] = useState<AssetCategoryType | ''>('');
    const [isUpdating, setIsUpdating] = useState(false);

    const { updateDoc } = useFrappeUpdateDoc();

    // Fetch asset counts per category
    const { data: assetCounts } = useFrappeGetDocList(
        ASSET_MASTER_DOCTYPE,
        {
            fields: ['asset_category', 'count(name) as count'],
            groupBy: 'asset_category',
            limit: 0,
        },
        'asset_counts_by_category'
    );

    // Fetch category counts per type for facet filter labels (e.g., "Project (21)")
    const { data: categoryCountByType } = useFrappeGetDocList(
        ASSET_CATEGORY_DOCTYPE,
        {
            fields: ['category_type', 'count(name) as count'],
            groupBy: 'category_type',
            limit: 0,
        },
        'asset_category_count_by_type'
    );

    const categoryCountByTypeMap = useMemo(() => {
        const map: Record<string, number> = {};
        categoryCountByType?.forEach((item: any) => {
            if (item.category_type) map[item.category_type] = item.count;
        });
        return map;
    }, [categoryCountByType]);

    const assetCountMap = useMemo(() => {
        const map: Record<string, number> = {};
        assetCounts?.forEach((item: any) => {
            map[item.asset_category] = item.count;
        });
        return map;
    }, [assetCounts]);

    // Only users with canManageCategories can edit
    const { canManageCategories } = getAssetPermissions(userData?.user_id, userData?.role);

    const handleEditClick = useCallback((category: AssetCategory) => {
        setEditingCategory(category);
        setEditCategoryName(category.asset_category);
        setEditCategoryType(category.category_type || '');
        setEditDialogOpen(true);
    }, []);

    const handleEditSubmit = async () => {
        if (!editingCategory || !editCategoryType) return;

        try {
            setIsUpdating(true);
            await updateDoc(ASSET_CATEGORY_DOCTYPE, editingCategory.name, {
                category_type: editCategoryType,
            });
            toast({
                title: 'Category Updated',
                description: `"${editingCategory.asset_category}" saved as ${editCategoryType}`,
                variant: 'success',
            });
            setEditDialogOpen(false);
            setEditingCategory(null);
            refetchTable();
            refreshCategoryDropdowns();
        } catch (error: any) {
            toast({
                title: 'Error',
                description: error?.message || 'Failed to update category',
                variant: 'destructive',
            });
        } finally {
            setIsUpdating(false);
        }
    };

    const columns = useMemo<ColumnDef<AssetCategory>[]>(() => [
        {
            accessorKey: 'asset_category',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Category Name" />,
            cell: ({ row }) => (
                <Link
                    to={`/asset-management/category/${row.original.name}`}
                    className="group flex items-center gap-2 hover:text-primary"
                >
                    <Boxes className="h-4 w-4 text-gray-400 group-hover:text-primary transition-colors" />
                    <span className="font-medium text-gray-900 group-hover:text-primary group-hover:underline transition-colors">
                        {row.getValue('asset_category')}
                    </span>
                </Link>
            ),
            size: 240,
        },
        {
            accessorKey: 'category_type',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Type" />,
            cell: ({ row }) => {
                const type = row.original.category_type;
                if (!type) {
                    return <span className="text-xs text-gray-400 italic">Untagged</span>;
                }
                return (
                    <Badge variant="outline" className={`font-medium ${typeBadgeClass[type]}`}>
                        {typeIconMap[type]}
                        {type}
                    </Badge>
                );
            },
            size: 120,
        },
        {
            id: 'asset_count',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Assets" />,
            cell: ({ row }) => {
                const count = assetCountMap[row.original.name] || 0;
                return (
                    <Badge
                        variant={count > 0 ? 'secondary' : 'outline'}
                        className={`tabular-nums ${count > 0 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'text-gray-400'}`}
                    >
                        {count}
                    </Badge>
                );
            },
            size: 100,
        },
        {
            accessorKey: 'creation',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Created On" />,
            cell: ({ row }) => (
                <span className="text-sm text-gray-500 tabular-nums">
                    {formatDate(row.getValue('creation'))}
                </span>
            ),
            size: 140,
        },
        ...(canManageCategories ? [{
            id: 'actions',
            header: () => <span>Actions</span>,
            cell: ({ row }: { row: any }) => {
                const category = row.original as AssetCategory;
                return (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-gray-600 hover:text-blue-600 hover:bg-blue-50"
                        onClick={() => handleEditClick(category)}
                        title="Edit category"
                    >
                        <span className="sr-only">Edit</span>
                        <Pencil className="h-4 w-4" />
                    </Button>
                );
            },
            size: 80,
        }] : []),
    ], [assetCountMap, canManageCategories, handleEditClick]);

    const searchableFields = [
        { value: 'asset_category', label: 'Category Name', placeholder: 'Search categories...', default: true },
    ];

    const facetFilterOptions = useMemo(() => ({
        category_type: {
            title: 'Type',
            options: ASSET_CATEGORY_TYPE_OPTIONS.map((opt) => {
                const count = categoryCountByTypeMap[opt.value] ?? 0;
                return {
                    label: `${opt.label} (${count})`,
                    value: opt.value,
                };
            }),
        },
    }), [categoryCountByTypeMap]);

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
    } = useServerDataTable<AssetCategory>({
        doctype: ASSET_CATEGORY_DOCTYPE,
        columns,
        fetchFields: ASSET_CATEGORY_FIELDS as unknown as string[],
        searchableFields,
        defaultSort: 'asset_category asc',
        urlSyncKey: 'asset_categories',
        enableRowSelection: false,
    });

    return (
        <>
            <DataTable<AssetCategory>
                table={table}
                columns={columns}
                isLoading={isLoading}
                error={error as Error}
                totalCount={totalCount}
                searchFieldOptions={searchableFields}
                selectedSearchField={selectedSearchField}
                onSelectedSearchFieldChange={setSelectedSearchField}
                searchTerm={searchTerm}
                onSearchTermChange={setSearchTerm}
                facetFilterOptions={facetFilterOptions}
                showExportButton={false}
                showRowSelection={false}
                className="[&_tr]:group"
            />

            {/* Edit Dialog */}
            <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="text-lg font-semibold">Edit Category</DialogTitle>
                        <DialogDescription className="text-sm text-gray-500">
                            Change the type for this category. The category name cannot be modified.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div>
                            <Label htmlFor="categoryName" className="text-sm font-medium text-gray-700">
                                Category Name
                            </Label>
                            <Input
                                id="categoryName"
                                value={editCategoryName}
                                readOnly
                                disabled
                                className="mt-1.5 bg-gray-50 text-gray-600 cursor-not-allowed"
                            />
                        </div>
                        <div>
                            <Label className="text-sm font-medium text-gray-700">
                                Category Type <span className="text-red-500">*</span>
                            </Label>
                            <div className="mt-1.5 grid grid-cols-2 gap-2">
                                {ASSET_CATEGORY_TYPE_OPTIONS.map((opt) => {
                                    const isSelected = editCategoryType === opt.value;
                                    return (
                                        <button
                                            key={opt.value}
                                            type="button"
                                            onClick={() => setEditCategoryType(opt.value)}
                                            className={`
                                                inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium
                                                transition-colors
                                                ${isSelected
                                                    ? opt.value === 'Project'
                                                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                                                        : 'border-purple-500 bg-purple-50 text-purple-700'
                                                    : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                                                }
                                            `}
                                        >
                                            {typeIconMap[opt.value]}
                                            {opt.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button
                            variant="outline"
                            onClick={() => setEditDialogOpen(false)}
                            disabled={isUpdating}
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handleEditSubmit}
                            disabled={
                                isUpdating
                                || !editCategoryType
                                || editCategoryType === (editingCategory?.category_type || '')
                            }
                        >
                            {isUpdating ? 'Saving...' : 'Save Changes'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
};
