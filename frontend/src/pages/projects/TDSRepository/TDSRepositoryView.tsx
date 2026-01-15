import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SetupTDSRepositoryDialog, TDSRepositoryData, ViewCard, TdsCreateForm, TdsHistoryTable } from './components';

interface TDSRepositoryViewProps {
    data: TDSRepositoryData;
    projectId: string;
    onUpdate: (data: TDSRepositoryData) => Promise<void>;
}

export const TDSRepositoryView: React.FC<TDSRepositoryViewProps> = ({ data, projectId, onUpdate }) => {
    const [isSetupDialogOpen, setIsSetupDialogOpen] = useState(false);
    const [isUpdating, setIsUpdating] = useState(false);
    const [activeTab, setActiveTab] = useState("new");
    const [refreshKey, setRefreshKey] = useState(0);

    const handleUpdateConfirm = async (updatedData: TDSRepositoryData) => {
        setIsUpdating(true);
        try {
            await onUpdate(updatedData);
            setIsSetupDialogOpen(false);
        } catch (error) {
            console.error("Update failed", error);
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

            {/* TDS Item Management Tabs */}
            <div className="mt-12">
                <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                    <TabsList className="w-full justify-start h-auto p-0 bg-transparent border-b border-gray-200 rounded-none">
                        <TabsTrigger 
                            value="new"
                            className="rounded-none border-b-2 border-transparent data-[state=active]:border-red-600 data-[state=active]:text-red-700 text-gray-500 pb-3 pt-2 px-1 mr-8 font-medium bg-transparent shadow-none"
                        >
                            New Request
                        </TabsTrigger>
                        <TabsTrigger 
                            value="history"
                            className="rounded-none border-b-2 border-transparent data-[state=active]:border-red-600 data-[state=active]:text-red-700 text-gray-500 pb-3 pt-2 px-1 font-medium bg-transparent shadow-none"
                        >
                            TDS History
                        </TabsTrigger>
                    </TabsList>

                    <div className="mt-6">
                        <div className={activeTab === 'new' ? 'block' : 'hidden'}>
                            <TdsCreateForm 
                                key={refreshKey}
                                projectId={projectId} 
                                onSuccess={() => {
                                    setActiveTab('history');
                                    setRefreshKey(prev => prev + 1);
                                }} 
                            />
                        </div>
                        <div className={activeTab === 'history' ? 'block' : 'hidden'}>
                            <TdsHistoryTable 
                                projectId={projectId} 
                                refreshTrigger={refreshKey}
                                onDataChange={() => setRefreshKey(prev => prev + 1)}
                            />
                        </div>
                    </div>
                </Tabs>
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
