import React from 'react';
import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useFrappePostCall } from 'frappe-react-sdk';
import { toast } from '@/components/ui/use-toast';
import { Loader2 } from 'lucide-react';

interface DeleteZoneDialogProps {
    isOpen: boolean;
    onClose: () => void;
    trackerId: string;
    zone: string;
    // Tasks in this zone across ALL phases — all of them are removed with it.
    taskCount: number;
    // Of those, the ones in the Handover phase — called out so nobody loses handover work unawares.
    handoverTaskCount: number;
    onSuccess: () => void;
}

export const DeleteZoneDialog: React.FC<DeleteZoneDialogProps> = ({
    isOpen,
    onClose,
    trackerId,
    zone,
    taskCount,
    handoverTaskCount,
    onSuccess
}) => {
    const { call: deleteZoneCall, loading } = useFrappePostCall('nirmaan_stack.api.design_tracker.delete_zone.delete_zone');

    const handleDelete = async () => {
        try {
            await deleteZoneCall({ tracker_id: trackerId, zone_name: zone });
            toast({ title: "Success", description: `Zone '${zone}' deleted.`, variant: "success" });
            onSuccess();
            onClose();
        } catch (e: any) {
            console.error("Delete Zone Error:", e);
            let errorMessage = "Failed to delete zone.";
            if (e?.exception) {
                const parts = e.exception.split(':');
                errorMessage = parts.length > 1 ? parts.slice(1).join(':').trim() : e.exception;
            } else if (e?.message && e.message !== "There was an error.") {
                errorMessage = e.message;
            }
            toast({ title: "Error", description: errorMessage, variant: "destructive" });
        }
    };

    return (
        <AlertDialog open={isOpen} onOpenChange={(open) => { if (!open && !loading) onClose(); }}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Delete zone '{zone}'?</AlertDialogTitle>
                    <AlertDialogDescription>
                        This permanently removes the zone and its {taskCount} task{taskCount !== 1 ? 's' : ''} across
                        all phases, including any status, assignments and files on them. This cannot be undone.
                    </AlertDialogDescription>
                    {handoverTaskCount > 0 && (
                        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                            This zone has a Handover phase: its {handoverTaskCount} Handover
                            task{handoverTaskCount !== 1 ? 's' : ''} (with their status, assignments and files)
                            will also be deleted.
                        </p>
                    )}
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
                    <Button onClick={handleDelete} disabled={loading} className="bg-red-700 hover:bg-red-800 text-white">
                        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Delete Zone
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};
