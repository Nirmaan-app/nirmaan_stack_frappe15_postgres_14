// src/pages/ProjectExpenses/AllProjectExpenses.tsx

import React from 'react';
import { ProjectExpensesList } from './ProjectExpensesList';

const AllProjectExpensesPage: React.FC = () => {
    // This component renders the reusable list WITHOUT a projectId,
    // so it shows all expenses.
    return (
        <div className="flex-1 space-y-4 p-4 md:p-6">
            <div className="flex items-center justify-between">
                <h2 className="text-3xl font-bold tracking-tight">All Project Expenses</h2>
            </div>
            <ProjectExpensesList />
        </div>
    );
};

export default AllProjectExpensesPage;