import React, { useState, useEffect } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogClose
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useFrappePostCall } from 'frappe-react-sdk';
import { toast } from '@/components/ui/use-toast';
import { Loader2 } from 'lucide-react';

interface RenameZoneDialogProps {
    isOpen: boolean;
    onClose: () => void;
    trackerId: string;
    onSuccess: () => void;
    initialZone?: string | null;
}

export const RenameZoneDialog: React.FC<RenameZoneDialogProps> = ({
    isOpen,
    onClose,
    trackerId,
    onSuccess,
    initialZone
}) => {
    const [selectedZone, setSelectedZone] = useState<string | null>(null);
    const [newZoneName, setNewZoneName] = useState('');
    
    const { call: renameZoneCall, loading } = useFrappePostCall('nirmaan_stack.api.design_tracker.rename_zone.rename_zone');

    useEffect(() => {
        if (isOpen && initialZone) {
            setSelectedZone(initialZone);
            setNewZoneName(initialZone);
        } else if (isOpen) {
             // Fallback or reset if no initialZone (shouldn't happen with new flow)
            setSelectedZone(null);
            setNewZoneName('');
        }
    }, [isOpen, initialZone]);

    const handleSave = async () => {
        if (!selectedZone) return;

        if (!newZoneName || newZoneName.trim() === '') {
            toast({ title: "Error", description: "Zone name cannot be empty.", variant: "destructive" });
            return;
        }
        if (newZoneName === selectedZone) {
            onClose(); // Just close if no change
            return;
        }

        try {
            await renameZoneCall({
                tracker_id: trackerId,
                old_zone_name: selectedZone,
                new_zone_name: newZoneName
            });

            toast({ title: "Success", description: `Renamed '${selectedZone}' to '${newZoneName}'.` });
            onSuccess();
            onClose();
        } catch (e: any) {
            console.error("Rename Zone Error:", e);
            
            let errorMessage = "Failed to rename zone.";

            // 1. Check for 'messages' array (parsed by SDK)
            if (e?.messages && Array.isArray(e.messages) && e.messages.length > 0) {
                errorMessage = e.messages[0];
            } 
            // 2. Check for '_server_messages' (raw string from Frappe)
            else if (e?._server_messages) {
                try {
                    const parsed = JSON.parse(e._server_messages);
                    // _server_messages is often a stringified JSON array of stringified JSON objects
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        const firstMsg = JSON.parse(parsed[0]);
                        errorMessage = firstMsg.message || errorMessage;
                    }
                } catch (err) { /* ignore parse error */ }
            }
            // 3. Check for specific 'exception' string
            else if (e?.exception) {
                 // Format: "frappe.exceptions.ValidationError: Error Message"
                 const parts = e.exception.split(':');
                 if (parts.length > 1) {
                     errorMessage = parts.slice(1).join(':').trim();
                 } else {
                     errorMessage = e.exception;
                 }
            } 
            // 4. Fallback to e.message if it's not the generic "There was an error."
            else if (e?.message && e.message !== "There was an error.") {
                errorMessage = e.message;
            }

            toast({ 
                title: "Error", 
                description: errorMessage, 
                variant: "destructive",
                className: "bg-red-600 text-white" 
            });
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[500px] bg-white">
                <DialogHeader>
                    <DialogTitle>Edit Zone</DialogTitle>
                </DialogHeader>

                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="current-name" className="text-right">
                            Current
                        </Label>
                        <Input
                            id="current-name"
                            value={selectedZone || ''}
                            disabled
                            className="col-span-3 bg-gray-100"
                        />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="new-name" className="text-right">
                            New Name
                        </Label>
                        <Input
                            id="new-name"
                            value={newZoneName}
                            onChange={(e) => setNewZoneName(e.target.value)}
                            className="col-span-3"
                            autoFocus
                        />
                    </div>
                </div>

                <DialogFooter className="flex justify-end w-full gap-2">
                    <DialogClose asChild>
                        <Button variant="outline" type="button">Cancel</Button>
                    </DialogClose>
                    <Button onClick={handleSave} disabled={loading || newZoneName === selectedZone} className="bg-red-700 hover:bg-red-800 text-white">
                        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Save Changes
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
