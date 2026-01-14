import { useFrappeGetDocList, FrappeDoc, GetDocListArgs } from 'frappe-react-sdk';
import { useMemo } from 'react';
import { ProcurementOrder, InvoiceDataType } from '@/types/NirmaanStack/ProcurementOrders';
import { NirmaanAttachment } from '@/types/NirmaanStack/NirmaanAttachment';
import { Projects } from '@/types/NirmaanStack/Projects';
import { Vendors } from '@/types/NirmaanStack/Vendors';
import { ProjectPayments } from '@/types/NirmaanStack/ProjectPayments';
import { getTotalInvoiceAmount } from '@/utils/getAmounts';
import { parseNumber } from '@/utils/parseNumber';
import { queryKeys, getPaymentReportListOptions } from '@/config/queryKeys';

// Invoice item for hover display
export interface InvoiceHoverItem {
    date: string;
    invoiceNo: string;
    amount: number;
}

// Attachment item for hover display
export interface AttachmentHoverItem {
    name: string;
    creation: string;
    attachment: string;
}

// Row data structure for the table
export interface POAttachmentReconcileRowData {
    name: string;                              // PO ID
    creation: string;                          // Creation date for default sorting
    projectId: string;
    projectName: string;
    vendorId: string;
    vendorName: string;
    latestDeliveryDate: string | null;
    modified: string;                          // Last modified date
    status: string;
    totalPOAmount: number;
    totalAmountPaid: number;
    totalInvoiceAmount: number;
    poAmountDelivered: number;
    // Attachment counts
    invoiceCount: number;
    dcCount: number;
    mirCount: number;
    // Hover data
    invoices: InvoiceHoverItem[];
    deliveryChallans: AttachmentHoverItem[];
    mirs: AttachmentHoverItem[];
}

interface UsePOAttachmentReconcileDataResult {
    reportData: POAttachmentReconcileRowData[] | null;
    isLoading: boolean;
    error: Error | null;
    mutate: () => Promise<any>;
    summary: {
        totalPOs: number;
        totalPOValue: number;
        totalDeliveredValue: number;
        totalInvoiceCount: number;
        totalDCCount: number;
        totalMIRCount: number;
    } | null;
}

// Fetch options for POs with Delivered/Partially Delivered status
const getPOAttachmentReconcileOptions = (): GetDocListArgs<FrappeDoc<ProcurementOrder>> => ({
    fields: [
        'name', 'creation', 'modified', 'project', 'vendor', 'total_amount',
        'loading_charges', 'freight_charges', 'invoice_data', 'status',
        'project_name', 'vendor_name', 'latest_delivery_date', 'amount_paid',
        'po_amount_delivered'
    ],
    filters: [["status", "in", ["Delivered", "Partially Delivered"]]],
    limit: 100000,
    orderBy: { field: 'latest_delivery_date', order: 'desc' },
});

// Fetch options for all attachments related to POs
const getAttachmentsOptions = (): GetDocListArgs<FrappeDoc<NirmaanAttachment>> => ({
    fields: ['name', 'creation', 'attachment', 'attachment_type', 'associated_docname'],
    filters: [
        ["associated_doctype", "=", "Procurement Orders"],
        ["attachment_type", "in", ["po delivery challan", "material inspection report"]]
    ],
    limit: 100000,
});

// Fetch options for Projects lookup
const getProjectsMinimalOptions = (): GetDocListArgs<FrappeDoc<Projects>> => ({
    fields: ["name", "project_name"],
    limit: 0,
});

// Fetch options for Vendors lookup
const getVendorsMinimalOptions = (): GetDocListArgs<FrappeDoc<Vendors>> => ({
    fields: ["name", "vendor_name"],
    limit: 0,
});

export const usePOAttachmentReconcileData = (): UsePOAttachmentReconcileDataResult => {
    // Fetch POs
    const poOptions = getPOAttachmentReconcileOptions();
    const {
        data: purchaseOrders,
        isLoading: poLoading,
        error: poError,
        mutate: mutatePOs,
    } = useFrappeGetDocList<ProcurementOrder>(
        "Procurement Orders",
        poOptions,
        ["Procurement Orders", "attachmentReconcile"]
    );

    // Fetch Attachments (DCs and MIRs)
    const attachmentOptions = getAttachmentsOptions();
    const {
        data: attachments,
        isLoading: attachmentsLoading,
        error: attachmentsError,
    } = useFrappeGetDocList<NirmaanAttachment>(
        "Nirmaan Attachments",
        attachmentOptions,
        ["Nirmaan Attachments", "poAttachments"]
    );

    // Fetch Payments
    const paymentOptions = getPaymentReportListOptions(['Procurement Orders']);
    const paymentQueryKey = queryKeys.projectPayments.list(paymentOptions);
    const {
        data: payments,
        isLoading: paymentsLoading,
        error: paymentsError,
    } = useFrappeGetDocList<ProjectPayments>(
        paymentQueryKey[0],
        paymentOptions as GetDocListArgs<FrappeDoc<ProjectPayments>>,
        paymentQueryKey
    );

    // Fetch Projects for name lookup
    const projectsOptions = getProjectsMinimalOptions();
    const {
        data: projects,
        isLoading: projectsLoading,
        error: projectsError,
    } = useFrappeGetDocList<Projects>(
        "Projects",
        projectsOptions,
        ["Projects", "allMinimal"]
    );

    // Fetch Vendors for name lookup
    const vendorsOptions = getVendorsMinimalOptions();
    const {
        data: vendors,
        isLoading: vendorsLoading,
        error: vendorsError,
    } = useFrappeGetDocList<Vendors>(
        "Vendors",
        vendorsOptions,
        ["Vendors", "allMinimal"]
    );

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

    // Group payments by PO name
    const paymentsMap = useMemo(() => {
        return payments?.reduce((acc, payment) => {
            if (payment.document_name) {
                const currentTotal = acc[payment.document_name] || 0;
                acc[payment.document_name] = currentTotal + parseNumber(payment.amount);
            }
            return acc;
        }, {} as Record<string, number>) ?? {};
    }, [payments]);

    // Group attachments by PO name
    const attachmentsByPO = useMemo(() => {
        const map: Record<string, { dcs: AttachmentHoverItem[]; mirs: AttachmentHoverItem[] }> = {};

        attachments?.forEach((att) => {
            if (!att.associated_docname) return;

            if (!map[att.associated_docname]) {
                map[att.associated_docname] = { dcs: [], mirs: [] };
            }

            const item: AttachmentHoverItem = {
                name: att.name,
                creation: att.creation,
                attachment: att.attachment,
            };

            if (att.attachment_type === 'po delivery challan') {
                map[att.associated_docname].dcs.push(item);
            } else if (att.attachment_type === 'material inspection report') {
                map[att.associated_docname].mirs.push(item);
            }
        });

        return map;
    }, [attachments]);

    // Transform PO data to row data
    const reportData = useMemo<POAttachmentReconcileRowData[] | null>(() => {
        if (poLoading || attachmentsLoading || paymentsLoading || projectsLoading || vendorsLoading) {
            return null;
        }

        if (!purchaseOrders) {
            return [];
        }

        return purchaseOrders.map((po) => {
            // Parse invoices from invoice_data
            const invoiceData = po.invoice_data?.data as InvoiceDataType | undefined;
            const invoices: InvoiceHoverItem[] = [];

            if (invoiceData) {
                Object.entries(invoiceData).forEach(([date, invoice]) => {
                    invoices.push({
                        date,
                        invoiceNo: invoice.invoice_no,
                        amount: parseNumber(invoice.amount),
                    });
                });
            }

            // Get attachments for this PO
            const poAttachments = attachmentsByPO[po.name] || { dcs: [], mirs: [] };

            return {
                name: po.name,
                creation: po.creation,
                projectId: po.project,
                projectName: projectMap[po.project] || po.project_name || po.project,
                vendorId: po.vendor,
                vendorName: vendorMap[po.vendor] || po.vendor_name || po.vendor,
                latestDeliveryDate: po.latest_delivery_date || null,
                modified: po.modified,
                status: po.status,
                totalPOAmount: parseNumber(po.total_amount),
                totalAmountPaid: paymentsMap[po.name] || 0,
                totalInvoiceAmount: getTotalInvoiceAmount(po.invoice_data),
                poAmountDelivered: parseNumber(po.po_amount_delivered),
                invoiceCount: invoices.length,
                dcCount: poAttachments.dcs.length,
                mirCount: poAttachments.mirs.length,
                invoices,
                deliveryChallans: poAttachments.dcs,
                mirs: poAttachments.mirs,
            };
        });
    }, [
        purchaseOrders, attachments, payments, projects, vendors,
        poLoading, attachmentsLoading, paymentsLoading, projectsLoading, vendorsLoading,
        projectMap, vendorMap, paymentsMap, attachmentsByPO
    ]);

    // Calculate summary
    const summary = useMemo(() => {
        if (!reportData) return null;

        return {
            totalPOs: reportData.length,
            totalPOValue: reportData.reduce((sum, row) => sum + row.totalPOAmount, 0),
            totalDeliveredValue: reportData.reduce((sum, row) => sum + row.poAmountDelivered, 0),
            totalInvoiceCount: reportData.reduce((sum, row) => sum + row.invoiceCount, 0),
            totalDCCount: reportData.reduce((sum, row) => sum + row.dcCount, 0),
            totalMIRCount: reportData.reduce((sum, row) => sum + row.mirCount, 0),
        };
    }, [reportData]);

    const isLoading = poLoading || attachmentsLoading || paymentsLoading || projectsLoading || vendorsLoading;
    const error = poError || attachmentsError || paymentsError || projectsError || vendorsError;

    return {
        reportData,
        isLoading,
        error: error instanceof Error ? error : null,
        mutate: mutatePOs,
        summary,
    };
};
