/**
 * Table for displaying pending vendor invoices awaiting approval.
 *
 * Updated to use Vendor Invoices doctype.
 */
import React, { useCallback, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { useInvoiceTaskActions } from "../hooks/useInvoiceTaskActions";
import { getPendingTaskColumns } from "./columns";
import { ConfirmationDialog } from "@/pages/ProcurementRequests/ApproveVendorQuotes/components/ConfirmationDialog";
import { InvoiceRejectionDialog } from "./InvoiceRejectionDialog";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { NirmaanAttachment } from "@/types/NirmaanStack/NirmaanAttachment";
import { useServerDataTable } from "@/hooks/useServerDataTable";
import { VendorInvoice } from "@/types/NirmaanStack/VendorInvoice";
import {
    DEFAULT_VENDOR_INVOICE_FIELDS_TO_FETCH,
    getVendorInvoiceStaticFilters,
    VENDOR_INVOICE_DATE_COLUMNS,
    VENDOR_INVOICE_SEARCHABLE_FIELDS,
} from "../config/InvoiceTaskTable.config";
import { VENDOR_INVOICES_DOCTYPE } from "../constants";
import { TableSkeleton } from "@/components/ui/skeleton";
import { DataTable } from "@/components/data-table/new-data-table";
import { useUserData } from "@/hooks/useUserData";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { useOrderTotals } from "@/hooks/useOrderTotals";
import { useOrderPayments } from "@/hooks/useOrderPayments";
import { useCEOHoldProjects } from "@/hooks/useCEOHoldProjects";
import { CEO_HOLD_ROW_CLASSES } from "@/utils/ceoHoldRowStyles";

const URL_SYNC_KEY = "inv_pending";

export const PendingTasksTable: React.FC = () => {
    const { role, user_id } = useUserData();
    const { ceoHoldProjectIds } = useCEOHoldProjects();

    const getRowClassName = useCallback(
        (row: any) => {
            const projectId = row.original.project;
            if (projectId && ceoHoldProjectIds.has(projectId)) {
                return CEO_HOLD_ROW_CLASSES;
            }
            return undefined;
        },
        [ceoHoldProjectIds]
    );

    // --- Fetch Attachments (Supporting Data) ---
    const [attachmentIds, setAttachmentIds] = React.useState<string[]>([]);
    const {
        data: attachmentsData,
        isLoading: attachmentsLoading,
        error: attachmentsError,
    } = useFrappeGetDocList<NirmaanAttachment>(
        "Nirmaan Attachments",
        {
            fields: ["name", "attachment"],
            filters: attachmentIds.length > 0 ? [["name", "in", attachmentIds]] : [],
            limit: attachmentIds.length || 1,
        },
        attachmentIds.length > 0
            ? `attachments_for_pending_invoices_${attachmentIds.join("_")}`
            : null
    );

    const attachmentsMap = useMemo(() => {
        if (!attachmentsData) return {};
        return attachmentsData.reduce((acc, item) => {
            if (item.name && item.attachment) acc[item.name] = item.attachment;
            return acc;
        }, {} as Record<string, string>);
    }, [attachmentsData]);

    // --- Action Handling ---
    const {
        openConfirmationDialog,
        closeConfirmationDialog,
        onConfirmAction,
        confirmationState,
        loadingInvoiceId,
        isProcessing,
    } = useInvoiceTaskActions({});

    const { getTotalAmount, getDeliveredAmount, getVendorName } = useOrderTotals();
    const { getAmount } = useOrderPayments();

    // --- Column Definitions ---
    const columns = React.useMemo(
        () =>
            getPendingTaskColumns(
                openConfirmationDialog,
                loadingInvoiceId,
                isProcessing,
                attachmentsMap,
                getTotalAmount,
                getAmount,
                getDeliveredAmount,
                getVendorName
            ),
        [
            openConfirmationDialog,
            loadingInvoiceId,
            isProcessing,
            attachmentsMap,
            getTotalAmount,
            getAmount,
            getDeliveredAmount,
            getVendorName,
        ]
    );

    const staticFilters = useMemo(
        () => getVendorInvoiceStaticFilters("Pending", role, user_id),
        [role, user_id]
    );

    const fetchFields = useMemo(() => DEFAULT_VENDOR_INVOICE_FIELDS_TO_FETCH, []);
    const searchableFields = useMemo(() => VENDOR_INVOICE_SEARCHABLE_FIELDS, []);

    // --- Main Data Table Hook ---
    const {
        table,
        data: invoices,
        totalCount,
        isLoading: listIsLoading,
        error: listError,
        searchTerm,
        setSearchTerm,
        selectedSearchField,
        setSelectedSearchField,
        refetch,
    } = useServerDataTable<VendorInvoice>({
        doctype: VENDOR_INVOICES_DOCTYPE,
        columns: columns,
        fetchFields: fetchFields,
        searchableFields: searchableFields,
        urlSyncKey: URL_SYNC_KEY,
        defaultSort: "modified desc",
        additionalFilters: staticFilters,
        enableRowSelection: false,
    });

    // Effect to extract attachment IDs from fetched invoices
    useEffect(() => {
        if (invoices && invoices.length > 0) {
            const ids = invoices
                .map((invoice) => invoice?.invoice_attachment)
                .filter((id): id is string => typeof id === "string" && id.length > 0);
            if (ids.length > 0) {
                setAttachmentIds((currentIds) => {
                    const newIdsSet = new Set(ids);
                    const currentIdsSet = new Set(currentIds);
                    if (
                        newIdsSet.size === currentIdsSet.size &&
                        [...newIdsSet].every((id) => currentIdsSet.has(id))
                    ) {
                        return currentIds;
                    }
                    return ids;
                });
            } else {
                setAttachmentIds([]);
            }
        } else {
            setAttachmentIds([]);
        }
    }, [invoices]);

    const isLoadingOverall = attachmentsLoading;
    const combinedError = listError || attachmentsError;

    if (combinedError) {
        return <AlertDestructive error={combinedError} />;
    }

    return (
        <div
            className={cn(
                "flex flex-col gap-2 mt-6 overflow-hidden",
                totalCount > 10
                    ? "h-[calc(100vh-150px)]"
                    : totalCount > 0
                        ? "h-auto"
                        : ""
            )}
        >
            {isLoadingOverall && !invoices?.length ? (
                <TableSkeleton />
            ) : (
                <DataTable<VendorInvoice>
                    table={table}
                    columns={columns}
                    isLoading={listIsLoading}
                    error={listError}
                    totalCount={totalCount}
                    searchFieldOptions={searchableFields}
                    selectedSearchField={selectedSearchField}
                    onSelectedSearchFieldChange={setSelectedSearchField}
                    searchTerm={searchTerm}
                    onSearchTermChange={setSearchTerm}
                    dateFilterColumns={VENDOR_INVOICE_DATE_COLUMNS}
                    showExportButton={true}
                    onExport={"default"}
                    exportFileName="Pending_Vendor_Invoices"
                    getRowClassName={getRowClassName}
                />
            )}

            {/* Approval Dialog */}
            {confirmationState.action === "Approved" && (
                <ConfirmationDialog
                    isOpen={confirmationState.isOpen}
                    onClose={closeConfirmationDialog}
                    onConfirm={async () => {
                        await onConfirmAction();
                        refetch();
                    }}
                    isLoading={loadingInvoiceId === confirmationState.invoiceId}
                    title="Confirm Approval"
                    confirmText="Approve"
                    confirmVariant="default"
                >
                    <p className="text-sm text-muted-foreground text-center pt-2">
                        Are you sure you want to{" "}
                        <strong className="text-primary">Approve</strong> invoice{" "}
                        <strong>
                            {confirmationState.invoiceNo || confirmationState.invoiceId}
                        </strong>
                        ?
                    </p>
                </ConfirmationDialog>
            )}

            {/* Rejection Dialog */}
            {confirmationState.action === "Rejected" && (
                <InvoiceRejectionDialog
                    isOpen={confirmationState.isOpen}
                    onClose={closeConfirmationDialog}
                    onConfirm={async (rejectionReason) => {
                        await onConfirmAction(rejectionReason);
                        refetch();
                    }}
                    isLoading={loadingInvoiceId === confirmationState.invoiceId}
                    invoiceNo={confirmationState.invoiceNo}
                />
            )}
        </div>
    );
};

export default PendingTasksTable;
