/**
 * Table for displaying vendor invoice history (all statuses).
 *
 * Updated to use Vendor Invoices doctype.
 */
import React, { useCallback, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { getTaskHistoryColumns } from "./columns";
import { useUsersList } from "@/pages/ProcurementRequests/ApproveNewPR/hooks/useUsersList";
import {
    DEFAULT_VENDOR_INVOICE_FIELDS_TO_FETCH,
    getVendorInvoiceStaticFilters,
    VENDOR_INVOICE_DATE_COLUMNS,
    VENDOR_INVOICE_SEARCHABLE_FIELDS,
} from "../config/InvoiceTaskTable.config";
import { VENDOR_INVOICES_DOCTYPE } from "../constants";
import { useUserData } from "@/hooks/useUserData";
import { NirmaanAttachment } from "@/types/NirmaanStack/NirmaanAttachment";
import { useFrappePostCall } from "frappe-react-sdk";
import { VendorInvoice } from "@/types/NirmaanStack/VendorInvoice";
import { useServerDataTable } from "@/hooks/useServerDataTable";
import { DataTable } from "@/components/data-table/new-data-table";
import { TableSkeleton } from "@/components/ui/skeleton";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { useOrderTotals } from "@/hooks/useOrderTotals";
import { useOrderPayments } from "@/hooks/useOrderPayments";

const URL_SYNC_KEY = "inv_history";

export const TaskHistoryTable: React.FC = () => {
    const { role, user_id } = useUserData();

    const { data: usersList } = useUsersList();

    const { getTotalAmount, getDeliveredAmount, getVendorName } = useOrderTotals();
    const { getAmount } = useOrderPayments();

    const [attachmentIds, setAttachmentIds] = React.useState<string[]>([]);
    const [attachmentsData, setAttachmentsData] = React.useState<NirmaanAttachment[] | undefined>(undefined);

    const {
        call: fetchAttachments,
        loading: attachmentsLoading,
        error: attachmentsError,
    } = useFrappePostCall<{ message: NirmaanAttachment[] }>(
        "nirmaan_stack.api.tasks.attachment_names.get_attachments_by_name"
    );

    // Fetch attachments when IDs change
    useEffect(() => {
        const performFetch = async () => {
            if (attachmentIds && attachmentIds.length > 0) {
                try {
                    const response = await fetchAttachments({
                        attachment_names: attachmentIds,
                    });
                    setAttachmentsData((response as any)?.message as NirmaanAttachment[] | undefined);
                } catch (err) {
                    console.error("An error occurred while calling fetchAttachments:", err);
                }
            }
        };

        performFetch();
    }, [attachmentIds, fetchAttachments]);

    const attachmentsMap = useMemo(() => {
        if (!attachmentsData && !attachmentsLoading) {
            return {};
        }

        let parsedData = attachmentsData || [];
        if (!Array.isArray(parsedData)) return {};

        return parsedData.reduce((acc, item) => {
            if (item && item.name && item.attachment) {
                acc[item.name] = item.attachment;
            }
            return acc;
        }, {} as Record<string, string>);
    }, [attachmentsData, attachmentsLoading]);

    const getUserName = useCallback(
        (id: string | undefined): string => {
            if (!id) return "";
            if (id === "Administrator") return "Administrator";
            return usersList?.find((user) => user.name === id)?.full_name || id;
        },
        [usersList]
    );

    const staticFilters = useMemo(
        () => getVendorInvoiceStaticFilters("", role, user_id),
        [role, user_id]
    );

    const fetchFields = useMemo(() => [
        ...DEFAULT_VENDOR_INVOICE_FIELDS_TO_FETCH,
        "rejection_reason",
    ], []);

    const searchableFields = useMemo(
        () =>
            VENDOR_INVOICE_SEARCHABLE_FIELDS.concat([
                {
                    value: "approved_by",
                    label: "Actioned By",
                    placeholder: "Search by Approver...",
                },
                {
                    value: "status",
                    label: "Status",
                    placeholder: "Search by Status...",
                },
            ]),
        []
    );

    // Columns for history view
    const columns = React.useMemo(
        () =>
            getTaskHistoryColumns(
                getUserName,
                attachmentsMap,
                getTotalAmount,
                getDeliveredAmount,
                getAmount,
                getVendorName
            ),
        [
            getUserName,
            attachmentsMap,
            getTotalAmount,
            getAmount,
            getDeliveredAmount,
            getVendorName,
        ]
    );

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
                    exportFileName="Vendor_Invoices_History"
                />
            )}
        </div>
    );
};

export default TaskHistoryTable;
