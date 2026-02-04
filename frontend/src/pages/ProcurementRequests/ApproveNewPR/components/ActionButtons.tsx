import React from 'react';
import { Button } from '@/components/ui/button';
import { ListChecks, ListX, Trash2 } from 'lucide-react';

interface ActionButtonsProps {
    onPrepareReject: () => void;
    onPrepareApprove: () => void;
    canApprove: boolean; // Determined by logic hook (no requested items & list not empty)
    canReject: boolean; // Determined by logic hook (list not empty)
    isLoading: boolean; // Loading state for backend actions
    handleOpenDeletePRDialog: () => void;
    canDelete?: boolean; // Optional - defaults to true if not provided
}

export const ActionButtons: React.FC<ActionButtonsProps> = ({
    onPrepareReject,
    onPrepareApprove,
    handleOpenDeletePRDialog,
    canApprove,
    canReject,
    isLoading,
    canDelete = true,
}) => {

    return (
        <div className="flex items-center gap-2">
            {/* Delete button */}
            <Button
                variant="destructive"
                size="sm"
                onClick={handleOpenDeletePRDialog}
                disabled={!canDelete || isLoading}
                title="Delete PR"
            >
                <Trash2 className="h-4 w-4 mr-2" /> Delete
            </Button>

            {/* Reject button */}
            <Button
                variant="outline"
                size="sm"
                onClick={onPrepareReject}
                disabled={!canReject || isLoading}
                className="text-amber-600 border-amber-300 hover:bg-amber-50 hover:text-amber-700"
                title="Reject PR"
            >
                <ListX className="h-4 w-4 mr-2" /> Reject
            </Button>

            {/* Approve button */}
            <Button
                size="sm"
                onClick={onPrepareApprove}
                disabled={!canApprove || isLoading}
                title={!canApprove ? "Resolve requested items or add items first" : "Approve PR"}
            >
                {isLoading ? (
                    "Processing..."
                ) : (
                    <>
                        <ListChecks className="h-4 w-4 mr-2" /> Approve
                    </>
                )}
            </Button>
        </div>
    );
};