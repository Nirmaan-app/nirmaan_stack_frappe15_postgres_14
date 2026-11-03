/**
 * The early-credit-cheque half of Request Payment, one copy for both dialogs: the PO page's (`POPaymentTermsCard`)
 * and Credit Payments' (`RequestPaymentDialog`). The rule itself lives in `../creditCheque.ts`.
 *
 * A Credit term not yet due is paid by a cheque dated on or after its due date (owner, 2026-10-31): the dialog
 * becomes "Pay by Cheque", offers Cheque only, and Request stays disabled while `dateProblem` is set.
 */
import { useEffect, useState } from "react";

import { creditChequeDateProblem, isEarlyCreditCheque, startingPaymentMode, todayDay } from "../creditCheque";
import { EMPTY_PAYMENT_MODE, type PaymentModeValue } from "../paymentMode";

type CreditTermLike = { payment_type?: string | null; due_date?: string | null } | null | undefined;

/** Owns the dialog's payment mode, so it can start each request on Cheque or Online. */
export function useEarlyCreditCheque(term: CreditTermLike, isOpen: boolean) {
  const [payMode, setPayMode] = useState<PaymentModeValue>(EMPTY_PAYMENT_MODE);
  const earlyCredit = isEarlyCreditCheque(term, todayDay());
  const dateProblem = earlyCredit ? creditChequeDateProblem(payMode.cheque_date, term?.due_date) : null;
  // A fresh choice for every request: the dialogs stay mounted between terms.
  useEffect(() => {
    if (isOpen) setPayMode(startingPaymentMode(earlyCredit));
  }, [isOpen, earlyCredit]);

  return {
    payMode,
    setPayMode,
    earlyCredit,
    dateProblem,
    title: earlyCredit ? "Pay by Cheque" : "Request Payment",
    /** Spread onto `PaymentModeFields`. */
    chequeFieldProps: {
      chequeOnly: earlyCredit,
      minChequeDate: earlyCredit ? term?.due_date?.slice(0, 10) : undefined,
      chequeDateProblem: dateProblem,
    },
  };
}
