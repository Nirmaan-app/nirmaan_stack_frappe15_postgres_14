import { CHEQUE_STATUS } from "@/types/NirmaanStack/Cheques";

/**
 * The cheque chip (#1415, spec #1407): `Cheque 004521 · Issued` on every payment that is on a Cheque,
 * wherever payments are listed. Pure, so the text is the same on every surface and in the CSV export.
 */

/** What `api/cheques/cheque_chips.get_cheque_chips` sends: Cheque name -> its number and status. */
export const CHEQUE_CHIPS_API = "nirmaan_stack.api.cheques.cheque_chips.get_cheque_chips";

/**
 * "Cheque 004521 · Issued". The number keeps its leading zeros. A cheque payment no Cheque records yet
 * (from before Cheques) has no status, so its chip reads "Cheque 004521".
 */
export const chequeChipText = (chequeNo: string, status?: string | null): string =>
    status ? `Cheque ${chequeNo} · ${status}` : `Cheque ${chequeNo}`;

/** A Cancelled cheque's chip is struck through, so a dead cheque is obvious. */
export const isChequeStruck = (status?: string | null): boolean => status === CHEQUE_STATUS.CANCELLED;

/** The cheque fields a payment row carries (the approval queue row has all three). */
export interface ChequeRowFacts {
    utr_ref: string;
    cheque_no: string;
    cheque_status: string;
}

/**
 * The UTR / Ref cell as text, for the CSV export: an Online payment's UTR as today; a cheque payment's
 * chip text, then its UTR once it is reconciled.
 */
export const utrOrChequeText = ({ utr_ref, cheque_no, cheque_status }: ChequeRowFacts): string => {
    if (!cheque_no) return utr_ref;
    const chip = chequeChipText(cheque_no, cheque_status);
    return utr_ref ? `${chip} / ${utr_ref}` : chip;
};
