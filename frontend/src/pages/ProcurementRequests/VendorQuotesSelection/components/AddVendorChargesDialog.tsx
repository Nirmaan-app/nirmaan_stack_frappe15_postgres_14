// Create new file: src/features/ProcurementRequests/VendorQuotesSelection/components/AddVendorChargesDialog.tsx
import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

// --- NEW --- Define the template structure for clarity
interface ChargeTemplate {
    item_id: string;
    item_name: string;
}


interface AddVendorChargesDialogProps {
    isOpen: boolean;
    onClose: () => void;
    vendorName: string;
     // --- MODIFIED PROPS ---
    onAddCharges: (selectedTemplates: ChargeTemplate[]) => void;
    availableTemplates: ChargeTemplate[];
    existingChargeItemIds: string[];
}

export const AddVendorChargesDialog: React.FC<AddVendorChargesDialogProps> = ({ isOpen, onClose, vendorName, onAddCharges,availableTemplates, existingChargeItemIds }) => {

      const [selected, setSelected] = useState<Map<string, ChargeTemplate>>(new Map());

    const handleCheckedChange = (template: ChargeTemplate, checked: boolean) => {
        setSelected(prev => {
            const newMap = new Map(prev);
            if (checked) {
                newMap.set(template.item_id, template);
            } else {
                newMap.delete(template.item_id);
            }
            return newMap;
        });
    };



       const handleConfirm = () => {
        onAddCharges(Array.from(selected.values()));
        onClose();
        setSelected(new Map()); // Reset state for next open
    };

      const onDialogOpenChange = (open: boolean) => {
        if (!open) {
            setSelected(new Map()); // Reset on close
            onClose();
        }
    };

   return (
        <Dialog open={isOpen} onOpenChange={onDialogOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Add Charges for {vendorName}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    {availableTemplates.length > 0 ? (
                        availableTemplates.map(template => (
                            <div key={template.item_id} className="flex items-center gap-4">
                                <Checkbox 
                                    id={template.item_id} 
                                    onCheckedChange={checked => handleCheckedChange(template, !!checked)} 
                                    disabled={existingChargeItemIds.includes(template.item_id)}
                                />
                                <Label 
                                    htmlFor={template.item_id} 
                                    className={`text-base ${existingChargeItemIds.includes(template.item_id) ? 'text-muted-foreground' : 'cursor-pointer'}`}
                                >
                                    {template.item_name}
                                </Label>
                            </div>
                        ))
                    ) : (
                        <p className="text-muted-foreground text-center">No additional charges are configured for this document.</p>
                    )}
                </div>
                <DialogFooter>
                    <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
                    <Button onClick={handleConfirm} disabled={selected.size === 0}>Add Selected</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

