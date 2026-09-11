/**
 * `/payment-tds-deductions` — the Tax Deducted at Source ledger, one row per deducted payment.
 *
 * ⚠️ "TDS" HERE IS **TAX DEDUCTED AT SOURCE**, NOT the Technical Data Sheet family that owns
 * `/tds-repository` and `/tds-approval` in the same sidebar. The route name is spelled out in full
 * for exactly that reason.
 *
 * READ-ONLY BY DESIGN. Rows are written by `services/payment_tds.py` when an SR-backed payment
 * reaches `Approved`, and a deduction has no reversal (owner ruling 2026-09-10) — it is deleted
 * with the payment it belongs to. So there is no create, edit or delete affordance here, and
 * adding one would need the reversal path that deliberately does not exist yet.
 */

import React, { useCallback, useMemo } from "react";
import { FrappeDoc, GetDocListArgs, useFrappeGetDocList } from "frappe-react-sdk";
import { Row } from "@tanstack/react-table";
import memoize from "lodash/memoize";

import { DataTable } from "@/components/data-table/new-data-table";
import { FacetOverrides } from "@/components/data-table/facetConfig";
import { TableSkeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useServerDataTable } from "@/hooks/useServerDataTable";
import { useCEOHoldProjects } from "@/hooks/useCEOHoldProjects";
import { CEO_HOLD_ROW_CLASSES } from "@/utils/ceoHoldRowStyles";
import { getProjectListOptions, queryKeys } from "@/config/queryKeys";
import { useVendorsList } from "@/pages/ProcurementRequests/VendorQuotesSelection/hooks/useVendorsList";
import { Projects } from "@/types/NirmaanStack/Projects";


import {
    DOCTYPE,
    PAYMENT_TDS_AGGREGATES_CONFIG,
    PAYMENT_TDS_DATE_COLUMNS,
    PAYMENT_TDS_FIELDS_TO_FETCH,
    PAYMENT_TDS_SEARCHABLE_FIELDS,
    getPaymentTdsColumns,
    PaymentTDSDeductionRow,
} from "./config/paymentTdsDeductions.config";
import { PaymentTDSSummaryCard } from "./components/PaymentTDSSummaryCard";

interface PaymentTDSDeductionsProps {
    /** Scope to one project (for a future embed on the project page). */
    projectId?: string;
    /** Scope to one vendor (for a future embed on the vendor page). */
    vendorId?: string;
    /** Override the URL-sync namespace so an embedded instance keeps its own table state. */
    urlSyncKey?: string;
}

export const PaymentTDSDeductions: React.FC<PaymentTDSDeductionsProps> = ({
    projectId,
    vendorId,
    urlSyncKey,
}) => {
    // --- Lookups: the row stores IDs, the table shows names ---
    const projectsFetchOptions = getProjectListOptions();
    const { data: projects, isLoading: isProjectsLoading } = useFrappeGetDocList<Projects>(
        "Projects",
        projectsFetchOptions as GetDocListArgs<FrappeDoc<Projects>>,
        queryKeys.projects.list(projectsFetchOptions)
    );

    // Service vendors only would be tempting -- every row today is an SR payment -- but the
    // superset costs nothing and keeps the name resolving if `DEDUCTIBLE_PARENTS` ever widens.
    const { data: vendors, isLoading: isVendorsLoading } = useVendorsList({
        vendorTypes: ["Service", "Material", "Material & Service"],
    });

    const getProjectName = useCallback(
        memoize(
            (projId?: string) =>
                projects?.find((p) => p.name === projId)?.project_name || projId || "--"
        ),
        [projects]
    );

    const getVendorName = useCallback(
        memoize(
            (vendId?: string) =>
                vendors?.find((v) => v.name === vendId)?.vendor_name || vendId || "--"
        ),
        [vendors]
    );

    const { ceoHoldProjectIds } = useCEOHoldProjects();
    const getRowClassName = useCallback(
        (row: Row<PaymentTDSDeductionRow>) => {
            const projId = row.original.project;
            return projId && ceoHoldProjectIds.has(projId) ? CEO_HOLD_ROW_CLASSES : undefined;
        },
        [ceoHoldProjectIds]
    );

    const columns = useMemo(
        () => getPaymentTdsColumns({ getProjectName, getVendorName }),
        [getProjectName, getVendorName]
    );

    const staticFilters = useMemo(() => {
        const filters: Array<[string, string, string]> = [];
        if (projectId) filters.push(["project", "=", projectId]);
        if (vendorId) filters.push(["vendor", "=", vendorId]);
        return filters;
    }, [projectId, vendorId]);

    const {
        table,
        data,
        isLoading: isDataLoading,
        error,
        totalCount,
        searchTerm,
        setSearchTerm,
        selectedSearchField,
        setSelectedSearchField,
        columnFilters,
        aggregates,
        isAggregatesLoading,
        exportAllRows,
        isExporting,
    } = useServerDataTable<PaymentTDSDeductionRow>({
        doctype: DOCTYPE,
        columns,
        fetchFields: PAYMENT_TDS_FIELDS_TO_FETCH,
        searchableFields: PAYMENT_TDS_SEARCHABLE_FIELDS,
        additionalFilters: staticFilters,
        urlSyncKey: urlSyncKey ?? `payment_tds_${projectId || vendorId || "all"}`,
        // The day the tax was withheld, newest first -- `creation` would sort the 629 backfilled
        // rows by the day the patch ran, which is the same day for all of them.
        defaultSort: "deducted_on desc",
        aggregatesConfig: PAYMENT_TDS_AGGREGATES_CONFIG,
        enableRowSelection: false,
    });

    // Facet scope: when the table is already pinned to one project (or vendor), that column's
    // facet is hidden rather than rendered with a single option.
    const facetOverrides = useMemo<FacetOverrides>(
        () => ({
            project: { enabled: !projectId },
            vendor: { enabled: !vendorId },
        }),
        [projectId, vendorId]
    );

    const isLoadingOverall = isDataLoading || isProjectsLoading || isVendorsLoading;

    return (
        <div
            className={cn(
                "flex flex-col gap-2 overflow-hidden",
                totalCount > 10 ? "h-[calc(100vh-80px)]" : totalCount > 0 ? "h-auto" : ""
            )}
        >
            {isLoadingOverall && !data?.length ? (
                <TableSkeleton />
            ) : (
                <DataTable<PaymentTDSDeductionRow>
                    table={table}
                    columns={columns}
                    isLoading={isLoadingOverall}
                    error={error as Error | null}
                    totalCount={totalCount}
                    searchFieldOptions={PAYMENT_TDS_SEARCHABLE_FIELDS}
                    selectedSearchField={selectedSearchField}
                    onSelectedSearchFieldChange={setSelectedSearchField}
                    searchTerm={searchTerm}
                    onSearchTermChange={setSearchTerm}
                    facetDoctype={DOCTYPE}
                    facetOverrides={facetOverrides}
                    dateFilterColumns={PAYMENT_TDS_DATE_COLUMNS}
                    showExportButton={true}
                    onExport={"default"}
                    onExportAll={exportAllRows}
                    isExporting={isExporting}
                    exportFileName={DOCTYPE}
                    showRowSelection={false}
                    getRowClassName={getRowClassName}
                    summaryCard={
                        <PaymentTDSSummaryCard
                            aggregates={aggregates}
                            isAggregatesLoading={isAggregatesLoading}
                            totalCount={totalCount}
                            columnFilters={columnFilters}
                            searchTerm={searchTerm}
                        />
                    }
                />
            )}
        </div>
    );
};

export default PaymentTDSDeductions;
