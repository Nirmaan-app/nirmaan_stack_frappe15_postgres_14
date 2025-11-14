// File: frontend/src/pages/reports/hooks/useProjectReportCalculations.ts
import { useFrappeGetDocList, FrappeDoc, GetDocListArgs } from 'frappe-react-sdk';
import { useMemo, useCallback } from 'react';
import memoize from 'lodash/memoize'; // Import lodash.memoize
import { Projects } from '@/types/NirmaanStack/Projects';
import { ProcurementOrder } from '@/types/NirmaanStack/ProcurementOrders';
import { ServiceRequests } from '@/types/NirmaanStack/ServiceRequests';
import { ProjectInflows } from '@/types/NirmaanStack/ProjectInflows';
import { ProjectPayments } from '@/types/NirmaanStack/ProjectPayments';
import { ProjectExpenses } from '@/types/NirmaanStack/ProjectExpenses'; // --- (Indicator) NEW: Import ProjectExpenses type ---
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
import { useCredits } from '@/pages/credits/hooks/useCredits';

// ----- 
import { parseISO,isWithinInterval } from 'date-fns';
import {isDateInPeriod,isDateOnOrAfter} from './useVendorLedgerCalculations';

// Define a type for the parameters for better readability
interface ProjectReportParams { // <--- NEW INTERFACE
    startDate?: Date | null;
    endDate?: Date | null;
}


// Define the structure for the calculated fields
export interface ProjectCalculatedFields {
    totalInvoiced: number;
    totalPoSrInvoiced: number; // This is the new field for invoiced amounts from invoice_data
    totalProjectInvoiced: number;
    totalInflow: number;
    totalOutflow: number;
    TotalPurchaseOverCredit: number; // ✨ NEW
    CreditPaidAmount: number;           // ✨ NEW
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
    mutatePaymentTerms: () => Promise<any>; // ✨ NEW mutator

    mutateProjectExpenses: () => Promise<any>; // --- (Indicator) NEW: Mutator for Project Expenses ---
}



export const useProjectReportCalculations = (params: ProjectReportParams = {}): UseProjectReportCalculationsResult => {

     const { startDate, endDate } = params; // <--- DESTUCTURE DATES
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

    const {data:CreditData}=useCredits()

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

    // --- (Indicator) NEW: Fetch all Project Expenses ---
    const { data: projectExpensesData, isLoading: isLoadingProjectExpenses, error: errorProjectExpenses, mutate: mutateProjectExpenses } =
        useFrappeGetDocList<ProjectExpenses>('Project Expenses', {
            fields: ['projects', 'amount'], // Only fields needed for this calculation
            limit: 0,
        }, 'AllProjectExpensesForReports');

    // --- Pre-process and Group Data (Memoized) ---
    // const posByProject = useMemo(() => {
    //     return purchaseOrders?.reduce((acc, po) => {
    //         if (po.project) {
    //             (acc.get(po.project) || acc.set(po.project, []).get(po.project))!.push(po);
    //         }
    //         return acc;
    //     }, new Map<string, ProcurementOrder[]>()) ?? new Map();
    // }, [purchaseOrders]);

    const posByProject = useMemo(() => {
        const filteredPOs = purchaseOrders?.filter(po => {
            // Apply filter only to creation date
            return isDateInPeriod(po.creation, startDate, endDate);
        }) || [];

        return filteredPOs.reduce((acc, po) => {
            if (po.project) {
                (acc.get(po.project) || acc.set(po.project, []).get(po.project))!.push(po);
            }
            return acc;
        }, new Map<string, ProcurementOrder[]>());
    }, [purchaseOrders, startDate, endDate]); // <--- NEW DEPENDENCIES


    // const srsByProject = useMemo(() => {
    //     return serviceRequests?.reduce((acc, sr) => {
    //         if (sr.project) {
    //             (acc.get(sr.project) || acc.set(sr.project, []).get(sr.project))!.push(sr);
    //         }
    //         return acc;
    //     }, new Map<string, ServiceRequests[]>()) ?? new Map();
    // }, [serviceRequests]);


    const srsByProject = useMemo(() => {
        const filteredSRs = serviceRequests?.filter(sr => {
            // Apply filter only to creation date
            return isDateInPeriod(sr.creation, startDate, endDate);
        }) || [];
        
        return filteredSRs.reduce((acc, sr) => {
            if (sr.project) {
                (acc.get(sr.project) || acc.set(sr.project, []).get(sr.project))!.push(sr);
            }
            return acc;
        }, new Map<string, ServiceRequests[]>());
    }, [serviceRequests, startDate, endDate]); // <--- NEW DEPENDENCIES

    // const totalInflowByProject = useMemo(() => {
    //     return inflowsData?.reduce((acc, inflow) => {
    //         if (inflow.project) {
    //             acc.set(inflow.project, (acc.get(inflow.project) || 0) + parseNumber(inflow.amount));
    //         }
    //         return acc;
    //     }, new Map<string, number>()) ?? new Map();
    // }, [inflowsData]);

      const totalInflowByProject = useMemo(() => {
         const filteredInflows = inflowsData?.filter(inflow => {
            // Inflows typically only have 'creation'
            return isDateInPeriod(inflow.payment_date, startDate, endDate); 
        }) || [];
        
        return filteredInflows.reduce((acc, inflow) => {
            if (inflow.project) {
                acc.set(inflow.project, (acc.get(inflow.project) || 0) + parseNumber(inflow.amount));
            }
            return acc;
        }, new Map<string, number>()) ?? new Map();
    }, [inflowsData, startDate, endDate]); // <--- NEW DEPENDENCIES


    // const totalProjectInvoiceByProject = useMemo(() => {
    //     return projectInvoiceData?.reduce((acc, inv) => {
    //         if (inv.project) {
    //             acc.set(inv.project, (acc.get(inv.project) || 0) + parseNumber(inv.amount));
    //         }
    //         return acc;
    //     }, new Map<string, number>()) ?? new Map();
    // }, [projectInvoiceData]);

     const totalProjectInvoiceByProject = useMemo(() => {
        const filteredInvoices = projectInvoiceData?.filter(inv => {
            // Project Invoices should be filtered by 'creation' or a specific 'invoice_date' field if present
            return isDateInPeriod(inv.invoice_date, startDate, endDate); 
        }) || [];
        
        return filteredInvoices.reduce((acc, inv) => {
            if (inv.project) {
                acc.set(inv.project, (acc.get(inv.project) || 0) + parseNumber(inv.amount));
            }
            return acc;
        }, new Map<string, number>()) ?? new Map();
    }, [projectInvoiceData, startDate, endDate]); // <--- NEW DEPENDENCIES


    // const totalOutflowByProject = useMemo(() => {
    //     return paymentsData?.reduce((acc, payment) => {
    //         if (payment.project) {
    //             acc.set(payment.project, (acc.get(payment.project) || 0) + parseNumber(payment.amount));
    //         }
    //         return acc;
    //     }, new Map<string, number>()) ?? new Map();
    // }, [paymentsData]);

    // --- (Indicator) NEW: Create a map for Project Expenses totals ---
    
     const totalOutflowByProject = useMemo(() => {
        const filteredPayments = paymentsData?.filter(payment => {
            // Payments should be filtered by 'payment_date' or 'creation'
            return isDateInPeriod(payment.payment_date, startDate, endDate); 
        }) || [];

        return filteredPayments.reduce((acc, payment) => {
            if (payment.project) {
                acc.set(payment.project, (acc.get(payment.project) || 0) + parseNumber(payment.amount));
            }
            return acc;
        }, new Map<string, number>()) ?? new Map();
    }, [paymentsData, startDate, endDate]); // <--- NEW DEPENDENCIES

    // const totalProjectExpensesByProject = useMemo(() => {
    //     return projectExpensesData?.reduce((acc, expense) => {
    //         if (expense.projects) { // The link field in the doctype is 'projects'
    //             acc.set(expense.projects, (acc.get(expense.projects) || 0) + parseNumber(expense.amount));
    //         }
    //         return acc;
    //     }, new Map<string, number>()) ?? new Map();
    // }, [projectExpensesData]);

    // --- (Indicator) NEW MEMOIZED MAP: Calculate total invoiced amount from POs and SRs ---
    
        const totalProjectExpensesByProject = useMemo(() => {
        const filteredExpenses = projectExpensesData?.filter(expense => {
            // Project Expenses should be filtered by 'creation'
            return isDateInPeriod(expense.creation, startDate, endDate); 
        }) || [];
        
        return filteredExpenses.reduce((acc, expense) => {
            if (expense.projects) { 
                acc.set(expense.projects, (acc.get(expense.projects) || 0) + parseNumber(expense.amount));
            }
            return acc;
        }, new Map<string, number>()) ?? new Map();
    }, [projectExpensesData, startDate, endDate]); // <--- NEW DEPENDENCIES


    
    // const totalPoSrInvoicedByProject = useMemo(() => {
    //     const projectTotals = new Map<string, number>();

    //     // Process Purchase Orders
    //     purchaseOrders?.forEach(po => {
    //         if (po.project && po.invoice_data) {
    //             const currentTotal = projectTotals.get(po.project) || 0;
    //             // getTotalInvoiceAmount is the utility function that iterates through the invoice_data JSON
    //             projectTotals.set(po.project, currentTotal + getTotalInvoiceAmount(po.invoice_data));
    //         }
    //     });

    //     // Process Service Requests
    //     serviceRequests?.forEach(sr => {
    //         if (sr.project && sr.invoice_data) {
    //             const currentTotal = projectTotals.get(sr.project) || 0;
    //             projectTotals.set(sr.project, currentTotal + getTotalInvoiceAmount(sr.invoice_data));
    //         }
    //     });

    //     return projectTotals;
    // }, [purchaseOrders, serviceRequests]);


     const totalPoSrInvoicedByProject = useMemo(() => {
        const projectTotals = new Map<string, number>();

        // Process Purchase Orders and Service Requests (from the full, UNFILTERED lists)
        // We MUST use the original purchaseOrders/serviceRequests and filter the invoice lines individually
        [...(purchaseOrders || []), ...(serviceRequests || [])].forEach(doc => {
            const project = doc.project || doc.project;
            const invoiceData = doc.invoice_data?.data;

            if (project && invoiceData) {
                let invoiceSum = 0;
                for (const dateStr in invoiceData) {
                    // Filter the actual invoice date
                    if (isDateInPeriod(dateStr, startDate, endDate)) { 
                // console.log("dateStr",dateStr)
                        
                        invoiceSum += parseNumber(invoiceData[dateStr].amount);
                    }
                }
                if (invoiceSum > 0) {
                    const currentTotal = projectTotals.get(project) || 0;
                    projectTotals.set(project, currentTotal + invoiceSum);
                }
            }
        });

        return projectTotals;
    }, [purchaseOrders, serviceRequests, startDate, endDate]); // <--- NEW DEPENDENCIES
    

        const getProjectCreditAndDue = useMemo(() => 
        memoize((projId: string): { TotalPurchaseOverCredit: number; CreditPaidAmount: number } => {
            if (!CreditData || !projId) {
                return { TotalPurchaseOverCredit: 0, CreditPaidAmount: 0 };
            }
// console.log("CreditData",CreditData)
              return CreditData.reduce(
                (totals, term) => {
                    if (term.project === projId) {
                        const amount = parseNumber(term.amount);

                        // 1. Rule for 'TotalPurchaseOverCredit' (Based on DUE DATE)
                        // Sums all credit terms that were scheduled to be DUE within the period.
                        if (isDateInPeriod(term.due_date, startDate, endDate)) { 
                            // Check if it's a valid term (term_status is not empty/null)
                            if (term.term_status) { 
                                totals.TotalPurchaseOverCredit += amount;
                            }
                        }

                        // 2. Rule for 'CreditPaidAmount' (Based on PAID STATUS and MODIFIED DATE)
                        // Sums all terms that were marked 'Paid' within the period.
                        if (term.term_status === "Paid") {
                            // The user's requested logic: filter paid terms by the modified date.
                            if (isDateInPeriod(term.modified, startDate, endDate)) {
                            // console.log("term.modified",term.term_modified,term.ptname)

                                totals.CreditPaidAmount += amount;
                            }
                        }
                    }
                    return totals;
                },
                { TotalPurchaseOverCredit: 0, CreditPaidAmount: 0 }
            );
        }), 
    [CreditData,startDate, endDate]); // This calculation depends only on CreditData


    // --- Memoized Function for Per-Project Calculation ---
    const getProjectCalculatedFields = useCallback(
        memoize((projectId: string): ProjectCalculatedFields | null => {
            // Important: If any of the dependent global data is still loading,
            // we cannot reliably calculate. The component using this should check `isLoadingGlobalDeps`.
            if (isLoadingPOs || isLoadingSRs || isLoadingInflows || isLoadingProjectInvoice || isLoadingPayments || isLoadingProjectExpenses) {
                return null; // Indicate that data isn't ready for this calculation
            }

            const relatedPOs = posByProject.get(projectId) || [];
            const relatedSRs = srsByProject.get(projectId) || [];
// console.log("DEBUG: relatedPOs, relatedSRs",relatedPOs,relatedSRs)
            let totalInvoiced = 0;
            relatedPOs.forEach(po => {
                totalInvoiced += getPOTotal(po)?.totalWithTax || 0;
            });
            relatedSRs.forEach(sr => {
                const amount = getSRTotal(sr) || 0;
                totalInvoiced += sr?.gst === "true" ? amount * 1.18 : amount;
            });
            // console.log("DEBUG: totalInvoiced",totalInvoiced)

            const totalInflow = totalInflowByProject.get(projectId) || 0;
            const totalProjectInvoiced = totalProjectInvoiceByProject.get(projectId) || 0;
            const poSrPaymentOutflow = totalOutflowByProject.get(projectId) || 0;
            const projectExpenseOutflow = totalProjectExpensesByProject.get(projectId) || 0;

            // The new combined total
            const totalOutflow = poSrPaymentOutflow + projectExpenseOutflow;

                        // ✨ Call your new memoized function to get the credit/due totals
            const { TotalPurchaseOverCredit, CreditPaidAmount } = getProjectCreditAndDue(projectId);

            // Get the newly calculated invoiced amount from our map
            const totalPoSrInvoiced = totalPoSrInvoicedByProject.get(projectId) || 0;
            return {
                totalInvoiced: parseNumber(totalInvoiced),
                totalPoSrInvoiced: parseNumber(totalPoSrInvoiced), // Add the new value here
                totalProjectInvoiced: parseNumber(totalProjectInvoiced),
                totalInflow: parseNumber(totalInflow),
                totalOutflow: parseNumber(totalOutflow),
                TotalPurchaseOverCredit: TotalPurchaseOverCredit, // ✨ Add the new value
                CreditPaidAmount: CreditPaidAmount,     
            };
        }),
        [
            // Add the new map to the dependency array
            posByProject, srsByProject, totalInflowByProject, totalProjectInvoiceByProject, totalOutflowByProject, totalPoSrInvoicedByProject,
            isLoadingPOs, isLoadingSRs, isLoadingInflows, isLoadingProjectInvoice, isLoadingPayments,getProjectCreditAndDue,CreditData,startDate,endDate,
        ]
    );

    const isLoadingGlobalDeps = isLoadingPOs || isLoadingSRs || isLoadingInflows || isLoadingProjectInvoice || isLoadingPayments;
    const globalDepsError = errorPOs || errorSRs || errorInflows || errorProjectInvoice || errorPayments || errorProjectExpenses;

    return {
        getProjectCalculatedFields,
        isLoadingGlobalDeps,
        globalDepsError: globalDepsError instanceof Error ? globalDepsError : null,
        mutatePOs,
        mutateSRs,
        mutateInflows,
        mutateProjectInvoice,
        mutatePayments,
        mutateProjectExpenses
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