import React, { useMemo, useRef } from 'react';
import { Column, ColumnDef } from "@tanstack/react-table";
import { DataTable, SearchFieldOption } from '@/components/data-table/new-data-table';
import { useServerDataTable } from '@/hooks/useServerDataTable';
import { FacetDeclaration, FacetOverrides } from '@/components/data-table/facetConfig';
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { DataTableFacetedFilter } from "@/components/data-table/data-table-faceted-filter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, Trash2, MessageSquare, Lock } from 'lucide-react';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger
} from "@/components/ui/tooltip";
import { useUserData } from "@/hooks/useUserData";
import { useNirmaanUsers } from '../../data/tds/useTdsQueries';
import { useDeleteTdsItem } from '../../data/tds/useTdsMutations';
import { toast } from "@/components/ui/use-toast";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useState } from "react";
import {
    HISTORY_STATUSES,
    HISTORY_STATUS_LABEL,
    historyStatusLabel,
    historyStatusOf,
    historyStatusesIn,
    isDeleteLocked,
    isProjectCustomId,
    storedStatusesFor,
    type HistoryStatus,
} from "@/utils/tdsRequestRules";
import {
    CLIENT_STATUS,
    CLIENT_STATUS_ACTION,
    clientStatusActionsFor,
    historyTabFilters,
    isClientStatusMarkable,
    type ClientStatusAction,
    type HistoryTab,
} from "@/utils/tdsRequestRules";
import { useSetClientStatus } from '../../data/tds/useTdsMutations';
import { getFrappeError } from "@/utils/frappeErrors";
import { format } from 'date-fns';
import { TdsClientRejectDialog } from './TdsClientRejectDialog';

interface TdsHistoryTableProps {
    projectId: string;
    /** Which History tab this table shows; the server filters rows by its Client Status. */
    tab?: HistoryTab;
    refreshTrigger?: number;
    onDataChange?: () => void;
    /** After rows are marked: the page refreshes its tab counts and export data. */
    onClientStatusChange?: () => void;
}

interface ProjectTDSItem {
    name: string;
    tds_request_id: string;
    tds_work_package: string;
    tds_category: string;
    tds_item_id: string;
    tds_item_name: string;
    tds_description: string;
    tds_make: string;
    tds_status: string;
    tds_rejection_reason?: string;
    tds_attachment?: string;
    tds_boq_line_item?: string;
    client_status?: string;
    client_status_by?: string;
    client_status_on?: string;
    client_rejection_reason?: string;
    creation: string;
    // owner: string; // Removed in favor of dynamic keys
    [key: string]: any;
}

const DOCTYPE = "Project TDS Item List";

const HISTORY_STATUS_OPTIONS = HISTORY_STATUSES.map(s => ({ label: HISTORY_STATUS_LABEL[s], value: s }));

const HISTORY_STATUS_STYLES: Record<HistoryStatus, string> = {
    Pending: "bg-yellow-100 text-yellow-800",
    Approved: "bg-green-100 text-green-800",
    Rejected: "bg-red-100 text-red-800",
};

// Unlike the Admin's green and red, so the two decisions are easy to tell apart.
const CLIENT_STATUS_STYLES: Record<string, string> = {
    [CLIENT_STATUS.approved]: "bg-blue-100 text-blue-800",
    [CLIENT_STATUS.rejected]: "bg-orange-100 text-orange-800",
};

const CLIENT_ACTION_BUTTONS: Record<ClientStatusAction, { label: string; className: string }> = {
    [CLIENT_STATUS_ACTION.markApproved]: { label: CLIENT_STATUS.approved, className: "bg-blue-600 hover:bg-blue-700 text-white" },
    [CLIENT_STATUS_ACTION.markRejected]: { label: CLIENT_STATUS.rejected, className: "bg-orange-600 hover:bg-orange-700 text-white" },
    [CLIENT_STATUS_ACTION.clear]: { label: "Clear Client Status", className: "" },
};

/** A mark reads "Mark …" on TDS History and "Switch to …" on a client tab, where the rows already hold an answer. */
const clientActionLabel = (action: ClientStatusAction, tab: HistoryTab) => {
    const { label } = CLIENT_ACTION_BUTTONS[action];
    if (action === CLIENT_STATUS_ACTION.clear) return label;
    return `${tab === "history" ? "Mark" : "Switch to"} ${label}`;
};

const formatMarkedOn = (value?: string) => (value ? format(new Date(value), "dd-MMM-yyyy HH:mm") : "");

// The Status filter offers the three shown statuses, but the column's filter state holds the
// STORED values (Pending → Pending + New). The list fetch, the export and the other facets'
// cross-filter all read that state, so each matches New rows with no rule of its own.
const historyStatusFilterColumn = (column: Column<ProjectTDSItem, unknown>): Column<ProjectTDSItem, unknown> =>
    Object.assign(Object.create(column), {
        getFilterValue: () => historyStatusesIn(column.getFilterValue()),
        setFilterValue: (shown?: string[]) =>
            column.setFilterValue(shown?.length ? storedStatusesFor(shown) : undefined),
    });

export const TdsHistoryTable: React.FC<TdsHistoryTableProps> = ({
    projectId,
    tab = "history",
    refreshTrigger = 0,
    onDataChange,
    onClientStatusChange,
}) => {
    const { role } = useUserData();
    const { deleteDoc } = useDeleteTdsItem();
    const { setClientStatus, loading: isMarking } = useSetClientStatus();
    // The ticked rows waiting on the Rejected by Client dialog; empty while it is closed.
    const [rowsToReject, setRowsToReject] = useState<ProjectTDSItem[]>([]);
    const [itemToDelete, setItemToDelete] = useState<string | null>(null);
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

    // --- 1. Fetch Nirmaan Users for Mapping ---
    // Moved to top so it can be used in columns
    const { data: nirmaanUsers } = useNirmaanUsers();

    // Create User Map: email -> full_name
    const userMap = useMemo(() => {
        const map = new Map<string, string>();
        if (nirmaanUsers) {
            nirmaanUsers.forEach((u: any) => {
                if (u.name && u.full_name) {
                    map.set(u.name, u.full_name);
                }
            });
        }
        return map;
    }, [nirmaanUsers]);

    const isAdmin = role === "Nirmaan Admin Profile" || role === "Administrator";
    const isPMO = role === "Nirmaan PMO Executive Profile";

    // Gates the Actions column AND every button in it. A PMO deletes on the same
    // terms as an Admin, at ANY status (owner ruling) — the previous rule let a
    // PMO delete only Pending / Rejected rows and rendered "--" on Approved ones,
    // which is what put an unusable column in front of them.
    //
    // The doctype grants `Nirmaan PMO Executive` delete permission, so this gate
    // is the role boundary. The one server re-check is the Client Status lock: a
    // row the client has answered is refused by the `on_trash` hook and shows
    // "Locked" here (`isDeleteLocked`).
    const canManageTDS = isAdmin || isPMO;
    // The server re-checks both (`client_status.py` MARK_PROFILES, Clear Admin-only; both pass Administrator).
    const clientActions = clientStatusActionsFor(tab, { canMark: isAdmin || isPMO, canClear: isAdmin });

    // --- 2. Define Columns (with dependency on userMap) ---
    const columns = useMemo<ColumnDef<ProjectTDSItem>[]>(() => [

        {
            accessorKey: "tds_request_id",
            header: ({ column }) => <DataTableColumnHeader column={column} title="TDS ID" />,
            cell: ({ row }) => (
                <div className="font-medium text-red-600">
                    {row.getValue("tds_request_id")}
                </div>
            ),
            size: 100,
            enableSorting: true,
            meta: {
                facet: { field: "tds_request_id", title: "TDS ID" } satisfies FacetDeclaration,
            },
        },
        {
            accessorKey: "tds_work_package",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Work Package" />,
            cell: ({ row }) => <div title={row.getValue("tds_work_package")}>{row.getValue("tds_work_package")}</div>,
            size: 120,
            enableSorting: true,
            filterFn: (row, id, value) => value.includes(row.getValue(id)),
            meta: {
                facet: { field: "tds_work_package", title: "Work Package" } satisfies FacetDeclaration,
            },
        },
        {
            accessorKey: "tds_category",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Category" />,
            cell: ({ row }) => <div title={row.getValue("tds_category")}>{row.getValue("tds_category")}</div>,
            size: 120,
            enableSorting: true,
            filterFn: (row, id, value) => value.includes(row.getValue(id)),
            meta: {
                facet: { field: "tds_category", title: "Category" } satisfies FacetDeclaration,
            },
        },
        {
            accessorKey: "tds_item_id",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Item ID" />,
            cell: ({ row }) => <div className="font-medium whitespace-wrap">{row.getValue("tds_item_id")}</div>,
            size: 100,
            enableSorting: true,
            meta: {
                facet: { field: "tds_item_id", title: "Item ID" } satisfies FacetDeclaration,
            },
        },
        {
            accessorKey: "tds_item_name",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Item Name" />,
            cell: ({ row }) => (
                <div>
                    <div className="font-medium" title={row.getValue("tds_item_name")}>{row.getValue("tds_item_name")}</div>
                    {isProjectCustomId(row.original.tds_item_id) && (
                        <span className="mt-0.5 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-800">
                            Project Custom
                        </span>
                    )}
                </div>
            ),
            size: 150,
            enableSorting: true,
            meta: {
                facet: { field: "tds_item_name", title: "Item Name" } satisfies FacetDeclaration,
            },
        },
        {
            accessorKey: "tds_description",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Description" />,
            cell: ({ row }) => {
                const description = row.getValue("tds_description") as string;
                const displayValue = description?.trim() ? description : "--";
                return (
                    <div className="truncate max-w-[150px]" title={displayValue}>
                        {displayValue}
                    </div>
                );
            },
            size: 100,
        },
        {
            accessorKey: "tds_make",
            header: "Make",
            cell: ({ row }) => (
                <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium border border-gray-200 text-gray-600 bg-gray-50">
                    {row.getValue("tds_make")}
                </span>
            ),
            size: 120,
            meta: {
                facet: { field: "tds_make", title: "Make" } satisfies FacetDeclaration,
            },
        },
        {
            accessorKey: "tds_status",
            header: ({ column }) => (
                <div className="flex items-center gap-1">
                    <DataTableFacetedFilter
                        column={historyStatusFilterColumn(column)}
                        title="Status"
                        options={HISTORY_STATUS_OPTIONS}
                    />
                    Status
                </div>
            ),
            cell: ({ row }) => {
                const status = historyStatusOf(row.getValue("tds_status"));
                const colorClass = HISTORY_STATUS_STYLES[status];

                const reason = row.original.tds_rejection_reason;
                const hasReason = !!reason && reason.trim() !== "";

                return (
                    <div className="flex flex-col items-center gap-1.5 min-w-[100px]">
                        <Badge variant="secondary" className={`border whitespace-nowrap ${colorClass}`}>
                            {HISTORY_STATUS_LABEL[status]}
                        </Badge>
                        {status === "Rejected" && (
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <div className="cursor-help">
                                            <MessageSquare
                                                className={`h-3.5 w-3.5 ${hasReason ? "text-red-500 hover:text-red-700" : "text-gray-300 opacity-40"} transition-colors`}
                                            />
                                        </div>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        <p>{hasReason ? reason : "No reason provided"}</p>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        )}
                    </div>
                );
            },
            size: 100,
            meta: {
                exportHeaderName: "Status",
                exportValue: (row: ProjectTDSItem) => historyStatusLabel(row.tds_status),
            },
        },
        {
            accessorKey: "tds_attachment",
            header: "Doc",
            cell: ({ row }) => {
                const attachment = row.getValue("tds_attachment") as string;
                return attachment ? (
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600 hover:bg-blue-50" onClick={() => window.open(attachment, '_blank')}>
                        <FileText className="h-4 w-4" />
                    </Button>
                ) : <span className="text-gray-300 ml-2">-</span>;
            },
            size: 80,
            enableSorting: false,
        },
        {
            accessorKey: "tds_boq_line_item",
            header: ({ column }) => <DataTableColumnHeader column={column} title="BOQ Ref" />,
            cell: ({ row }) => {
                const boqRef = row.getValue("tds_boq_line_item") as string;
                return boqRef ? (
                    <span className="text-sm text-gray-700 whitespace-normal break-words">
                        {boqRef}
                    </span>
                ) : <span className="text-gray-300 ml-2">-</span>;
            },
            size: 120,
            enableSorting: true,
            meta: {
                exportHeaderName: "BOQ Ref"
            }
        },
        // The client's answer. Every tab exports these; TDS History hides them (always blank there).
        {
            accessorKey: "client_status",
            header: "Client Status",
            cell: ({ row }) => {
                const value = row.original.client_status;
                return value ? (
                    <Badge variant="secondary" className={`border whitespace-nowrap ${CLIENT_STATUS_STYLES[value] ?? ""}`}>
                        {value}
                    </Badge>
                ) : <span className="text-gray-300 ml-2">-</span>;
            },
            size: 130,
            enableSorting: false,
            meta: { exportHeaderName: "Client Status" },
        },
        {
            accessorKey: "client_status_by",
            header: "Marked By",
            cell: ({ row }) => {
                const by = row.original.client_status_by;
                return <span className="text-sm">{by ? userMap.get(by) || by : "-"}</span>;
            },
            size: 130,
            enableSorting: false,
            meta: {
                exportHeaderName: "Marked By",
                exportValue: (row: ProjectTDSItem) =>
                    row.client_status_by ? userMap.get(row.client_status_by) || row.client_status_by : "",
            },
        },
        {
            accessorKey: "client_status_on",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Marked On" />,
            cell: ({ row }) => (
                <span className="text-sm whitespace-nowrap">{formatMarkedOn(row.original.client_status_on) || "-"}</span>
            ),
            size: 130,
            enableSorting: true,
            meta: {
                exportHeaderName: "Marked On",
                exportValue: (row: ProjectTDSItem) => formatMarkedOn(row.client_status_on),
            },
        },
        {
            accessorKey: "client_rejection_reason",
            header: "Client's Reason",
            cell: ({ row }) => (
                <span className="text-sm whitespace-normal break-words">{row.original.client_rejection_reason || "-"}</span>
            ),
            size: 180,
            enableSorting: false,
            meta: { exportHeaderName: "Client's Reason" },
        },
        ...(canManageTDS ? [
            {
                id: "actions",
                header: "Actions",
                // The column only exists when `canManageTDS`, which grants every row
                // except one the client has answered: that row is locked until an
                // Admin clears its Client Status.
                cell: ({ row }: { row: any }) => isDeleteLocked(row.original) ? (
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <span
                                    className="inline-flex items-center gap-1 text-xs text-muted-foreground cursor-help"
                                    data-testid="tds-row-locked"
                                >
                                    <Lock className="h-3.5 w-3.5" />
                                    Locked
                                </span>
                            </TooltipTrigger>
                            <TooltipContent>
                                <p>The client has answered this row, so it can't be deleted. An Admin must clear its Client Status first.</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                ) : (
                    <Button
                        aria-label="Delete"
                        data-testid="tds-row-delete"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-red-400 hover:text-red-600 hover:bg-red-50"
                        onClick={() => handleDeleteClick(row.original.name)}
                    >
                        <Trash2 className="h-4 w-4" />
                    </Button>
                ),
                size: 80,
                enableSorting: false,
            }
        ] : [])
    ], [userMap, role, canManageTDS]);

    const searchableFields: SearchFieldOption[] = [
        { label: "Item Name", value: "tds_item_name" },
        { label: "TDS ID", value: "tds_request_id" },
        { label: "Work Package", value: "tds_work_package" }
    ];

    // The project, and this tab's Client Status (TDS History = none yet).
    const staticFilters = useMemo(
        () => [["tdsi_project_id", "=", projectId], ...historyTabFilters(tab)],
        [projectId, tab]
    );
    const fieldsToFetch = [
        "name", "tdsi_project_id", "tdsi_project_name",
        "tds_work_package", "tds_request_id", "tds_category",
        "tds_item_id", "tds_item_name", "tds_make",
        "tds_boq_line_item", "tds_description", "tds_attachment",
        "tds_status", "tds_rejection_reason",
        "client_status", "client_status_by", "client_status_on", "client_rejection_reason",
        "creation", "owner"
    ];

    // --- Hook Initialization ---
    const {
        table,
        totalCount,
        isLoading,
        error,
        selectedSearchField,
        setSelectedSearchField,
        searchTerm,
        setSearchTerm,
        refetch: refetchTable,
        exportAllRows,
        isExporting,
    } = useServerDataTable<ProjectTDSItem>({
        doctype: DOCTYPE,
        columns: columns,
        fetchFields: fieldsToFetch,
        searchableFields: searchableFields,
        defaultSort: "creation desc",
        additionalFilters: staticFilters,
        urlSyncKey: `tds_${tab}_${projectId}_${refreshTrigger}`,
        // Ticks only on rows that can take a Client Status, keyed by row name so they survive paging.
        enableRowSelection: row => isClientStatusMarkable(row.original),
        getRowId: row => row.name,
        // Item ID is an internal `Items` key nobody reads off this screen -- Item
        // Name is the identifying column. Hidden rather than deleted: the column
        // def, its facet and its fetch field all stay, so it is one click away in
        // "Toggle columns" and still lands in the export when switched back on.
        initialState: {
            columnVisibility: {
                tds_item_id: false,
                ...(tab === "history" && {
                    client_status: false,
                    client_status_by: false,
                    client_status_on: false,
                }),
                ...(tab !== "rejectedByClient" && { client_rejection_reason: false }),
            },
        },
    });

    // --- Facet Filters (self-fetching: ADR-0010 "Option 2") ---
    // Every facet is scoped to the current project via `staticFilters`. Column ids match the
    // faceted field names, so the override keys are the TanStack column ids verbatim.
    const facetOverrides = useMemo<FacetOverrides>(() => ({
        tds_request_id: { additionalFilters: staticFilters },
        tds_work_package: { additionalFilters: staticFilters },
        tds_category: { additionalFilters: staticFilters },
        tds_item_id: { additionalFilters: staticFilters },
        tds_item_name: { additionalFilters: staticFilters },
        tds_make: { additionalFilters: staticFilters },
    }), [staticFilters]);


    // --- Client Status marking ---
    // The visible ticked rows: what "N selected" counts, the marks send and Export writes.
    const selectedRows = table.getSelectedRowModel().rows.map(r => r.original);

    const markClientStatus = async (rows: ProjectTDSItem[], action: ClientStatusAction, reason?: string) => {
        try {
            const result = await setClientStatus(projectId, rows.map(r => r.name), action, reason);
            const isClear = action === CLIENT_STATUS_ACTION.clear;
            if (result.updated) {
                const rowsText = `${result.updated} ${result.updated === 1 ? "row" : "rows"}`;
                toast({
                    title: isClear ? "Client Status cleared" : "Client Status saved",
                    description: isClear ? `${rowsText} cleared and back in TDS History.` : `${rowsText} marked.`,
                    variant: "success",
                });
            }
            if (result.errors.length) {
                toast({
                    title: `${result.errors.length} ${result.errors.length === 1 ? "row was" : "rows were"} not ${isClear ? "cleared" : "marked"}`,
                    description: result.errors[0].error,
                    variant: "destructive",
                });
            }
            setRowsToReject([]);
            table.resetRowSelection();
            refetchTable();
            onClientStatusChange?.();
        } catch (error) {
            toast({ title: "Error", description: getFrappeError(error), variant: "destructive" });
        }
    };

    const handleClientAction = (action: ClientStatusAction) => {
        if (action === CLIENT_STATUS_ACTION.markRejected) setRowsToReject(selectedRows);
        else markClientStatus(selectedRows, action);
    };

    const toolbarActions = selectedRows.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2" data-testid="tds-selection-toolbar">
            <span className="text-sm text-gray-600">{selectedRows.length} selected</span>
            <Button variant="link" size="sm" className="px-1 text-gray-600" onClick={() => table.resetRowSelection()}>
                Clear
            </Button>
            {clientActions.map(action => (
                <Button
                    key={action}
                    size="sm"
                    variant={action === CLIENT_STATUS_ACTION.clear ? "outline" : "default"}
                    disabled={isMarking}
                    className={CLIENT_ACTION_BUTTONS[action].className}
                    onClick={() => handleClientAction(action)}
                >
                    {clientActionLabel(action, tab)}
                </Button>
            ))}
        </div>
    ) : null;

    // --- Handlers ---
    const handleDeleteClick = (docName: string) => {
        setItemToDelete(docName);
        setIsDeleteDialogOpen(true);
    };

    const confirmDelete = async () => {
        if (!itemToDelete) return;
        try {
            await deleteDoc(itemToDelete, projectId);
            toast({
                title: "Deleted",
                description: "Item removed from history.",
            });
            refetchTable();
            if (onDataChange) onDataChange();
        } catch (error) {
            console.error("Delete failed", error);
            toast({
                title: "Error",
                // The server's reason, e.g. the Client Status lock on a row answered since this view loaded.
                description: getFrappeError(error) || "Failed to delete item.",
                variant: "destructive"
            });
        } finally {
            setIsDeleteDialogOpen(false);
            setItemToDelete(null);
        }
    };

    // --- Effect to Handle Refresh Trigger (e.g. from New Request) ---
    const prevRefreshTrigger = useRef(refreshTrigger);

    React.useEffect(() => {
        if (refreshTrigger > 0 && refreshTrigger !== prevRefreshTrigger.current) {
            prevRefreshTrigger.current = refreshTrigger;
            refetchTable();
            // Self-fetching facets refetch internally on filter/search change + first popover open;
            // there is no external facet-refetch handle in the Option-2 model.
        }
    }, [refreshTrigger, refetchTable]);

    return (
        <>
            <DataTable<ProjectTDSItem>
                table={table}
                columns={columns}
                isLoading={isLoading}
                error={error}
                totalCount={totalCount}
                searchFieldOptions={searchableFields}
                selectedSearchField={selectedSearchField}
                onSelectedSearchFieldChange={setSelectedSearchField}
                searchTerm={searchTerm}
                onSearchTermChange={setSearchTerm}
                facetDoctype={DOCTYPE}
                facetOverrides={facetOverrides}
                showRowSelection={true}
                toolbarActions={toolbarActions}
                showExportButton={true}
                onExport="default"
                onExportAll={exportAllRows}
                isExporting={isExporting}
            />

            <TdsClientRejectDialog
                rows={rowsToReject}
                isSubmitting={isMarking}
                onCancel={() => setRowsToReject([])}
                onConfirm={reason => markClientStatus(rowsToReject, CLIENT_STATUS_ACTION.markRejected, reason)}
            />

            <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This action cannot be undone. This will permanently delete the item from the project history.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
};
