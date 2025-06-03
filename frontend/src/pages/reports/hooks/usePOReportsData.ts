import { useFrappeGetDocList, FrappeDoc, GetDocListArgs } from 'frappe-react-sdk';
import { useMemo } from 'react';
import { ProcurementOrder } from '@/types/NirmaanStack/ProcurementOrders';
// import { ServiceRequests } from '@/types/NirmaanStack/ServiceRequests';
import { ProjectPayments } from '@/types/NirmaanStack/ProjectPayments';
import { Projects } from '@/types/NirmaanStack/Projects';
import { Vendors } from '@/types/NirmaanStack/Vendors';
import { getPOTotal, getTotalInvoiceAmount } from '@/utils/getAmounts';
import { parseNumber } from '@/utils/parseNumber';
import {
    queryKeys,
    getPOReportListOptions,
    // getSRReportListOptions,
    getPaymentReportListOptions,
    // getProjectMinimalListOptions,
    // getVendorMinimalListOptions
} from '@/config/queryKeys';

export interface POReportRowData {
    name: string;
    // type: 'PO' | 'SR';
    creation: string;
    project: string;
    projectName?: string;
    vendor: string;
    vendorName?: string;
    totalAmount: number;
    invoiceAmount: number;
    amountPaid: number;
    originalDoc: ProcurementOrder; //| ServiceRequests;
}

interface UsePOReportsDataResult {
    reportData: POReportRowData[] | null;
    isLoading: boolean;
    error: Error | null;
    mutatePOs: () => Promise<any>;
    // mutateSRs: () => Promise<any>;
    mutatePayments: () => Promise<any>;
}

// New simpler options for fetching all minimal project/vendor data for lookups
const getAllProjectsMinimalOptions = (): GetDocListArgs<FrappeDoc<Projects>> => ({
    fields: ["name", "project_name"], // Only fetch what's needed for the map
    limit: 0, // Fetch all
});

const getAllVendorsMinimalOptions = (): GetDocListArgs<FrappeDoc<Vendors>> => ({
    fields: ["name", "vendor_name"], // Only fetch what's needed for the map
    limit: 0, // Fetch all
});

export const usePOReportsData = (): UsePOReportsDataResult => {
    // --- Get Options ---
    const poOptions = getPOReportListOptions();
    // const srOptions = getSRReportListOptions();
    const paymentOptions = getPaymentReportListOptions(['Procurement Orders']); // Already filtered for Paid PO/SR payments

    // --- Generate Query Keys ---
    const poQueryKey = queryKeys.procurementOrders.list(poOptions);
    // const srQueryKey = queryKeys.serviceRequests.list(srOptions);
    const paymentQueryKey = queryKeys.projectPayments.list(paymentOptions);

    // --- Fetch Core Data ---
    const {
        data: purchaseOrders,
        isLoading: poLoading,
        error: poError,
        mutate: mutatePOs,
    } = useFrappeGetDocList<ProcurementOrder>(poQueryKey[0], poOptions as GetDocListArgs<FrappeDoc<ProcurementOrder>>, poQueryKey);

    // const {
    //     data: serviceRequests,
    //     isLoading: srLoading,
    //     error: srError,
    //     mutate: mutateSRs,
    // } = useFrappeGetDocList<ServiceRequests>(srQueryKey[0], srOptions as GetDocListArgs<FrappeDoc<ServiceRequests>>, srQueryKey);

    const {
        data: payments, // These are already filtered by status='Paid' and doc_type = PO/SR
        isLoading: paymentsLoading,
        error: paymentsError,
        mutate: mutatePayments,
    } = useFrappeGetDocList<ProjectPayments>(paymentQueryKey[0], paymentOptions as GetDocListArgs<FrappeDoc<ProjectPayments>>, paymentQueryKey);

    // --- Get Unique Project and Vendor IDs (Depends on PO/SR data) ---
    // const uniqueProjectIds = useMemo(() => {
    //     const ids = new Set<string>();
    //     purchaseOrders?.forEach(po => po.project && ids.add(po.project));
    //     serviceRequests?.forEach(sr => sr.project && ids.add(sr.project));
    //     return Array.from(ids);
    // }, [purchaseOrders, serviceRequests]);

    // const uniqueVendorIds = useMemo(() => {
    //     const ids = new Set<string>();
    //     purchaseOrders?.forEach(po => po.vendor && ids.add(po.vendor));
    //     serviceRequests?.forEach(sr => sr.vendor && ids.add(sr.vendor));
    //     return Array.from(ids);
    // }, [purchaseOrders, serviceRequests]);

    // --- Fetch Dependent Data (Project/Vendor Names) ---
    // const projectOptions = getProjectMinimalListOptions(uniqueProjectIds);
    // const vendorOptions = getVendorMinimalListOptions(uniqueVendorIds);

    // --- Fetch ALL Dependent Data (Project/Vendor Names) - MODIFIED ---
    const allProjectsOptions = getAllProjectsMinimalOptions();
    const allVendorsOptions = getAllVendorsMinimalOptions();

    // const projectQueryKey = queryKeys.projects.list(projectOptions);
    // const vendorQueryKey = queryKeys.vendors.list(vendorOptions);

    // Use simpler, static SWR keys if fetching all
    const allProjectsQueryKey = queryKeys.projects.allMinimal(); // Define this in queryKeys.ts
    const allVendorsQueryKey = queryKeys.vendors.allMinimal();   // Define this in queryKeys.ts

    // const { data: projects, isLoading: projectsLoading } = useFrappeGetDocList<Projects>(
    //     projectQueryKey[0],
    //     projectOptions as GetDocListArgs<FrappeDoc<Projects>>,
    //     uniqueProjectIds.length > 0 ? projectQueryKey : null, // Use the generated key
    // );

    //  const { data: vendors, isLoading: vendorsLoading } = useFrappeGetDocList<Vendors>(
    //     vendorQueryKey[0],
    //     vendorOptions as GetDocListArgs<FrappeDoc<Vendors>>,
    //     uniqueVendorIds.length > 0 ? vendorQueryKey : null, // Use the generated key
    //  );

    const { data: projects, isLoading: projectsLoading, error: projectsError } = useFrappeGetDocList<Projects>(
        allProjectsQueryKey[0], // e.g., "Projects"
        allProjectsOptions,
        allProjectsQueryKey     // e.g., ["Projects", "allMinimal"]
    );

    const { data: vendors, isLoading: vendorsLoading, error: vendorsError } = useFrappeGetDocList<Vendors>(
        allVendorsQueryKey[0], // e.g., "Vendors"
        allVendorsOptions,
        allVendorsQueryKey    // e.g., ["Vendors", "allMinimal"]
    );


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

    // Group *Paid* Payments by Document Name (Memoized)
    const paymentsMap = useMemo(() => {
        // Payments are pre-filtered to be 'Paid' and linked to PO/SRs
        return payments?.reduce((acc, payment) => {
            if (payment.document_name) {
                const currentTotal = acc[payment.document_name] || 0;
                acc[payment.document_name] = currentTotal + parseNumber(payment.amount);
            }
            return acc;
        }, {} as Record<string, number>) ?? {};
    }, [payments]);

    // --- Combine and Process Data (Memoized) ---
    const reportData = useMemo<POReportRowData[] | null>(() => {
        // Wait until all *required* data for calculation is loaded
        if (poLoading || paymentsLoading || projectsLoading || vendorsLoading) {
            return null; // Indicate data is not fully ready
        }

        // Handle cases where initial fetches might return undefined/null before loading finishes
        if (!purchaseOrders) {
            return []; // No POs or SRs found
        }

        const combinedData: POReportRowData[] = [];

        // Process Purchase Orders
        (purchaseOrders || []).forEach(po => {
            const { totalAmt } = getPOTotal(po, po.loading_charges, po.freight_charges); // Assuming totalAmt includes tax
            combinedData.push({
                name: po.name,
                // type: 'PO',
                creation: po.creation,
                project: po.project,
                projectName: projectMap[po.project] || po.project_name || po.project,
                vendor: po.vendor,
                vendorName: vendorMap[po.vendor] || po.vendor_name || po.vendor,
                totalAmount: parseNumber(totalAmt),
                invoiceAmount: getTotalInvoiceAmount(po.invoice_data),
                amountPaid: paymentsMap[po.name] || 0, // Look up pre-calculated paid amount
                originalDoc: po,
            });
        });

        // Process Service Requests
        // (serviceRequests || []).forEach(sr => {
        //      const total = getSRTotal(sr);
        //      const totalWithTax = sr.gst === "true" ? total * 1.18 : total;
        //     combinedData.push({
        //         name: sr.name,
        //         type: 'SR',
        //         creation: sr.creation,
        //         project: sr.project,
        //         projectName: projectMap[sr.project] || sr.project,
        //         vendor: sr.vendor,
        //         vendorName: vendorMap[sr.vendor] || sr.vendor,
        //         totalAmount: parseNumber(totalWithTax),
        //         invoiceAmount: getTotalInvoiceAmount(sr.invoice_data),
        //         amountPaid: paymentsMap[sr.name] || 0, // Look up pre-calculated paid amount
        //         originalDoc: sr,
        //     });
        // });

        // Sort the combined list by creation date descending
        combinedData.sort((a, b) => new Date(b.creation).getTime() - new Date(a.creation).getTime());

        return combinedData;

    }, [
        purchaseOrders, payments, projects, vendors, // Raw data
        poLoading, paymentsLoading, projectsLoading, vendorsLoading, // Loading states
        projectMap, vendorMap, paymentsMap, // Derived maps
    ]);

    // --- Consolidated Loading and Error State ---
    const isLoading = poLoading || paymentsLoading || projectsLoading || vendorsLoading;
    const error = poError || paymentsError || projectsError || vendorsError; // Add errors from project/vendor fetches if needed

    return {
        reportData,
        isLoading,
        error: error instanceof Error ? error : null,
        mutatePOs,
        // mutateSRs,
        mutatePayments,
    };
};