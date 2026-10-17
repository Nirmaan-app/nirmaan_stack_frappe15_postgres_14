import React, { useMemo, useState, useCallback } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { Link } from 'react-router-dom';
import { useFrappeGetDocList, useFrappePostCall, useFrappeUpdateDoc, useSWRConfig } from 'frappe-react-sdk';

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
import { Switch } from '@/components/ui/switch';
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
import { getFrappeError } from '@/utils/frappeErrors';
import { auditCycleRanges, auditMonthLabel, cycleMonth } from '@/utils/assetAudit';
import { cn } from '@/lib/utils';
import { Pencil, Boxes, Briefcase, Laptop } from 'lucide-react';

import {
    ASSET_CACHE_KEYS,
    ASSET_CATEGORY_DOCTYPE,
    ASSET_CATEGORY_FIELDS,
    ASSET_CATEGORY_TYPE_OPTIONS,
    AssetCategoryType,
} from '../assets.constants';
import { useCategoryAssetCounts } from '../hooks/useCategoryAssetCounts';
import { getAssetPermissions } from '../utils/permissions';
import { useAssetDataRefresh } from '../hooks/useAssetDataRefresh';

interface AssetCategory {
    name: string;
    asset_category: string;
    category_type: AssetCategoryType | null;
    /** "Monthly audit required" (owner, 2026-10-14). */
    audit_required?: 0 | 1;
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

    // Asset counts per category; Unassigned = Assets - Assigned (shared with the summary card).
    const { totalByCategory: assetCountMap, assignedByCategory: assignedCountMap } = useCategoryAssetCounts();

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

    // Only users with canManageCategories can edit
    const { canManageCategories, canSwitchCategoryAudit } = getAssetPermissions(userData?.user_id, userData?.role);

    // Monthly audit switch (owner, 2026-10-14): confirmed first, because switching it on opens this
    // month's audits of the category's assigned assets at once.
    const [auditSwitch, setAuditSwitch] = useState<{ category: AssetCategory; on: boolean } | null>(null);
    const [isSwitching, setIsSwitching] = useState(false);
    const { call: setCategoryAudit } = useFrappePostCall('nirmaan_stack.api.assets.audits.set_category_audit');
    const { mutate } = useSWRConfig();
    // This month split by the audit cycle, for the confirm dialog: [1st–27th, 28th–end].
    const cycleRanges = auditCycleRanges(new Date());

    const confirmAuditSwitch = async () => {
        if (!auditSwitch) return;
        const { category, on } = auditSwitch;
        setIsSwitching(true);
        try {
            const result = await setCategoryAudit({ category: category.name, required: on ? 1 : 0 });
            const opened: number = result?.message?.opened ?? 0;
            toast({
                title: on ? `Monthly audit on for ${category.asset_category}` : `Monthly audit off for ${category.asset_category}`,
                description: on
                    ? opened
                        ? `Opened ${opened} audit${opened === 1 ? '' : 's'} for ${auditMonthLabel(cycleMonth(new Date()))}.`
                        : 'No assigned asset needed an audit for this month yet.'
                    : 'No new audits open. Open ones can still be sent; unsent ones are recorded Missed and closed on the 7th.',
                variant: 'success',
            });
            setAuditSwitch(null);
            refetchTable();
            mutate(ASSET_CACHE_KEYS.AUDIT_PENDING);
            mutate(ASSET_CACHE_KEYS.AUDITED_CATEGORIES);
        } catch (error) {
            toast({ title: "Couldn't switch the monthly audit", description: getFrappeError(error), variant: 'destructive' });
        } finally {
            setIsSwitching(false);
        }
    };

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
            id: 'assigned_count',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Assigned" />,
            cell: ({ row }) => {
                const count = assignedCountMap[row.original.name] || 0;
                return (
                    <Badge
                        variant="outline"
                        className={`tabular-nums ${count > 0 ? 'bg-blue-50 text-blue-700 border-blue-200' : 'text-gray-400'}`}
                    >
                        {count}
                    </Badge>
                );
            },
            size: 100,
            meta: {
                exportHeaderName: 'Assigned',
                exportValue: (row: AssetCategory) => assignedCountMap[row.name] || 0,
            },
        },
        {
            id: 'unassigned_count',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Unassigned" />,
            cell: ({ row }) => {
                const count = Math.max(
                    (assetCountMap[row.original.name] || 0) - (assignedCountMap[row.original.name] || 0),
                    0
                );
                return (
                    <Badge
                        variant="outline"
                        className={`tabular-nums ${count > 0 ? 'bg-amber-50 text-amber-700 border-amber-200' : 'text-gray-400'}`}
                    >
                        {count}
                    </Badge>
                );
            },
            size: 110,
            meta: {
                exportHeaderName: 'Unassigned',
                exportValue: (row: AssetCategory) =>
                    Math.max((assetCountMap[row.name] || 0) - (assignedCountMap[row.name] || 0), 0),
            },
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
        // Monthly audit switch (owner, 2026-10-14): after Created On, and Admin's alone.
        ...(canSwitchCategoryAudit ? [{
            accessorKey: 'audit_required',
            header: ({ column }: { column: any }) => <DataTableColumnHeader column={column} title="Monthly Audit" />,
            meta: {
                exportHeaderName: 'Monthly Audit',
                exportValue: (row: AssetCategory) => (row.audit_required ? 'Yes' : 'No'),
            },
            cell: ({ row }: { row: any }) => {
                const category = row.original as AssetCategory;
                return (
                    <Switch
                        checked={!!category.audit_required}
                        aria-label={`Monthly audit for ${category.asset_category}`}
                        onCheckedChange={(next) => setAuditSwitch({ category, on: next })}
                    />
                );
            },
            size: 120,
        }] : []),
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
    ], [assetCountMap, assignedCountMap, canManageCategories, canSwitchCategoryAudit, handleEditClick]);

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

            {/* Monthly audit switch confirmation */}
            <AlertDialog open={!!auditSwitch} onOpenChange={(open) => !open && !isSwitching && setAuditSwitch(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {auditSwitch?.on ? 'Turn on' : 'Turn off'} the monthly audit for {auditSwitch?.category.asset_category}?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {auditSwitch?.on
                                ? `Every assigned ${auditSwitch?.category.asset_category} with a signed declaration gets the ${auditMonthLabel(cycleMonth(new Date()))} audit now (unless it was already audited for that month), and one every month from then on.`
                                : 'No new audits open for this category from now on. Audits already open stay and can still be sent; any still unsent on the 7th after their month are recorded Missed and closed.'}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    {/* Which month an audit opened today is for: from the 28th it is next month's (owner, 2026-10-14). */}
                    {auditSwitch?.on && (
                        <div className="rounded-md border bg-muted/40 px-3 py-2.5 text-sm">
                            <p className="mb-1.5 text-xs font-medium text-gray-600">Turned on during…</p>
                            {cycleRanges.map((range) => (
                                <div
                                    key={range.days}
                                    className={cn(
                                        'flex items-center justify-between gap-3 rounded px-2 py-1 tabular-nums',
                                        range.current ? 'bg-white font-medium text-gray-900 ring-1 ring-gray-200' : 'text-gray-500'
                                    )}
                                >
                                    <span>{range.days}</span>
                                    <span>
                                        → {range.month} audit
                                        {range.current && <span className="ml-1.5 text-xs font-normal text-emerald-700">(today)</span>}
                                    </span>
                                </div>
                            ))}
                            {cycleRanges[1].current && (
                                <p className="mt-1.5 text-xs text-gray-600">
                                    Today is the 28th or later, so no {auditMonthLabel(new Date())} audit is asked for.
                                </p>
                            )}
                        </div>
                    )}
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isSwitching}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            disabled={isSwitching}
                            onClick={(event) => {
                                event.preventDefault();
                                confirmAuditSwitch();
                            }}
                        >
                            {isSwitching ? 'Saving…' : auditSwitch?.on ? 'Turn on' : 'Turn off'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

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
