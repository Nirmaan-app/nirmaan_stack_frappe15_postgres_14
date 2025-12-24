// /workspace/development/frappe-bench/apps/nirmaan_stack/frontend/src/pages/reports/hooks/useOutflowReportData.ts

import { useMemo } from 'react';
import { useFrappeGetDocList } from 'frappe-react-sdk';
import { ProjectPayments } from '@/types/NirmaanStack/ProjectPayments';
import { ProjectExpenses } from '@/types/NirmaanStack/ProjectExpenses';
import { parseNumber } from '@/utils/parseNumber';
import { useOrderTotals } from '@/hooks/useOrderTotals';
import { formatISO, parseISO, isWithinInterval } from 'date-fns';

/**
 * Helper function to check if a date string is within the period
 * Falls back to creation date if payment_date is not available
 */
const isDateInPeriod = (paymentDate: string | null | undefined, creationDate: string, startDate: Date, endDate: Date): boolean => {
    try {
        const dateToCheck = paymentDate || creationDate; // Fallback to creation
        if (!dateToCheck) return false;
        const date = parseISO(dateToCheck);
        return isWithinInterval(date, { start: startDate, end: endDate });
    } catch {
        return false;
    }
};

/**
 * A standardized interface for a single row in our Outflow Report.
 * This ensures that data from both ProjectPayments and ProjectExpenses
 * can be displayed uniformly in the table.
 */
export interface OutflowRowData {
    id: string; // Unique document name (e.g., PP-001 or PE-001)
    payment_date: string;
    project: string;
    vendor: string;
    amount: number;
    expense_type: string;
    details: string;
     effective_gst: number; // <-- Add effective_gst field
    ref: string;
    source_doctype: 'Project Payments' | 'Project Expenses'; // For linking or debugging
    originalDoc: ProjectPayments | ProjectExpenses; // Keep the original document
}

interface UseOutflowReportDataParams {
    startDate?: Date;
    endDate?: Date;
}

export const useOutflowReportData = ({ startDate, endDate }: UseOutflowReportDataParams = {}) => {
    // Build date filters if dates are provided
    // NOTE: Date filtering moved to client-side to handle payments without payment_date
    const dateFilters = useMemo(() => {
        const filters: any[] = [['status', '=', 'Paid']];
        // Removed date filters from database query - will filter client-side instead
        return filters;
    }, []);

    const expenseFilters = useMemo(() => {
        const filters: any[] = [];
        // Removed date filters from database query - will filter client-side instead
        return filters;
    }, []);

    // 1. Fetch all 'Paid' Project Payments (no date filters - will filter client-side)
    const { data: projectPaymentsData, isLoading: isLoadingPayments, error: paymentsError } = useFrappeGetDocList<ProjectPayments>('Project Payments', {
        fields: [
            'name',
            'payment_date',
            'creation', // Added for fallback date filtering
            'project',
            'vendor',
            'amount',
            'tds',
            'document_type',
            'document_name',
            'utr'
        ],
        filters: dateFilters,
        limit: 0
    }, `outflow-project-payments-all`);

    const {getEffectiveGST} = useOrderTotals()


    // 2. Fetch all Project Expenses (no date filters - will filter client-side)
    const { data: projectExpensesData, isLoading: isLoadingExpenses, error: expensesError } = useFrappeGetDocList<ProjectExpenses>('Project Expenses', {
        fields: [
            'name',
            'payment_date',
            'creation', // Added for fallback date filtering
            'projects', // Note: field name is 'projects' here
            'vendor',
            'amount',
            'type', // This is the link to 'Expense Type' DocType
            'type.expense_name as expense_type_name', // <--- THIS IS THE FIX
            'description',
            'comment'
        ],
        filters: expenseFilters,
        limit: 0
    }, `outflow-project-expenses-all`);

    // 3. Combine and standardize the data once it's all fetched
    const reportData = useMemo<OutflowRowData[]>(() => {
        if (!projectPaymentsData || !projectExpensesData) {
            return [];
        }

        // Apply client-side date filtering to payments (with fallback to creation date)
        const filteredPayments = startDate && endDate
            ? projectPaymentsData.filter(p => isDateInPeriod(p.payment_date, p.creation, startDate, endDate))
            : projectPaymentsData;

        // Apply client-side date filtering to expenses (with fallback to creation date)
        const filteredExpenses = startDate && endDate
            ? projectExpensesData.filter(e => isDateInPeriod(e.payment_date, e.creation, startDate, endDate))
            : projectExpensesData;

        // Map Project Payments to the standard OutflowRowData format
        const mappedPayments: OutflowRowData[] = filteredPayments.map(p => {
            let expenseType = 'Unknown Payment';
            let effectiveGst;
            if (p.document_type === 'Procurement Orders') {
                expenseType = 'Payment Against PO';
             effectiveGst = getEffectiveGST(p.document_name, p.document_type);

            } else if (p.document_type === 'Service Requests') {
                expenseType = 'Payment Against SR';
             effectiveGst = getEffectiveGST(p.document_name, p.document_type);

            }
            
            // const amountPaid = parseNumber(p.amount) - parseNumber(p.tds);
            const amountPaid = parseNumber(p.amount);


            return {
                id: p.name,
                payment_date: p.payment_date,
                project: p.project,
                vendor: p.vendor,
                amount: amountPaid,
                expense_type: expenseType,
                details: p.document_name, // e.g., PO-00123
                effective_gst: effectiveGst,
                ref: p.utr || '--',
                source_doctype: 'Project Payments',
                originalDoc: p
            };
        });

        // Map Project Expenses to the standard OutflowRowData format
        const mappedExpenses: OutflowRowData[] = filteredExpenses.map(e => ({
            id: e.name,
            payment_date: e.payment_date,
            project: e.projects, // field name is 'projects'
            vendor: e.vendor,
            amount: parseNumber(e.amount),
            expense_type: e.expense_type_name || e.type, // Use fetched label, fallback to ID
            details: e.description,
            effective_gst: 0,
            ref: e.comment || '--',
            source_doctype: 'Project Expenses',
            originalDoc: e
        }));

        const combined = [...mappedPayments, ...mappedExpenses];
        
        // --- DEBUGGING CONSOLE LOG ---
        // console.log("[Outflow Debug] Final Merged Report Data:", combined);
        // --- END DEBUGGING ---

        return combined;


    }, [projectPaymentsData, projectExpensesData, startDate, endDate]);

    return {
        reportData,
        isLoading: isLoadingPayments || isLoadingExpenses,
        error: paymentsError || expensesError,
    };
};