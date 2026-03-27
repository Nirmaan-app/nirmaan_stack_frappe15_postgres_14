import React, { useState } from 'react';
import {
    AlertDialog, AlertDialogCancel, AlertDialogContent,
    AlertDialogHeader, AlertDialogTitle, AlertDialogFooter
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TailSpin } from "react-loader-spinner";
import { useFrappePostCall } from 'frappe-react-sdk';
import { toast } from "@/components/ui/use-toast";

interface EditCreditLimitDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    vendorId: string;
    currentLimit: number;
    onSuccess: () => void;
}

export const EditCreditLimitDialog: React.FC<EditCreditLimitDialogProps> = ({
    open,
    onOpenChange,
    vendorId,
    currentLimit,
    onSuccess,
}) => {
    const [creditLimit, setCreditLimit] = useState<string>(String(currentLimit || 0));
    const { call, loading } = useFrappePostCall('nirmaan_stack.api.vendor_credit.update_credit_limit');

    const handleOpenChange = (nextOpen: boolean) => {
        if (nextOpen) {
            setCreditLimit(String(currentLimit || 0));
        }
        onOpenChange(nextOpen);
    };

    const handleSubmit = async () => {
        const value = parseFloat(creditLimit);
        if (isNaN(value) || value < 0) {
            toast({ title: "Invalid input", description: "Credit limit must be a non-negative number.", variant: "destructive" });
            return;
        }
        try {
            await call({ vendor_id: vendorId, new_limit: value });
            toast({ title: "Success", description: "Credit limit updated successfully." });
            onSuccess();
        } catch (err: any) {
            toast({
                title: "Error",
                description: err?.message || "Failed to update credit limit.",
                variant: "destructive",
            });
        }
    };

    const isSubmitDisabled = loading || creditLimit === "" || parseFloat(creditLimit) < 0;

    return (
        <AlertDialog open={open} onOpenChange={handleOpenChange}>
            <AlertDialogContent className="sm:max-w-md">
                <AlertDialogHeader>
                    <AlertDialogTitle className="text-center">Edit Credit Limit</AlertDialogTitle>
                </AlertDialogHeader>
                <div className="py-4 grid gap-4">
                    <div className="grid grid-cols-3 items-center gap-4">
                        <Label htmlFor="credit_limit" className="text-right col-span-1">Credit Limit (&#8377;)</Label>
                        <div className="col-span-2">
                            <Input
                                id="credit_limit"
                                type="number"
                                min={0}
                                value={creditLimit}
                                onChange={(e) => setCreditLimit(e.target.value)}
                                disabled={loading}
                                placeholder="Enter credit limit"
                            />
                        </div>
                    </div>
                </div>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
                    <Button onClick={handleSubmit} disabled={isSubmitDisabled}>
                        {loading ? <TailSpin color="white" height={20} width={20} /> : "Save"}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};

export default EditCreditLimitDialog;
