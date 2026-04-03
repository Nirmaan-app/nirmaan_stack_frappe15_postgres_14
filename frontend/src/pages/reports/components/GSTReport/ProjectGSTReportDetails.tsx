import React, { useMemo, useState } from "react";
import {
    useReactTable,
    getCoreRowModel,
    getSortedRowModel,
    getPaginationRowModel,
    getFilteredRowModel,
    SortingState,
    ColumnFiltersState,
    VisibilityState,
    ColumnDef,
} from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/new-data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { useProjectGSTDetailsData, GSTInvoiceDetail } from "../../hooks/useProjectGSTDetailsData";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ExternalLink, FileText, Receipt, Wallet, Calculator, Percent } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { subMonths, format } from "date-fns";

interface ProjectGSTReportDetailsProps {
    projectId: string;
    projectName: string;
    initialGST?: string;
    initialInvoiceType?: string[];
    initialMonth?: string; // yyyy-MM
    onBack: () => void;
}

export const ProjectGSTReportDetails: React.FC<ProjectGSTReportDetailsProps> = ({ projectId, projectName, initialGST, initialInvoiceType, initialMonth, onBack }) => {
    const { combinedData, isLoading } = useProjectGSTDetailsData();

    // Calculate last 6 months as default if none provided
    const defaultMonths = useMemo(() => {
        return Array.from({ length: 6 }, (_, i) => format(subMonths(new Date(), i), "yyyy-MM"));
    }, []);

    const [sorting, setSorting] = useState<SortingState>([{ id: "invoice_date", desc: true }]);
    const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(() => {
        const filters: ColumnFiltersState = [{ id: "project", value: [projectId] }];
        if (initialGST && initialGST !== "all") {
            filters.push({ id: "project_gst", value: [initialGST] });
        }
        if (initialInvoiceType && initialInvoiceType.length > 0) {
            filters.push({ id: "invoice_type", value: initialInvoiceType });
        }

        // If a specific month was provided, use it. Otherwise, use the last 6 months.
        if (initialMonth) {
            filters.push({ id: "invoice_date", value: initialMonth });
        } else {
            filters.push({ id: "invoice_date", value: defaultMonths });
        }
        return filters;
    });
    const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
    const [pagination, setPagination] = useState({
        pageIndex: 0,
        pageSize: 50,
    });
    const [searchTerm, setSearchTerm] = useState("");
    const [selectedSearchField, setSelectedSearchField] = useState("vendor");

    const columns = useMemo<ColumnDef<GSTInvoiceDetail>[]>(() => [
        {
            accessorKey: "project",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Project Name" />,
            cell: ({ row }) => <div className="font-medium truncate max-w-[180px]" title={row.original.project_name}>{row.original.project_name}</div>,
            size: 180,
            meta: {
                exportHeaderName: "Project Name",
                exportValue: (row: any) => row.project_name
            },
            filterFn: (row, id, value) => {
                if (!value) return true;
                if (Array.isArray(value)) {
                    return value.length === 0 || value.includes(row.getValue(id));
                }
                return String(row.getValue(id)).toLowerCase().includes(String(value).toLowerCase());
            },
        },
        {
            accessorKey: "project_gst",
            header: ({ column }) => <DataTableColumnHeader column={column} title="GST Type" />,
            cell: ({ row }) => <Badge variant="outline" className="bg-slate-50 truncate max-w-[150px]" title={row.original.project_gst_display}>{row.original.project_gst_display}</Badge>,
            size: 150,
            meta: {
                exportHeaderName: "GST Type",
                exportValue: (row: any) => row.project_gst_display
            },
            filterFn: (row, id, value) => {
                if (!value) return true;
                if (Array.isArray(value)) {
                    return value.length === 0 || value.includes(row.getValue(id));
                }
                return String(row.getValue(id)).toLowerCase().includes(String(value).toLowerCase());
            },
        },
        {
            accessorKey: "invoice_date",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Invoice Date" />,
            cell: ({ row }) => <div className="tabular-nums whitespace-nowrap">{row.getValue("invoice_date")}</div>,
            size: 150,
            meta: { exportHeaderName: "Invoice Date" },
            filterFn: (row, id, value) => {
                if (!value) return true;
                if (Array.isArray(value)) {
                    return value.some(v => String(row.getValue(id)).startsWith(v));
                }
                return String(row.getValue(id)).startsWith(String(value));
            },
        },
        {
            accessorKey: "invoice_type",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Invoice Type" />,
            cell: ({ row }) => {
                const type = row.getValue("invoice_type") as string;
                let color = "text-slate-600 bg-slate-100";
                if (type === "PO Invoice") color = "text-blue-600 bg-blue-50 border-blue-100";
                if (type === "SR Invoice") color = "text-purple-600 bg-purple-50 border-purple-100";
                if (type === "Project Invoice") color = "text-emerald-600 bg-emerald-50 border-emerald-100";
                return <Badge className={`${color} border shadow-sm px-2 py-0.5 whitespace-nowrap`}>{type}</Badge>;
            },
            size: 150,
            meta: { exportHeaderName: "Invoice Type" },
            filterFn: (row, id, value) => {
                if (!value) return true;
                if (Array.isArray(value)) {
                    return value.length === 0 || value.includes(row.getValue(id));
                }
                return String(row.getValue(id)).toLowerCase().includes(String(value).toLowerCase());
            },
        },
        {
            accessorKey: "document_name",
            header: ({ column }) => <DataTableColumnHeader column={column} title="PO / SR ID" />,
            cell: ({ row }) => {
                const docName = row.original.document_name;
                const docType = row.original.document_type;
                if (!docName) return <span className="text-slate-400">-</span>;

                let linkPath = "";
                if (docType === "Procurement Orders") linkPath = `/all-AQs/${docName?.replaceAll("/", "&=")}`;
                else if (docType === "Service Requests") linkPath = `/service-requests-list/${docName}`;

                if (!linkPath) return <div className="font-mono text-xs font-medium text-slate-500">{docName}</div>;

                return (
                    <Link
                        to={linkPath}
                        className="group inline-flex items-center gap-1 font-mono text-xs font-bold text-slate-700 hover:text-indigo-600 transition-all duration-200"
                    >
                        <span className="group-hover:underline decoration-indigo-300 underline-offset-2">{docName}</span>
                        <ExternalLink className="w-2.5 h-2.5 opacity-0 -translate-x-1 transition-all duration-300 group-hover:opacity-100 group-hover:translate-x-0 group-hover:text-indigo-400" />
                    </Link>
                );
            },
            size: 150,
            meta: { exportHeaderName: "PO / SR ID" },
            filterFn: (row, id, value) => {
                if (!value) return true;
                return String(row.getValue(id)).toLowerCase().includes(String(value).toLowerCase());
            },
        },
        {
            accessorKey: "vendor",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Vendor" />,
            cell: ({ row }) => <div className="font-medium truncate max-w-[180px]" title={row.original.vendor_name}>{row.original.vendor_name}</div>,
            size: 200,
            meta: {
                exportHeaderName: "Vendor",
                exportValue: (row: any) => row.vendor_name
            },
            filterFn: (row, id, value) => {
                if (!value) return true;
                if (Array.isArray(value)) {
                    return value.length === 0 || value.includes(row.getValue(id));
                }
                return String(row.getValue(id)).toLowerCase().includes(String(value).toLowerCase());
            },
        },
        {
            accessorKey: "base_amount",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Amount" className="justify-end" />,
            cell: ({ row }) => <div className="text-center tabular-nums  font-medium whitespace-nowrap">{formatToRoundedIndianRupee(row.getValue("base_amount"))}</div>,
            size: 130,
            meta: { exportHeaderName: "Amount" }
        },
        {
            accessorKey: "gst_percentage",
            header: ({ column }) => <DataTableColumnHeader column={column} title="GST %" />,
            cell: ({ row }) => <Badge variant="secondary" className="bg-amber-50 text-amber-700 border-amber-100">{Math.round(row.original.gst_percentage)}%</Badge>,
            size: 80,
            meta: { exportHeaderName: "GST %" }
        },
        {
            accessorKey: "gst_amount",
            header: ({ column }) => <DataTableColumnHeader column={column} title="GST Amount" className="justify-end" />,
            cell: ({ row }) => <div className="text-center tabular-nums text-blue-600 font-medium whitespace-nowrap">{formatToRoundedIndianRupee(row.getValue("gst_amount"))}</div>,
            size: 130,
            meta: { exportHeaderName: "GST Amount" }
        },
        {
            accessorKey: "total_amount",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Total Amount" className="justify-end" />,
            cell: ({ row }) => <div className="text-center tabular-nums font-bold text-slate-900 whitespace-nowrap">{formatToRoundedIndianRupee(row.getValue("total_amount"))}</div>,
            size: 140,
            meta: { exportHeaderName: "Total Amount" }
        },
        {
            accessorKey: "attachment",
            header: "Attachment",
            size: 100,
            cell: ({ row }) => {
                const url = row.original.attachment;
                if (!url) return <span className="text-slate-400">No file</span>;

                return (
                    <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-red-600 hover:text-red-700 transition-colors bg-red-50 px-2 py-1 rounded border border-red-100 w-fit"
                    >
                        <FileText className="w-3.5 h-3.5" />
                        <span className="text-[10px] font-medium uppercase tracking-wider">View</span>
                        <ExternalLink className="w-3 h-3" />
                    </a>
                );
            },

        }
    ], []);

    // Sync search term with table filters
    React.useEffect(() => {
        if (searchTerm) {
            setColumnFilters(prev => {
                const filtered = prev.filter(f => f.id !== selectedSearchField);
                return [...filtered, { id: selectedSearchField, value: searchTerm }];
            });
        } else {
            setColumnFilters(prev => prev.filter(f => f.id !== selectedSearchField || Array.isArray(f.value)));
        }
    }, [searchTerm, selectedSearchField]);

    const table = useReactTable({
        data: combinedData,
        columns,
        state: {
            sorting,
            columnFilters,
            columnVisibility,
            pagination,
        },
        onSortingChange: setSorting,
        onColumnFiltersChange: setColumnFilters,
        onColumnVisibilityChange: setColumnVisibility,
        onPaginationChange: setPagination,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
    });

    const projectFilter = columnFilters.find(f => f.id === "project")?.value as string[] | undefined;
    const isFilteredToSingleProject = projectFilter && projectFilter.length === 1;

    // Format Month for Title
    const monthFilter = columnFilters.find(f => f.id === "invoice_date")?.value as string | string[] | undefined;
    let monthDisplay = "";
    if (typeof monthFilter === "string" && monthFilter.length === 7) { // Single Month
        const [year, month] = monthFilter.split("-");
        const date = new Date(parseInt(year), parseInt(month) - 1);
        monthDisplay = ` - ${date.toLocaleString('default', { month: 'short' })} ${year}`;
    } else if (Array.isArray(monthFilter) && monthFilter.length > 1) { // Multiple/Default
        monthDisplay = ` - Last ${monthFilter.length} Months`;
    }

    const currentProjectTitle = (isFilteredToSingleProject ? (projectFilter[0] === projectId ? projectName : projectFilter[0]) : "All Projects") + monthDisplay;

    // Calculate Summary Totals for Filtered Rows
    const filteredRows = table.getFilteredRowModel().rows;
    const totals = useMemo(() => {
        const t = filteredRows.reduce((acc, row) => {
            const data = row.original;
            return {
                base: acc.base + (data.base_amount || 0),
                gst: acc.gst + (data.gst_amount || 0),
                total: acc.total + (data.total_amount || 0)
            };
        }, { base: 0, gst: 0, total: 0 });

        // Round the totals at the end to match Summary View logic
        const roundedBase = Math.round(t.base);
        const roundedGst = Math.round(t.gst);
        const roundedTotal = Math.round(t.total);

        return {
            base: roundedBase,
            gst: roundedGst,
            total: roundedTotal,
            avgTax: roundedBase > 0 ? ((roundedGst / roundedBase) * 100).toFixed(2) : "0"
        };
    }, [filteredRows]);

    const summaryCard = (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
            {[
                {
                    label: "Total GST",
                    value: formatToRoundedIndianRupee(totals.gst),
                    icon: <Receipt className="w-4 h-4" />,
                    bg: "bg-indigo-50/50",
                    border: "border-indigo-100",
                    text: "text-indigo-700",
                    iconBg: "bg-indigo-100 text-indigo-600",
                },
                {
                    label: "Overall Tax %",
                    value: `${totals.avgTax}%`,
                    icon: <Percent className="w-4 h-4" />,
                    bg: "bg-amber-50/50",
                    border: "border-amber-100",
                    text: "text-amber-700",
                    iconBg: "bg-amber-100 text-amber-600",
                },
                {
                    label: "Grand Amount",
                    value: formatToRoundedIndianRupee(totals.base),
                    icon: <Wallet className="w-4 h-4" />,
                    bg: "bg-blue-50/50",
                    border: "border-blue-100",
                    text: "text-blue-700",
                    iconBg: "bg-blue-100 text-blue-600",
                },
                {
                    label: "Grand Total Amount",
                    value: formatToRoundedIndianRupee(totals.total),
                    icon: <Calculator className="w-4 h-4" />,
                    bg: "bg-slate-50",
                    border: "border-slate-200",
                    text: "text-slate-900",
                    iconBg: "bg-slate-200 text-slate-700",
                }
            ].map((card, i) => (
                <div key={i} className={`${card.bg} ${card.border} border rounded-xl p-3.5 shadow-sm transition-all duration-300 hover:shadow-md relative overflow-hidden group`}>
                    <div className="flex items-center justify-between relative z-10">
                        <div>
                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">{card.label}</p>
                            <p className={`text-xl font-bold tabular-nums tracking-tight ${card.text}`}>
                                {card.value}
                            </p>
                        </div>
                        <div className={`${card.iconBg} p-1.5 rounded-lg`}>
                            {card.icon}
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );

    const activeFilters = useMemo(() => {
        // Create local lookup maps from data for display
        const pMap: Record<string, string> = {};
        const gMap: Record<string, string> = {};
        const vMap: Record<string, string> = {};
        combinedData.forEach(d => {
            pMap[d.project] = d.project_name;
            gMap[d.project_gst] = d.project_gst_display;
            if (d.vendor) vMap[d.vendor] = d.vendor_name;
        });

        const labels: string[] = [];
        columnFilters.forEach(filter => {
            if (filter.id === "project") {
                const vals = filter.value as string[];
                const displayVals = (vals || []).map(v => pMap[v] || v);
                if (displayVals.length > 0) labels.push(`Project: ${displayVals.join(", ")}`);
            }
            if (filter.id === "project_gst") {
                const vals = filter.value as string[];
                const displayVals = (vals || []).map(v => gMap[v] || v);
                if (displayVals.length > 0) labels.push(`GST: ${displayVals.join(", ")}`);
            }
            if (filter.id === "invoice_type") {
                const vals = filter.value as string[];
                if (vals && vals.length > 0) labels.push(`Type: ${vals.join(", ")}`);
            }
            if (filter.id === "invoice_date") {
                const val = filter.value;
                if (typeof val === "string" && val.length === 7) {
                    const [year, month] = val.split("-");
                    const date = new Date(parseInt(year), parseInt(month) - 1);
                    labels.push(`Date: ${date.toLocaleString('default', { month: 'short' })} ${year}`);
                } else if (Array.isArray(val) && val.length > 0) {
                    // Show "Last X Months" or a range
                    if (val.length === 1) {
                        const [year, month] = val[0].split("-");
                        const date = new Date(parseInt(year), parseInt(month) - 1);
                        labels.push(`Date: ${date.toLocaleString('default', { month: 'short' })} ${year}`);
                    } else {
                        labels.push(`Date: Last ${val.length} Months`);
                    }
                }
            }
            if (filter.id === "vendor") {
                const vals = filter.value;
                if (Array.isArray(vals) && vals.length > 0) {
                    const displayVals = vals.map(v => vMap[v] || v);
                    labels.push(`Vendor: ${displayVals.join(", ")}`);
                } else if (typeof vals === 'string' && vals) {
                    labels.push(`Search: ${vMap[vals] || vals}`);
                }
            }
        });
        return labels;
    }, [columnFilters, combinedData]);

    if (isLoading) return <LoadingFallback />;

    return (
        <div className="flex flex-col gap-4 p-4 min-h-screen bg-slate-50/30">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Button variant="ghost" size="sm" onClick={onBack} className="text-red-600 hover:text-red-700 hover:bg-red-50 shadow-sm border border-red-100 font-semibold transition-colors">
                        <ArrowLeft className="w-4 h-4 mr-1.5" />
                        Back
                    </Button>
                    {/* <h2 className="text-xl font-bold text-slate-800 tracking-tight">
                        Project GST REPORT
                    </h2> */}
                </div>
                <div className="flex flex-col items-end gap-1.5">
                    <Badge variant="secondary" className="px-3 py-1 font-semibold">
                        {table.getFilteredRowModel().rows.length} Records Found
                    </Badge>
                    {activeFilters.length > 0 && (
                        <div className="flex items-center gap-2 flex-wrap justify-end max-w-[600px]">
                            <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-100 rounded-md border border-slate-200 shadow-inner">
                                <span className="text-[10px] font-bold uppercase tracking-tighter">Active Filters</span>
                            </div>
                            <div className="flex gap-1.5 flex-wrap justify-end">
                                {activeFilters.map((f, i) => (
                                    <span key={i} className="text-[10px] font-bold text-blue-600 bg-blue-50/50 px-2 py-1 rounded-md border border-blue-100 shadow-sm backdrop-blur-sm transition-all hover:bg-blue-100/50">
                                        {f}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <div className="bg-white overflow-hidden">
                <DataTable
                    table={table}
                    columns={columns}
                    isLoading={false}
                    totalCount={table.getFilteredRowModel().rows.length}
                    summaryCard={summaryCard}
                    searchFieldOptions={[
                        { label: "Vendor", value: "vendor" },
                        { label: "Invoice Type", value: "invoice_type" },
                        { label: "Project GST", value: "project_gst" }
                    ]}
                    selectedSearchField={selectedSearchField}
                    onSelectedSearchFieldChange={setSelectedSearchField}
                    searchTerm={searchTerm}
                    onSearchTermChange={setSearchTerm}
                    showExportButton={true}
                    onExport="default"
                    exportFileName={`GST_Details_${projectName.replace(/\s+/g, '_')}`}
                    facetFilterOptions={{
                        project: {
                            title: "Project Name",
                            options: Array.from(new Set(combinedData.map(d => JSON.stringify({ label: d.project_name, value: d.project }))))
                                .map(s => JSON.parse(s))
                        },
                        project_gst: {
                            title: "GST Location",
                            options: Array.from(new Set(combinedData.map(d => JSON.stringify({ label: d.project_gst_display, value: d.project_gst }))))
                                .map(s => JSON.parse(s))
                        },
                        invoice_type: {
                            title: "Invoice Type",
                            options: Array.from(new Set(combinedData.map(d => d.invoice_type))).map(t => ({ label: t, value: t }))
                        },
                        vendor: {
                            title: "Vendor",
                            options: Array.from(new Set(combinedData.filter(d => d.vendor !== "N/A" && d.vendor).map(d => JSON.stringify({ label: d.vendor_name, value: d.vendor }))))
                                .map(s => JSON.parse(s))
                        }
                    }}
                    dateFilterColumns={["invoice_date"]}
                    tableHeight="calc(100vh - 320px)"
                />
            </div>
        </div>
    );
};

export default ProjectGSTReportDetails;
