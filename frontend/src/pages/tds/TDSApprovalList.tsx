import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DataTable } from "@/components/data-table/new-data-table"; 
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"; 
import { useServerDataTable } from "@/hooks/useServerDataTable"; 
import { ColumnDef, useReactTable, getCoreRowModel, getPaginationRowModel } from "@tanstack/react-table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { format } from "date-fns";
import Cookies from "js-cookie";

interface TDSRequest {
    request_id: string;
    project: string;
    creation: string;
    total_items: number;
    pending_count: number;
    rejected_count: number;
    created_by: string;
    status: string;
}

export const TDSApprovalList: React.FC = () => {
    const navigate = useNavigate();
    const user_id = Cookies.get("user_id") ?? "";
    const [activeTab, setActiveTab] = useState("Pending Approval");
    
    // Define columns
    const columns = useMemo<ColumnDef<TDSRequest>[]>(() => [
        {
            accessorKey: "request_id",
            header: ({ column }) => <DataTableColumnHeader column={column} title="TDS ID" />,
            cell: ({ row }) => (
                <div 
                    className="font-medium text-blue-600 hover:underline cursor-pointer"
                    onClick={() => {
                        let statusParam = "All";
                        if (activeTab === "Pending Approval") statusParam = "Pending";
                        else if (activeTab === "Approved") statusParam = "Approved";
                        else if (activeTab === "Rejected") statusParam = "Rejected";

                        navigate(`/tds-approval/${row.original.request_id}?status=${statusParam}`);
                    }}
                >
                    {row.getValue("request_id")}
                </div>
            ),
            enableColumnFilter: true, // Server-side search handles this
        },
        {
            accessorKey: "project",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />,
        },
        {
            accessorKey: "creation",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Created On" />,
            cell: ({ row }) => {
                const date = row.getValue("creation");
                return date ? format(new Date(date as string), "dd-MM-yyyy") : "--";
            },
            enableSorting: true,
        },
        {
            accessorKey: "total_items",
            header: ({ column }) => <DataTableColumnHeader column={column} title={
                activeTab === "Pending Approval" ? "Pending Items" :
                activeTab === "Rejected" ? "Rejected Items" :
                "Total Items"
            } />,
            cell: ({ row }) => {
                let count = row.original.total_items;
                if (activeTab === "Pending Approval") {
                    count = row.original.pending_count;
                } else if (activeTab === "Rejected") {
                    count = row.original.rejected_count;
                }
                return <div className="text-center font-medium">{count}</div>
            },
        },
        {
            accessorKey: "created_by",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Created By" />,
        },
        /*
        {
            accessorKey: "status",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
            cell: ({ row }) => {
                const status = row.getValue("status") as string;
                let variant = "outline";
                let className = "";
                
                if (status === "Approved") {
                    className = "bg-green-100 text-green-800 border-green-200";
                } else if (status === "Rejected") {
                    className = "bg-red-100 text-red-800 border-red-200";
                } else {
                    className = "bg-yellow-100 text-yellow-800 border-yellow-200";
                }
                
                return (
                    <Badge variant="outline" className={className}>
                        {status}
                    </Badge>
                );
            },
        },
        */
    ], [navigate, activeTab]);

    // Construct custom fetch parameters
    // We pass 'tab' as a custom param to the API
    const customParams = useMemo(() => ({
        tab: activeTab,
        user_id: user_id 
    }), [activeTab, user_id]);

    const serverDataTable = useServerDataTable<TDSRequest>({
        doctype: "Project TDS Item List", // Ignored by custom API but required by type? No, usually allows optional.
        // Actually, looking at TaskWiseTable, it passes 'doctype' AND 'apiEndpoint'.
        // The hook likely prefers apiEndpoint if present.
        apiEndpoint: "nirmaan_stack.api.tds.get_tds_requests.get_tds_request_list",
        customParams: customParams,
        columns: columns,
        fetchFields: ["request_id", "project", "creation", "total_items", "created_by", "pending_count", "rejected_count"], // Not strictly used by custom API but good for cache keys
        defaultSort: "creation desc",
        searchableFields: [
            { label: "Request ID / Project", value: "request_id", default: true }
        ],
        // Force refetch when tab changes (customParams change triggers this in hook usually)
    });

    // Trigger refetch when activeTab changes (since hook doesn't watch customParams automatically)
    React.useEffect(() => {
        serverDataTable.refetch();
    }, [activeTab]);

    // React Table instance
    const table = useReactTable({
        data: serverDataTable.data || [],
        columns: columns,
        getCoreRowModel: getCoreRowModel(),
        manualPagination: true,
        pageCount: serverDataTable.table.getPageCount(),
        state: {
            pagination: serverDataTable.pagination,
            sorting: serverDataTable.sorting,
            columnFilters: serverDataTable.columnFilters,
            globalFilter: serverDataTable.searchTerm,
        },
        onPaginationChange: serverDataTable.setPagination,
        onSortingChange: serverDataTable.setSorting,
        onColumnFiltersChange: serverDataTable.setColumnFilters,
        onGlobalFilterChange: serverDataTable.setSearchTerm,
    });
    
    return (
        <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
            <div className="flex items-center justify-between space-y-2">
                <h2 className="text-3xl font-bold tracking-tight">TDS Approval</h2>
            </div>
            
            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
                <TabsList>
                    <TabsTrigger value="Pending Approval">Pending Approval</TabsTrigger>
                    <TabsTrigger value="Approved">Approved</TabsTrigger>
                    <TabsTrigger value="Rejected">Rejected</TabsTrigger>
                    <TabsTrigger value="All TDS">All TDS</TabsTrigger>
                </TabsList>
                
                <TabsContent value={activeTab} className="space-y-4">
                     <div className="rounded-md border bg-white shadow">
                        <DataTable
                            table={table}
                            columns={columns}
                            isLoading={serverDataTable.isLoading}
                            error={serverDataTable.error}
                            totalCount={serverDataTable.totalCount}
                            searchFieldOptions={[{ label: "Search", value: "default" }]}
                            searchTerm={serverDataTable.searchTerm}
                            onSearchTermChange={serverDataTable.setSearchTerm}
                            // Facets could be added later if needed
                        />
                    </div>
                </TabsContent>
            </Tabs>
        </div>
    );
};

export default TDSApprovalList;
