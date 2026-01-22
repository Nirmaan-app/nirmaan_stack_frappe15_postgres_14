/**
 * Hook for fetching vendor invoices.
 *
 * Renamed from useInvoiceTasks but kept the same file name for backward compatibility.
 * Now fetches from Vendor Invoices doctype instead of Task.
 */
import { Filter, FrappeDoc, useFrappeGetDocList } from 'frappe-react-sdk';
import { VendorInvoice } from '@/types/NirmaanStack/VendorInvoice';
import { NirmaanAttachment } from '@/types/NirmaanStack/NirmaanAttachment';
import { useMemo } from 'react';
import { useUserData } from '@/hooks/useUserData';
import { VENDOR_INVOICES_DOCTYPE } from '../constants';

type StatusFilter = 'Pending' | '!= Pending';

interface UseVendorInvoicesResult {
    invoices: VendorInvoice[] | null;
    /** @deprecated Use invoices instead */
    tasks: VendorInvoice[] | null;
    isLoading: boolean;
    error: Error | null;
    attachmentsMap?: Record<string, string>;
    mutateInvoices: () => Promise<any>;
    /** @deprecated Use mutateInvoices instead */
    mutateTasks: () => Promise<any>;
}

/**
 * Hook to fetch vendor invoices with optional status filtering.
 *
 * @param statusFilter - 'Pending' for pending invoices, '!= Pending' for history
 */
export const useInvoiceTasks = (statusFilter: StatusFilter): UseVendorInvoicesResult => {
    const { role, user_id } = useUserData();
    const isProcurementUser = role === "Nirmaan Procurement Executive Profile";

    // Build filters for Vendor Invoices
    const invoiceFilters: Filter<FrappeDoc<VendorInvoice>>[] = [
        statusFilter === 'Pending'
            ? ["status", "=", "Pending"]
            : ["status", "in", ["Pending", "Approved", "Rejected"]],
    ];

    // Conditionally add the owner filter for procurement users
    if (isProcurementUser && user_id) {
        invoiceFilters.push(["owner", "=", user_id]);
    }

    const {
        data,
        isLoading,
        error,
        mutate,
    } = useFrappeGetDocList<VendorInvoice>(VENDOR_INVOICES_DOCTYPE, {
        fields: [
            "name",
            "creation",
            "modified",
            "owner",
            "document_type",
            "document_name",
            "project",
            "vendor",
            "invoice_no",
            "invoice_date",
            "invoice_amount",
            "invoice_attachment",
            "status",
            "uploaded_by",
            "approved_by",
            "approved_on",
            "rejection_reason",
        ],
        filters: invoiceFilters,
        limit: 100000,
        orderBy: { field: "modified", order: "desc" }
    });

    // Prepare attachment filters
    const attachmentIds = useMemo<string[]>(() => {
        return (data
            ?.map(invoice => invoice?.invoice_attachment)
            .filter((id): id is string => typeof id === 'string' && id.length > 0)
            ?? []) as string[];
    }, [data]);

    const shouldFetchAttachments = attachmentIds.length > 0;

    const attachmentFilters = shouldFetchAttachments
        ? [["name", "in", attachmentIds] as Filter<FrappeDoc<NirmaanAttachment>>]
        : [];

    const { data: attachments, isLoading: attachmentsLoading } = useFrappeGetDocList<NirmaanAttachment>(
        "Nirmaan Attachments",
        {
            fields: ["name", "attachment", "attachment_link_doctype", "attachment_link_docname"],
            filters: attachmentFilters,
            limit: 1000,
        },
        `attachments_for_${statusFilter}_invoices`
    );

    const attachmentsMap = useMemo(() => {
        if (!attachments) {
            return {};
        }
        return attachments.reduce((acc, item) => {
            if (item?.name && item.attachment) {
                acc[item.name] = item.attachment;
            }
            return acc;
        }, {} as Record<string, string>);
    }, [attachments]);

    const typedError = error instanceof Error ? error : null;

    return {
        invoices: data || null,
        tasks: data || null, // Backward compatibility
        attachmentsMap,
        isLoading: isLoading || attachmentsLoading,
        error: typedError,
        mutateInvoices: mutate,
        mutateTasks: mutate, // Backward compatibility
    };
};

/**
 * Alias for useInvoiceTasks with a more descriptive name.
 * @param statusFilter - 'Pending' for pending invoices, '!= Pending' for history
 */
export const useVendorInvoices = useInvoiceTasks;
