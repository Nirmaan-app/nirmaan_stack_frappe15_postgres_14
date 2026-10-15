/**
 * State for "Where do we pay this vendor?" (#1425, spec #1420): a Payee already on record (picked
 * from the suggestions through the confirmation) or new bank details (`usePayeeBankForm`, checked
 * against the vendor screens' own endpoint). The rules are pure, in `utils/payees/payeeChoice.ts`.
 *
 * Rendered by `VendorPayeeSection`. The new-vendor form uses it; the vendor page's Use a different payee
 * (#1426) reuses both.
 */

import { useCallback, useState } from "react";

import type { PayeeWithLinks } from "@/types/NirmaanStack/Payee";
import {
    VENDOR_PAYEE_MODE,
    vendorPayeeAnswer,
    vendorPayeeProblem,
    type VendorPayeeAnswer,
    type VendorPayeeMode,
} from "@/utils/payees/payeeChoice";

import { usePayeeBankForm, type PayeeBankForm } from "./usePayeeBankForm";
import { CHECK_VENDOR_PAYEE_API } from "./vendorPayeeApi";

export interface VendorPayeeChoice {
    mode: VendorPayeeMode;
    setMode: (mode: VendorPayeeMode) => void;
    /** The Payee picked through the confirmation, if any. */
    chosen: PayeeWithLinks | null;
    /** Pick a Payee (after the confirmation): switches to "Use a payee already on record". */
    choose: (choice: PayeeWithLinks) => void;
    payeeForm: PayeeBankForm;
    /** Why the vendor can't be saved with this answer yet, or null. */
    problem: string | null;
    /** The vendor's Payee as the vendor endpoints take it. */
    answer: () => VendorPayeeAnswer;
    reset: () => void;
}

export function useVendorPayeeChoice(): VendorPayeeChoice {
    const [mode, setMode] = useState<VendorPayeeMode>(VENDOR_PAYEE_MODE.NEW);
    const [chosen, setChosen] = useState<PayeeWithLinks | null>(null);
    const payeeForm = usePayeeBankForm({ checkApi: CHECK_VENDOR_PAYEE_API });

    const choose = useCallback((choice: PayeeWithLinks) => {
        setChosen(choice);
        setMode(VENDOR_PAYEE_MODE.EXISTING);
    }, []);

    const { reset: resetForm } = payeeForm;
    const reset = useCallback(() => {
        setMode(VENDOR_PAYEE_MODE.NEW);
        setChosen(null);
        resetForm();
    }, [resetForm]);

    return {
        mode,
        setMode,
        chosen,
        choose,
        payeeForm,
        problem: vendorPayeeProblem({
            mode,
            chosen: chosen?.name ?? null,
            formProblem: payeeForm.problem,
            duplicate: !!payeeForm.duplicate,
            lookingUp: payeeForm.lookingUp,
        }),
        answer: () => vendorPayeeAnswer({ mode, chosen: chosen?.name ?? null, form: payeeForm.form }),
        reset,
    };
}
