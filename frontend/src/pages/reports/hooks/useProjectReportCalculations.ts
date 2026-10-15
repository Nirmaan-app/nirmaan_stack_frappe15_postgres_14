// File: frontend/src/pages/reports/hooks/useProjectReportCalculations.ts
import { useFrappeGetCall, useFrappeGetDocList, FrappeDoc, GetDocListArgs } from 'frappe-react-sdk';
import { useMemo, useCallback } from 'react';
import { Projects } from '@/types/NirmaanStack/Projects';
import { ProcurementOrder } from '@/types/NirmaanStack/ProcurementOrders';
import { ServiceRequests } from '@/types/NirmaanStack/ServiceRequests';
import { VendorInvoice } from '@/types/NirmaanStack/VendorInvoice';
import { parseNumber } from '@/utils/parseNumber';
import {
    queryKeys,
    getPOForProjectInvoiceOptions,
    getSRForProjectInvoiceOptions,
    getProjectInvoiceReportListOptions,
} from '@/config/queryKeys';
import { ProjectInvoice } from '@/types/NirmaanStack/ProjectInvoice';
import { ProjectMoney } from '@/types/NirmaanStack/ProjectMoney';
import { useProjectAllCredits } from '@/pages/projects/hooks/useProjectAllCredits';
import { format } from 'date-fns';
import { isDateInPeriod } from './useVendorLedgerCalculations';

interface ProjectReportParams {
    /** The Cash Sheet's projects: the server's money figures are asked for these. */
    projectIds: string[];
    startDate?: Date | null;
    endDate?: Date | null;
}

// Define the structure for the calculated fields
export interface ProjectCalculatedFields {
    totalInvoiced: number;
    // 18% of the in-range Approved WOs raised with GST off — the GST never charged on them.
    notionalGst: number;
    totalPoSrInvoiced: number; // This is the combined invoiced amount for POs and SRs
    totalProjectInvoiced: number;
    // Inflow, Outflow, Current Liabilities and the Cashflow Gap are the server's project figures for
    // the chosen dates: the one figure CEO Hold and the Projects list read too.
    totalInflow: number;
    totalOutflow: number;
    totalLiabilities: number;
    cashflowGap: number;
    TotalPurchaseOverCredit: number;
    CreditPaidAmount: number;
    CreditDueAmount: number; // Credit terms that are "Due" (Created + due_date <= today)
}

// The hook's return type
export interface UseProjectReportCalculationsResult {
    getProjectCalculatedFields: (projectId: string) => ProjectCalculatedFields | null;
    isLoadingGlobalDeps: boolean; // Indicates if the underlying data for calculations is loading
    globalDepsError: Error | null;
    // Mutators for cache invalidation if needed from the component using this hook
    mutatePOs: () => Promise<unknown>;
    mutateSRs: () => Promise<unknown>;
    mutateProjectInvoice: () => Promise<unknown>;
    mutateProjectMoney: () => Promise<unknown>;
}

const NO_MONEY: ProjectMoney = {
    po_outflow: 0, wo_outflow: 0, expense_outflow: 0, outflow: 0, liabilities: 0, inflow: 0, cashflow_gap: 0,
};


export const useProjectReportCalculations = (params: ProjectReportParams): UseProjectReportCalculationsResult => {

    const { projectIds, startDate, endDate } = params;

    // --- Fetch All Underlying Data Needed for Calculations ---
    const poOptions = getPOForProjectInvoiceOptions();
    const srOptions = getSRForProjectInvoiceOptions();
    const projectInvoiceOptions = getProjectInvoiceReportListOptions();

    const poQueryKey = queryKeys.procurementOrders.list(poOptions);
    const srQueryKey = queryKeys.serviceRequests.list(srOptions);
    const projectInvoiceQueryKey = queryKeys.projectInvoices.list(projectInvoiceOptions);

    const { creditTerms: CreditData } = useProjectAllCredits(undefined);

    const { data: purchaseOrders, isLoading: isLoadingPOs, error: errorPOs, mutate: mutatePOs } =
        useFrappeGetDocList<ProcurementOrder>(poQueryKey[0], poOptions as GetDocListArgs<FrappeDoc<ProcurementOrder>>, poQueryKey);

    const { data: serviceRequests, isLoading: isLoadingSRs, error: errorSRs, mutate: mutateSRs } =
        useFrappeGetDocList<ServiceRequests>(srQueryKey[0], srOptions as GetDocListArgs<FrappeDoc<ServiceRequests>>, srQueryKey);

    const { data: projectInvoiceData, isLoading: isLoadingProjectInvoice, error: errorProjectInvoice, mutate: mutateProjectInvoice } =
        useFrappeGetDocList<ProjectInvoice>(projectInvoiceQueryKey[0], projectInvoiceOptions as GetDocListArgs<FrappeDoc<ProjectInvoice>>, projectInvoiceQueryKey);

    // --- Fetch all Vendor Invoices for project report calculations ---
    const { data: vendorInvoicesData, isLoading: isLoadingVendorInvoices, error: errorVendorInvoices } =
        useFrappeGetDocList<VendorInvoice>('Vendor Invoices', {
            filters: [["status", "=", "Approved"]],
            fields: ['name', 'project', 'invoice_date', 'invoice_amount'],
            limit: 0,
        }, 'AllVendorInvoicesForProjectReports');

    const shouldFilterByDate = !!(startDate && endDate);

    // --- The server's project outflow, Current Liabilities, inflow and cashflow gap (ADR-0034) ---
    // Each payment, refund, expense and inflow counts on its own date; liabilities cover the POs created
    // in the range. One POST for every project (a GET with ~300 names would pass nginx's URL limit).
    const fromDate = shouldFilterByDate ? format(startDate!, 'yyyy-MM-dd') : null;
    const toDate = shouldFilterByDate ? format(endDate!, 'yyyy-MM-dd') : null;
    const {
        data: projectsMoney,
        isLoading: isLoadingMoney,
        error: errorMoney,
        mutate: mutateProjectMoney,
    } = useFrappeGetCall<{ message: Record<string, ProjectMoney> }>(
        "nirmaan_stack.api.projects.project_money.get_projects_money",
        { projects: projectIds, ...(fromDate && { from_date: fromDate, to_date: toDate }) },
        projectIds.length ? ["CashSheetProjectMoney", fromDate ?? "", toDate ?? "", projectIds.join(",")] : null,
        undefined,
        "POST"
    );

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
    }, [purchaseOrders, startDate, endDate, shouldFilterByDate]);

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

     // --- 3. Conditional Filtering: totalProjectInvoiceByProject ---
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
    }, [projectInvoiceData, startDate, endDate, shouldFilterByDate]);

     // Calculate PO/SR invoice totals using Vendor Invoices doctype
    const totalPoSrInvoicedByProject = useMemo(() => {
        const projectTotals = new Map<string, number>();

        // Process Vendor Invoices directly (grouped by project)
        (vendorInvoicesData || []).forEach(invoice => {
            const project = invoice.project;
            if (!project) return;

            // Filter by date range if applicable
            const shouldInclude = !shouldFilterByDate || isDateInPeriod(invoice.invoice_date, startDate || null, endDate || null);

            if (shouldInclude) {
                const currentTotal = projectTotals.get(project) || 0;
                projectTotals.set(project, currentTotal + parseNumber(invoice.invoice_amount));
            }
        });

        return projectTotals;
    }, [vendorInvoicesData, startDate, endDate, shouldFilterByDate]);

     const getProjectCreditAndDue = useCallback(
        (projId: string): { TotalPurchaseOverCredit: number; CreditPaidAmount: number; CreditDueAmount: number } => {
            if (!CreditData || !projId) {
                return { TotalPurchaseOverCredit: 0, CreditPaidAmount: 0, CreditDueAmount: 0 };
            }

            return CreditData.reduce(
                (totals, term) => {
                    if (term.project === projId) {
                        const amount = parseNumber(term.amount);

                        // Check 1: TotalPurchaseOverCredit (Due Date)
                        // Use due_date from child table
                        const filterDue = !shouldFilterByDate || isDateInPeriod(term.due_date, startDate, endDate);
                        if (filterDue && term.term_status) { // User's edit: sums ALL credits in range
                            totals.TotalPurchaseOverCredit += amount;
                        }

                        // Check 1.1: CreditDueAmount (Created + due_date <= today) - Replaces old "Scheduled"
                        // Only count as "due" if term_status is Created AND due_date has passed
                        if (filterDue && term.term_status === 'Created') {
                            const dueDate = term.due_date ? new Date(term.due_date) : null;
                            if (dueDate) {
                                const todayCheck = new Date();
                                todayCheck.setHours(0, 0, 0, 0);
                                dueDate.setHours(0, 0, 0, 0);
                                if (dueDate <= todayCheck) {
                                    totals.CreditDueAmount += amount;
                                }
                            }
                        }

                        // Check 2: CreditPaidAmount (Modified Date - fallback to creation/due_date if needed or assume parent modified)
                        // Note: term.modified comes from Parent Procurement Order in the current hook setup
                        const filterPaid = !shouldFilterByDate || isDateInPeriod(term.modified, startDate, endDate);
                        if (term.term_status === "Paid" && filterPaid) {
                            totals.CreditPaidAmount += amount;
                        }

                    }
                    return totals;
                },
                { TotalPurchaseOverCredit: 0, CreditPaidAmount: 0, CreditDueAmount: 0 }
            );
        },
        [CreditData, startDate, endDate, shouldFilterByDate]
    );

    const isLoadingGlobalDeps = isLoadingPOs || isLoadingSRs || isLoadingProjectInvoice || isLoadingVendorInvoices || isLoadingMoney;

    // --- Memoized Function for Per-Project Calculation ---
    const getProjectCalculatedFields = useCallback(
        (projectId: string): ProjectCalculatedFields | null => {
            // Important: If any of the dependent global data is still loading,
            // we cannot reliably calculate. The component using this should check `isLoadingGlobalDeps`.
            if (isLoadingGlobalDeps) {
                return null; // Indicate that data isn't ready for this calculation
            }

            const relatedPOs = posByProject.get(projectId) || [];
            const relatedSRs = srsByProject.get(projectId) || [];

            // Both PO.total_amount and SR.total_amount are kept fresh by their
            // respective doctype hooks and already include GST when applicable.
            // No client-side GST math required.
            let totalInvoiced = 0;
            let notionalGst = 0;
            relatedPOs.forEach(po => {
                totalInvoiced += parseNumber(po?.total_amount);
            });
            relatedSRs.forEach(sr => {
                totalInvoiced += parseNumber(sr?.total_amount);
                // Notional GST: a GST-off WO's total excludes GST, so 18% of it is the GST
                // it never charged. Same date-filtered WO set as the PO+SR value above.
                if (sr?.gst !== "true") {
                    notionalGst += parseNumber(sr?.total_amount) * 0.18;
                }
            });

            const totalProjectInvoiced = totalProjectInvoiceByProject.get(projectId) || 0;
            const money = projectsMoney?.message?.[projectId] ?? NO_MONEY;

            const { TotalPurchaseOverCredit, CreditPaidAmount, CreditDueAmount } = getProjectCreditAndDue(projectId);

            // Get the newly calculated invoiced amount from our map
            const totalPoSrInvoiced = totalPoSrInvoicedByProject.get(projectId) || 0;

            return {
                totalInvoiced: parseNumber(totalInvoiced),
                notionalGst: notionalGst,
                totalPoSrInvoiced: parseNumber(totalPoSrInvoiced),
                totalProjectInvoiced: parseNumber(totalProjectInvoiced),
                totalInflow: parseNumber(money.inflow),
                totalOutflow: parseNumber(money.outflow),
                totalLiabilities: parseNumber(money.liabilities),
                cashflowGap: parseNumber(money.cashflow_gap),
                TotalPurchaseOverCredit: TotalPurchaseOverCredit,
                CreditPaidAmount: CreditPaidAmount,
                CreditDueAmount: CreditDueAmount,
            };
        },
        [
            posByProject, srsByProject, totalProjectInvoiceByProject, totalPoSrInvoicedByProject, projectsMoney,
            isLoadingGlobalDeps, getProjectCreditAndDue,
        ]
    );

    const globalDepsError = errorPOs || errorSRs || errorProjectInvoice || errorVendorInvoices || errorMoney;

    return {
        getProjectCalculatedFields,
        isLoadingGlobalDeps,
        globalDepsError: globalDepsError instanceof Error ? globalDepsError : null,
        mutatePOs,
        mutateSRs,
        mutateProjectInvoice,
        mutateProjectMoney,
    };
};


// This interface is what your table rows will primarily be (base Project data).
// The calculated fields will be fetched/rendered by cell components.
export interface ProcessedProject extends Projects {
    // These fields are no longer pre-calculated and merged here.
    // They are dynamically fetched/calculated by the cell renderers.
    // For typing purposes in cells or if you enrich data for export, they can be optional.
    totalInvoiced?: number;
    totalPoSrInvoiced: number; // This is the combined invoiced amount for POs and SRs
    totalProjectInvoiced?: number;
    totalInflow?: number;
    totalOutflow?: number;
    totalCredit?: number; // For credit outstanding
}
