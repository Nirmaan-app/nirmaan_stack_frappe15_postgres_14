// Global approvals queue on the Commission Report list page (Admin / PMO).
// Same DataTable UX as the Task Wise tab, filtered to "Pending Approval" + "Submitted",
// with Approve / Reject + the report actions per row. Reuses get_task_wise_list.

import React, { useCallback, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
    ColumnDef,
    getCoreRowModel,
    getFacetedRowModel,
    getFacetedUniqueValues,
    useReactTable,
} from "@tanstack/react-table";
import { Check, X, Eye } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TableSkeleton } from "@/components/ui/skeleton";
import { DataTable } from "@/components/data-table/new-data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { useServerDataTable } from "@/hooks/useServerDataTable";
import { useUserData } from "@/hooks/useUserData";

import { useCommissionMasters } from "../hooks/useCommissionMasters";
import { CommissionReportTask } from "../types";
import { getUnifiedStatusStyle } from "../utils";
import { masterMapKey } from "./FillReportButton";
import { ReportPreviewDialog } from "./ReportPreviewDialog";
import { ApprovalActionDialog, type ApprovalTaskRef } from "./ApprovalActionDialog";
import { useMasterTaskMap } from "../report-wizard/data/useMasterTaskMap";

const PARENT_DOCTYPE = "Project Commission Report";
const PREVIEW_PORTRAIT = "Project Commission Report - Filled Task";
const PREVIEW_LANDSCAPE = "LSProject Commission Report - Filled Task";

const buildPdfUrl = (parentName: string, childRowName: string, isLandscape: boolean): string => {
    const params = new URLSearchParams({
        doctype: PARENT_DOCTYPE,
        name: parentName,
        format: isLandscape ? PREVIEW_LANDSCAPE : PREVIEW_PORTRAIT,
        task_row: childRowName,
        letterhead: "No Letterhead",
    });
    return `/api/method/frappe.utils.print_format.download_pdf?${params.toString()}`;
};

interface FlattenedTask extends CommissionReportTask {
    project_name: string;
    project: string;
    prjname: string;
}

interface Props {
    /** When set, scope the queue to a single project tracker and hide the Project column. */
    trackerName?: string;
    /** Called after approve/reject so the parent can refresh counts / tracker doc. */
    onRefresh?: () => void;
}

export const GlobalApprovalsTable: React.FC<Props> = ({ trackerName, onRefresh }) => {
    const { categoryData, FacetProjectsOptions } = useCommissionMasters();
    const { map: masterMap } = useMasterTaskMap();
    const { role, user_id } = useUserData();
    // Approve / Reject actions are Admin-only; PMO sees the queue read-only.
    const isAdmin = role === "Nirmaan Admin Profile" || user_id === "Administrator";

    const [preview, setPreview] = useState<{ open: boolean; url: string; title: string }>({ open: false, url: "", title: "" });
    const openPreview = useCallback((url: string, title: string) => setPreview({ open: true, url, title }), []);
    const [approval, setApproval] = useState<{ open: boolean; mode: 'approve' | 'reject' | null; task: ApprovalTaskRef | null }>(
        { open: false, mode: null, task: null },
    );
    const refetchRef = useRef<() => void>(() => {});
    // Refresh BOTH this table and the parent (tracker doc / list) so status counts
    // and other views update immediately after approve/reject.
    const refresh = useCallback(() => { refetchRef.current?.(); onRefresh?.(); }, [onRefresh]);

    const openApproval = useCallback((task: FlattenedTask, mode: 'approve' | 'reject') => {
        const info = masterMap.get(masterMapKey(task.commission_category, task.task_name));
        setApproval({
            open: true,
            mode,
            task: {
                name: task.name,
                prjname: task.prjname,
                task_name: task.task_name,
                hasTemplate: !!info?.hasTemplate,
                isLandscape: !!info?.isLandscape,
            },
        });
    }, [masterMap]);

    const columns: ColumnDef<FlattenedTask>[] = useMemo(() => [
        ...(trackerName ? [] : [{
            accessorKey: "project",
            header: ({ column }: { column: any }) => <DataTableColumnHeader column={column} title="Project" />,
            cell: ({ row }: { row: any }) => (
                <Link
                    to={`/commission-tracker/${row.original.prjname}`}
                    className="text-red-700 underline-offset-2 hover:underline font-medium"
                >
                    {row.original.project_name}
                </Link>
            ),
            enableColumnFilter: true,
            size: 160, minSize: 130, maxSize: 200,
        }] as ColumnDef<FlattenedTask>[]),
        {
            accessorKey: "commission_category",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Category" />,
            enableColumnFilter: true,
            size: 140, minSize: 110, maxSize: 170,
        },
        {
            accessorKey: "task_name",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Report Name" />,
            size: 200, minSize: 160, maxSize: 260,
        },
        {
            accessorKey: "report_type",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Type" />,
            cell: ({ row }) => {
                const rt = row.original.report_type || "Field";
                return (
                    <span className={`py-0.5 px-2 text-[10px] rounded-full border ${rt === "Vendor"
                        ? "bg-orange-50 text-orange-700 border-orange-200"
                        : "bg-sky-50 text-sky-700 border-sky-200"}`}>
                        {rt}
                    </span>
                );
            },
            enableColumnFilter: true,
            size: 90, minSize: 75, maxSize: 110,
        },
        {
            accessorKey: "task_status",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
            cell: ({ row }) => (
                <Badge
                    variant="outline"
                    className={`min-h-[22px] py-0.5 px-2 text-[10px] justify-center whitespace-normal break-words text-center leading-tight rounded-full ${getUnifiedStatusStyle(row.original.task_status || "...")}`}
                >
                    {row.original.task_status || "..."}
                </Badge>
            ),
            enableColumnFilter: true,
            size: 120, minSize: 100, maxSize: 140,
        },
        {
            id: "report",
            header: () => <div className="w-full text-center">Submission</div>,
            cell: ({ row }) => {
                const t = row.original;
                const info = masterMap.get(masterMapKey(t.commission_category, t.task_name));
                if (!info?.hasTemplate) {
                    return <div className="text-center text-[11px] text-gray-400">--</div>;
                }
                return (
                    <div className="flex justify-center">
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 gap-1"
                            onClick={() => openPreview(buildPdfUrl(t.prjname, t.name, !!info.isLandscape), t.task_name)}
                            title="View the submitted report"
                        >
                            <Eye className="h-3 w-3" /> <span className="text-[11px] font-medium">View Submission</span>
                        </Button>
                    </div>
                );
            },
            size: 170,
            meta: { excludeFromExport: true },
        },
        ...(isAdmin ? [{
            id: "actions",
            header: () => <div className="w-full text-center">Actions</div>,
            cell: ({ row }: { row: any }) => {
                const task = row.original;
                return (
                    <div className="flex justify-center gap-2">
                        <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-green-600 hover:bg-green-50"
                            title="Submit"
                            onClick={() => openApproval(task, 'approve')}
                        >
                            <Check className="h-4 w-4" />
                        </Button>
                        <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-red-600 hover:bg-red-50"
                            title="Reject"
                            onClick={() => openApproval(task, 'reject')}
                        >
                            <X className="h-4 w-4" />
                        </Button>
                    </div>
                );
            },
            size: 100, minSize: 90, maxSize: 120,
            meta: { excludeFromExport: true },
        }] as ColumnDef<FlattenedTask>[] : []),
    ], [masterMap, trackerName, openPreview, openApproval, isAdmin]);

    const facetFilterOptions = useMemo(() => ({
        ...(trackerName ? {} : { project: { title: "Project", options: FacetProjectsOptions || [] } }),
        commission_category: {
            title: "Category",
            options: (categoryData || []).map((cat) => ({ label: cat.category_name, value: cat.category_name })),
        },
        report_type: {
            title: "Report Type",
            options: [
                { label: "Field", value: "Field" },
                { label: "Vendor", value: "Vendor" },
            ],
        },
    }), [FacetProjectsOptions, categoryData, trackerName]);

    const additionalFilters = useMemo(() => {
        const base: any[] = [
            ["Commission Report Task Child Table", "task_status", "=", "Pending Approval"],
        ];
        if (trackerName) base.push(["Commission Report Task Child Table", "prjname", "=", trackerName]);
        return base;
    }, [trackerName]);

    const serverDataTable = useServerDataTable<FlattenedTask>({
        doctype: PARENT_DOCTYPE,
        apiEndpoint: "nirmaan_stack.api.commission_report.get_task_wise_list.get_task_wise_list",
        columns,
        fetchFields: [
            "name as prjname", "project_name", "project", "name", "task_name",
            "commission_category", "deadline", "task_status",
            "report_type", "file_link", "approval_proof", "response_data",
            "comments", "modified", "last_submitted",
        ],
        searchableFields: [
            { value: "task_name", label: "Report Name", default: true },
            { value: "project_name", label: "Project Name" },
            { value: "commission_category", label: "Category" },
        ],
        defaultSort: "modified desc",
        urlSyncKey: trackerName ? "cr_proj_approvals" : "cr_approvals",
        additionalFilters,
    });

    refetchRef.current = serverDataTable.refetch;

    const table = useReactTable({
        data: serverDataTable.data || [],
        columns: serverDataTable.table.options.columns,
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
        getFacetedRowModel: getFacetedRowModel(),
        getFacetedUniqueValues: getFacetedUniqueValues(),
    });

    if (serverDataTable.isLoading && !serverDataTable.data?.length) {
        return <TableSkeleton />;
    }

    return (
        <div className="overflow-x-auto rounded-lg shadow-sm bg-white">
            <DataTable<FlattenedTask>
                table={table}
                columns={table.options.columns}
                isLoading={serverDataTable.isLoading}
                error={serverDataTable.error}
                totalCount={serverDataTable.totalCount}
                searchFieldOptions={[
                    { value: "task_name", label: "Report Name", default: true },
                    { value: "project_name", label: "Project Name" },
                    { value: "commission_category", label: "Category" },
                ]}
                selectedSearchField={serverDataTable.selectedSearchField}
                onSelectedSearchFieldChange={serverDataTable.setSelectedSearchField}
                facetFilterOptions={facetFilterOptions}
                searchTerm={serverDataTable.searchTerm}
                onSearchTermChange={serverDataTable.setSearchTerm}
                showExportButton={false}
                tableHeight="60vh"
            />
            <ReportPreviewDialog
                open={preview.open}
                onOpenChange={(o) => setPreview((p) => ({ ...p, open: o }))}
                pdfUrl={preview.url}
                title={preview.title}
                canDownload={false}
            />
            <ApprovalActionDialog
                open={approval.open}
                onOpenChange={(o) => setApproval((a) => ({ ...a, open: o }))}
                mode={approval.mode}
                task={approval.task}
                refresh={refresh}
            />
        </div>
    );
};
