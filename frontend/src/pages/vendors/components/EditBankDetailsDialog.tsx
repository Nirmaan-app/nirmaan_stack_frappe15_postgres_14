import React from 'react';
import {
    AlertDialog, AlertDialogCancel, AlertDialogContent,
    AlertDialogHeader, AlertDialogTitle, AlertDialogFooter
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TailSpin } from "react-loader-spinner";
import { useVendorBankDetailsForm } from '../hooks/useVendorBankDetailsForm';
import { Vendors } from '@/types/NirmaanStack/Vendors';

interface EditBankDetailsDialogProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    vendor: Vendors;
    onSuccess: () => void;
}

export const EditBankDetailsDialog: React.FC<EditBankDetailsDialogProps> = ({
    isOpen,
    onOpenChange,
    vendor,
    onSuccess,
}) => {
    const {
        formState,
        handleInputChange,
        handleSubmit,
        ifscError,
        isIFSCValid,
        bankApiLoading,
        updateLoading,
    } = useVendorBankDetailsForm(vendor, onSuccess);

    const isSubmitDisabled =
        updateLoading ||
        bankApiLoading ||
        (formState.ifsc.length === 11 && !isIFSCValid && !ifscError) || // If 11 chars, must be valid or have an error already
        !!ifscError || // Any IFSC error
        formState.account_number !== formState.confirm_account_number ||
        !formState.account_name || !formState.account_number || !formState.ifsc;


    return (
        <AlertDialog open={isOpen} onOpenChange={onOpenChange}>
            <AlertDialogContent className="sm:max-w-lg">
                <AlertDialogHeader>
                    <AlertDialogTitle className="text-center">Edit Bank Account Details</AlertDialogTitle>
                </AlertDialogHeader>
                <div className="py-4 grid gap-4">
                    <FieldInput label="Account Holder Name" id="account_name" value={formState.account_name}
                        onChange={e => handleInputChange("account_name", e.target.value)} disabled={updateLoading} />

                    <FieldInput label="Account Number" id="account_number" type="password" value={formState.account_number}
                        onChange={e => handleInputChange("account_number", e.target.value)} disabled={updateLoading} autoComplete="new-password" />
                    
                    <FieldInput label="Confirm Account Number" id="confirm_account_number" type="password" value={formState.confirm_account_number}
                        onChange={e => handleInputChange("confirm_account_number", e.target.value)} disabled={updateLoading} autoComplete="new-password"
                        error={formState.account_number !== formState.confirm_account_number ? "Account numbers do not match." : undefined} />

                    <div className="grid grid-cols-3 items-center gap-4">
                        <Label htmlFor="ifsc" className="text-right col-span-1">IFSC Code*</Label>
                        <div className="col-span-2 space-y-1">
                            <Input id="ifsc" value={formState.ifsc} placeholder="Enter 11 character IFSC"
                                   maxLength={11}
                                   onChange={e => handleInputChange("ifsc", e.target.value.toUpperCase())} disabled={updateLoading || bankApiLoading} />
                            {bankApiLoading && <p className="text-xs text-muted-foreground">Validating IFSC...</p>}
                            {ifscError && <p className="text-xs text-destructive">{ifscError}</p>}
                            {isIFSCValid && formState.bank_name && (
                                <p className="text-xs text-green-600">{formState.bank_name} - {formState.bank_branch}</p>
                            )}
                        </div>
                    </div>
                </div>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={updateLoading}>Cancel</AlertDialogCancel>
                    <Button onClick={handleSubmit} disabled={isSubmitDisabled}>
                        {updateLoading ? <TailSpin color="white" height={20} width={20} /> : "Save Changes"}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};

// Helper for consistent field display
const FieldInput: React.FC<{ label: string, id: string, value: string, onChange: React.ChangeEventHandler<HTMLInputElement>, error?: string, disabled?: boolean, type?: string, placeholder?: string, autoComplete?: string }> =
    ({ label, id, value, onChange, error, disabled, type = "text", placeholder, autoComplete }) => (
    <div className="grid grid-cols-3 items-center gap-4">
        <Label htmlFor={id} className="text-right col-span-1">{label}*</Label>
        <div className="col-span-2 space-y-1">
            <Input id={id} type={type} value={value} onChange={onChange} disabled={disabled} placeholder={placeholder} autoComplete={autoComplete} />
            {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
    </div>
);