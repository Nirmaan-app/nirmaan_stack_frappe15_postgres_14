import React from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"; // Adjust path
import { NewVendor } from '@/pages/vendors/new-vendor'; // Adjust path

interface VendorSheetProps {
    isOpen: boolean;
    onClose: () => void;
    service?: boolean;
    // Add callbacks if needed, e.g., onVendorCreated to refetch vendor list
}

export const VendorSheet: React.FC<VendorSheetProps> = ({ isOpen, onClose, service = false }) => {
    return (
        <Sheet open={isOpen} onOpenChange={onClose}>
            <SheetContent className="overflow-auto w-full sm:max-w-lg"> {/* Adjust width */}
                <SheetHeader className="text-left">
                    <SheetTitle>Add New Vendor</SheetTitle>
                    <SheetDescription>
                        Enter the details for the new vendor. They will be available for selection afterwards.
                    </SheetDescription>
                </SheetHeader>
                <div className="py-4">
                    {/* Pass necessary props to NewVendor */}
                    <NewVendor
                        navigation={false} // Prevent redirection within the sheet
                        service={service}
                        // Add an onSaveSuccess callback prop to NewVendor if possible
                        // onSaveSuccess={() => { onClose(); /* maybe trigger refetch? */ }}
                    />
                </div>
            </SheetContent>
        </Sheet>
    );
};