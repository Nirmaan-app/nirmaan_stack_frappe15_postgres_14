// File: frontend/src/pages/reports/hooks/useProjectReportCalculations.ts
import { useFrappeGetDocList, FrappeDoc, GetDocListArgs } from 'frappe-react-sdk';
import { useMemo, useCallback } from 'react';
import memoize from 'lodash/memoize'; // Import lodash.memoize
import { Projects } from '@/types/NirmaanStack/Projects';
import { ProcurementOrder } from '@/types/NirmaanStack/ProcurementOrders';
import { ServiceRequests } from '@/types/NirmaanStack/ServiceRequests';
import { ProjectInflows } from '@/types/NirmaanStack/ProjectInflows';
import { ProjectPayments } from '@/types/NirmaanStack/ProjectPayments';
import { getPOTotal, getSRTotal } from '@/utils/getAmounts';
import { parseNumber } from '@/utils/parseNumber';
import {
    queryKeys,
    // getProjectReportListOptions, // Base projects will be fetched by useServerDataTable
    getPOForProjectInvoiceOptions,
    getSRForProjectInvoiceOptions,
    getInflowReportListOptions,
    getPaidPaymentReportListOptions,
} from '@/config/queryKeys';

// Define the structure for the calculated fields
export interface ProjectCalculatedFields {
    totalInvoiced: number;
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
    mutatePayments: () => Promise<any>;
}

export const useProjectReportCalculations = (): UseProjectReportCalculationsResult => {
    // --- Fetch All Underlying Data Needed for Calculations ---
    const poOptions = getPOForProjectInvoiceOptions();
    const srOptions = getSRForProjectInvoiceOptions();
    const inflowOptions = getInflowReportListOptions();
    const paymentOptions = getPaidPaymentReportListOptions();

    const poQueryKey = queryKeys.procurementOrders.list(poOptions);
    const srQueryKey = queryKeys.serviceRequests.list(srOptions);
    const inflowQueryKey = queryKeys.projectInflows.list(inflowOptions);
    const paymentQueryKey = queryKeys.projectPayments.list(paymentOptions);

    const { data: purchaseOrders, isLoading: isLoadingPOs, error: errorPOs, mutate: mutatePOs } =
        useFrappeGetDocList<ProcurementOrder>(poQueryKey[0], poOptions as GetDocListArgs<FrappeDoc<ProcurementOrder>>, poQueryKey);

    const { data: serviceRequests, isLoading: isLoadingSRs, error: errorSRs, mutate: mutateSRs } =
        useFrappeGetDocList<ServiceRequests>(srQueryKey[0], srOptions as GetDocListArgs<FrappeDoc<ServiceRequests>>, srQueryKey);

    const { data: inflowsData, isLoading: isLoadingInflows, error: errorInflows, mutate: mutateInflows } =
        useFrappeGetDocList<ProjectInflows>(inflowQueryKey[0], inflowOptions as GetDocListArgs<FrappeDoc<ProjectInflows>>, inflowQueryKey);

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

    const totalOutflowByProject = useMemo(() => {
        return paymentsData?.reduce((acc, payment) => {
            if (payment.project) {
                acc.set(payment.project, (acc.get(payment.project) || 0) + parseNumber(payment.amount));
            }
            return acc;
        }, new Map<string, number>()) ?? new Map();
    }, [paymentsData]);

    // --- Memoized Function for Per-Project Calculation ---
    const getProjectCalculatedFields = useCallback(
        memoize((projectId: string): ProjectCalculatedFields | null => {
            // Important: If any of the dependent global data is still loading,
            // we cannot reliably calculate. The component using this should check `isLoadingGlobalDeps`.
            if (isLoadingPOs || isLoadingSRs || isLoadingInflows || isLoadingPayments) {
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
            const totalOutflow = totalOutflowByProject.get(projectId) || 0;

            return {
                totalInvoiced: parseNumber(totalInvoiced),
                totalInflow: parseNumber(totalInflow),
                totalOutflow: parseNumber(totalOutflow),
            };
        }),
        [ // Dependencies for useCallback: these ensure `memoize` uses the latest maps if they change
            posByProject, srsByProject, totalInflowByProject, totalOutflowByProject,
            // Also include loading states, so if they flip, the memoized function is "new"
            // and lodash.memoize's cache for specific projectIds might be cleared if its internal
            // function reference changes.
            isLoadingPOs, isLoadingSRs, isLoadingInflows, isLoadingPayments
        ]
    );

    const isLoadingGlobalDeps = isLoadingPOs || isLoadingSRs || isLoadingInflows || isLoadingPayments;
    const globalDepsError = errorPOs || errorSRs || errorInflows || errorPayments;

    return {
        getProjectCalculatedFields,
        isLoadingGlobalDeps,
        globalDepsError: globalDepsError instanceof Error ? globalDepsError : null,
        mutatePOs,
        mutateSRs,
        mutateInflows,
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
    totalInflow?: number;
    totalOutflow?: number;
    totalCredit?: number; // For credit outstanding
}