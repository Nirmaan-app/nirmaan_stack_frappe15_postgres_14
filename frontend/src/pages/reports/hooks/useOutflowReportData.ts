// /workspace/development/frappe-bench/apps/nirmaan_stack/frontend/src/pages/reports/hooks/useOutflowReportData.ts

import { useMemo } from 'react';
import { useFrappeGetDocList } from 'frappe-react-sdk';
import { ProjectPayments } from '@/types/NirmaanStack/ProjectPayments';
import { ProjectExpenses } from '@/types/NirmaanStack/ProjectExpenses';
import { parseNumber } from '@/utils/parseNumber';

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
    ref: string;
    source_doctype: 'Project Payments' | 'Project Expenses'; // For linking or debugging
    originalDoc: ProjectPayments | ProjectExpenses; // Keep the original document
}

export const useOutflowReportData = () => {
    // 1. Fetch all 'Paid' Project Payments
    const { data: projectPaymentsData, isLoading: isLoadingPayments, error: paymentsError } = useFrappeGetDocList<ProjectPayments>('Project Payments', {
        fields: [
            'name',
            'payment_date',
            'project',
            'vendor',
            'amount',
            'tds',
            'document_type',
            'document_name',
            'utr'
        ],
        filters: [['status', '=', 'Paid']],
        limit: 0
    }, 'outflow-project-payments');



    // 2. Fetch all Project Expenses
    const { data: projectExpensesData, isLoading: isLoadingExpenses, error: expensesError } = useFrappeGetDocList<ProjectExpenses>('Project Expenses', {
        fields: [
            'name',
            'payment_date',
            'projects', // Note: field name is 'projects' here
            'vendor',
            'amount',
            'type', // This is the link to 'Expense Type' DocType
            'type.expense_name as expense_type_name', // <--- THIS IS THE FIX
            'description',
            'comment'
        ],
        limit: 0
    }, 'outflow-project-expenses');

    //     // --- DEBUGGING CONSOLE LOGS ---
    // console.log("[Outflow Debug] Raw Project Payments Data:", projectPaymentsData);
    // console.log("[Outflow Debug] Raw Project Expenses Data:", projectExpensesData);
    // --- END DEBUGGING ---


    // 3. Combine and standardize the data once it's all fetched
    const reportData = useMemo<OutflowRowData[]>(() => {
        if (!projectPaymentsData || !projectExpensesData) {
            return [];
        }

        // Map Project Payments to the standard OutflowRowData format
        const mappedPayments: OutflowRowData[] = projectPaymentsData.map(p => {
            let expenseType = 'Unknown Payment';
            if (p.document_type === 'Procurement Orders') {
                expenseType = 'Payment Against PO';
            } else if (p.document_type === 'Service Requests') {
                expenseType = 'Payment Against SR';
            }
            
            const amountPaid = parseNumber(p.amount) - parseNumber(p.tds);

            return {
                id: p.name,
                payment_date: p.payment_date,
                project: p.project,
                vendor: p.vendor,
                amount: amountPaid,
                expense_type: expenseType,
                details: p.document_name, // e.g., PO-00123
                ref: p.utr || '--',
                source_doctype: 'Project Payments',
                originalDoc: p
            };
        });

        // Map Project Expenses to the standard OutflowRowData format
        const mappedExpenses: OutflowRowData[] = projectExpensesData.map(e => ({
            id: e.name,
            payment_date: e.payment_date,
            project: e.projects, // field name is 'projects'
            vendor: e.vendor,
            amount: parseNumber(e.amount),
            expense_type: e.expense_type_name || e.type, // Use fetched label, fallback to ID
            details: e.description,
            ref: e.comment || '--',
            source_doctype: 'Project Expenses',
            originalDoc: e
        }));

        const combined = [...mappedPayments, ...mappedExpenses];
        
        // --- DEBUGGING CONSOLE LOG ---
        // console.log("[Outflow Debug] Final Merged Report Data:", combined);
        // --- END DEBUGGING ---

        return combined;


    }, [projectPaymentsData, projectExpensesData]);

    return {
        reportData,
        isLoading: isLoadingPayments || isLoadingExpenses,
        error: paymentsError || expensesError,
    };
};