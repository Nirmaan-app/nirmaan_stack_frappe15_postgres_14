// src/pages/vendors/components/EditBalancingDialog.tsx

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from 'lucide-react';

interface EditBalancingDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (values: { po: number; invoice: number; payment: number; }) => void;
    isSaving: boolean;
    initialData: {
        po: number;
        invoice: number;
        payment: number;
    };
    activeTab: 'poLedger' | 'invoicesLedger'; // <-- ADD THIS LINE


}

export const EditBalancingDialog: React.FC<EditBalancingDialogProps> = ({ isOpen, onClose, onSave, isSaving, initialData,activeTab }) => {
    const [values, setValues] = useState(initialData);

    useEffect(() => {
        // Reset state if the dialog is reopened with new initial data
        setValues(initialData);
    }, [initialData, isOpen]);

    const handleSave = () => {
        onSave({
            po: Number(values.po) || 0,
            invoice: Number(values.invoice) || 0,
            payment: Number(values.payment) || 0
        });
    };
    
    const hasChanged = JSON.stringify(values) !== JSON.stringify(initialData);

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[480px]">
                <DialogHeader>
                    <DialogTitle>Edit Opening Balance Figures</DialogTitle>
                    <DialogDescription>
                        Enter the total amounts from before April 1st, 2025 to set the starting balance for this vendor's ledger.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-6 py-4">
                    <div className="grid grid-cols-3 items-center gap-4">
                        <Label htmlFor="po-balance" className="text-right">PO Amount</Label>
                        <Input
                            id="po-balance"
                            type="number"
                            value={values.po}
                            onChange={(e) => setValues(v => ({ ...v, po: Number(e.target.value) }))}
                            className="col-span-2 h-10"
                            placeholder="e.g., 50000"
                            disabled={activeTab === 'invoicesLedger' || isSaving}

                        />
                    </div>
                    <div className="grid grid-cols-3 items-center gap-4">
                         <Label htmlFor="invoice-balance" className="text-right">Invoice Amount</Label>
                        <Input
                            id="invoice-balance"
                            type="number"
                             value={values.invoice}
                            onChange={(e) => setValues(v => ({ ...v, invoice: Number(e.target.value) }))}
                            className="col-span-2 h-10"
                            placeholder="e.g., 45000"
                                                        disabled={activeTab === 'poLedger' || isSaving}
                        />
                    </div>
                    <div className="grid grid-cols-3 items-center gap-4">
                         <Label htmlFor="payment-balance" className="text-right">Payment Amount</Label>
                        <Input
                            id="payment-balance"
                            type="number"
                            value={values.payment}
                            onChange={(e) => setValues(v => ({ ...v, payment: Number(e.target.value) }))}
                            className="col-span-2 h-10"
                            placeholder="e.g., 30000"
                             disabled={isSaving} 
                        />
                    </div>
                </div>
                <DialogFooter>
                    <DialogClose asChild>
                        <Button type="button" variant="outline">Cancel</Button>
                    </DialogClose>
                    <Button onClick={handleSave} disabled={isSaving || !hasChanged}>
                        {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Save Changes
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};