import { PAYMENT_STATUS } from "@/constants/paymentStatus";
import { CHEQUE_STATUS, type ChequeStatus } from "@/types/NirmaanStack/Cheques";
import { formatDate } from "@/utils/FormatDate";

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

/** A Cheque's date (its cheque date, when it was made, a status change) as shown and exported; blank when unset. */
export const chequeDateText = (v?: string | null): string => (v ? formatDate(v) : "");

const STATUS_TONE: Record<ChequeStatus, string> = {
    [CHEQUE_STATUS.PENDING]: "border-indigo-300 bg-indigo-50 text-indigo-900",
    Issued: "border-yellow-300 bg-yellow-50 text-yellow-900",
    Cleared: "border-green-300 bg-green-50 text-green-900",
    Cancelled: "border-red-200 bg-red-50 text-red-700",
};

/** The chip's colours for a Cheque at `status`; plain for a payment no Cheque records yet. */
export const chequeChipTone = (status?: string | null): string =>
    STATUS_TONE[status as ChequeStatus] ?? "border-border bg-muted/40 text-foreground";

/** A Cancelled cheque's chip is struck through, so a dead cheque is obvious. */
export const isChequeStruck = (status?: string | null): boolean => status === CHEQUE_STATUS.CANCELLED;

/**
 * Does this payment show a cheque chip? A cheque payment does. A Rejected one does only while its Cheque is
 * Cancelled: a rejected Payment-cheque payment stays on its cancelled cheque (#1481, #1484), while any other
 * Rejected payment has dropped off its Cheque (#1413), and a chip would name a Cheque that no longer lists it.
 * `cheque_status` is the Cheque's status (the queue row's, or the chip lookup's).
 */
export const showsChequeChip = (p: {
    cheque_no?: string | null;
    status?: string | null;
    cheque_status?: string | null;
}): boolean =>
    !!p.cheque_no && (p.status !== PAYMENT_STATUS.REJECTED || p.cheque_status === CHEQUE_STATUS.CANCELLED);

/** The cheque fields a payment row carries (the approval queue row has all of them). */
export interface ChequeRowFacts {
    utr_ref: string;
    cheque_no: string;
    cheque_status: string;
    status: string;
}

/**
 * The UTR / Ref cell as text, for the CSV export: an Online (or Rejected) payment's UTR as today; a cheque
 * payment's chip text, then its UTR once it is reconciled.
 */
export const utrOrChequeText = (row: ChequeRowFacts): string => {
    const { utr_ref, cheque_no, cheque_status } = row;
    if (!showsChequeChip(row)) return utr_ref;
    const chip = chequeChipText(cheque_no, cheque_status);
    return utr_ref ? `${chip} / ${utr_ref}` : chip;
};
