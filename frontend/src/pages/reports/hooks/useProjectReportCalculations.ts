// File: frontend/src/pages/reports/hooks/useProjectReportCalculations.ts
import { useFrappeGetDocList, FrappeDoc, GetDocListArgs } from 'frappe-react-sdk';
import { useMemo, useCallback } from 'react';
import memoize from 'lodash/memoize'; // Import lodash.memoize
import { Projects } from '@/types/NirmaanStack/Projects';
import { ProcurementOrder } from '@/types/NirmaanStack/ProcurementOrders';
import { ServiceRequests } from '@/types/NirmaanStack/ServiceRequests';
import { ProjectInflows } from '@/types/NirmaanStack/ProjectInflows';
import { ProjectPayments } from '@/types/NirmaanStack/ProjectPayments';
import { getPOTotal, getSRTotal, getTotalInvoiceAmount } from '@/utils/getAmounts';
import { parseNumber } from '@/utils/parseNumber';
import {
    queryKeys,
    // getProjectReportListOptions, // Base projects will be fetched by useServerDataTable
    getPOForProjectInvoiceOptions,
    getSRForProjectInvoiceOptions,
    getInflowReportListOptions,
    getProjectInvoiceReportListOptions,
    getPaidPaymentReportListOptions,
} from '@/config/queryKeys';
import { ProjectInvoice } from '@/types/NirmaanStack/ProjectInvoice';

// Define the structure for the calculated fields
export interface ProjectCalculatedFields {
    totalInvoiced: number;
    totalPoSrInvoiced: number; // This is the new field for invoiced amounts from invoice_data
    totalProjectInvoiced: number;
    totalInflow: number;
    totalOutflow: number;
    // You can add more calculated fields here if needed, e.g., totalCredit
}

// The hook's return type
export interface UseProjectReportCalculationsResult {
    getProjectCalculatedFields: (projectId: string) => ProjectCalculatedFields | null;
    isLoadingGlobalDeps: boolean; // Indicates if the underlying data for calculations is loading
    globalDepsError: Error | null;
    // Mutators for cache invalidation if needed from the component using this hook
    mutatePOs: () => Promise<any>;
    mutateSRs: () => Promise<any>;
    mutateInflows: () => Promise<any>;
    mutateProjectInvoice: () => Promise<any>;
    mutatePayments: () => Promise<any>;
}

export const useProjectReportCalculations = (): UseProjectReportCalculationsResult => {
    // --- Fetch All Underlying Data Needed for Calculations ---
    const poOptions = getPOForProjectInvoiceOptions();
    const srOptions = getSRForProjectInvoiceOptions();
    const inflowOptions = getInflowReportListOptions();
    const projectInvoiceOptions = getProjectInvoiceReportListOptions(); // Not used here, but can be useful for other calculations
    const paymentOptions = getPaidPaymentReportListOptions();

    const poQueryKey = queryKeys.procurementOrders.list(poOptions);
    const srQueryKey = queryKeys.serviceRequests.list(srOptions);
    const inflowQueryKey = queryKeys.projectInflows.list(inflowOptions);
    const projectInvoiceQueryKey = queryKeys.projectInvoices.list(projectInvoiceOptions);
    const paymentQueryKey = queryKeys.projectPayments.list(paymentOptions);

    const { data: purchaseOrders, isLoading: isLoadingPOs, error: errorPOs, mutate: mutatePOs } =
        useFrappeGetDocList<ProcurementOrder>(poQueryKey[0], poOptions as GetDocListArgs<FrappeDoc<ProcurementOrder>>, poQueryKey);

    const { data: serviceRequests, isLoading: isLoadingSRs, error: errorSRs, mutate: mutateSRs } =
        useFrappeGetDocList<ServiceRequests>(srQueryKey[0], srOptions as GetDocListArgs<FrappeDoc<ServiceRequests>>, srQueryKey);

    const { data: inflowsData, isLoading: isLoadingInflows, error: errorInflows, mutate: mutateInflows } =
        useFrappeGetDocList<ProjectInflows>(inflowQueryKey[0], inflowOptions as GetDocListArgs<FrappeDoc<ProjectInflows>>, inflowQueryKey);

    const { data: projectInvoiceData, isLoading: isLoadingProjectInvoice, error: errorProjectInvoice, mutate: mutateProjectInvoice } =
        useFrappeGetDocList<ProjectInvoice>(projectInvoiceQueryKey[0], projectInvoiceOptions as GetDocListArgs<FrappeDoc<ProjectInvoice>>, projectInvoiceQueryKey);

    const { data: paymentsData, isLoading: isLoadingPayments, error: errorPayments, mutate: mutatePayments } =
        useFrappeGetDocList<ProjectPayments>(paymentQueryKey[0], paymentOptions as GetDocListArgs<FrappeDoc<ProjectPayments>>, paymentQueryKey);

    // --- Pre-process and Group Data (Memoized) ---
    const posByProject = useMemo(() => {
        return purchaseOrders?.reduce((acc, po) => {
            if (po.project) {
                (acc.get(po.project) || acc.set(po.project, []).get(po.project))!.push(po);
            }
            return acc;
        }, new Map<string, ProcurementOrder[]>()) ?? new Map();
    }, [purchaseOrders]);

    const srsByProject = useMemo(() => {
        return serviceRequests?.reduce((acc, sr) => {
            if (sr.project) {
                (acc.get(sr.project) || acc.set(sr.project, []).get(sr.project))!.push(sr);
            }
            return acc;
        }, new Map<string, ServiceRequests[]>()) ?? new Map();
    }, [serviceRequests]);

    const totalInflowByProject = useMemo(() => {
        return inflowsData?.reduce((acc, inflow) => {
            if (inflow.project) {
                acc.set(inflow.project, (acc.get(inflow.project) || 0) + parseNumber(inflow.amount));
            }
            return acc;
        }, new Map<string, number>()) ?? new Map();
    }, [inflowsData]);

    const totalProjectInvoiceByProject = useMemo(() => {
        return projectInvoiceData?.reduce((acc, inv) => {
            if (inv.project) {
                acc.set(inv.project, (acc.get(inv.project) || 0) + parseNumber(inv.amount));
            }
            return acc;
        }, new Map<string, number>()) ?? new Map();
    }, [projectInvoiceData]);

    const totalOutflowByProject = useMemo(() => {
        return paymentsData?.reduce((acc, payment) => {
            if (payment.project) {
                acc.set(payment.project, (acc.get(payment.project) || 0) + parseNumber(payment.amount));
            }
            return acc;
        }, new Map<string, number>()) ?? new Map();
    }, [paymentsData]);

    // --- (Indicator) NEW MEMOIZED MAP: Calculate total invoiced amount from POs and SRs ---
    const totalPoSrInvoicedByProject = useMemo(() => {
        const projectTotals = new Map<string, number>();

        // Process Purchase Orders
        purchaseOrders?.forEach(po => {
            if (po.project && po.invoice_data) {
                const currentTotal = projectTotals.get(po.project) || 0;
                // getTotalInvoiceAmount is the utility function that iterates through the invoice_data JSON
                projectTotals.set(po.project, currentTotal + getTotalInvoiceAmount(po.invoice_data));
            }
        });

        // Process Service Requests
        serviceRequests?.forEach(sr => {
            if (sr.project && sr.invoice_data) {
                const currentTotal = projectTotals.get(sr.project) || 0;
                projectTotals.set(sr.project, currentTotal + getTotalInvoiceAmount(sr.invoice_data));
            }
        });

        return projectTotals;
    }, [purchaseOrders, serviceRequests]);

    // --- Memoized Function for Per-Project Calculation ---
    const getProjectCalculatedFields = useCallback(
        memoize((projectId: string): ProjectCalculatedFields | null => {
            // Important: If any of the dependent global data is still loading,
            // we cannot reliably calculate. The component using this should check `isLoadingGlobalDeps`.
            if (isLoadingPOs || isLoadingSRs || isLoadingInflows || isLoadingProjectInvoice || isLoadingPayments) {
                return null; // Indicate that data isn't ready for this calculation
            }

            const relatedPOs = posByProject.get(projectId) || [];
            const relatedSRs = srsByProject.get(projectId) || [];

            let totalInvoiced = 0;
            relatedPOs.forEach(po => {
                totalInvoiced += getPOTotal(po, po.loading_charges, po.freight_charges)?.totalAmt || 0;
            });
            relatedSRs.forEach(sr => {
                const amount = getSRTotal(sr) || 0;
                totalInvoiced += sr?.gst === "true" ? amount * 1.18 : amount;
            });

            const totalInflow = totalInflowByProject.get(projectId) || 0;
            const totalProjectInvoiced = totalProjectInvoiceByProject.get(projectId) || 0;
            const totalOutflow = totalOutflowByProject.get(projectId) || 0;

            // Get the newly calculated invoiced amount from our map
            const totalPoSrInvoiced = totalPoSrInvoicedByProject.get(projectId) || 0;

            return {
                totalInvoiced: parseNumber(totalInvoiced),
                totalPoSrInvoiced: parseNumber(totalPoSrInvoiced), // Add the new value here
                totalProjectInvoiced: parseNumber(totalProjectInvoiced),
                totalInflow: parseNumber(totalInflow),
                totalOutflow: parseNumber(totalOutflow),
            };
        }),
        [
            // Add the new map to the dependency array
            posByProject, srsByProject, totalInflowByProject, totalProjectInvoiceByProject, totalOutflowByProject, totalPoSrInvoicedByProject,
            isLoadingPOs, isLoadingSRs, isLoadingInflows, isLoadingProjectInvoice, isLoadingPayments
        ]
    );

    const isLoadingGlobalDeps = isLoadingPOs || isLoadingSRs || isLoadingInflows || isLoadingProjectInvoice || isLoadingPayments;
    const globalDepsError = errorPOs || errorSRs || errorInflows || errorProjectInvoice || errorPayments;

    return {
        getProjectCalculatedFields,
        isLoadingGlobalDeps,
        globalDepsError: globalDepsError instanceof Error ? globalDepsError : null,
        mutatePOs,
        mutateSRs,
        mutateInflows,
        mutateProjectInvoice,
        mutatePayments,
    };
};


// This interface is what your table rows will primarily be (base Project data).
// The calculated fields will be fetched/rendered by cell components.
export interface ProcessedProject extends Projects {
    // These fields are no longer pre-calculated and merged here.
    // They are dynamically fetched/calculated by the cell renderers.
    // For typing purposes in cells or if you enrich data for export, they can be optional.
    totalInvoiced?: number;
    totalPoSrInvoiced: number; // This is the new field for invoiced amounts from invoice_data
    totalProjectInvoiced?: number;
    totalInflow?: number;
    totalOutflow?: number;
    totalCredit?: number; // For credit outstanding
}