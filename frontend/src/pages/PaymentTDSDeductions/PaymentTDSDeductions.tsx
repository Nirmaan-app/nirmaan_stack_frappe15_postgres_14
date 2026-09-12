/**
 * Reports > "Payment TDS Deduction" tab — the Tax Deducted at Source ledger, one row per deducted
 * payment. It had a sidebar item and a `/payment-tds-deductions` route of its own until it moved
 * into the Reports hub; that path is now a redirect into the tab, so old links still work.
 *
 * ⚠️ "TDS" HERE IS **TAX DEDUCTED AT SOURCE**, NOT the Technical Data Sheet family that owns
 * `/tds-repository` and `/tds-approval` in the sidebar. The tab label and the old route name are
 * spelled out in full for exactly that reason.
 *
 * READ-ONLY BY DESIGN. Rows are written by `services/payment_tds.py` when an SR-backed payment
 * reaches `Approved`, and a deduction has no reversal (owner ruling 2026-09-10) — it is deleted
 * with the payment it belongs to. So there is no create, edit or delete affordance here, and
 * adding one would need the reversal path that deliberately does not exist yet.
 */

import React, { useCallback, useMemo, useState } from "react";
import { FrappeDoc, GetDocListArgs, useFrappeGetDocList } from "frappe-react-sdk";
import { Row } from "@tanstack/react-table";
import memoize from "lodash/memoize";
import { BadgeIndianRupee } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
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
    PAYMENT_TDS_HIDDEN_COLUMNS,
    PAYMENT_TDS_SEARCHABLE_FIELDS,
    getPaymentTdsColumns,
    PaymentTDSDeductionRow,
} from "./config/paymentTdsDeductions.config";
import { PaymentTDSSummaryCard } from "./components/PaymentTDSSummaryCard";
import { PayTdsDialog } from "./components/PayTdsDialog";

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
        refetch,
    } = useServerDataTable<PaymentTDSDeductionRow>({
        doctype: DOCTYPE,
        columns,
        fetchFields: PAYMENT_TDS_FIELDS_TO_FETCH,
        searchableFields: PAYMENT_TDS_SEARCHABLE_FIELDS,
        additionalFilters: staticFilters,
        urlSyncKey: urlSyncKey ?? `payment_tds_${projectId || vendorId || "all"}`,
        // The day the payment was approved, newest first -- `creation` would sort the 629
        // backfilled rows by the day the patch ran, which is the same day for all of them.
        defaultSort: "payment_approved_on desc",
        aggregatesConfig: PAYMENT_TDS_AGGREGATES_CONFIG,
        // ⚠️ ONLY A `Pending` DEDUCTION IS SELECTABLE. DataTable renders each row's checkbox with
        // `disabled={!row.getCanSelect()}`, so an already-paid row cannot be ticked at all -- and
        // TanStack's select-all skips it too, which is what stops a header click from sweeping paid
        // rows into a second payment. A blank reads as Pending, matching the Status column.
        enableRowSelection: (row) => (row.original.status || "Pending") === "Pending",
        // Project / Payment / Gross Amount / Net Paid start hidden -- see the const's own note for
        // why, and for the Project-facet consequence. INITIAL state only: the "View" menu still
        // toggles them, per user.
        initialState: { columnVisibility: PAYMENT_TDS_HIDDEN_COLUMNS },
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

    // --- Pay TDS selection ---
    // Read straight off the table rather than mirrored into page state: `rowSelection` lives in the
    // hook, and a second copy here could disagree with the checkboxes after a refetch.
    const selectedRows = table.getSelectedRowModel().rows;
    const selectedCount = selectedRows.length;
    const selectedDeductions = useMemo(
        () => selectedRows.map((row) => row.original),
        [selectedRows]
    );
    // Shown on the button so the figure you are about to pay is visible BEFORE the dialog opens —
    // rounded, because paise on a toolbar button is noise. The dialog and the server both carry the
    // exact figure.
    const selectedTdsTotal = useMemo(
        () => selectedDeductions.reduce((sum, row) => sum + (row.tds_amount || 0), 0),
        [selectedDeductions]
    );
    const [isPayTdsOpen, setIsPayTdsOpen] = useState(false);

    // After a successful payment the ticked rows are no longer Pending, so the selection would be
    // stale: clear it, then re-read so their Status flips to Paid on screen.
    const handlePaid = useCallback(() => {
        table.resetRowSelection();
        refetch();
    }, [table, refetch]);

    return (
        <div
            className={cn(
                "flex flex-col gap-2 overflow-hidden",
                // 130px, not 80: inside the Reports hub the tab strip + report-type row sit above
                // this table, so the 80px of the old standalone route overflowed the viewport.
                // Matches its sibling tabs (CustomerReports, VendorReports).
                totalCount > 10 ? "h-[calc(100vh-130px)]" : totalCount > 0 ? "h-auto" : ""
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
                    // ⚠️ TURNING THIS ON ALSO RE-AIMS THE EXPORT BUTTON. DataTable gates both the
                    // checkbox column and Export on this ONE prop: with it true, Export writes the
                    // SELECTED rows and sits disabled while nothing is ticked. Splitting them would
                    // mean editing the shared DataTable, which four other pages rely on.
                    showRowSelection={true}
                    toolbarActions={
                        <Button
                            size="sm"
                            variant="default"
                            className="bg-blue-600 hover:bg-blue-700"
                            disabled={selectedCount === 0}
                            onClick={() => setIsPayTdsOpen(true)}
                        >
                            <BadgeIndianRupee className="h-3.5 w-3.5 mr-1.5" />
                            Pay TDS
                            {selectedCount > 0
                                ? ` (${selectedCount}) · ${formatToRoundedIndianRupee(selectedTdsTotal)}`
                                : ""}
                        </Button>
                    }
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

            <PayTdsDialog
                open={isPayTdsOpen}
                onOpenChange={setIsPayTdsOpen}
                deductions={selectedDeductions}
                onPaid={handlePaid}
            />
        </div>
    );
};

export default PaymentTDSDeductions;
