import React, { useMemo, useState } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { Link } from 'react-router-dom';
import { useFrappeGetDocList, useFrappePostCall, useSWRConfig } from 'frappe-react-sdk';
import { Briefcase, CheckCircle2, Hash, Undo2, User, XCircle } from 'lucide-react';

import { DataTable, SearchFieldOption } from '@/components/data-table/new-data-table';
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/components/ui/use-toast';
import { useServerDataTable } from '@/hooks/useServerDataTable';
import { useUserData } from '@/hooks/useUserData';
import { formatDate } from '@/utils/FormatDate';
import { getFrappeError } from '@/utils/frappeErrors';

import {
    ASSET_CACHE_KEYS,
    ASSET_MANAGEMENT_DOCTYPE,
    ASSET_MANAGEMENT_RETURN_FIELDS,
    AssetCategoryType,
} from '../assets.constants';
import { useAssetDataRefresh } from '../hooks/useAssetDataRefresh';
import { useAssetMasterNamesByType } from '../hooks/useAssetMasterNamesByType';
import { useAssetProjectOptions } from '../hooks/useAssetProjectOptions';
import { assignmentDepartmentColumn } from '../utils/departmentColumn';
import { getAssetPermissions } from '../utils/permissions';
import { AssetLookupFacetFilter } from './AssetLookupFacetFilter';

/** An assignment whose holder has returned the asset (Asset Management with `returned` ticked). */
interface ReturnRow {
    name: string;
    asset: string;
    asset_assigned_to: string;
    asset_assigned_on: string | null;
    received_on: string | null;
    returned_on: string | null;
}

interface AssetMaster {
    name: string;
    asset_name: string;
    asset_category: string;
    department: string | null;
    project: string | null;
}

const RETURN_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: 'asset', label: 'Asset ID', placeholder: 'Search by asset ID...', default: true },
    { value: 'asset_assigned_to', label: 'Returned By', placeholder: 'Search by person...' },
];

/** Both dates get the table's date-range filter. */
const RETURN_DATE_COLUMNS = ['returned_on', 'received_on'];

type Decision = { kind: 'approve' | 'reject'; row: ReturnRow };

interface ReturnRequestsListProps {
    assetType: AssetCategoryType;
    /** After an approve or reject: the page refreshes its lists and counts. */
    onChanged?: () => void;
}

const showDate = (value: string | null | undefined) => (value ? formatDate(value) : '—');

/**
 * The Return By tab (owner, 2026-10-13): assets whose holder says they gave them back, in the same table
 * as the Assigned tab -- search, sort, filters, export. Approve unassigns the asset; Reject clears the
 * return and the person keeps it. Both belong to the people who may unassign it -- Admin, HR, PMO, and
 * procurement for Project assets (owner, 2026-10-13). Both are confirmed first; the server re-checks.
 */
export const ReturnRequestsList: React.FC<ReturnRequestsListProps> = ({ assetType, onChanged }) => {
    // Wait for the tab's asset list, so the first fetch is never scoped to nothing (see AssignedAssetsList).
    const { masterNames, isLoading } = useAssetMasterNamesByType(assetType);
    if (isLoading) return <Skeleton className="h-96 w-full bg-gray-100" />;
    return <ReturnRequestsTable assetType={assetType} masterNames={masterNames} onChanged={onChanged} />;
};

const ReturnRequestsTable: React.FC<ReturnRequestsListProps & { masterNames: string[] }> = ({
    assetType,
    masterNames,
    onChanged,
}) => {
    const isProjectTab = assetType === 'Project';
    const scope = masterNames.length ? masterNames : ['__none__'];

    const { data: assetsList } = useFrappeGetDocList<AssetMaster>(
        'Asset Master',
        {
            fields: ['name', 'asset_name', 'asset_category', 'department', 'project'],
            filters: [['name', 'in', scope]],
            limit: 0,
        },
        `assets_for_return_list_${assetType}`
    );
    const assetsMap = useMemo(() => {
        const map: Record<string, AssetMaster> = {};
        assetsList?.forEach((asset) => {
            map[asset.name] = asset;
        });
        return map;
    }, [assetsList]);

    const { data: usersList } = useFrappeGetDocList<{ name: string; full_name: string }>(
        'Nirmaan Users',
        { fields: ['name', 'full_name'], limit: 0 },
        'users_for_pending_list'
    );
    const usersMap = useMemo(() => {
        const map: Record<string, string> = {};
        usersList?.forEach((user) => {
            map[user.name] = user.full_name;
        });
        return map;
    }, [usersList]);

    const { projectsById } = useAssetProjectOptions(isProjectTab);

    // Facet options with counts, from every waiting return in this tab.
    const { data: facetSource } = useFrappeGetDocList<{ name: string; asset: string; asset_assigned_to: string }>(
        ASSET_MANAGEMENT_DOCTYPE,
        {
            fields: ['name', 'asset', 'asset_assigned_to'],
            filters: [['returned', '=', 1], ['asset', 'in', scope]],
            limit: 0,
        },
        `return_facet_source_${assetType}`
    );
    const facets = useMemo(() => {
        const count = (values: string[]) => {
            const counts = new Map<string, number>();
            values.forEach((value) => value && counts.set(value, (counts.get(value) ?? 0) + 1));
            return counts;
        };
        const toOptions = (counts: Map<string, number>, label: (value: string) => string) =>
            Array.from(counts.entries())
                .map(([value, n]) => ({ label: `${label(value)} (${n})`, value }))
                .sort((a, b) => a.label.localeCompare(b.label));
        const rows = facetSource ?? [];
        return {
            asset: toOptions(count(rows.map((row) => row.asset)), (id) => assetsMap[id]?.asset_name || id),
            returnedBy: toOptions(count(rows.map((row) => row.asset_assigned_to)), (id) => usersMap[id] || id),
            category: toOptions(count(rows.map((row) => assetsMap[row.asset]?.asset_category || '')), (c) => c),
        };
    }, [facetSource, assetsMap, usersMap]);

    // Category lives on the Asset Master, so its funnel holds the selection here and narrows `asset`.
    const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
    const additionalFilters = useMemo(() => {
        const names = categoryFilter.length
            ? masterNames.filter((name) => categoryFilter.includes(assetsMap[name]?.asset_category || ''))
            : masterNames;
        return [
            ['returned', '=', 1],
            ['asset', 'in', names.length ? names : ['__none__']],
        ];
    }, [masterNames, categoryFilter, assetsMap]);

    // Approve / Reject
    const userData = useUserData();
    // Approve and Reject: the people who may unassign this kind of asset.
    const canDecide = getAssetPermissions(userData?.user_id, userData?.role).canAssignAssetType(assetType);
    const [decision, setDecision] = useState<Decision | null>(null);
    const [saving, setSaving] = useState(false);
    const { toast } = useToast();
    const { mutate } = useSWRConfig();
    const { refreshSummaryCards } = useAssetDataRefresh();
    const { call: approveReturn } = useFrappePostCall('nirmaan_stack.api.assets.returns.approve_return');
    const { call: rejectReturn } = useFrappePostCall('nirmaan_stack.api.assets.returns.reject_return');

    const nameOfAsset = (row: ReturnRow) => assetsMap[row.asset]?.asset_name || row.asset;
    const nameOfPerson = (row: ReturnRow) => usersMap[row.asset_assigned_to] || row.asset_assigned_to;

    const columns = useMemo<ColumnDef<ReturnRow>[]>(() => [
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
            size: 90,
        },
        {
            accessorKey: 'asset',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Asset Name" />,
            meta: { exportValue: (row: ReturnRow) => assetsMap[row.asset]?.asset_name || row.asset },
            cell: ({ row }) => (
                <Link
                    to={`/asset-management/${row.original.asset}`}
                    className="font-medium text-gray-900 hover:text-blue-600 transition-colors"
                >
                    {assetsMap[row.original.asset]?.asset_name || row.original.asset}
                </Link>
            ),
            size: 170,
        },
        {
            id: 'asset_category',
            enableSorting: false,
            header: ({ column }) => (
                <div className="flex items-center gap-1">
                    <AssetLookupFacetFilter title="Category" options={facets.category} onChange={setCategoryFilter} />
                    <DataTableColumnHeader column={column} title="Category" />
                </div>
            ),
            meta: { exportHeaderName: 'Category', exportValue: (row: ReturnRow) => assetsMap[row.asset]?.asset_category || '' },
            cell: ({ row }) => {
                const category = assetsMap[row.original.asset]?.asset_category;
                return category ? (
                    <Badge variant="outline" className="font-normal">{category}</Badge>
                ) : (
                    <span className="text-gray-400">—</span>
                );
            },
            size: 130,
        },
        {
            accessorKey: 'asset_assigned_to',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Returned By" />,
            meta: { exportValue: (row: ReturnRow) => usersMap[row.asset_assigned_to] || row.asset_assigned_to },
            cell: ({ row }) => (
                <Link
                    to={`/users/${row.original.asset_assigned_to}?tab=assets`}
                    className="inline-flex items-center gap-1.5 text-gray-700 text-sm hover:underline"
                >
                    <User className="h-3.5 w-3.5 text-sky-500" />
                    {usersMap[row.original.asset_assigned_to] || row.original.asset_assigned_to}
                </Link>
            ),
            size: 160,
        },
        {
            accessorKey: 'returned_on',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Return Date" />,
            cell: ({ row }) => (
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-sky-700 tabular-nums">
                    <Undo2 className="h-3.5 w-3.5" />
                    {showDate(row.original.returned_on)}
                </span>
            ),
            size: 120,
        },
        {
            accessorKey: 'received_on',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Received" />,
            cell: ({ row }) => (
                <span className="text-sm text-gray-500 tabular-nums">{showDate(row.original.received_on)}</span>
            ),
            size: 110,
        },
        assignmentDepartmentColumn<ReturnRow>((assetId) => assetsMap[assetId]?.department),
        ...(isProjectTab
            ? ([
                  {
                      id: 'project',
                      enableSorting: false,
                      header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />,
                      meta: {
                          exportHeaderName: 'Project',
                          exportValue: (row: ReturnRow) => {
                              const id = assetsMap[row.asset]?.project;
                              return id ? projectsById[id]?.project_name || id : '';
                          },
                      },
                      cell: ({ row }) => {
                          const id = assetsMap[row.original.asset]?.project;
                          if (!id) return <span className="text-gray-400">—</span>;
                          return (
                              <span className="inline-flex items-center gap-1.5 text-sm text-gray-700">
                                  <Briefcase className="h-3.5 w-3.5 text-gray-400" />
                                  {projectsById[id]?.project_name || id}
                              </span>
                          );
                      },
                      size: 160,
                  },
              ] as ColumnDef<ReturnRow>[])
            : []),
        {
            id: 'actions',
            enableSorting: false,
            header: () => <div className="text-center text-xs font-semibold">Actions</div>,
            meta: { excludeFromExport: true },
            cell: ({ row }) =>
                canDecide ? (
                    <div className="flex items-center justify-center gap-1.5">
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    size="icon"
                                    variant="outline"
                                    aria-label="Reject the return"
                                    className="h-8 w-8 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                                    onClick={() => setDecision({ kind: 'reject', row: row.original })}
                                >
                                    <XCircle className="h-4 w-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Reject the return</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    size="icon"
                                    aria-label="Approve the return"
                                    className="h-8 w-8 bg-emerald-600 text-white hover:bg-emerald-700"
                                    onClick={() => setDecision({ kind: 'approve', row: row.original })}
                                >
                                    <CheckCircle2 className="h-4 w-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Approve the return</TooltipContent>
                        </Tooltip>
                    </div>
                ) : (
                    <div className="text-center text-xs text-gray-400">—</div>
                ),
            size: 96,
        },
        // categoryFilter is deliberately not a dep: the funnel owns its selection, and rebuilding the
        // columns on every pick would remount its popover (as in AssignedAssetsList).
    ], [assetsMap, usersMap, projectsById, facets, isProjectTab, canDecide]);

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
    } = useServerDataTable<ReturnRow>({
        doctype: ASSET_MANAGEMENT_DOCTYPE,
        columns,
        fetchFields: ASSET_MANAGEMENT_RETURN_FIELDS as unknown as string[],
        searchableFields: RETURN_SEARCHABLE_FIELDS,
        defaultSort: 'returned_on desc',
        urlSyncKey: `return_requests_${assetType.toLowerCase()}`,
        enableRowSelection: false,
        additionalFilters,
    });

    const facetFilterOptions = useMemo(
        () => ({
            asset: { title: 'Asset Name', options: facets.asset },
            asset_assigned_to: { title: 'Returned By', options: facets.returnedBy },
        }),
        [facets]
    );

    const decide = async () => {
        if (!decision) return;
        const { kind, row } = decision;
        setSaving(true);
        try {
            await (kind === 'approve' ? approveReturn : rejectReturn)({ assignment: row.name });
            toast({
                title: kind === 'approve' ? 'Return approved' : 'Return rejected',
                description:
                    kind === 'approve'
                        ? `${nameOfAsset(row)} is free again.`
                        : `${nameOfAsset(row)} stays with ${nameOfPerson(row)}.`,
                variant: 'success',
            });
            setDecision(null);
            mutate(ASSET_CACHE_KEYS.RETURN_REQUESTS);
            mutate(`return_facet_source_${assetType}`);
            refreshSummaryCards();
            onChanged?.();
        } catch (err) {
            toast({
                title: kind === 'approve' ? "Couldn't approve the return" : "Couldn't reject the return",
                description: getFrappeError(err),
                variant: 'destructive',
            });
        } finally {
            setSaving(false);
        }
    };

    return (
        <>
            <DataTable<ReturnRow>
                table={table}
                columns={columns}
                isLoading={isLoading}
                error={error as Error}
                totalCount={totalCount}
                searchFieldOptions={RETURN_SEARCHABLE_FIELDS}
                selectedSearchField={selectedSearchField}
                onSelectedSearchFieldChange={setSelectedSearchField}
                searchTerm={searchTerm}
                onSearchTermChange={setSearchTerm}
                facetFilterOptions={facetFilterOptions}
                dateFilterColumns={RETURN_DATE_COLUMNS}
                showExportButton={true}
                onExport="default"
                onExportAll={exportAllRows}
                isExporting={isExporting}
                exportFileName={`returned_${assetType.toLowerCase()}_assets`}
                showRowSelection={false}
            />

            <AlertDialog open={!!decision} onOpenChange={(open) => !open && !saving && setDecision(null)}>
                <AlertDialogContent className="max-h-[90vh] overflow-y-auto">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-center">
                            {decision?.kind === 'approve' ? 'Approve the return?' : 'Reject the return?'}
                        </AlertDialogTitle>
                        <AlertDialogDescription className="text-center">
                            {decision && (
                                <>
                                    <span className="font-medium text-gray-700">{nameOfAsset(decision.row)}</span> from{' '}
                                    <span className="font-medium text-gray-700">{nameOfPerson(decision.row)}</span>, returned on{' '}
                                    {showDate(decision.row.returned_on)}.
                                    <span className="mt-3 block rounded-md bg-muted px-3 py-2 text-left text-xs text-gray-600">
                                        {decision.kind === 'approve'
                                            ? 'The asset becomes free: it moves to Unassigned, and its holder, project, city and state are cleared. The history records it as "Returned – no longer needed".'
                                            : `The return is cleared and ${nameOfPerson(decision.row)} keeps the asset. The history records the rejection; they can return it again later.`}
                                    </span>
                                </>
                            )}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="gap-2 sm:justify-center">
                        <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            disabled={saving}
                            onClick={(event) => {
                                // Radix closes on click by default; close only once the server agreed.
                                event.preventDefault();
                                decide();
                            }}
                            className={
                                decision?.kind === 'approve'
                                    ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                                    : 'bg-red-600 text-white hover:bg-red-700'
                            }
                        >
                            {saving
                                ? 'Saving…'
                                : decision?.kind === 'approve'
                                    ? 'Approve and free the asset'
                                    : 'Reject the return'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
};
