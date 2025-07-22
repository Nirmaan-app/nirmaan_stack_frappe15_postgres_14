// src/pages/ProjectExpenses/AllProjectExpenses.tsx

import React from 'react';
import { ProjectExpensesList } from './ProjectExpensesList';

const AllProjectExpensesPage: React.FC = () => {
    // This component renders the reusable list WITHOUT a projectId,
    // so it shows all expenses.
    return (

        <ProjectExpensesList />
    );
};

export default AllProjectExpensesPage;