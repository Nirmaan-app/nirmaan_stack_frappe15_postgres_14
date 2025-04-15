import React from 'react';
import { Button } from '@/components/ui/button';
import { ListChecks, ListX, Trash2 } from 'lucide-react';

interface ActionButtonsProps {
    onPrepareReject: () => void;
    onPrepareApprove: () => void;
    canApprove: boolean; // Determined by logic hook (no requested items & list not empty)
    canReject: boolean; // Determined by logic hook (list not empty)
    isLoading: boolean; // Loading state for backend actions
    handleOpenDeletePRDialog: () => void
}

export const ActionButtons: React.FC<ActionButtonsProps> = ({
    onPrepareReject,
    onPrepareApprove,
    handleOpenDeletePRDialog,
    canApprove,
    canReject,
    isLoading
}) => {

    console.log("canApprove", canApprove)
    return (
        <div className="flex max-sm:flex-col gap-2 justify-end items-center">
            <Button variant="outline" className='border-primary text-primary hover:text-red-400 mr-4' size="sm" onClick={handleOpenDeletePRDialog}>
                 <Trash2 className="h-4 w-4 mr-1" /> Delete PR
             </Button>
            <Button
                variant="outline"
                className='border-primary text-primary hover:text-red-400'
                onClick={onPrepareReject}
                disabled={!canReject || isLoading} // Can reject if items exist
            >
                <ListX className="h-4 w-4 mr-1" />
                Reject PR
            </Button>
            <Button
                onClick={onPrepareApprove}
                disabled={!canApprove || isLoading} // Can only approve if conditions met
                title={!canApprove ? "Resolve requested items or add items first" : "Approve PR"} // Tooltip
            >
                 {isLoading ? (
                     "Processing..."
                 ) : (
                     <>
                         <ListChecks className="h-4 w-4 mr-1" /> Approve PR
                     </>
                )}
            </Button>
        </div>
    );
};