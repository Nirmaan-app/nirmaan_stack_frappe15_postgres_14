import { useFrappeGetDocList, FrappeDoc, GetDocListArgs } from 'frappe-react-sdk';
import { useMemo } from 'react';
import { Projects } from '@/types/NirmaanStack/Projects';
import { ProcurementOrder } from '@/types/NirmaanStack/ProcurementOrders';
import { ServiceRequests } from '@/types/NirmaanStack/ServiceRequests';
import { ProjectInflows } from '@/types/NirmaanStack/ProjectInflows';
import { ProjectPayments } from '@/types/NirmaanStack/ProjectPayments';
import { getPOTotal, getSRTotal, getTotalInvoiceAmount } from '@/utils/getAmounts';
import { parseNumber } from '@/utils/parseNumber';
import {
    queryKeys,
    getProjectReportListOptions,
    getPOForProjectInvoiceOptions,
    getSRForProjectInvoiceOptions,
    getInflowReportListOptions,
    getPaidPaymentReportListOptions,
} from '@/config/queryKeys';

// Define the processed project type including calculated amounts
export interface ProcessedProject extends Projects {
    totalInvoiced: number;
    totalInflow: number;
    totalOutflow: number;
}

interface UseProjectReportsDataResult {
    processedProjects: ProcessedProject[] | null;
    isLoading: boolean;
    error: Error | null;
    mutateProjects: () => Promise<any>;
    mutatePOs: () => Promise<any>; // Add mutators for all fetched data
    mutateSRs: () => Promise<any>;
    mutateInflows: () => Promise<any>;
    mutatePayments: () => Promise<any>;
}

export const useProjectReportsData = (): UseProjectReportsDataResult => {
    // --- Get Options ---
    const projectOptions = getProjectReportListOptions();
    const poOptions = getPOForProjectInvoiceOptions(); // Fetches only necessary fields
    const srOptions = getSRForProjectInvoiceOptions(); // Fetches only necessary fields
    const inflowOptions = getInflowReportListOptions(); // Fetches all inflows
    const paymentOptions = getPaidPaymentReportListOptions(); // Fetches all *Paid* payments

    // --- Generate Query Keys ---
    const projectQueryKey = queryKeys.projects.list(projectOptions);
    const poQueryKey = queryKeys.procurementOrders.list(poOptions); // Different key from PO report fetch due to different params
    const srQueryKey = queryKeys.serviceRequests.list(srOptions);   // Different key from PO report fetch
    const inflowQueryKey = queryKeys.projectInflows.list(inflowOptions);
    const paymentQueryKey = queryKeys.projectPayments.list(paymentOptions); // Different key for 'Paid' payments

    // --- Fetch All Required Data ---
    const {
        data: projectsData,
        isLoading: isLoadingProjects,
        error: errorProjects,
        mutate: mutateProjects,
    } = useFrappeGetDocList<Projects>(projectQueryKey[0], projectOptions as GetDocListArgs<FrappeDoc<Projects>>, projectQueryKey);

    const {
        data: purchaseOrders,
        isLoading: isLoadingPOs,
        error: errorPOs,
        mutate: mutatePOs,
    } = useFrappeGetDocList<ProcurementOrder>(poQueryKey[0], poOptions as GetDocListArgs<FrappeDoc<ProcurementOrder>>, poQueryKey);

    const {
        data: serviceRequests,
        isLoading: isLoadingSRs,
        error: errorSRs,
        mutate: mutateSRs,
    } = useFrappeGetDocList<ServiceRequests>(srQueryKey[0], srOptions as GetDocListArgs<FrappeDoc<ServiceRequests>>, srQueryKey);

    const {
        data: inflowsData,
        isLoading: isLoadingInflows,
        error: errorInflows,
        mutate: mutateInflows,
    } = useFrappeGetDocList<ProjectInflows>(inflowQueryKey[0], inflowOptions as GetDocListArgs<FrappeDoc<ProjectInflows>>, inflowQueryKey);

    const {
        data: paymentsData, // These are filtered to status = 'Paid'
        isLoading: isLoadingPayments,
        error: errorPayments,
        mutate: mutatePayments,
    } = useFrappeGetDocList<ProjectPayments>(paymentQueryKey[0], paymentOptions as GetDocListArgs<FrappeDoc<ProjectPayments>>, paymentQueryKey);

    // --- Pre-process and Group Data (Memoized) ---

    // Group POs by Project for Invoice Calculation
    const posByProject = useMemo(() => {
        return purchaseOrders?.reduce((acc, po) => {
            if (po.project) {
                if (!acc.has(po.project)) {
                    acc.set(po.project, []);
                }
                acc.get(po.project)?.push(po);
            }
            return acc;
        }, new Map<string, ProcurementOrder[]>()) ?? new Map();
    }, [purchaseOrders]);

    // Group SRs by Project for Invoice Calculation
    const srsByProject = useMemo(() => {
        return serviceRequests?.reduce((acc, sr) => {
            if (sr.project) {
                if (!acc.has(sr.project)) {
                    acc.set(sr.project, []);
                }
                acc.get(sr.project)?.push(sr);
            }
            return acc;
        }, new Map<string, ServiceRequests[]>()) ?? new Map();
    }, [serviceRequests]);

    // Calculate Total Inflow per Project
    const totalInflowByProject = useMemo(() => {
        return inflowsData?.reduce((acc, inflow) => {
            if (inflow.project) {
                const currentTotal = acc.get(inflow.project) || 0;
                acc.set(inflow.project, currentTotal + parseNumber(inflow.amount));
            }
            return acc;
        }, new Map<string, number>()) ?? new Map();
    }, [inflowsData]);

    // Calculate Total *Paid* Outflow per Project
    const totalOutflowByProject = useMemo(() => {
         // paymentsData is already filtered for 'Paid' status by the query options
        return paymentsData?.reduce((acc, payment) => {
            if (payment.project) {
                const currentTotal = acc.get(payment.project) || 0;
                acc.set(payment.project, currentTotal + parseNumber(payment.amount));
            }
            return acc;
        }, new Map<string, number>()) ?? new Map();
    }, [paymentsData]);

    // --- Combine Project Data with Calculated Amounts (Memoized) ---
    const processedProjects = useMemo<ProcessedProject[] | null>(() => {
        // Wait until all data sources are loaded
        if (isLoadingProjects || isLoadingPOs || isLoadingSRs || isLoadingInflows || isLoadingPayments) {
            return null; // Data not ready
        }

        if (!projectsData) {
            return []; // No base projects found
        }

        return projectsData.map(project => {
            const relatedPOs = posByProject.get(project.name) || [];
            const relatedSRs = srsByProject.get(project.name) || [];

            // Calculate total invoiced amount for this project
            let totalInvoiced = 0;
            relatedPOs.forEach(po => {
                // totalInvoiced += getTotalInvoiceAmount(po.invoice_data);
                totalInvoiced += getPOTotal(po, po.loading_charges, po.freight_charges)?.totalAmt;
            });
            relatedSRs.forEach(sr => {
                // totalInvoiced += getTotalInvoiceAmount(sr.invoice_data);
                const amount = getSRTotal(sr);
                totalInvoiced += sr?.gst === "true" ? amount * 1.18 : amount;
            });

            // Get pre-calculated inflow and outflow
            const totalInflow = totalInflowByProject.get(project.name) || 0;
            const totalOutflow = totalOutflowByProject.get(project.name) || 0;

            return {
                ...project,
                totalInvoiced: parseNumber(totalInvoiced), // Ensure it's a number
                totalInflow: parseNumber(totalInflow),
                totalOutflow: parseNumber(totalOutflow),
            };
        });

    }, [
        projectsData, posByProject, srsByProject, totalInflowByProject, totalOutflowByProject, // Derived data maps
        isLoadingProjects, isLoadingPOs, isLoadingSRs, isLoadingInflows, isLoadingPayments // Loading states
    ]);

    // --- Consolidated Loading and Error State ---
    const isLoading = isLoadingProjects || isLoadingPOs || isLoadingSRs || isLoadingInflows || isLoadingPayments;
    const error = errorProjects || errorPOs || errorSRs || errorInflows || errorPayments;

    return {
        processedProjects, // Return the data with calculated amounts
        isLoading,
        error: error instanceof Error ? error : null,
        mutateProjects,
        mutatePOs,
        mutateSRs,
        mutateInflows,
        mutatePayments,
    };
};