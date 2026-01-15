import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { SetupTDSRepositoryDialog, TDSRepositoryData, ViewCard } from './components';

interface TDSRepositoryViewProps {
    data: TDSRepositoryData;
    projectId: string;
    onUpdate: (data: TDSRepositoryData) => Promise<void>;
}

export const TDSRepositoryView: React.FC<TDSRepositoryViewProps> = ({ data, onUpdate }) => {
    const [isSetupDialogOpen, setIsSetupDialogOpen] = useState(false);
    const [isUpdating, setIsUpdating] = useState(false);

    const handleUpdateConfirm = async (updatedData: TDSRepositoryData) => {
        setIsUpdating(true);
        try {
            await onUpdate(updatedData);
            setIsSetupDialogOpen(false);
        } catch (error) {
            console.error("Update failed", error);
            // Optionally handle error state here, but parent likely handles toast
        } finally {
            setIsUpdating(false);
        }
    };

    return (
        <div className="p-8 bg-white min-h-full">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
                 <div>
                    <h2 className="text-xl font-semibold text-gray-900">Set up TDS Repository</h2>
                    <p className="text-sm text-gray-500 mt-1">
                        These details will appear for all TDS submissions for this project
                    </p>
                 </div>
                 <Button 
                    onClick={() => setIsSetupDialogOpen(true)} 
                    variant="outline"
                    className="bg-white border-gray-300 text-gray-900 hover:bg-gray-50 font-medium px-4 shadow-sm"
                 >
                    Edit Details
                 </Button>
            </div>

            {/* Read-Only Summary Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                <ViewCard label="Client" name={data.client.name} logo={data.client.logo} />
                <ViewCard label="Project Manager" name={data.projectManager.name} logo={data.projectManager.logo} />
                <ViewCard label="Architect" name={data.architect.name} logo={data.architect.logo} />
                <ViewCard label="Consultant" name={data.consultant.name} logo={data.consultant.logo} />
                <ViewCard label="GC Contractor" name={data.gcContractor.name} logo={data.gcContractor.logo} />
                <ViewCard label="MEP Contractor" name={data.mepContractor.name} logo={data.mepContractor.logo} />
            </div>

            {/* Edit Dialog */}
            <SetupTDSRepositoryDialog
                isOpen={isSetupDialogOpen}
                onClose={() => setIsSetupDialogOpen(false)}
                onConfirm={handleUpdateConfirm}
                initialData={data} 
                isLoading={isUpdating}
            />
        </div>
    );
};
