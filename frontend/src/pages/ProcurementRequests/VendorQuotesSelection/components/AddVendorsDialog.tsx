import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog"; // Adjust path
import { Button } from '@/components/ui/button'; // Adjust path
import { VendorsReactMultiSelect } from '@/components/helpers/VendorsReactSelect'; // Adjust path
import { Vendor } from '@/pages/ServiceRequests/service-request/select-service-vendor'; // Adjust path
import { CirclePlus } from 'lucide-react';

interface AddVendorsDialogProps {
    isOpen: boolean;
    onClose: () => void;
    vendorOptions: Vendor[]; // Available vendors to select
    selectedVendors: Vendor[]; // Vendors currently selected *in the dialog*
    onVendorSelect: (selected: Vendor[]) => void; // Updates the temporary selection state
    onConfirm: () => void; // Confirms selection and closes dialog
    onOpenVendorSheet: () => void; // Opens the New Vendor sheet
}

export const AddVendorsDialog: React.FC<AddVendorsDialogProps> = ({
    isOpen, onClose, vendorOptions, selectedVendors, onVendorSelect, onConfirm, onOpenVendorSheet
}) => {
    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle className="text-center" data-cy="vendor-addition-text">Add Vendors to RFQ</DialogTitle>
                    <DialogDescription className='text-center'>Select vendors you want to send the RFQ to.</DialogDescription>
                </DialogHeader>
                <div className="flex gap-2 items-center py-4">
                    <div className="flex-grow" data-cy="vendor-addition-dropdown">
                         <VendorsReactMultiSelect
                             vendorOptions={vendorOptions}
                             setSelectedVendors={onVendorSelect} // Use the passed handler
                             // You might need to adapt VendorsReactMultiSelect to accept `value` prop
                             // based on `selectedVendors` if it's meant to be a controlled component internally
                         />
                    </div>
                     <Button variant="ghost" size="icon" onClick={onOpenVendorSheet} title="Add New Vendor">
                         <CirclePlus className="text-primary cursor-pointer h-6 w-6" />
                     </Button>
                </div>
                <DialogFooter>
                    <DialogClose asChild>
                        <Button variant="outline" data-cy="vendor-selection-cancel-button">Cancel</Button>
                    </DialogClose>
                    <Button data-cy="vendor-selection-confirm-button" onClick={onConfirm} disabled={selectedVendors.length === 0}>
                        Confirm Selection
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};