import React, { useEffect, useState } from 'react';
import { useFrappePostCall } from 'frappe-react-sdk';

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

import { getFrappeError } from '@/utils/frappeErrors';
import { isUnassignReasonValid } from '@/utils/assetUnassign';
import { useAssetDataRefresh } from '../hooks/useAssetDataRefresh';
import { UnassignReasonFields } from './UnassignReasonFields';

interface UnassignAssetDialogProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    assetId: string;
    assetName: string;
    assigneeName: string;
    /** The current holder's assignment row; the server finds it when not given. */
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
    const [reason, setReason] = useState('');
    const [details, setDetails] = useState('');

    const { toast } = useToast();
    const { refreshSummaryCards } = useAssetDataRefresh();
    // One request: the reason is checked, the assignment removed and the reason kept on the
    // asset's "Unassigned" history row (api/assets/assign.py).
    const { call: unassignAsset } = useFrappePostCall('nirmaan_stack.api.assets.assign.unassign_asset');

    useEffect(() => {
        if (isOpen) {
            setReason('');
            setDetails('');
        }
    }, [isOpen]);

    const canUnassign = isUnassignReasonValid(reason, details) && !isSubmitting;

    const handleUnassign = async () => {
        setIsSubmitting(true);

        try {
            await unassignAsset({
                asset: assetId,
                reason,
                details: details.trim() || undefined,
                assignment: assetManagementId,
            });

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
                description: getFrappeError(error),
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
                            This action will remove the current assignment record and
                            clear the asset's project, city and state.
                        </span>
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <UnassignReasonFields
                    reason={reason}
                    details={details}
                    onReasonChange={setReason}
                    onDetailsChange={setDetails}
                    disabled={isSubmitting}
                />
                <AlertDialogFooter className="sm:justify-center gap-2">
                    <AlertDialogCancel disabled={isSubmitting}>
                        Cancel
                    </AlertDialogCancel>
                    <AlertDialogAction
                        onClick={(event) => {
                            // Radix closes the dialog on this click by default; it closes only on success.
                            event.preventDefault();
                            handleUnassign();
                        }}
                        disabled={!canUnassign}
                        className="bg-red-600 text-white hover:bg-red-700 focus:ring-red-600"
                    >
                        {isSubmitting ? 'Unassigning...' : 'Unassign'}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};
