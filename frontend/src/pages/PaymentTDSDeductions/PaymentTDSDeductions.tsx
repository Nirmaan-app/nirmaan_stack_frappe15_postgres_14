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
 *
 * SPLIT INTO **Pending / Paid** SUB-TABS. The two halves are read for different reasons — Pending
 * is a worklist (what still has to be remitted, and the only thing `Pay TDS` can act on), Paid is
 * an archive — and one mixed table made the worklist a filtering exercise. Each tab is a SEPARATE
 * table instance with its own URL-sync namespace, so a filter, sort or page set on one does not
 * follow you to the other.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
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
import { getUrlStringParam, useServerDataTable } from "@/hooks/useServerDataTable";
import { useCounts, CountSpec } from "@/hooks/useCounts";
import { useCEOHoldProjects } from "@/hooks/useCEOHoldProjects";
import { CEO_HOLD_ROW_CLASSES } from "@/utils/ceoHoldRowStyles";
import { getProjectListOptions, queryKeys } from "@/config/queryKeys";
import { urlStateManager } from "@/utils/urlStateManager";
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

/** The two halves of the ledger. Mirrors the doctype's `status` Select, which has exactly these
 *  two options and defaults to `Pending`. */
export type TdsLedgerTab = "Pending" | "Paid";
const TDS_TABS: TdsLedgerTab[] = ["Pending", "Paid"];

/** ⚠️ NOT `tab` — the Reports hub owns that param for its own top-level tab strip
 *  (ReportsContainer reads and writes it), so this one has to be namespaced or the two would
 *  overwrite each other on every click. */
const TAB_URL_PARAM = "tds_tab";

/**
 * The Pending half is `status != Paid`, NOT `status = Pending`.
 *
 * A blank reads as Pending everywhere else on this screen (the Status cell and the Pay-TDS
 * selection gate both say so), and `!=` keeps that true: Frappe compiles it to
 * `ifnull(status, '') != 'Paid'`, so a NULL or empty row stays in the worklist and stays payable.
 * `= Pending` would drop such a row out of BOTH tabs and strand it. The two filters are exact
 * complements, so every row is in exactly one tab.
 */
const tabStatusFilter = (tab: TdsLedgerTab): [string, string, string] =>
    tab === "Paid" ? ["status", "=", "Paid"] : ["status", "!=", "Paid"];

interface PaymentTDSDeductionsProps {
    /** Scope to one project (for a future embed on the project page). */
    projectId?: string;
    /** Scope to one vendor (for a future embed on the vendor page). */
    vendorId?: string;
    /** Override the URL-sync namespace so an embedded instance keeps its own table state. */
    urlSyncKey?: string;
}

interface PaymentTDSLedgerTableProps {
    tab: TdsLedgerTab;
    /** Already namespaced per tab by the parent. */
    urlSyncKey: string;
    staticFilters: Array<[string, string, string]>;
    columns: ReturnType<typeof getPaymentTdsColumns>;
    getRowClassName: (row: Row<PaymentTDSDeductionRow>) => string | undefined;
    facetOverrides: FacetOverrides;
    isLookupsLoading: boolean;
    /** Paid rows leave this tab, so the parent's tab badges have to be re-counted. */
    onPaid: () => void;
}

/**
 * ONE tab's table. Split out of the page so each tab gets its OWN `useServerDataTable` instance:
 * the hook seeds pagination, sorting and filters from `urlSyncKey` at mount and never re-reads
 * them, so swapping the key on a live instance would leave it holding the other tab's state.
 * The parent remounts this with `key={tab}` instead, which is also what clears a stale selection.
 */
const PaymentTDSLedgerTable: React.FC<PaymentTDSLedgerTableProps> = ({
    tab,
    urlSyncKey,
    staticFilters,
    columns,
    getRowClassName,
    facetOverrides,
    isLookupsLoading,
    onPaid,
}) => {
    const isPendingTab = tab === "Pending";

    const additionalFilters = useMemo(
        () => [...staticFilters, tabStatusFilter(tab)],
        [staticFilters, tab]
    );

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
        additionalFilters,
        urlSyncKey,
        // The day the payment was approved, newest first -- `creation` would sort the 629
        // backfilled rows by the day the patch ran, which is the same day for all of them.
        defaultSort: "payment_approved_on desc",
        aggregatesConfig: PAYMENT_TDS_AGGREGATES_CONFIG,
        // ⚠️ ONLY A `Pending` DEDUCTION IS SELECTABLE. The Paid tab cannot contain one, so its
        // selection is off entirely (see `showRowSelection` below); the predicate stays on the
        // Pending tab as the belt-and-braces gate, because a blank status lands there too.
        enableRowSelection: isPendingTab
            ? (row) => (row.original.status || "Pending") === "Pending"
            : false,
        initialState: {
            // 100 rows, not the hook's default 50 -- a TDS run is read in bulk, and this is a
            // SEED only: `<syncKey>_pageSize` in the URL wins, so a size the user picks (and any
            // bookmarked link) survives.
            pagination: { pageIndex: 0, pageSize: 100 },
            // Project / Payment / Gross Amount / Net Paid start hidden -- see the const's own note
            // for why, and for the Project-facet consequence. INITIAL state only: the "View" menu
            // still toggles them, per user.
            //
            // `status` joins them HERE because the tab already states it -- every row in this
            // table carries the same value, so the column would be a constant. It is initial state
            // like the rest, so "View" brings it back, and the CSV export still carries it either
            // way (export reads the column DEFINITIONS, not what is on screen).
            columnVisibility: { ...PAYMENT_TDS_HIDDEN_COLUMNS, status: false },
        },
    });

    // After a successful payment the ticked rows are no longer Pending, so the selection would be
    // stale: clear it, then re-read so they drop out of this tab and into Paid.
    const handlePaid = useCallback(() => {
        table.resetRowSelection();
        refetch();
        onPaid();
    }, [table, refetch, onPaid]);

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

    const isLoadingOverall = isDataLoading || isLookupsLoading;

    if (isLoadingOverall && !data?.length) {
        return <TableSkeleton />;
    }

    return (
        <>
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
                exportFileName={`${DOCTYPE} - ${tab}`}
                // ⚠️ THIS ONE PROP ALSO AIMS THE EXPORT BUTTON. DataTable gates both the checkbox
                // column and Export on it: true (Pending) means Export writes the SELECTED rows and
                // sits disabled while nothing is ticked; false (Paid) means Export falls through to
                // `onExportAll` and writes the whole filtered set. That is the behaviour each tab
                // wants -- but it is a coupling, not two independent switches, and splitting them
                // would mean editing the shared DataTable that four other pages rely on.
                showRowSelection={isPendingTab}
                toolbarActions={
                    isPendingTab ? (
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
                    ) : undefined
                }
                getRowClassName={getRowClassName}
                summaryCard={
                    <PaymentTDSSummaryCard
                        aggregates={aggregates}
                        isAggregatesLoading={isAggregatesLoading}
                        totalCount={totalCount}
                        columnFilters={columnFilters}
                        searchTerm={searchTerm}
                        // Same number, different meaning per tab: still owed to the department
                        // vs already remitted under a challan.
                        label={isPendingTab ? "TDS Withheld" : "TDS Paid"}
                    />
                }
            />

            {isPendingTab && (
                <PayTdsDialog
                    open={isPayTdsOpen}
                    onOpenChange={setIsPayTdsOpen}
                    deductions={selectedDeductions}
                    onPaid={handlePaid}
                />
            )}
        </>
    );
};

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

    // --- Tab state, synced to the URL so a tab is linkable and survives a refresh ---
    const [tab, setTab] = useState<TdsLedgerTab>(
        () => (getUrlStringParam(TAB_URL_PARAM, "Pending") === "Paid" ? "Paid" : "Pending")
    );

    useEffect(() => {
        if (urlStateManager.getParam(TAB_URL_PARAM) !== tab) {
            urlStateManager.updateParam(TAB_URL_PARAM, tab);
        }
    }, [tab]);

    // Back/forward and direct links write the param from outside React; anything that is not
    // exactly "Paid" (including the param being removed) lands on Pending, the worklist.
    useEffect(
        () =>
            urlStateManager.subscribe(TAB_URL_PARAM, (_, value) =>
                setTab(value === "Paid" ? "Paid" : "Pending")
            ),
        []
    );

    // --- Tab badges ---
    // ONE grouped round-trip rather than a count call per tab. It carries the same project/vendor
    // scoping as the tables but NOT their search or facet filters, so a badge is the size of the
    // whole tab -- which is what you want while standing on the other one.
    const countSpecs = useMemo<CountSpec[]>(
        () => [
            {
                key: "byStatus",
                doctype: DOCTYPE,
                filters: staticFilters.length ? staticFilters : undefined,
                group_field: "status",
            },
        ],
        [staticFilters]
    );
    const { data: countsData, mutate: mutateCounts } = useCounts(
        countSpecs,
        `payment_tds_status_counts:${projectId || ""}:${vendorId || ""}`
    );

    const tabCounts = useMemo<Record<TdsLedgerTab, number>>(() => {
        const byStatus = (countsData?.message?.byStatus ?? {}) as Record<string, number>;
        const paid = byStatus["Paid"] || 0;
        // Everything that is not Paid, not just the rows literally reading "Pending" -- the badge
        // has to agree with the tab's `status != Paid` filter, blanks and all.
        const pending = Object.entries(byStatus).reduce(
            (sum, [status, count]) => (status === "Paid" ? sum : sum + (count || 0)),
            0
        );
        return { Pending: pending, Paid: paid };
    }, [countsData]);

    // Facet scope: when the table is already pinned to one project (or vendor), that column's
    // facet is hidden rather than rendered with a single option. `status` is off on both tabs --
    // the tab IS the status filter, and a facet fighting it could only ever empty the table.
    const facetOverrides = useMemo<FacetOverrides>(
        () => ({
            project: { enabled: !projectId },
            vendor: { enabled: !vendorId },
            status: { enabled: false },
        }),
        [projectId, vendorId]
    );

    const baseSyncKey = urlSyncKey ?? `payment_tds_${projectId || vendorId || "all"}`;

    return (
        <div
            className={cn(
                "flex flex-col gap-2 overflow-hidden",
                // 170px, not the old 130: the tab strip below now sits between the Reports hub's
                // own tabs + report-type row and this table, and the height has to pay for it or
                // the last row falls past the viewport.
                "h-[calc(100vh-170px)]"
            )}
        >
            {/* Tab strip -- same chip idiom as the Project Payments tabs. */}
            <div className="flex flex-nowrap items-center gap-1.5 flex-shrink-0">
                {TDS_TABS.map((option) => {
                    const isActive = tab === option;
                    return (
                        <button
                            key={option}
                            type="button"
                            onClick={() => setTab(option)}
                            className={cn(
                                "px-2.5 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm rounded",
                                "transition-colors flex items-center gap-1.5 whitespace-nowrap",
                                isActive
                                    ? "bg-sky-500 text-white"
                                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                            )}
                        >
                            {option}
                            <span
                                className={cn(
                                    "text-xs font-bold tabular-nums",
                                    isActive ? "opacity-90" : "opacity-70"
                                )}
                            >
                                {tabCounts[option]}
                            </span>
                        </button>
                    );
                })}
            </div>

            {/* `key` forces a fresh table per tab -- see PaymentTDSLedgerTable's own note. */}
            <PaymentTDSLedgerTable
                key={tab}
                tab={tab}
                urlSyncKey={`${baseSyncKey}_${tab.toLowerCase()}`}
                staticFilters={staticFilters}
                columns={columns}
                getRowClassName={getRowClassName}
                facetOverrides={facetOverrides}
                isLookupsLoading={isProjectsLoading || isVendorsLoading}
                onPaid={mutateCounts}
            />
        </div>
    );
};

export default PaymentTDSDeductions;
