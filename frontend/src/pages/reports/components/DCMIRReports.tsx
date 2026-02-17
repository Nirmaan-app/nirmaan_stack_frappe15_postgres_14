import { useMemo, useCallback, useEffect } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import { DataTable } from "@/components/data-table/new-data-table";
import { DCMIRReportRowData, useDCMIRReportsData } from "../hooks/useDCMIRReportsData";
import { getDCMIRReportColumns } from "./columns/dcmirColumns";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { DCMIRReportType, useReportStore } from "../store/useReportStore";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { getProjectListOptions, queryKeys } from "@/config/queryKeys";
import { Projects } from "@/types/NirmaanStack/Projects";
import { FrappeDoc, GetDocListArgs, useFrappeGetDocList } from "frappe-react-sdk";
import { useServerDataTable } from "@/hooks/useServerDataTable";
import {
    DCMIR_REPORTS_SEARCHABLE_FIELDS,
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
}

export default function DCMIRReports({ projectId, forcedReportType }: DCMIRReportsProps = {}) {
    const { reportData: allDeliveryDocs, isLoading: isLoadingInitialData, error: initialDataError } = useDCMIRReportsData();

    const storeReportType = useReportStore(
        (state) => state.selectedReportType as DCMIRReportType | null
    );
    const selectedReportType = forcedReportType || storeReportType;

    // Determine columns based on selected report type
    const tableColumnsToDisplay = useMemo(
        () => getDCMIRReportColumns(selectedReportType || 'DC Report'),
        [selectedReportType]
    );

    // Filter data by type based on selected report
    const currentDisplayData = useMemo(() => {
        if (!allDeliveryDocs) return [];
        if (!selectedReportType) return [];

        const typeFilter = selectedReportType === 'DC Report' ? 'Delivery Challan' : 'Material Inspection Report';
        
        let filtered = allDeliveryDocs.filter((doc) => doc.type === typeFilter);
        if (projectId) {
            filtered = filtered.filter(doc => doc.project === projectId);
        }
        return filtered;
    }, [allDeliveryDocs, selectedReportType, projectId]);

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
    } = useServerDataTable<DCMIRReportRowData>({
        doctype: `DCMIRReportsVirtual_${selectedReportType || "none"}`,
        columns: tableColumnsToDisplay,
        fetchFields: [],
        searchableFields: DCMIR_REPORTS_SEARCHABLE_FIELDS,
        clientData: currentDisplayData,
        clientTotalCount: currentDisplayData.length,
        urlSyncKey: `dcmir_reports_${projectId ? projectId + "_" : ""}${selectedReportType?.toString().replace(/\s+/g, "_") || "all"}`,
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

    const projectFacetOptions = useMemo<SelectOption[]>(
        () => projects?.map((p) => ({ label: p.project_name, value: p.project_name })) || [],
        [projects]
    );

    const signedFacetOptions = useMemo<SelectOption[]>(() => [
        { label: "Yes", value: "Yes" },
        { label: "No", value: "No" },
    ], []);

    const stubFacetOptions = useMemo<SelectOption[]>(() => [
        { label: "Complete", value: "Complete" },
        { label: "Stub", value: "Stub" },
    ], []);

    const facetOptionsConfig = useMemo(
        () => {
            const baseConfig = {
                is_signed: { title: "Signed", options: signedFacetOptions },
                is_stub: { title: "Status", options: stubFacetOptions },
            };
            
            if (!projectId) {
               return {
                   project_name: { title: "Project", options: projectFacetOptions },
                   ...baseConfig
               }
            }
            return baseConfig;
        },
        [projectFacetOptions, signedFacetOptions, stubFacetOptions, projectId]
    );

    const exportFileName = useMemo(() => {
        const prefix = selectedReportType === 'MIR Report' ? 'mir_report' : 'dc_report';
        return projectId ? `${projectId}_${prefix}` : prefix;
    }, [selectedReportType, projectId]);

    const handleCustomExport = useCallback(() => {
        if (!fullyFilteredData || fullyFilteredData.length === 0) {
            toast({ title: "Export", description: "No data available to export.", variant: "default" });
            return;
        }

        const dataToExport = fullyFilteredData.map((row) => ({
            document_id: row.name,
            project: row.projectName || row.project,
            reference_number: row.reference_number || "",
            dc_reference: row.dc_reference || "",
            vendor: row.vendorName || row.vendor || "",
            po_number: row.procurement_order,
            date: row.dc_date ? formatDate(row.dc_date) : "",
            items: row.itemsSummary,
            signed: row.is_signed_by_client === 1 ? "Yes" : "No",
            attachment: row.attachment_url || "",
            status: row.is_stub === 1 ? "Stub" : "Complete",
        }));

        const exportColumnsConfig: ColumnDef<any, any>[] = [
            { header: "Document ID", accessorKey: "document_id" },
            { header: "Project", accessorKey: "project" },
            { header: selectedReportType === 'MIR Report' ? "MIR No." : "DC No.", accessorKey: "reference_number" },
            ...(selectedReportType === 'MIR Report' ? [{ header: "DC Ref", accessorKey: "dc_reference" } as ColumnDef<any, any>] : []),
            { header: "Vendor", accessorKey: "vendor" },
            { header: "PO No.", accessorKey: "po_number" },
            { header: "Date", accessorKey: "date" },
            { header: "Items", accessorKey: "items" },
            { header: "Signed", accessorKey: "signed" },
            { header: "Attachment", accessorKey: "attachment" },
            { header: "Status", accessorKey: "status" },
        ];

        try {
            exportToCsv(exportFileName, dataToExport, exportColumnsConfig);
            toast({ title: "Export Successful", description: `${dataToExport.length} rows exported.`, variant: "success" });
        } catch (e) {
            console.error("Export failed:", e);
            toast({ title: "Export Error", description: "Could not generate CSV file.", variant: "destructive" });
        }
    }, [fullyFilteredData, exportFileName, selectedReportType]);

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
