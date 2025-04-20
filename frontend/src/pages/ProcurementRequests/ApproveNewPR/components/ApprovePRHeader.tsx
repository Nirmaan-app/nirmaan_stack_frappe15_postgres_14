import React from 'react';
import { ProcurementActionsHeaderCard } from '@/components/helpers/ProcurementActionsHeaderCard'; // Assuming this is reusable
import { OrderData, Project } from '../types';

interface ApprovePRHeaderProps {
    orderData: OrderData;
    projectDoc?: Project; // Optional project details
}

export const ApprovePRHeader: React.FC<ApprovePRHeaderProps> = ({ orderData, projectDoc }) => {
    // You might need to adapt ProcurementActionsHeaderCard to accept OrderData or map fields
    const adaptedOrderDataForCard = {
        // Map fields from OrderData to what ProcurementActionsHeaderCard expects
        name: orderData.name,
        project: orderData.project,
        creation: orderData.creation,
        modified_by: orderData.owner,
        status: orderData.workflow_state, // Or map as needed
        project_name: projectDoc?.project_name,
        work_package: orderData.work_package,
    };

    return <ProcurementActionsHeaderCard orderData={adaptedOrderDataForCard} pr={true} />;
};