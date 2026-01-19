import React, { useMemo, useRef } from 'react';
import { ColumnDef } from "@tanstack/react-table";
import { DataTable, SearchFieldOption } from '@/components/data-table/new-data-table';
import { useServerDataTable } from '@/hooks/useServerDataTable';
import { useFacetValues } from '@/hooks/useFacetValues';
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, Trash2, MessageSquare } from 'lucide-react';
import { 
    Tooltip, 
    TooltipContent, 
    TooltipProvider, 
    TooltipTrigger 
} from "@/components/ui/tooltip";
import { useFrappeDeleteDoc, useFrappeGetDocList } from "frappe-react-sdk";
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

interface TdsHistoryTableProps {
    projectId: string;
    refreshTrigger?: number;
    onDataChange?: () => void;
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
    creation: string;
    // owner: string; // Removed in favor of dynamic keys
    [key: string]: any; 
}

const DOCTYPE = "Project TDS Item List";

export const TdsHistoryTable: React.FC<TdsHistoryTableProps> = ({ projectId, refreshTrigger = 0, onDataChange }) => {
    const { deleteDoc } = useFrappeDeleteDoc();
    const [itemToDelete, setItemToDelete] = useState<string | null>(null);
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

    // --- 1. Fetch Nirmaan Users for Mapping ---
    // Moved to top so it can be used in columns
    const { data: nirmaanUsers } = useFrappeGetDocList("Nirmaan Users", {
        fields: ["name", "full_name"],
        limit: 0
    });

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
        },
        {
            accessorKey: "tds_work_package",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Work Package" />,
            cell: ({ row }) => <div title={row.getValue("tds_work_package")}>{row.getValue("tds_work_package")}</div>,
            size: 150,
            filterFn: (row, id, value) => value.includes(row.getValue(id)),
        },
        {
            accessorKey: "tds_category",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Category" />,
            cell: ({ row }) => <div title={row.getValue("tds_category")}>{row.getValue("tds_category")}</div>,
            size: 120,
            filterFn: (row, id, value) => value.includes(row.getValue(id)),
        },
        {
            accessorKey: "tds_item_id",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Item ID" />,
            cell: ({ row }) => <div className="font-medium whitespace-nowrap">{row.getValue("tds_item_id")}</div>,
            size: 100,
            enableSorting: true,
        },
        {
            accessorKey: "tds_item_name",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Item Name" />,
            cell: ({ row }) => <div className="font-medium" title={row.getValue("tds_item_name")}>{row.getValue("tds_item_name")}</div>,
            size: 150,
        },
        {
            accessorKey: "tds_description",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Description" />,
            cell: ({ row }) => <div className="truncate max-w-[150px]" title={row.getValue("tds_description")}>{row.getValue("tds_description")}</div>,
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
        },
        {
            accessorKey: "tds_status",
            header: "Status",
            cell: ({ row }) => {
                const status = row.getValue("tds_status") as string;
                let colorClass = "bg-gray-100 text-gray-800";
                if (status === "Pending") colorClass = "bg-yellow-100 text-yellow-800";
                else if (status === "Approved") colorClass = "bg-green-100 text-green-800";
                else if (status === "Rejected") colorClass = "bg-red-100 text-red-800";

                const reason = row.original.tds_rejection_reason;
                const hasReason = !!reason && reason.trim() !== "";

                return (
                    <div className="flex flex-col items-center gap-1.5 min-w-[100px]">
                        <Badge variant="secondary" className={`border ${colorClass}`}>
                            {status || 'Pending'}
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
            filterFn: (row, id, value) => value.includes(row.getValue(id)),
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
            id: "actions",
            header: "Actions",
            cell: ({ row }) => (
                <Button
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
    ], [userMap]);

    const searchableFields: SearchFieldOption[] = [
        { label: "Item Name", value: "tds_item_name" },
        { label: "TDS ID", value: "tds_request_id" },
        { label: "Work Package", value: "tds_work_package" }
    ];

    const staticFilters = useMemo(() => [["tdsi_project_id", "=", projectId]], [projectId]);
    const fieldsToFetch = ["*"]; // Fetch all fields including owner

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
        columnFilters,
        refetch: refetchTable
    } = useServerDataTable<ProjectTDSItem>({
        doctype: DOCTYPE,
        columns: columns,
        fetchFields: fieldsToFetch,
        searchableFields: searchableFields,
        defaultSort: "creation desc",
        additionalFilters: staticFilters,
        urlSyncKey: `tds_history_${projectId}_${refreshTrigger}` 
    });

    // --- Facet Filters ---
    const { facetOptions: wpOptions, isLoading: wpLoading, refetch: refetchWp } = useFacetValues({
        doctype: DOCTYPE,
        field: "tds_work_package",
        currentFilters: columnFilters,
        searchTerm,
        selectedSearchField,
        additionalFilters: staticFilters,
        enabled: true
    });

    const { facetOptions: catOptions, isLoading: catLoading, refetch: refetchCat } = useFacetValues({
        doctype: DOCTYPE,
        field: "tds_category",
        currentFilters: columnFilters,
        searchTerm,
        selectedSearchField,
        additionalFilters: staticFilters,
        enabled: true
    });
    
    const { facetOptions: statusOptions, isLoading: statusLoading, refetch: refetchStatus } = useFacetValues({
        doctype: DOCTYPE,
        field: "tds_status",
        currentFilters: columnFilters,
        searchTerm,
        selectedSearchField,
        additionalFilters: staticFilters,
        enabled: true
    });

    const { facetOptions: makeOptions, isLoading: makeLoading, refetch: refetchMake } = useFacetValues({
        doctype: DOCTYPE,
        field: "tds_make",
        currentFilters: columnFilters,
        searchTerm,
        selectedSearchField,
        additionalFilters: staticFilters,
        enabled: true
    });

    const { facetOptions: reqIdOptions, isLoading: reqIdLoading, refetch: refetchReqId } = useFacetValues({
        doctype: DOCTYPE,
        field: "tds_request_id",
        currentFilters: columnFilters,
        searchTerm,
        selectedSearchField,
        additionalFilters: staticFilters,
        enabled: true
    });

    const { facetOptions: itemIdOptions, isLoading: itemIdLoading, refetch: refetchItemId } = useFacetValues({
        doctype: DOCTYPE,
        field: "tds_item_id",
        currentFilters: columnFilters,
        searchTerm,
        selectedSearchField,
        additionalFilters: staticFilters,
        enabled: true
    });

    const { facetOptions: itemNameOptions, isLoading: itemNameLoading, refetch: refetchItemName } = useFacetValues({
        doctype: DOCTYPE,
        field: "tds_item_name",
        currentFilters: columnFilters,
        searchTerm,
        selectedSearchField,
        additionalFilters: staticFilters,
        enabled: true
    });

    const { facetOptions: ownerOptions, isLoading: ownerLoading, refetch: refetchOwner } = useFacetValues({
        doctype: DOCTYPE,
        field: "owner",
        currentFilters: columnFilters,
        searchTerm,
        selectedSearchField,
        additionalFilters: staticFilters,
        enabled: true
    });

    // Map owner facet options
    const mappedOwnerOptions = useMemo(() => {
        if (!ownerOptions) return [];
        return ownerOptions.map(opt => {
            const fullName = userMap.get(opt.value);
            return fullName ? { ...opt, label: opt.label.replace(opt.value, fullName) } : opt;
        });
    }, [ownerOptions, userMap]);


    const facetFilterOptions = useMemo(() => ({
        tds_work_package: { title: "Work Package", options: wpOptions, isLoading: wpLoading },
        tds_category: { title: "Category", options: catOptions, isLoading: catLoading },
        tds_item_id: { title: "Item ID", options: itemIdOptions, isLoading: itemIdLoading },
        tds_item_name: { title: "Item Name", options: itemNameOptions, isLoading: itemNameLoading },
        tds_make: { title: "Make", options: makeOptions, isLoading: makeLoading },
        tds_request_id: { title: "TDS ID", options: reqIdOptions, isLoading: reqIdLoading },
        owner: { title: "Created By", options: mappedOwnerOptions, isLoading: ownerLoading },
        tds_status: { title: "Status", options: statusOptions, isLoading: statusLoading }
    }), [wpOptions, wpLoading, catOptions, catLoading, statusOptions, statusLoading, makeOptions, makeLoading, mappedOwnerOptions, ownerLoading, reqIdOptions, reqIdLoading, itemIdOptions, itemIdLoading, itemNameOptions, itemNameLoading]);


    // --- Handlers ---
    const handleDeleteClick = (docName: string) => {
        setItemToDelete(docName);
        setIsDeleteDialogOpen(true);
    };

    const confirmDelete = async () => {
        if (!itemToDelete) return;
        try {
            await deleteDoc(DOCTYPE, itemToDelete);
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
                description: "Failed to delete item.",
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
            refetchWp();
            refetchCat();
            refetchStatus();
            refetchMake();
            refetchItemId();
            refetchItemName();
            refetchReqId();
            refetchOwner();
        }
    }, [refreshTrigger, refetchTable, refetchWp, refetchCat, refetchStatus, refetchMake, refetchOwner, refetchReqId, refetchItemId, refetchItemName]);

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
            facetFilterOptions={facetFilterOptions}
            showExportButton={true} 
            onExport="default"
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
