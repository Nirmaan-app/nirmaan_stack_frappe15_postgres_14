import { useFrappeGetDocList, FrappeDoc, GetDocListArgs } from 'frappe-react-sdk';
import { useMemo } from 'react';
import { ProcurementOrder } from '@/types/NirmaanStack/ProcurementOrders';
import { Projects } from '@/types/NirmaanStack/Projects';
import { Vendors } from '@/types/NirmaanStack/Vendors';
import { VendorInvoice } from '@/types/NirmaanStack/VendorInvoice';
import { parseNumber } from '@/utils/parseNumber';
import {
    queryKeys,
    getPOReportListOptions,
} from '@/config/queryKeys';
import { useProjectAssignees } from '@/hooks/useProjectAssignees';
import { format } from "date-fns"; // Added by user's edit, though not used in the final provided code.

// Assuming NirmaanPurchaseOrder is ProcurementOrder based on context
type NirmaanPurchaseOrder = ProcurementOrder;

export interface POReportRowData extends NirmaanPurchaseOrder {
  invoiceAmount: number;
  amountPaid: number;
  totalAmounts: number; // This seems to be a new field, or a rename of total_amount
  originalDoc: NirmaanPurchaseOrder; // Keep reference to original if needed
  projectId: string; // Add projectId for easier lookup
}

interface UsePOReportsDataResult {
    reportData: POReportRowData[] | null;
    isLoading: boolean;
    error: Error | null;
    mutatePOs: () => Promise<any>;
    assignmentsLookup: ReturnType<typeof useProjectAssignees>['assignmentsLookup']; // Added assignmentsLookup to result type
}

// Simpler options for fetching all minimal project/vendor data for lookups
const getAllProjectsMinimalOptions = (): GetDocListArgs<FrappeDoc<Projects>> => ({
    fields: ["name", "project_name"],
    limit: 0,
});

const getAllVendorsMinimalOptions = (): GetDocListArgs<FrappeDoc<Vendors>> => ({
    fields: ["name", "vendor_name"],
    limit: 0,
});

export const usePOReportsData = (): UsePOReportsDataResult => {
    // --- Get Options ---
    const poOptions = getPOReportListOptions();
    // --- Generate Query Keys ---
    const poQueryKey = queryKeys.procurementOrders.list(poOptions);

    // --- Fetch Core Data ---
    const {
        data: purchaseOrders,
        isLoading: poLoading,
        error: poError,
        mutate: mutatePOs,
    } = useFrappeGetDocList<ProcurementOrder>(poQueryKey[0], poOptions as GetDocListArgs<FrappeDoc<ProcurementOrder>>, poQueryKey);

    // --- Fetch ALL Approved Vendor Invoices for POs ---
    // Note: We don't filter by document_name to avoid URL length limits with large IN clauses.
    // Instead, we fetch all approved PO invoices and filter client-side.
    const {
        data: vendorInvoices,
        isLoading: invoicesLoading,
        error: invoicesError,
    } = useFrappeGetDocList<VendorInvoice>(
        "Vendor Invoices",
        {
            filters: [
                ["document_type", "=", "Procurement Orders"],
                ["status", "=", "Approved"],
            ],
            fields: ["name", "document_name", "invoice_amount"],
            limit: 0,
        } as GetDocListArgs<FrappeDoc<VendorInvoice>>,
        "VendorInvoices-PO-Reports-All"
    );

    // Create a Set of PO names for efficient lookup
    const poNamesSet = useMemo(
        () => new Set(purchaseOrders?.map(po => po.name) || []),
        [purchaseOrders]
    );

    // --- Fetch Projects and Vendors ---
    const allProjectsOptions = getAllProjectsMinimalOptions();
    const allVendorsOptions = getAllVendorsMinimalOptions();
    const allProjectsQueryKey = queryKeys.projects.allMinimal();
    const allVendorsQueryKey = queryKeys.vendors.allMinimal();

    const { data: projects, isLoading: projectsLoading, error: projectsError } = useFrappeGetDocList<Projects>(
        allProjectsQueryKey[0],
        allProjectsOptions,
        allProjectsQueryKey
    );

    const { data: vendors, isLoading: vendorsLoading, error: vendorsError } = useFrappeGetDocList<Vendors>(
        allVendorsQueryKey[0],
        allVendorsOptions,
        allVendorsQueryKey
    );

    // --- Fetch Users and Permissions for Assignees ---
    const { assignmentsLookup, isLoading: assigneesLoading, error: assigneesError } = useProjectAssignees();

    // --- Create Lookup Maps (Memoized) ---
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

    // Group Vendor Invoice Totals by Document Name (only for POs in our list)
    const invoiceTotalsMap = useMemo(() => {
        return vendorInvoices?.reduce((acc, invoice) => {
            // Only include invoices for POs in our current dataset
            if (invoice.document_name && poNamesSet.has(invoice.document_name)) {
                const currentTotal = acc[invoice.document_name] || 0;
                acc[invoice.document_name] = currentTotal + parseNumber(invoice.invoice_amount);
            }
            return acc;
        }, {} as Record<string, number>) ?? {};
    }, [vendorInvoices, poNamesSet]);

    // --- Combine and Process Data (Memoized) ---
    const reportData = useMemo<POReportRowData[] | null>(() => {
        // Wait until all required data for calculation is loaded
        if (poLoading || projectsLoading || vendorsLoading || invoicesLoading) {
            return null;
        }



        const combinedData: POReportRowData[] = [];

        // Process Purchase Orders
        (purchaseOrders || []).forEach(po => {
            if (po) {
                const projectName = projectMap[po.project] || po.project_name || po.project;
                // Use project name (ID) for lookup as permissions use that usually, 
                // but need to verify if 'for_value' is ID or Name. Usually ID.
                // In ProjectOverviewTab: for_value: projectData?.name (which is ID: "PROJ-...")
                // Use project name (ID) for lookup as permissions use that usually, 
                // but need to verify if 'for_value' is ID or Name. Usually ID.
                // In ProjectOverviewTab: for_value: projectData?.name (which is ID: "PROJ-...")

                combinedData.push({
                    name: po.name,
                    creation: po.creation,
                    project: po.project,
                    projectName: projectName,
                    vendor: po.vendor,
                    vendorName: vendorMap[po.vendor] || po.vendor_name || po.vendor,
                    totalAmount: parseNumber(po.total_amount),
                    invoiceAmount: invoiceTotalsMap[po.name] || 0, // Use Vendor Invoices lookup
                    amountPaid: parseNumber(po.amount_paid),
                    dispatch_date: po.dispatch_date || undefined,
                    originalDoc: po,
                    assignees: [], // Deprecated in favor of assignmentsLookup passed to column
                });
            }
        });

        // Sort by dispatch_date descending
        combinedData.sort((a, b) => {
            const dateA = a.dispatch_date ? new Date(a.dispatch_date).getTime() : 0;
            const dateB = b.dispatch_date ? new Date(b.dispatch_date).getTime() : 0;
            return dateB - dateA;
        });

        return combinedData;

    }, [
        purchaseOrders, projects, vendors, vendorInvoices, 
        poLoading, projectsLoading, vendorsLoading, invoicesLoading, 
        projectMap, vendorMap, invoiceTotalsMap,
    ]);

    // --- Consolidated Loading and Error State ---
    const isLoading = poLoading || projectsLoading || vendorsLoading || invoicesLoading || assigneesLoading;
    const error = poError || projectsError || vendorsError || invoicesError || assigneesError;

    return {
        reportData,
        isLoading,
        error: error instanceof Error ? error : null,
        mutatePOs,
        assignmentsLookup, // Export for columns
    };
};
