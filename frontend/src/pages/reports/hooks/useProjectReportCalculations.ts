// File: frontend/src/pages/reports/hooks/useProjectReportCalculations.ts
import { useFrappeGetDocList, FrappeDoc, GetDocListArgs } from 'frappe-react-sdk';
import { useMemo, useCallback } from 'react';
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
    totalLiabilities: number; // Current liabilities
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
            fields: ['projects', 'amount', 'payment_date'], // Only fields needed for this calculation
            limit: 0,
        }, 'AllProjectExpensesForReports');

    // --- KEY CHANGE: Calculate once in the hook scope ---
    const shouldFilterByDate = useMemo(() => !!(startDate && endDate), [startDate, endDate]);
    // ---------------------------------------------------

    const posByProject = useMemo(() => {
        if (!purchaseOrders) return new Map();
       const docsToProcess = shouldFilterByDate ? purchaseOrders.filter(po => {
                // Only filter if we have a valid range
                return isDateInPeriod(po.creation, startDate, endDate);
            })
            : purchaseOrders; // If no dates, use the full list

        return docsToProcess.reduce((acc, po) => {
            if (po.project) {
                (acc.get(po.project) || acc.set(po.project, []).get(po.project))!.push(po);
            }
            return acc;
        }, new Map<string, ProcurementOrder[]>());
    }, [purchaseOrders, startDate, endDate, shouldFilterByDate]); // <--- ADDED shouldFilterByDate


    

     // --- 2. Conditional Filtering: srsByProject ---
    const srsByProject = useMemo(() => {
        if (!serviceRequests) return new Map();

        const docsToProcess = shouldFilterByDate
            ? serviceRequests.filter(sr => {
                return isDateInPeriod(sr.creation, startDate, endDate);
            })
            : serviceRequests; // If no dates, use the full list
        
        return docsToProcess.reduce((acc, sr) => {
            if (sr.project) {
                (acc.get(sr.project) || acc.set(sr.project, []).get(sr.project))!.push(sr);
            }
            return acc;
        }, new Map<string, ServiceRequests[]>());
    }, [serviceRequests, startDate, endDate, shouldFilterByDate]);
   

     // --- 3. Conditional Filtering: totalInflowByProject ---
    const totalInflowByProject = useMemo(() => {
         if (!inflowsData) return new Map();

         const docsToProcess = shouldFilterByDate
            ? inflowsData.filter(inflow => {
                // Use payment_date with fallback to creation date
                const dateToCheck = inflow.payment_date || inflow.creation;
                return isDateInPeriod(dateToCheck, startDate, endDate);
            })
            : inflowsData; // If no dates, use the full list

        const result = docsToProcess.reduce((acc, inflow) => {
            if (inflow.project) {
                acc.set(inflow.project, (acc.get(inflow.project) || 0) + parseNumber(inflow.amount));
            }
            return acc;
        }, new Map<string, number>());

        // Debug logging
        console.log('[totalInflowByProject] Recalculated:', {
            shouldFilterByDate,
            startDate,
            endDate,
            totalDocs: inflowsData?.length,
            filteredDocs: docsToProcess.length,
            projectCount: result.size,
            totalAmount: Array.from(result.values()).reduce((sum, val) => sum + val, 0)
        });

        return result;
    }, [inflowsData, startDate, endDate, shouldFilterByDate]); 

     // --- 4. Conditional Filtering: totalProjectInvoiceByProject ---
     const totalProjectInvoiceByProject = useMemo(() => {
        if (!projectInvoiceData) return new Map();

        const docsToProcess = shouldFilterByDate
            ? projectInvoiceData.filter(inv => {
                // Project Invoices should be filtered by 'invoice_date'
                return isDateInPeriod(inv.invoice_date, startDate, endDate); 
            })
            : projectInvoiceData; // If no dates, use the full list
        
        return docsToProcess.reduce((acc, inv) => {
            if (inv.project) {
                acc.set(inv.project, (acc.get(inv.project) || 0) + parseNumber(inv.amount));
            }
            return acc;
        }, new Map<string, number>());
    }, [projectInvoiceData, startDate, endDate, shouldFilterByDate]); // <--- UPDATED DEPENDENCIES



    // --- 5. Conditional Filtering: totalOutflowByProject (Project Payments) ---
     const totalOutflowByProject = useMemo(() => {
        if (!paymentsData) return new Map();

        const docsToProcess = shouldFilterByDate
            ? paymentsData.filter(payment => {
                // Payments should be filtered by 'payment_date' with fallback to 'creation'
                const dateToCheck = payment.payment_date || payment.creation;
                return isDateInPeriod(dateToCheck, startDate, endDate);
            })
            : paymentsData; // If no dates, use the full list

        const result = docsToProcess.reduce((acc, payment) => {
            if (payment.project) {
                acc.set(payment.project, (acc.get(payment.project) || 0) + parseNumber(payment.amount));
            }
            return acc;
        }, new Map<string, number>());

        // Debug logging
        console.log('[totalOutflowByProject] Recalculated:', {
            shouldFilterByDate,
            startDate,
            endDate,
            totalDocs: paymentsData?.length,
            filteredDocs: docsToProcess.length,
            projectCount: result.size,
            totalAmount: Array.from(result.values()).reduce((sum, val) => sum + val, 0)
        });

        return result;
    }, [paymentsData, startDate, endDate, shouldFilterByDate]); // <--- UPDATED DEPENDENCIES

    // --- 6. Conditional Filtering: totalProjectExpensesByProject ---
    const totalProjectExpensesByProject = useMemo(() => {
        if (!projectExpensesData) return new Map();

        const docsToProcess = shouldFilterByDate
            ? projectExpensesData.filter(expense => {
                // Project Expenses should be filtered by 'payment_date' (Updated from 'creation' for consistency)
                // Use payment_date if available, fallback to creation if null/undefined (though it should be there)
                const dateToCheck = expense.payment_date || expense.creation;
                return isDateInPeriod(dateToCheck, startDate, endDate); 
            })
            : projectExpensesData; // If no dates, use the full list
        
        return docsToProcess.reduce((acc, expense) => {
            if (expense.projects) { 
                acc.set(expense.projects, (acc.get(expense.projects) || 0) + parseNumber(expense.amount));
            }
            return acc;
        }, new Map<string, number>());
    }, [projectExpensesData, startDate, endDate, shouldFilterByDate]); // <--- UPDATED DEPENDENCIES


    


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
                    // Filter the actual invoice date - only if we have a date range
                    const shouldInclude = !shouldFilterByDate || isDateInPeriod(dateStr, startDate, endDate);
                    if (shouldInclude) {
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
    }, [purchaseOrders, serviceRequests, startDate, endDate, shouldFilterByDate]); // <--- ADDED shouldFilterByDate
    

         // Note: getProjectCreditAndDue's memoization logic:
    const getProjectCreditAndDue = useCallback(
        (projId: string): { TotalPurchaseOverCredit: number; CreditPaidAmount: number } => {
            if (!CreditData || !projId) {
                return { TotalPurchaseOverCredit: 0, CreditPaidAmount: 0 };
            }

            // The inner logic now just uses the pre-calculated flag
            return CreditData.reduce(
                (totals, term) => {
                    if (term.project === projId) {
                        const amount = parseNumber(term.amount);

                        // Check 1: TotalPurchaseOverCredit (Due Date)
                        const filterDue = !shouldFilterByDate || isDateInPeriod(term.due_date, startDate, endDate);
                        if (filterDue && term.term_status) {
                            totals.TotalPurchaseOverCredit += amount;
                        }

                        // Check 2: CreditPaidAmount (Modified Date)
                        const filterPaid = !shouldFilterByDate || isDateInPeriod(term.modified, startDate, endDate);
                        if (term.term_status === "Paid" && filterPaid) {
                            totals.CreditPaidAmount += amount;
                        }
                    }
                    return totals;
                },
                { TotalPurchaseOverCredit: 0, CreditPaidAmount: 0 }
            );
        },
        // Include shouldFilterByDate in the dependency array
        [CreditData, startDate, endDate, shouldFilterByDate]
    ); 

    
    // --- Memoized Function for Per-Project Calculation ---
    const getProjectCalculatedFields = useCallback(
        (projectId: string): ProjectCalculatedFields | null => {
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

            // Calculate Current Liabilities (Payable Amount Against Delivered - Amount Paid Against Delivered)
            const totalPayableAgainstDelivered = relatedPOs.reduce((sum, po) => sum + parseNumber(po.po_amount_delivered || 0), 0);
            const totalPaidAgainstDelivered = relatedPOs.reduce((sum, po) => {
                const amountPaid = parseNumber(po.amount_paid || 0);
                const poAmountDelivered = parseNumber(po.po_amount_delivered || 0);
                return sum + Math.min(amountPaid, poAmountDelivered);
            }, 0);
            const totalLiabilities = totalPayableAgainstDelivered - totalPaidAgainstDelivered;

            return {
                totalInvoiced: parseNumber(totalInvoiced),
                totalPoSrInvoiced: parseNumber(totalPoSrInvoiced), // Add the new value here
                totalProjectInvoiced: parseNumber(totalProjectInvoiced),
                totalInflow: parseNumber(totalInflow),
                totalOutflow: parseNumber(totalOutflow),
                TotalPurchaseOverCredit: TotalPurchaseOverCredit, // ✨ Add the new value
                CreditPaidAmount: CreditPaidAmount,
                totalLiabilities: totalLiabilities,
            };
        },
        [
            // Add the new map to the dependency array
            posByProject, srsByProject, totalInflowByProject, totalProjectInvoiceByProject, totalOutflowByProject, totalPoSrInvoicedByProject,
            isLoadingPOs, isLoadingSRs, isLoadingInflows, isLoadingProjectInvoice, isLoadingPayments, getProjectCreditAndDue, CreditData, startDate, endDate, totalProjectExpensesByProject,
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