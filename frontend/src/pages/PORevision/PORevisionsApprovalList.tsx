import { useState, useMemo, useCallback } from "react";
import { DOCTYPE, PO_REVISION_FIELDS_TO_FETCH, PO_REVISION_SEARCHABLE_FIELDS, PO_REVISION_DATE_COLUMNS, getPORevisionColumns } from "./config/poRevisions.config";
import { useServerDataTable } from "@/hooks/useServerDataTable";
import { DataTable } from "@/components/data-table/new-data-table";
import { getProjectListOptions, getVendorListOptions, queryKeys } from "@/config/queryKeys";
import { Projects } from "@/types/NirmaanStack/Projects";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { FrappeDoc, GetDocListArgs, useFrappeGetDocList } from "frappe-react-sdk";
import { memoize } from "lodash";
import { TableSkeleton } from "@/components/ui/skeleton";
import { useFacetValues } from "@/hooks/useFacetValues";

export default function PORevisionsApprovalList() {
    const [activeTab, setActiveTab] = useState<string>("Pending Approval");

    const tabs = [
        "Pending Approval",
        "Approved",
        "Rejected",
        "All Requests"
    ];

    // Map the UI tabs to backend statuses
    const getStatusFilters = () => {
        if (activeTab === "Pending Approval") {
            return [["status", "=", "Pending"]];
        } else if (activeTab === "Approved") {
            return [["status", "=", "Approved"]];
        } else if (activeTab === "Rejected") {
            return [["status", "=", "Rejected"]];
        }
        return []; // "All Requests"
    };

    const statusFilters = useMemo(() => getStatusFilters(), [activeTab]);

    // Projects Fetch for names
    const projectsFetchOptions = getProjectListOptions();
    const { data: projects, isLoading: isProjectsLoading } = useFrappeGetDocList<Projects>(
        "Projects",
        projectsFetchOptions as GetDocListArgs<FrappeDoc<Projects>>,
        queryKeys.projects.list(projectsFetchOptions)
    );

    const getProjectName = useCallback(
        memoize(
            (projId?: string) =>
                projects?.find((p) => p.name === projId)?.project_name || projId || "--"
        ),
        [projects]
    );

    // Vendors Fetch for names
    const vendorsFetchOptions = getVendorListOptions();
    const { data: vendors, isLoading: isVendorsLoading } = useFrappeGetDocList<Vendors>(
        "Vendors",
        vendorsFetchOptions as GetDocListArgs<FrappeDoc<Vendors>>,
        queryKeys.vendors.list(vendorsFetchOptions)
    );

    const getVendorName = useCallback(
        memoize(
            (vendorId?: string) =>
                vendors?.find((v) => v.name === vendorId)?.vendor_name || vendorId || "--"
        ),
        [vendors]
    );

    const tableColumns = useMemo(
        () => getPORevisionColumns({ getProjectName, getVendorName }),
        [getProjectName, getVendorName]
    );

    const {
        table,
        data: poRevisionsData,
        isLoading: isDataLoading,
        error: dataError,
        totalCount,
        searchTerm,
        setSearchTerm,
        selectedSearchField,
        setSelectedSearchField,
        columnFilters,
    } = useServerDataTable<any>({
        doctype: DOCTYPE,
        columns: tableColumns,
        additionalFilters: statusFilters,
        fetchFields: PO_REVISION_FIELDS_TO_FETCH,
        searchableFields: PO_REVISION_SEARCHABLE_FIELDS,
        urlSyncKey: "po_revisions",
        defaultSort: "creation desc",
    });

    const {
        facetOptions: projectFacetOptions,
        isLoading: isProjectFacetLoading,
    } = useFacetValues({
        doctype: DOCTYPE,
        field: "project",
        currentFilters: columnFilters,
        searchTerm,
        selectedSearchField,
        enabled: true,
    });

    const {
        facetOptions: vendorFacetOptions,
        isLoading: isVendorFacetLoading,
    } = useFacetValues({
        doctype: DOCTYPE,
        field: "vendor",
        currentFilters: columnFilters,
        searchTerm,
        selectedSearchField,
        enabled: true,
    });

    const facetOptionsConfig = useMemo(
        () => ({
            project: {
                title: "Project",
                options: projectFacetOptions,
                isLoading: isProjectFacetLoading,
            },
            vendor: {
                title: "Vendor",
                options: vendorFacetOptions,
                isLoading: isVendorFacetLoading,
            }
        }),
        [projectFacetOptions, isProjectFacetLoading, vendorFacetOptions, isVendorFacetLoading]
    );

    const isLoadingOverall = isDataLoading || isProjectsLoading || isVendorsLoading;

    return (
        <div className="flex-1 space-y-4 pt-2">
            {/* <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold tracking-tight text-gray-800">
                    PO Revisions
                </h2>
            </div> */}
            {/* Tab Navigation - Custom Tailwind buttons mapping Work Orders Style */}
            <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 scrollbar-thin">
                <div className="flex gap-1.5 sm:flex-wrap pb-1 sm:pb-0">
                    {tabs.map((tab) => {
                        const isActive = activeTab === tab;
                        return (
                            <button
                                key={tab}
                                type="button"
                                onClick={() => setActiveTab(tab)}
                                className={`px-2.5 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm rounded
                                    transition-colors flex items-center gap-1.5 whitespace-nowrap
                                    ${isActive
                                        ? "bg-sky-500 text-white"
                                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                                    }`}
                            >
                                {tab}
                                {/* If we had counts for PO Revisions it would go here */}
                                {/* <span className={`text-xs font-bold ${isActive ? "opacity-90" : "opacity-70"}`}>
                                    {count}
                                </span> */}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Table */}
            <div
              className={`flex flex-col gap-2 overflow-hidden ${
                totalCount > 10
                  ? "h-[calc(100vh-80px)]"
                  : totalCount > 0
                  ? "h-auto"
                  : ""
              }`}
            >
                {isLoadingOverall && !poRevisionsData?.length ? (
                    <TableSkeleton />
                ) : (
                    <DataTable<any>
                        table={table}
                        columns={tableColumns}
                        isLoading={isLoadingOverall}
                        error={dataError as Error | null}
                        totalCount={totalCount}
                        searchFieldOptions={PO_REVISION_SEARCHABLE_FIELDS}
                        selectedSearchField={selectedSearchField}
                        onSelectedSearchFieldChange={setSelectedSearchField}
                        searchTerm={searchTerm}
                        onSearchTermChange={setSearchTerm}
                        facetFilterOptions={facetOptionsConfig}
                        dateFilterColumns={PO_REVISION_DATE_COLUMNS}
                        showExportButton={true}
                        onExport={"default"}
                        exportFileName={DOCTYPE}
                        showRowSelection={false}
                    />
                )}
            </div>
        </div>
    );
}
