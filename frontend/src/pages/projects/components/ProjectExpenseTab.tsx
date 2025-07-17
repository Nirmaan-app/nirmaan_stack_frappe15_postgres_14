// src/pages/projects/components/ProjectExpensesTab.tsx

import React from 'react';
import { ProjectExpensesList } from '../../ProjectExpenses/ProjectExpensesList'; // Adjust path if needed

interface ProjectExpensesTabProps {
    projectId: string;
}

export const ProjectExpensesTab: React.FC<ProjectExpensesTabProps> = ({ projectId }) => {
    // This component now just renders the reusable list, passing the specific projectId.
    return <ProjectExpensesList projectId={projectId} />;
};