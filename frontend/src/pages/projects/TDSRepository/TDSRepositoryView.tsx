import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Settings2 } from 'lucide-react';
import { SetupTDSRepositoryDialog, TDSRepositoryData } from './components';

interface TDSRepositoryViewProps {
    data: TDSRepositoryData; // We'll need to define how we pass this data
    projectId: string;
    onUpdate: () => void;
}

export const TDSRepositoryView: React.FC<TDSRepositoryViewProps> = ({ data, onUpdate }) => {
    // This is a placeholder for the view when data exists
    // You'll likely want to display the configured roles and their logos here
    const [isSetupDialogOpen, setIsSetupDialogOpen] = useState(false);

    return (
        <div className="p-6">
            <div className="flex justify-between items-center mb-6">
                 <h2 className="text-xl font-semibold text-gray-900">TDS Repository</h2>
                 <Button onClick={() => setIsSetupDialogOpen(true)} variant="outline">
                    <Settings2 className="w-4 h-4 mr-2" />
                    Manage Setup
                 </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {/* Render cards for each role based on 'data' */}
                {Object.entries(data).map(([key, roleData]) => (
                    roleData && (
                        <div key={key} className="bg-white p-4 rounded-lg border border-gray-100 shadow-sm">
                            <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-2">{key.replace(/([A-Z])/g, ' $1').trim()}</h3>
                            <div className="flex items-center gap-4">
                                {roleData.logo ? (
                                    <div className="w-12 h-12 rounded-md border border-gray-100 p-1">
                                        {/* Ideally this is a URL, but for now assuming we handle file objects or URLs */}
                                         <img src={typeof roleData.logo === 'string' ? roleData.logo : URL.createObjectURL(roleData.logo)} alt={roleData.name} className="w-full h-full object-contain" />
                                    </div>
                                ) : (
                                    <div className="w-12 h-12 rounded-md bg-gray-50 flex items-center justify-center text-gray-400 font-bold text-lg">
                                        {roleData.name.charAt(0)}
                                    </div>
                                )}
                                <span className="font-semibold text-gray-800">{roleData.name}</span>
                            </div>
                        </div>
                    )
                ))}
            </div>

            <SetupTDSRepositoryDialog
                isOpen={isSetupDialogOpen}
                onClose={() => setIsSetupDialogOpen(false)}
                onConfirm={(newData) => {
                    console.log("Updated Data:", newData);
                    // Handle update logic (API call) here
                    onUpdate();
                    setIsSetupDialogOpen(false);
                }}
                initialData={data} 
            />
        </div>
    );
};
