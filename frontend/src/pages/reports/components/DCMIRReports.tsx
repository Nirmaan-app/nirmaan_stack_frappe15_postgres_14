import { useMemo, useCallback, useEffect } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import { DataTable } from "@/components/data-table/new-data-table";
import { DCMIRReportRowData, useDCMIRReportsData } from "../hooks/useDCMIRReportsData";
import { getDCMIRReportColumns } from "./columns/dcmirColumns";
import { criticalPOLabel } from "@/components/helpers/CriticalPOCell";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { DCMIRReportType, useReportStore } from "../store/useReportStore";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { getProjectListOptions, queryKeys } from "@/config/queryKeys";
import { Projects } from "@/types/NirmaanStack/Projects";
import { FrappeDoc, GetDocListArgs, useFrappeGetDocList } from "frappe-react-sdk";
import { useServerDataTable } from "@/hooks/useServerDataTable";
import {
    DCMIR_REPORTS_SEARCHABLE_FIELDS,
    DCMIR_REPORTS_ITM_SEARCHABLE_FIELDS,
    DCMIR_REPORTS_DATE_COLUMNS,
} from "../config/dcmirReportsTable.config";
import { toast } from "@/components/ui/use-toast";
import { exportToCsv } from "@/utils/exportToCsv";
import { formatDate } from "@/utils/FormatDate";

interface SelectOption {
    label: string;
    value: string;
}

interface DCMIRReportsProps {
    projectId?: string;
    forcedReportType?: 'DC Report' | 'MIR Report';
    /**
     * Filter to PO-only or ITM-only rows. Defaults to "Procurement Orders" so legacy
     * callers preserve PO-only behavior. Pass "Internal Transfer Memo" for ITM tabs.
     */
    parentDoctype?: 'Procurement Orders' | 'Internal Transfer Memo';
}

export default function DCMIRReports({ projectId, forcedReportType, parentDoctype = 'Procurement Orders' }: DCMIRReportsProps = {}) {
    const { reportData: allDeliveryDocs, isLoading: isLoadingInitialData, error: initialDataError } = useDCMIRReportsData();

    const storeReportType = useReportStore(
        (state) => state.selectedReportType as DCMIRReportType | null
    );
    const selectedReportType = forcedReportType || storeReportType;
    const isITM = parentDoctype === 'Internal Transfer Memo';

    // Determine columns based on selected report type + parent doctype.
    // ITM mode: hide vendor, PO No., Critical PO; show parent_docname (ITM No.) instead.
    const tableColumnsToDisplay = useMemo(
        () => {
            const cols = getDCMIRReportColumns(selectedReportType || 'DC Report', { parentDoctype });
            return projectId ? cols.filter(c => c.id !== 'project_name') : cols;
        },
        [selectedReportType, projectId, parentDoctype]
    );

    // Filter data by type based on selected report
    const currentDisplayData = useMemo(() => {
        if (!allDeliveryDocs) return [];
        if (!selectedReportType) return [];

        const typeFilter = selectedReportType === 'DC Report' ? 'Delivery Challan' : 'Material Inspection Report';
        let filtered = allDeliveryDocs.filter((doc) => doc.type === typeFilter);
        filtered = filtered.filter(doc => doc.parent_doctype === parentDoctype);
        if (projectId) {
            filtered = filtered.filter(doc => doc.project === projectId);
        }
        return filtered;
    }, [allDeliveryDocs, selectedReportType, projectId, parentDoctype]);

    // Initialize useServerDataTable in clientData mode
    const {
        table,
        isLoading: isTableHookLoading,
        error: tableHookError,
        totalCount,
        searchTerm,
        setSearchTerm,
        selectedSearchField,
        setSelectedSearchField,
        exportAllRows,
        isExporting,
    } = useServerDataTable<DCMIRReportRowData>({
        doctype: `DCMIRReportsVirtual_${selectedReportType || "none"}_${isITM ? "itm" : "po"}`,
        columns: tableColumnsToDisplay,
        fetchFields: [],
        searchableFields: isITM ? DCMIR_REPORTS_ITM_SEARCHABLE_FIELDS : DCMIR_REPORTS_SEARCHABLE_FIELDS,
        clientData: currentDisplayData,
        clientTotalCount: currentDisplayData.length,
        urlSyncKey: `dcmir_reports_${projectId ? projectId + "_" : ""}${isITM ? "itm_" : "po_"}${selectedReportType?.toString().replace(/\s+/g, "_") || "all"}`,
        defaultSort: "creation desc",
        enableRowSelection: false,
    });

    const filteredRowCount = table.getFilteredRowModel().rows.length;
    const fullyFilteredData = table.getFilteredRowModel().rows.map((row) => row.original);

    // Sync pageCount with client-side filtered data
    useEffect(() => {
        const { pageSize } = table.getState().pagination;
        const newPageCount = pageSize > 0 ? Math.ceil(filteredRowCount / pageSize) : 1;

        if (table.getPageCount() !== newPageCount) {
            table.setOptions((prev) => ({
                ...prev,
                pageCount: newPageCount,
            }));
        }
    }, [filteredRowCount]);

    // Project facet options
    const projectsFetchOptions = getProjectListOptions();
    const {
        data: projects,
        isLoading: projectsUiLoading,
        error: projectsUiError,
    } = useFrappeGetDocList<Projects>(
        "Projects",
        projectsFetchOptions as GetDocListArgs<FrappeDoc<Projects>>,
        queryKeys.projects.list(projectsFetchOptions)
    );

    const projectFacetOptions = useMemo<SelectOption[]>(() => {
        const counts: Record<string, number> = {};
        currentDisplayData.forEach(row => {
            const val = row.projectName || row.project;
            if (val) counts[val] = (counts[val] || 0) + 1;
        });
        return Object.entries(counts)
            .map(([val, count]) => ({ label: `${val} (${count})`, value: val }))
            .sort((a, b) => a.value.localeCompare(b.value));
    }, [currentDisplayData]);

    const signedFacetOptions = useMemo<SelectOption[]>(() => [
        { label: "Yes", value: "Yes" },
        { label: "No", value: "No" },
    ], []);

    const stubFacetOptions = useMemo<SelectOption[]>(() => [
        { label: "Complete", value: "Complete" },
        { label: "Stub", value: "Stub" },
    ], []);

    const criticalPOFacetOptions = useMemo<SelectOption[]>(() => {
        const counts = new Map<string, number>();
        for (const row of currentDisplayData) {
            // Use a Set to avoid double-counting the same label within one row
            const rowLabels = new Set<string>();
            for (const task of row.criticalPOTasks) {
                rowLabels.add(criticalPOLabel(task));
            }
            for (const label of rowLabels) {
                counts.set(label, (counts.get(label) || 0) + 1);
            }
        }
        return Array.from(counts.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([label, count]) => ({ label: `${label} (${count})`, value: label }));
    }, [currentDisplayData]);

    // Source project facet (ITM mode only) — counts unique source projects across visible rows.
    const sourceProjectFacetOptions = useMemo<SelectOption[]>(() => {
        if (!isITM) return [];
        const counts: Record<string, number> = {};
        for (const row of currentDisplayData) {
            const val = row.sourceProjectName || row.source_project;
            if (val) counts[val] = (counts[val] || 0) + 1;
        }
        return Object.entries(counts)
            .map(([val, count]) => ({ label: `${val} (${count})`, value: val }))
            .sort((a, b) => a.value.localeCompare(b.value));
    }, [currentDisplayData, isITM]);

    const facetOptionsConfig = useMemo(
        () => {
            const baseConfig: Record<string, { title: string; options: SelectOption[] }> = {
                is_signed: { title: "Signed", options: signedFacetOptions },
                is_stub: { title: "Status", options: stubFacetOptions },
            };
            if (isITM) {
                // ITM gets a Source Project facet (the equivalent of Vendor for POs).
                baseConfig.source_project_name = { title: "Source Project", options: sourceProjectFacetOptions };
            } else {
                // PO gets Critical PO facet.
                baseConfig.critical_po = { title: "Critical PO", options: criticalPOFacetOptions };
            }

            if (!projectId) {
               return {
                   project_name: { title: isITM ? "Target Project" : "Project", options: projectFacetOptions },
                   ...baseConfig
               }
            }
            return baseConfig;
        },
        [projectFacetOptions, criticalPOFacetOptions, sourceProjectFacetOptions, signedFacetOptions, stubFacetOptions, projectId, isITM]
    );

    const exportFileName = useMemo(() => {
        const base = selectedReportType === 'MIR Report' ? 'mir_report' : 'dc_report';
        const prefix = isITM ? `itm_${base}` : base;
        return projectId ? `${projectId}_${prefix}` : prefix;
    }, [selectedReportType, projectId, isITM]);

    const handleCustomExport = useCallback(async () => {
        const allRows = await exportAllRows();
        if (!allRows || allRows.length === 0) {
            toast({ title: "Export", description: "No data available to export.", variant: "default" });
            return;
        }

        const dataToExport = allRows.map((row) => ({
            document_id: row.name,
            project: row.projectName || row.project,
            source_project: row.sourceProjectName || row.source_project || "",
            reference_number: row.reference_number || "",
            dc_reference: row.dc_reference || "",
            vendor: row.vendorName || row.vendor || "",
            po_number: row.parent_docname || row.procurement_order || "",
            itm_number: row.parent_doctype === 'Internal Transfer Memo' ? row.parent_docname : "",
            critical_po_categories: row.criticalPOTasks?.map(criticalPOLabel).join(", ") || "",
            date: row.dc_date ? formatDate(row.dc_date) : "",
            items: row.itemsSummary,
            signed: row.is_signed_by_client === 1 ? "Yes" : "No",
            attachment: row.attachment_url || "",
            status: row.is_stub === 1 ? "Stub" : "Complete",
        }));

        const allExportColumns: ColumnDef<any, any>[] = [
            { header: "Document ID", accessorKey: "document_id" },
            { header: isITM ? "Target Project" : "Project", accessorKey: "project" },
            { header: selectedReportType === 'MIR Report' ? "MIR No." : "DC No.", accessorKey: "reference_number" },
            ...(selectedReportType === 'MIR Report' ? [{ header: "DC Ref", accessorKey: "dc_reference" } as ColumnDef<any, any>] : []),
            ...(isITM
                ? [
                    { header: "ITM No.", accessorKey: "itm_number" } as ColumnDef<any, any>,
                    { header: "Source Project", accessorKey: "source_project" } as ColumnDef<any, any>,
                  ]
                : [
                    { header: "Vendor", accessorKey: "vendor" } as ColumnDef<any, any>,
                    { header: "PO No.", accessorKey: "po_number" } as ColumnDef<any, any>,
                    { header: "Critical PO Categories", accessorKey: "critical_po_categories" } as ColumnDef<any, any>,
                ]),
            { header: "Date", accessorKey: "date" },
            { header: "Items", accessorKey: "items" },
            { header: "Signed", accessorKey: "signed" },
            { header: "Attachment", accessorKey: "attachment" },
            { header: "Status", accessorKey: "status" },
        ];

        const exportColumnsConfig = projectId
            ? allExportColumns.filter(c => (c as any).accessorKey !== "project")
            : allExportColumns;

        try {
            exportToCsv(exportFileName, dataToExport, exportColumnsConfig);
            toast({ title: "Export Successful", description: `${dataToExport.length} rows exported.`, variant: "success" });
        } catch (e) {
            console.error("Export failed:", e);
            toast({ title: "Export Error", description: "Could not generate CSV file.", variant: "destructive" });
        }
    }, [exportAllRows, exportFileName, selectedReportType, projectId]);

    const isLoadingOverall = isLoadingInitialData || projectsUiLoading || isTableHookLoading;
    const overallError = initialDataError || projectsUiError || tableHookError;

    if (overallError) {
        return <AlertDestructive error={overallError as Error} />;
    }

    return (
        <div
            className={cn(
                "flex flex-col gap-2 overflow-hidden",
                totalCount > 10 ? "h-[calc(100vh-130px)]" : totalCount > 0 ? "h-auto" : ""
            )}
        >
            {isLoadingInitialData && !allDeliveryDocs ? (
                <LoadingFallback />
            ) : (
                <DataTable<DCMIRReportRowData>
                    table={table}
                    columns={tableColumnsToDisplay}
                    isLoading={isLoadingOverall}
                    isExporting={isExporting}
                    error={overallError as Error | null}
                    totalCount={filteredRowCount}
                    searchFieldOptions={DCMIR_REPORTS_SEARCHABLE_FIELDS}
                    selectedSearchField={selectedSearchField}
                    onSelectedSearchFieldChange={setSelectedSearchField}
                    searchTerm={searchTerm}
                    onSearchTermChange={setSearchTerm}
                    facetFilterOptions={facetOptionsConfig}
                    dateFilterColumns={DCMIR_REPORTS_DATE_COLUMNS}
                    showExportButton={true}
                    onExport={handleCustomExport}
                    exportFileName={exportFileName}
                    showRowSelection={false}
                />
            )}
        </div>
    );
}
