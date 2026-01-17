import { useFrappeGetCall, useFrappeGetDocList } from 'frappe-react-sdk';
import { useMemo } from 'react';
import { Projects } from '@/types/NirmaanStack/Projects';
import { Vendors } from '@/types/NirmaanStack/Vendors';
import { NirmaanUsers } from '@/types/NirmaanStack/NirmaanUsers';
import { NirmaanAttachment } from '@/types/NirmaanStack/NirmaanAttachment';

// Reconciliation status type (matches invoices tab)
type ReconciliationStatus = "" | "partial" | "full";

// Interface for individual invoice item from API
interface InvoiceItem {
    name: string;
    amount: number;
    reconciled_amount: number;
    invoice_no: string;
    date: string;
    updated_by: string;
    invoice_attachment_id: string;
    procurement_order: string;
    project?: string;
    vendor: string;
    vendor_name: string;
    // New reconciliation fields (replaces is_2b_activated)
    reconciliation_status?: ReconciliationStatus;
    reconciled_date?: string | null;
    reconciled_by?: string | null;
    reconciliation_proof_attachment_id?: string | null;
    // Legacy field (deprecated - use reconciliation_status)
    is_2b_activated?: boolean;
}

// API response structure
interface AllInvoicesDataCallResponse {
    message: {
        message: {
            invoice_entries: InvoiceItem[];
            total_invoices: number;
            total_amount: number;
            // New reconciliation metrics
            total_fully_reconciled: number;
            total_partially_reconciled: number;
            pending_reconciliation: number;
            total_reconciled_amount: number;
            total_fully_reconciled_amount: number;
            total_partially_reconciled_amount: number;
            total_not_reconciled_amount: number;
            pending_reconciliation_amount: number;
            // Legacy fields (deprecated)
            total_2b_activated: number;
            pending_2b_activation: number;
        };
        status: number;
    };
}

// Row data structure for the table
export interface PO2BReconcileRowData {
    name: string;              // Generated unique ID (PO-InvoiceNo-index)
    poId: string;              // procurement_order
    projectId: string;
    projectName: string;
    vendorId: string;
    vendorName: string;
    invoiceNo: string;
    invoiceDate: string;
    invoiceAmount: number;
    // New reconciliation fields
    reconciledAmount: number;
    reconciliationStatus: ReconciliationStatus;  // "", "partial", "full"
    proofAttachmentId: string | null;
    proofAttachmentUrl: string | null;
    // Legacy field (deprecated - use reconciliationStatus)
    is2bActivated: boolean;
    reconciledDate: string | null;
    reconciledBy: string | null;
    reconciledByName: string | null;
    invoiceAttachmentId: string;
    updatedBy: string;
    updatedByName: string;
    attachmentUrl: string | null;
}

interface UsePO2BReconcileDataResult {
    reportData: PO2BReconcileRowData[] | null;
    isLoading: boolean;
    error: Error | null;
    mutate: () => Promise<any>;
    summary: {
        totalInvoices: number;
        totalAmount: number;
        total2bActivated: number;
        pending2bActivation: number;
    } | null;
}

export const usePO2BReconcileData = (): UsePO2BReconcileDataResult => {
    // Fetch all PO invoices
    const { data: invoicesData, isLoading: invoicesLoading, error: invoicesError, mutate } = useFrappeGetCall<AllInvoicesDataCallResponse>(
        "nirmaan_stack.api.invoices.po_wise_invoice_data.generate_all_po_invoice_data",
    );

    // Fetch all projects for name lookup
    const { data: projects, isLoading: projectsLoading } = useFrappeGetDocList<Projects>("Projects", {
        fields: ['name', 'project_name'],
        limit: 0,
    });

    // Fetch all vendors for name lookup
    const { data: vendors, isLoading: vendorsLoading } = useFrappeGetDocList<Vendors>("Vendors", {
        fields: ["name", "vendor_name"],
        limit: 0,
    });

    // Fetch all users for name lookup
    const { data: users, isLoading: usersLoading } = useFrappeGetDocList<NirmaanUsers>("Nirmaan Users", {
        fields: ["name", "full_name"],
        limit: 0,
    });

    // Fetch all attachments for URL lookup
    const { data: attachments, isLoading: attachmentsLoading } = useFrappeGetDocList<NirmaanAttachment>("Nirmaan Attachments", {
        fields: ["name", "attachment"],
        limit: 0,
    });

    // Create lookup maps
    const projectMap = useMemo(() => {
        return projects?.reduce((acc, p) => {
            if (p.name && p.project_name) acc[p.name] = p.project_name;
            return acc;
        }, {} as Record<string, string>) ?? {};
    }, [projects]);

    const vendorMap = useMemo(() => {
        return vendors?.reduce((acc, v) => {
            if (v.name && v.vendor_name) acc[v.name] = v.vendor_name;
            return acc;
        }, {} as Record<string, string>) ?? {};
    }, [vendors]);

    const userMap = useMemo(() => {
        return users?.reduce((acc, u) => {
            if (u.name && u.full_name) acc[u.name] = u.full_name;
            return acc;
        }, {} as Record<string, string>) ?? {};
    }, [users]);

    const attachmentMap = useMemo(() => {
        return attachments?.reduce((acc, a) => {
            if (a.name && a.attachment) acc[a.name] = a.attachment;
            return acc;
        }, {} as Record<string, string>) ?? {};
    }, [attachments]);

    // Transform invoice data to row data
    const reportData = useMemo<PO2BReconcileRowData[] | null>(() => {
        if (invoicesLoading || projectsLoading || vendorsLoading || usersLoading || attachmentsLoading) {
            return null;
        }

        const invoiceEntries = invoicesData?.message?.message?.invoice_entries || [];

        return invoiceEntries.map((entry, index) => ({
            name: `${entry.procurement_order}-${entry.invoice_no}-${index}`,
            poId: entry.procurement_order,
            projectId: entry.project || '',
            projectName: entry.project ? (projectMap[entry.project] || entry.project) : '',
            vendorId: entry.vendor,
            vendorName: entry.vendor_name || vendorMap[entry.vendor] || entry.vendor,
            invoiceNo: entry.invoice_no,
            invoiceDate: entry.date,
            invoiceAmount: entry.amount,
            // New reconciliation fields
            reconciledAmount: entry.reconciled_amount ?? 0,
            reconciliationStatus: entry.reconciliation_status ?? "",
            proofAttachmentId: entry.reconciliation_proof_attachment_id || null,
            proofAttachmentUrl: entry.reconciliation_proof_attachment_id
                ? (attachmentMap[entry.reconciliation_proof_attachment_id] || null)
                : null,
            // Legacy field (for backwards compatibility)
            is2bActivated: entry.reconciliation_status === "full" || entry.is_2b_activated || false,
            reconciledDate: entry.reconciled_date || null,
            reconciledBy: entry.reconciled_by || null,
            reconciledByName: entry.reconciled_by ? (userMap[entry.reconciled_by] || entry.reconciled_by) : null,
            invoiceAttachmentId: entry.invoice_attachment_id,
            updatedBy: entry.updated_by,
            updatedByName: userMap[entry.updated_by] || entry.updated_by,
            attachmentUrl: attachmentMap[entry.invoice_attachment_id] || null,
        }));
    }, [invoicesData, invoicesLoading, projectsLoading, vendorsLoading, usersLoading, attachmentsLoading, projectMap, vendorMap, userMap, attachmentMap]);

    // Summary data
    const summary = useMemo(() => {
        const data = invoicesData?.message?.message;
        if (!data) return null;

        return {
            totalInvoices: data.total_invoices,
            totalAmount: data.total_amount,
            total2bActivated: data.total_2b_activated,
            pending2bActivation: data.pending_2b_activation,
        };
    }, [invoicesData]);

    const isLoading = invoicesLoading || projectsLoading || vendorsLoading || usersLoading || attachmentsLoading;
    const error = invoicesError instanceof Error ? invoicesError : null;

    return {
        reportData,
        isLoading,
        error,
        mutate,
        summary,
    };
};
