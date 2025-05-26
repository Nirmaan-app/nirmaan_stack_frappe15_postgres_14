import { useState, useEffect, useCallback } from 'react';
import { useFrappePostCall, useFrappeUpdateDoc } from 'frappe-react-sdk';
import { toast } from "@/components/ui/use-toast";
import { Vendors } from '@/types/NirmaanStack/Vendors';
import { debounce } from 'lodash';

interface BankDetailsFormState {
    account_name: string;
    account_number: string;
    confirm_account_number: string;
    ifsc: string;
    bank_name?: string; // From API
    bank_branch?: string; // From API
}

const initialBankDetailsState: BankDetailsFormState = {
    account_name: "",
    account_number: "",
    confirm_account_number: "",
    ifsc: "",
    bank_name: "",
    bank_branch: "",
};

export const useVendorBankDetailsForm = (
    vendor: Vendors | undefined,
    onSuccess?: () => void // Callback after successful update
) => {
    const [formState, setFormState] = useState<BankDetailsFormState>(initialBankDetailsState);
    const [ifscError, setIfscError] = useState("");
    const [isIFSCValid, setIsIFSCValid] = useState(false);

    const { updateDoc, loading: updateLoading } = useFrappeUpdateDoc();
    const {
        call: fetchBankDetails,
        loading: bankApiLoading,
    } = useFrappePostCall("nirmaan_stack.api.bank_details.generate_bank_details");


    useEffect(() => {
        if (vendor) {
            setFormState({
                account_name: vendor.account_name || "",
                account_number: String(vendor.account_number || ""), // Ensure string
                confirm_account_number: String(vendor.account_number || ""), // Ensure string
                ifsc: vendor.ifsc || "",
                bank_name: vendor.bank_name || "",
                bank_branch: vendor.bank_branch || "",
            });
            // Initial IFSC validation if present
            if (vendor.ifsc) {
                debouncedValidateIFSC(vendor.ifsc);
            }
        } else {
            setFormState(initialBankDetailsState); // Reset if vendor becomes undefined
        }
    }, [vendor]);

    const debouncedValidateIFSC = useCallback(
        debounce(async (value: string) => {
            if (!value) {
                setIfscError("");
                setIsIFSCValid(false);
                setFormState(prev => ({...prev, bank_name: '', bank_branch: ''}));
                return;
            }
            if (value.length !== 11) {
                setIfscError("IFSC must be 11 characters.");
                setIsIFSCValid(false);
                setFormState(prev => ({...prev, bank_name: '', bank_branch: ''}));
                return;
            }
            const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
            if (!ifscRegex.test(value)) {
                setIfscError("Invalid IFSC format (e.g., SBIN0005943).");
                setIsIFSCValid(false);
                setFormState(prev => ({...prev, bank_name: '', bank_branch: ''}));
                return;
            }
            setIfscError(""); // Clear previous error before fetching

            // Fetch bank details using the call method from useFrappeGetCall
            try {
                const result = await fetchBankDetails({ ifsc_code: value });
                if (result && result.message) {
                    if (result.message.ERROR || result.message.error) { // API might return ERROR or error
                        setIfscError(result.message.ERROR || result.message.error || "Invalid IFSC Code.");
                        setIsIFSCValid(false);
                        setFormState(prev => ({ ...prev, bank_name: '', bank_branch: '' }));
                    } else if (result.message.BANK && result.message.BRANCH) {
                        setFormState(prev => ({
                            ...prev,
                            bank_name: result.message.BANK,
                            bank_branch: result.message.BRANCH,
                        }));
                        setIfscError("");
                        setIsIFSCValid(true);
                    } else {
                        setIfscError("Could not retrieve bank details for this IFSC.");
                        setIsIFSCValid(false);
                        setFormState(prev => ({...prev, bank_name: '', bank_branch: ''}));
                    }
                }
            } catch (apiError) {
                console.error("Error fetching bank details:", apiError);
                setIfscError("Error fetching bank details.");
                setIsIFSCValid(false);
                setFormState(prev => ({...prev, bank_name: '', bank_branch: ''}));
            }
        }, 700), // Increased debounce time
        [fetchBankDetails] // fetchBankDetails from useFrappeGetCall is stable
    );

    const handleInputChange = useCallback((field: keyof BankDetailsFormState, value: string) => {
        setFormState(prev => ({ ...prev, [field]: value }));
        if (field === "ifsc") {
            debouncedValidateIFSC(value.toUpperCase());
        }
    }, [debouncedValidateIFSC]);


    const handleSubmit = async () => {
        if (!vendor) {
            toast({ title: "Error", description: "Vendor data not loaded.", variant: "destructive" });
            return;
        }
        if (formState.account_number !== formState.confirm_account_number) {
            toast({ title: "Validation Error", description: "Account numbers do not match.", variant: "destructive" });
            return;
        }
        if (!isIFSCValid && formState.ifsc) { // Allow submission if IFSC is empty, but not if it's invalid
            toast({ title: "Validation Error", description: "Please enter a valid IFSC code or clear it.", variant: "destructive" });
            return;
        }
        if (!formState.account_name || !formState.account_number || !formState.ifsc) {
            toast({ title: "Missing Fields", description: "Account Name, Number, and IFSC are required.", variant: "destructive"});
            return;
        }

        try {
            await updateDoc("Vendors", vendor.name, {
                account_name: formState.account_name,
                account_number: formState.account_number,
                ifsc: formState.ifsc.toUpperCase(),
                bank_name: formState.bank_name,     // These come from API or are cleared
                bank_branch: formState.bank_branch, // if IFSC is invalid/empty
            });
            toast({ title: "Success", description: "Bank details updated successfully.", variant: "success" });
            onSuccess?.(); // Call the success callback (e.g., to close dialog and mutate vendor data)
        } catch (error: any) {
            toast({ title: "Update Failed", description: error.message || "Could not update bank details.", variant: "destructive" });
        }
    };

    return {
        formState,
        handleInputChange,
        handleSubmit,
        ifscError,
        isIFSCValid,
        bankApiLoading, // Loading state for IFSC lookup
        updateLoading, // Loading state for submitting the form
    };
};