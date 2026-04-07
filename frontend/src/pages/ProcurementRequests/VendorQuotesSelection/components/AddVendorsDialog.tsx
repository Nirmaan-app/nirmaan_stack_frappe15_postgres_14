import React, { useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { VendorsReactMultiSelect } from '@/components/helpers/VendorsReactSelect';
import { Vendor } from '@/pages/ServiceRequests/service-request/select-service-vendor';
import { CirclePlus, ShieldAlert } from 'lucide-react';

interface AddVendorsDialogProps {
    isOpen: boolean;
    onClose: () => void;
    vendorOptions: Vendor[];
    selectedVendors: Vendor[];
    onVendorSelect: (selected: Vendor[]) => void;
    onConfirm: () => void;
    onOpenVendorSheet: () => void;
    onHoldVendorIds?: Set<string>;
}

export const AddVendorsDialog: React.FC<AddVendorsDialogProps> = ({
    isOpen, onClose, vendorOptions, selectedVendors, onVendorSelect, onConfirm, onOpenVendorSheet, onHoldVendorIds
}) => {
    const onHoldSelected = useMemo(
        () => selectedVendors.filter(v => onHoldVendorIds?.has(v.value)),
        [selectedVendors, onHoldVendorIds]
    );
    const hasOnHoldVendor = onHoldSelected.length > 0;

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle className="text-center">Add Vendors to RFQ</DialogTitle>
                    <DialogDescription className='text-center'>Select vendors you want to send the RFQ to.</DialogDescription>
                </DialogHeader>
                <div className="flex gap-2 items-center py-4">
                    <div className="flex-grow">
                         <VendorsReactMultiSelect
                             vendorOptions={vendorOptions}
                             setSelectedVendors={onVendorSelect}
                         />
                    </div>
                     <Button variant="ghost" size="icon" onClick={onOpenVendorSheet} title="Add New Vendor">
                         <CirclePlus className="text-primary cursor-pointer h-6 w-6" />
                     </Button>
                </div>

                {hasOnHoldVendor && (
                    <div
                        className="relative overflow-hidden rounded-lg bg-gradient-to-r from-amber-50 to-orange-50 border-l-4 border-amber-600 shadow-sm"
                        role="alert"
                        aria-live="polite"
                    >
                        <div className="absolute inset-0 opacity-[0.03]">
                            <div className="absolute inset-0" style={{
                                backgroundImage: `repeating-linear-gradient(45deg, currentColor 0, currentColor 1px, transparent 0, transparent 50%)`,
                                backgroundSize: '10px 10px'
                            }} />
                        </div>
                        <div className="relative flex items-start gap-3 p-3">
                            <div className="flex-shrink-0 mt-0.5 relative">
                                <ShieldAlert className="h-5 w-5 text-amber-600" />
                                <div className="absolute inset-0 animate-ping opacity-20">
                                    <ShieldAlert className="h-5 w-5 text-amber-600" />
                                </div>
                            </div>
                            <div className="flex-1 min-w-0">
                                <h3 className="text-sm font-semibold text-amber-900 tracking-tight">
                                    Vendor Selection Blocked
                                </h3>
                                <div className="mt-1 space-y-0.5">
                                    {onHoldSelected.map(v => (
                                        <p key={v.value} className="text-sm text-amber-700 leading-relaxed">
                                            <span className="font-medium">{v.label}</span> is currently On Hold.
                                        </p>
                                    ))}
                                </div>
                                <p className="mt-1.5 text-xs text-amber-600">
                                    Contact Admin for resolution.
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                <DialogFooter>
                    <DialogClose asChild>
                        <Button variant="outline">Cancel</Button>
                    </DialogClose>
                    <Button onClick={onConfirm} disabled={selectedVendors.length === 0 || hasOnHoldVendor}>
                        Confirm Selection
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};