import React, { useState } from 'react';
import { useFrappeUpdateDoc, useFrappeDeleteDoc } from 'frappe-react-sdk';

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/components/ui/use-toast';
import { UserMinus } from 'lucide-react';

import {
    ASSET_MASTER_DOCTYPE,
    ASSET_MANAGEMENT_DOCTYPE,
} from '../assets.constants';
import { useAssetDataRefresh } from '../hooks/useAssetDataRefresh';

interface UnassignAssetDialogProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    assetId: string;
    assetName: string;
    assigneeName: string;
    assetManagementId?: string;
    onUnassigned?: () => void;
}

export const UnassignAssetDialog: React.FC<UnassignAssetDialogProps> = ({
    isOpen,
    onOpenChange,
    assetId,
    assetName,
    assigneeName,
    assetManagementId,
    onUnassigned,
}) => {
    const [isSubmitting, setIsSubmitting] = useState(false);

    const { toast } = useToast();
    const { updateDoc } = useFrappeUpdateDoc();
    const { deleteDoc } = useFrappeDeleteDoc();
    const { refreshSummaryCards } = useAssetDataRefresh();

    const handleUnassign = async () => {
        setIsSubmitting(true);

        try {
            // Clear current_assignee in Asset Master
            await updateDoc(ASSET_MASTER_DOCTYPE, assetId, {
                current_assignee: '',
            });

            // Delete the Asset Management record if it exists
            if (assetManagementId) {
                await deleteDoc(ASSET_MANAGEMENT_DOCTYPE, assetManagementId);
            }

            toast({
                title: 'Asset Unassigned',
                description: `${assetName} has been unassigned from ${assigneeName}.`,
                variant: 'success',
            });

            onOpenChange(false);
            refreshSummaryCards(); // Update assigned/unassigned counts
            onUnassigned?.();
        } catch (error: any) {
            console.error('Failed to unassign asset:', error);
            toast({
                title: 'Unassign Failed',
                description: error?.message || 'An error occurred while unassigning the asset.',
                variant: 'destructive',
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <AlertDialog open={isOpen} onOpenChange={onOpenChange}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
                        <UserMinus className="h-6 w-6 text-red-600" />
                    </div>
                    <AlertDialogTitle className="text-center">
                        Unassign Asset
                    </AlertDialogTitle>
                    <AlertDialogDescription className="text-center">
                        Are you sure you want to unassign{' '}
                        <span className="font-medium text-gray-700">{assetName}</span>{' '}
                        from{' '}
                        <span className="font-medium text-gray-700">{assigneeName}</span>?
                        <br />
                        <span className="text-xs text-gray-400 mt-2 block">
                            This action will remove the current assignment record.
                        </span>
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter className="sm:justify-center gap-2">
                    <AlertDialogCancel disabled={isSubmitting}>
                        Cancel
                    </AlertDialogCancel>
                    <AlertDialogAction
                        onClick={handleUnassign}
                        disabled={isSubmitting}
                        className="bg-red-600 text-white hover:bg-red-700 focus:ring-red-600"
                    >
                        {isSubmitting ? 'Unassigning...' : 'Unassign'}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};
