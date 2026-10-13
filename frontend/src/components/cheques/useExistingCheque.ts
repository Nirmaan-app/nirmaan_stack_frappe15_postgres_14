import { useEffect, useState } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";

import { CHEQUE_BANK } from "@/types/NirmaanStack/Cheques";
import { parseExistingCheque, type ExistingCheque } from "@/utils/cheques/existingCheque";

const FIND_CHEQUE_API = "nirmaan_stack.api.cheques.find_cheque.find_cheque";
const SETTLE_MS = 400;

/**
 * The Cheque already recorded with this bank + cheque number, or null (#1414). Asked once the
 * typing settles; pass an empty `chequeNo` to ask nothing. The server refuses the same on Submit.
 */
export const useExistingCheque = (bank: string, bankName: string, chequeNo: string): ExistingCheque | null => {
    const [asked, setAsked] = useState({ bank, bankName, chequeNo });
    useEffect(() => {
        const timer = setTimeout(() => setAsked({ bank, bankName, chequeNo }), SETTLE_MS);
        return () => clearTimeout(timer);
    }, [bank, bankName, chequeNo]);

    const number = asked.chequeNo.trim();
    const ready = number !== "" && !!asked.bank && (asked.bank !== CHEQUE_BANK.OTHERS || asked.bankName.trim() !== "");
    const { data } = useFrappeGetCall<{ message: unknown }>(
        FIND_CHEQUE_API,
        { bank: asked.bank, bank_name: asked.bankName, cheque_no: number },
        ready ? `find-cheque:${asked.bank}:${asked.bankName.trim().toLowerCase()}:${number}` : null,
    );
    return ready ? parseExistingCheque(data?.message) : null;
};
