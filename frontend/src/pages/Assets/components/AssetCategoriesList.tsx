import React, { useMemo, useState, useCallback } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { Link } from 'react-router-dom';
import { useFrappeGetDocList, useFrappeDeleteDoc, useFrappeUpdateDoc } from 'frappe-react-sdk';

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
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/components/ui/use-toast';
import { MoreHorizontal, Pencil, Trash2, Boxes } from 'lucide-react';

import {
    ASSET_CATEGORY_DOCTYPE,
    ASSET_CATEGORY_FIELDS,
    ASSET_MASTER_DOCTYPE,
} from '../assets.constants';
import { getAssetPermissions } from '../utils/permissions';

interface AssetCategory {
    name: string;
    asset_category: string;
    creation: string;
    modified: string;
}

export const AssetCategoriesList: React.FC = () => {
    const { toast } = useToast();
    const userData = useUserData();

    // Edit dialog state
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [editingCategory, setEditingCategory] = useState<AssetCategory | null>(null);
    const [editCategoryName, setEditCategoryName] = useState('');
    const [isUpdating, setIsUpdating] = useState(false);

    // Delete dialog state
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [deletingCategory, setDeletingCategory] = useState<AssetCategory | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    const { updateDoc } = useFrappeUpdateDoc();
    const { deleteDoc } = useFrappeDeleteDoc();

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

    const assetCountMap = useMemo(() => {
        const map: Record<string, number> = {};
        assetCounts?.forEach((item: any) => {
            map[item.asset_category] = item.count;
        });
        return map;
    }, [assetCounts]);

    // Get granular permissions - only users with canManageCategories can edit/delete
    const { canManageCategories } = getAssetPermissions(userData?.user_id, userData?.role);

    // Handle edit
    const handleEditClick = useCallback((category: AssetCategory) => {
        setEditingCategory(category);
        setEditCategoryName(category.asset_category);
        setEditDialogOpen(true);
    }, []);

    const handleEditSubmit = async () => {
        if (!editingCategory || !editCategoryName.trim()) return;

        try {
            setIsUpdating(true);
            await updateDoc(ASSET_CATEGORY_DOCTYPE, editingCategory.name, {
                asset_category: editCategoryName.trim(),
            });
            toast({
                title: 'Category Updated',
                description: `Category renamed to "${editCategoryName.trim()}"`,
                variant: 'success',
            });
            setEditDialogOpen(false);
            setEditingCategory(null);
            refetchTable();
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

    // Handle delete
    const handleDeleteClick = useCallback((category: AssetCategory) => {
        setDeletingCategory(category);
        setDeleteDialogOpen(true);
    }, []);

    const handleDeleteConfirm = async () => {
        if (!deletingCategory) return;

        const assetCount = assetCountMap[deletingCategory.name] || 0;
        if (assetCount > 0) {
            toast({
                title: 'Cannot Delete',
                description: `This category has ${assetCount} asset(s). Please reassign or delete them first.`,
                variant: 'destructive',
            });
            setDeleteDialogOpen(false);
            return;
        }

        try {
            setIsDeleting(true);
            await deleteDoc(ASSET_CATEGORY_DOCTYPE, deletingCategory.name);
            toast({
                title: 'Category Deleted',
                description: `"${deletingCategory.asset_category}" has been deleted`,
                variant: 'success',
            });
            setDeleteDialogOpen(false);
            setDeletingCategory(null);
            refetchTable();
        } catch (error: any) {
            toast({
                title: 'Error',
                description: error?.message || 'Failed to delete category',
                variant: 'destructive',
            });
        } finally {
            setIsDeleting(false);
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
            size: 280,
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
            header: () => <span className="sr-only">Actions</span>,
            cell: ({ row }: { row: any }) => {
                const category = row.original as AssetCategory;
                const hasAssets = (assetCountMap[category.name] || 0) > 0;

                return (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity data-[state=open]:opacity-100"
                            >
                                <span className="sr-only">Open menu</span>
                                <MoreHorizontal className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                            <DropdownMenuItem
                                onClick={() => handleEditClick(category)}
                                className="cursor-pointer"
                            >
                                <Pencil className="mr-2 h-4 w-4" />
                                Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                onClick={() => handleDeleteClick(category)}
                                className={`cursor-pointer text-red-600 focus:text-red-600 focus:bg-red-50 ${hasAssets ? 'opacity-50' : ''}`}
                            >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                );
            },
            size: 60,
        }] : []),
    ], [assetCountMap, canManageCategories, handleEditClick, handleDeleteClick]);

    const searchableFields = [
        { value: 'asset_category', label: 'Category Name', placeholder: 'Search categories...', default: true },
    ];

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
                            Update the category name. This will not affect existing assets.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                        <Label htmlFor="categoryName" className="text-sm font-medium text-gray-700">
                            Category Name
                        </Label>
                        <Input
                            id="categoryName"
                            value={editCategoryName}
                            onChange={(e) => setEditCategoryName(e.target.value)}
                            placeholder="Enter category name"
                            className="mt-1.5"
                            autoFocus
                        />
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
                            disabled={isUpdating || !editCategoryName.trim() || editCategoryName === editingCategory?.asset_category}
                        >
                            {isUpdating ? 'Saving...' : 'Save Changes'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation Dialog */}
            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete Category</AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to delete <strong>"{deletingCategory?.asset_category}"</strong>?
                            This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleDeleteConfirm}
                            disabled={isDeleting}
                            className="bg-red-600 text-white hover:bg-red-700 focus:ring-red-600"
                        >
                            {isDeleting ? 'Deleting...' : 'Delete'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
};
