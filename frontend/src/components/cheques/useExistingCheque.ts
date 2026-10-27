import { useEffect, useState } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";

import { PAYMENT_MODE_CHEQUE, type PaymentModeValue } from "@/pages/ProjectPayments/paymentMode";
import { CHEQUE_BANK } from "@/types/NirmaanStack/Cheques";
import { parseExistingCheque, type ExistingCheque } from "@/utils/cheques/existingCheque";

const FIND_CHEQUE_API = "nirmaan_stack.api.cheques.find_cheque.find_cheque";
const SETTLE_MS = 400;

/**
 * The ICICI Bank Cheque already recorded with this cheque number, or null (#1414). Asked once the typing
 * settles; pass an empty `chequeNo` to ask nothing. ICICI Bank is the only bank a Payment cheque is drawn
 * on (#1516), the bank `paymentModeArgs` sends. The server refuses the same on Submit.
 */
export const useExistingCheque = (chequeNo: string): ExistingCheque | null => {
    const [asked, setAsked] = useState(chequeNo);
    useEffect(() => {
        const timer = setTimeout(() => setAsked(chequeNo), SETTLE_MS);
        return () => clearTimeout(timer);
    }, [chequeNo]);

    const number = asked.trim();
    const { data } = useFrappeGetCall<{ message: unknown }>(
        FIND_CHEQUE_API,
        { bank: CHEQUE_BANK.ICICI, bank_name: "", cheque_no: number },
        number ? `find-cheque:${CHEQUE_BANK.ICICI}::${number}` : null,
    );
    return number ? parseExistingCheque(data?.message) : null;
};

/**
 * The Cheque already recorded with the bank + number a payment's cheque fields name, or "" (none, or an
 * Online request). A request dialog passes it to `isPaymentModeComplete`; `PaymentModeFields` shows the same
 * Cheque, through the same cached call.
 */
export const useDuplicateChequeOf = (v: PaymentModeValue): string =>
    useExistingCheque(v.mode === PAYMENT_MODE_CHEQUE ? v.cheque_no : "")?.cheque ?? "";
