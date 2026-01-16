import React, { useMemo, useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { 
    useReactTable, 
    getCoreRowModel, 
    getSortedRowModel,
    getPaginationRowModel,
    getFilteredRowModel,
    ColumnDef,
    SortingState,
    ColumnFiltersState,
} from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/new-data-table"; 
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"; 
import { useFrappePostCall } from "frappe-react-sdk";
import { format } from "date-fns";
import Cookies from "js-cookie";
import { toast } from "@/components/ui/use-toast";
import { useTDSStore } from "@/zustand/useTDSStore";

// Design tokens from screenshots
const COLORS = {
    primaryRed: "#D32F2F",
    pendingBg: "#FFF4CC",
    pendingText: "#9A6700",
    approvedBg: "#E6F4EA",
    approvedText: "#1E7F43",
    rejectedBg: "#FDECEA",
    rejectedText: "#B42318",
    pillBorder: "#E5E7EB",
    tableHeaderBg: "#F5F6FA",
    paBg: "#E0F2FE",
    paText: "#0369A1",
    prBg: "#FFEDD5",
    prText: "#C2410C",
    arBg: "#F3E8FF",
    arText: "#7E22CE",
    parBg: "#F1F5F9",
    parText: "#334155",
};

interface TDSRequest {
    request_id: string;
    project: string;
    creation: string;
    total_items: number;
    pending_count: number;
    rejected_count: number;
    approved_count: number;
    created_by: string;
    status: string;
}

interface TabCounts {
    pending: number;
    approved: number;
    rejected: number;
    all: number;
}

type TabType = "Pending Approval" | "Approved" | "Rejected" | "All TDS";

const TAB_CONFIG: { key: TabType; label: string; countKey: keyof TabCounts }[] = [
    { key: "Pending Approval", label: "Pending Approval", countKey: "pending" },
    { key: "Approved", label: "Approved", countKey: "approved" },
    { key: "Rejected", label: "Rejected", countKey: "rejected" },
    { key: "All TDS", label: "All TDS", countKey: "all" },
];

// Format date as "27th Nov, 2025"
const formatDateOrdinal = (dateStr: string) => {
    if (!dateStr) return "--";
    const date = new Date(dateStr);
    const day = date.getDate();
    const suffix = day === 1 || day === 21 || day === 31 ? "st" 
                 : day === 2 || day === 22 ? "nd"
                 : day === 3 || day === 23 ? "rd" 
                 : "th";
    return `${day}${suffix} ${format(date, "MMM, yyyy")}`;
};

export const TDSApprovalList: React.FC = () => {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const user_id = Cookies.get("user_id") ?? "";
    
    const { activeTab, setActiveTab, tabCounts, setTabCounts } = useTDSStore();

    const [searchTerm, setSearchTerm] = useState("");
    const [selectedSearchField, setSelectedSearchField] = useState("project");
    const [data, setData] = useState<TDSRequest[]>([]);
    const [totalCount, setTotalCount] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [sorting, setSorting] = useState<SortingState>([]);
    const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
    const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 50 });

    // Sync store with URL on mount or URL change
    useEffect(() => {
        const tabParam = searchParams.get("tab");
        if (tabParam && ["Pending Approval", "Approved", "Rejected", "All TDS"].includes(tabParam)) {
            if (tabParam !== activeTab) {
                setActiveTab(tabParam as TabType);
            }
        }
    }, [searchParams, activeTab, setActiveTab]);

    // Update URL when tab changes
    const handleTabChange = (tab: TabType) => {
        if (tab === activeTab) return;
        setSearchParams({ tab }, { replace: true });
        setActiveTab(tab);
        setPagination(prev => ({ ...prev, pageIndex: 0 }));
    };

    const { call } = useFrappePostCall("nirmaan_stack.api.tds.get_tds_requests.get_tds_request_list");

    // Fetch data
    const fetchData = useCallback(async () => {
        setIsLoading(true);
        try {
            const response = await call({
                start: pagination.pageIndex * pagination.pageSize,
                page_length: pagination.pageSize,
                tab: activeTab,
                search_term: searchTerm || null,
                user_id: user_id,
            });
            
            if (response?.message) {
                setData(response.message.data || []);
                setTotalCount(response.message.total_count || 0);
                if (response.message.tab_counts) {
                    setTabCounts(response.message.tab_counts);
                }
            }
        } catch (error) {
            console.error("Failed to fetch TDS requests:", error);
            toast({ title: "Error", description: "Failed to load data", variant: "destructive" });
        } finally {
            setIsLoading(false);
        }
    }, [call, activeTab, searchTerm, pagination, user_id, setTabCounts]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // Status Badge Component
    const StatusBadge = ({ status }: { status: string }) => {
        let bgColor = COLORS.pendingBg;
        let textColor = COLORS.pendingText;
        
        if (status === "Approved") {
            bgColor = COLORS.approvedBg;
            textColor = COLORS.approvedText;
        } else if (status === "Rejected") {
            bgColor = COLORS.rejectedBg;
            textColor = COLORS.rejectedText;
        } else if (status === "PA") {
            bgColor = COLORS.paBg;
            textColor = COLORS.paText;
        } else if (status === "PR") {
            bgColor = COLORS.prBg;
            textColor = COLORS.prText;
        } else if (status === "AR") {
            bgColor = COLORS.arBg;
            textColor = COLORS.arText;
        } else if (status === "PAR") {
            bgColor = COLORS.parBg;
            textColor = COLORS.parText;
        }
        
        return (
            <span 
                className="px-2.5 py-1 rounded-full text-xs font-medium"
                style={{ backgroundColor: bgColor, color: textColor }}
            >
                {status}
            </span>
        );
    };

    // Items Pill Component
    const ItemsPill = ({ count }: { count: number }) => (
        <span 
            className="px-3 py-1 rounded-full text-sm font-medium bg-white border"
            style={{ borderColor: COLORS.pillBorder }}
        >
            {count} Items
        </span>
    );

    // Define columns - Status column only in "All TDS" tab
    const columns = useMemo<ColumnDef<TDSRequest>[]>(() => {
        const baseColumns: ColumnDef<TDSRequest>[] = [
            {
                accessorKey: "request_id",
                header: ({ column }) => <DataTableColumnHeader column={column} title="#TDS" />,
                cell: ({ row }) => (
                    <div 
                        className="font-medium cursor-pointer hover:underline"
                        style={{ color: COLORS.primaryRed }}
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
                size: 120,
                filterFn: (row, id, filterValue) => {
                    if (!filterValue || filterValue.length === 0) return true;
                    return filterValue.includes(row.getValue(id));
                },
            },
            {
                accessorKey: "project",
                header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />,
                size: 200,
                filterFn: (row, id, filterValue) => {
                    if (!filterValue || filterValue.length === 0) return true;
                    return filterValue.includes(row.getValue(id));
                },
            },
            {
                accessorKey: "creation",
                header: ({ column }) => <DataTableColumnHeader column={column} title="Created On" />,
                cell: ({ row }) => formatDateOrdinal(row.getValue("creation")),
                size: 180,
                filterFn: (row, id, filterValue) => {
                    if (!filterValue) return true;
                    const rowDate = new Date(row.getValue(id) as string);
                    const { operator, value } = filterValue as { operator: string; value: string | string[] };
                    
                    if (!value) return true;
                    
                    if (operator === "Is" && typeof value === "string") {
                        const filterDate = new Date(value + "T00:00:00");
                        return rowDate.toDateString() === filterDate.toDateString();
                    }
                    if (operator === "Between" && Array.isArray(value)) {
                        const from = new Date(value[0] + "T00:00:00");
                        const to = new Date(value[1] + "T23:59:59");
                        return rowDate >= from && rowDate <= to;
                    }
                    if (operator === "<=" && typeof value === "string") {
                        const filterDate = new Date(value + "T23:59:59");
                        return rowDate <= filterDate;
                    }
                    if (operator === ">=" && typeof value === "string") {
                        const filterDate = new Date(value + "T00:00:00");
                        return rowDate >= filterDate;
                    }
                    return true;
                },
            },
            {
                accessorKey: "total_items",
                header: ({ column }) => <DataTableColumnHeader column={column} title="Items" />,
                cell: ({ row }) => {
                    let count = row.original.total_items;
                    if (activeTab === "Pending Approval") count = row.original.pending_count;
                    else if (activeTab === "Rejected") count = row.original.rejected_count;
                    else if (activeTab === "Approved") count = row.original.approved_count;
                    return <ItemsPill count={count} />;
                },
                size: 120,
            },
            {
                accessorKey: "created_by",
                header: ({ column }) => <DataTableColumnHeader column={column} title="Created By" />,
                size: 200,
                filterFn: (row, id, filterValue) => {
                    if (!filterValue || filterValue.length === 0) return true;
                    return filterValue.includes(row.getValue(id));
                },
            },
        ];

        // Add Status column only for "All TDS" tab
        if (activeTab === "All TDS") {
            baseColumns.push({
                accessorKey: "status",
                header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
                cell: ({ row }) => <StatusBadge status={row.getValue("status")} />,
                size: 120,
            });
        }

        return baseColumns;
    }, [navigate, activeTab]);

    // Create table instance
    const table = useReactTable({
        data,
        columns,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        onSortingChange: setSorting,
        onColumnFiltersChange: setColumnFilters,
        onPaginationChange: setPagination,
        manualPagination: true,
        pageCount: Math.ceil(totalCount / pagination.pageSize),
        state: {
            sorting,
            columnFilters,
            pagination,
        },
    });

    // Generate facet filter options from loaded data
    const facetFilterOptions = useMemo(() => {
        // Extract unique TDS IDs
        const uniqueTdsIds = [...new Set(data.map(d => d.request_id).filter(Boolean))];
        const tdsOptions = uniqueTdsIds.map(id => ({ label: id, value: id }));

        // Extract unique projects
        const uniqueProjects = [...new Set(data.map(d => d.project).filter(Boolean))];
        const projectOptions = uniqueProjects.map(p => ({ label: p, value: p }));

        // Extract unique created_by values
        const uniqueCreatedBy = [...new Set(data.map(d => d.created_by).filter(Boolean))];
        const createdByOptions = uniqueCreatedBy.map(c => ({ label: c, value: c }));

        return {
            request_id: { title: "#TDS", options: tdsOptions, isLoading: isLoading },
            project: { title: "Project", options: projectOptions, isLoading: isLoading },
            created_by: { title: "Created By", options: createdByOptions, isLoading: isLoading },
        };
    }, [data, isLoading]);

    return (
        <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
            {/* Title */}
            <h1 
                className="text-2xl font-bold tracking-tight"
                style={{ color: COLORS.primaryRed }}
            >
                TDS Approval
            </h1>
            
            {/* Refined Grouped Calm Segmented Tab Control */}
            <div className="flex items-center gap-4">
                {/* Standalone Pending Approval Tab */}
                {TAB_CONFIG.filter(t => t.key === "Pending Approval").map((tab) => (
                    <button
                        key={tab.key}
                        onClick={() => handleTabChange(tab.key)}
                        className={`
                            px-4 py-2 rounded-md text-sm font-medium transition-all
                            ${activeTab === tab.key 
                                ? "text-white shadow-sm" 
                                : "text-muted-foreground bg-white border border-gray-200 hover:text-gray-900 hover:bg-gray-50"
                            }
                        `}
                        style={activeTab === tab.key ? { backgroundColor: COLORS.primaryRed } : {}}
                    >
                        {tab.label} {tabCounts[tab.countKey]}
                    </button>
                ))}

                {/* Grouped Tabs: Approved, Rejected, All TDS */}
                <div className="flex items-center rounded-lg border border-gray-200 bg-white">
                    {TAB_CONFIG.filter(t => t.key !== "Pending Approval").map((tab) => (
                        <button
                            key={tab.key}
                            onClick={() => handleTabChange(tab.key)}
                            className={`
                                px-4 py-2 rounded-md text-sm font-medium transition-all
                                ${activeTab === tab.key 
                                    ? "text-white shadow-sm" 
                                    : "text-muted-foreground hover:text-gray-900 hover:bg-gray-50"
                                }
                            `}
                            style={activeTab === tab.key ? { backgroundColor: COLORS.primaryRed } : {}}
                        >
                            {tab.label} {tabCounts[tab.countKey]}
                        </button>
                    ))}
                </div>
            </div>

            {/* Data Table with built-in search and export */}
            <DataTable
                table={table}
                columns={columns}
                isLoading={isLoading}
                totalCount={totalCount}
                searchFieldOptions={[
                    { label: "Project", value: "project", placeholder: "Search by Project", default: true },
                    { label: "TDS ID", value: "request_id", placeholder: "Search by TDS ID" },
                ]}
                selectedSearchField={selectedSearchField}
                onSelectedSearchFieldChange={setSelectedSearchField}
                searchTerm={searchTerm}
                onSearchTermChange={setSearchTerm}
                showSearchBar={true}
                showExportButton={true}
                onExport="default"
                exportFileName="tds_approval_list"
                facetFilterOptions={facetFilterOptions}
                dateFilterColumns={["creation"]}
            />
        </div>
    );
};

export default TDSApprovalList;
