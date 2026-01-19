import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Settings2 } from 'lucide-react';
import { SetupTDSRepositoryDialog, TDSRepositoryData } from './components';

interface NoTDSRepositoryViewProps {
    onConfirm: (data: TDSRepositoryData) => void;
    isLoading?: boolean;
}

export const NoTDSRepositoryView: React.FC<NoTDSRepositoryViewProps> = ({ onConfirm, isLoading = false }) => {
    const [isSetupDialogOpen, setIsSetupDialogOpen] = useState(false);

    return (
        <div className="flex items-center justify-center min-h-[400px] p-6">
            <div className="bg-white p-8 rounded-lg border border-gray-100 shadow-sm flex flex-col items-center justify-center text-center max-w-2xl w-full">
                <div className="p-4 bg-gray-50 rounded-full mb-4">
                    <Settings2 className="w-10 h-10 text-gray-400" />
                </div>
                <h3 className="text-xl font-semibold text-gray-900">Repository Not Configured</h3>
                <p className="text-gray-500 max-w-sm mt-2 mb-8">
                    Set up the repository details, including Client, Architect, and Contractor information to get started.
                </p>
                <Button 
                    onClick={() => setIsSetupDialogOpen(true)}
                    size="lg"
                    className="bg-red-600 hover:bg-red-700"
                >
                    Configure TDS Repository 
                </Button>

                <SetupTDSRepositoryDialog 
                    isOpen={isSetupDialogOpen}
                    onClose={() => setIsSetupDialogOpen(false)}
                    onConfirm={onConfirm}
                    isLoading={isLoading}
                />
            </div>
        </div>
    );
};
