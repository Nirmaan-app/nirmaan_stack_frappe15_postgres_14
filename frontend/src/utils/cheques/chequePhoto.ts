import { CHEQUE_BANK, type ChequeBank } from "@/types/NirmaanStack/Cheques";

import { EMPTY_CHEQUE_FORM, type ChequeFormInput } from "./chequeForm";

/**
 * What a cheque photo fills on the cheque form (spec #1407, #1409). Pure, so vitest covers it (F4).
 *
 * The server reads the photo (`api/payment_autofill.extract_payment_fields(mode="cheque")`) and sends
 * every field it was unsure of as empty. Here the reply becomes form values, and a field keeps its
 * "From photo" tag only while it still holds what the photo said.
 */

/** The form fields a photo can fill. `bank` covers the Others bank name too. */
export type ChequePhotoField = "bank" | "cheque_no" | "cheque_date" | "amount" | "payee_name";

/** What one photo said: only the fields it could read. */
export interface ChequePhoto {
    bank?: ChequeBank;
    /** The printed bank name, for an Others bank only. */
    bank_name?: string;
    cheque_no?: string;
    cheque_date?: string;
    amount?: number;
    payee_name?: string;
}

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** The reader's reply, parsed at this one accessor (F2). Anything not read is left out. */
export const parseChequePhotoReply = (message: unknown): ChequePhoto => {
    if (!message || typeof message !== "object") return {};
    const reply = message as Record<string, unknown>;
    const photo: ChequePhoto = {};
    const bank = text(reply.bank);
    if (bank === CHEQUE_BANK.ICICI) photo.bank = CHEQUE_BANK.ICICI;
    if (bank === CHEQUE_BANK.OTHERS && text(reply.bank_name)) {
        photo.bank = CHEQUE_BANK.OTHERS;
        photo.bank_name = text(reply.bank_name);
    }
    if (text(reply.cheque_no)) photo.cheque_no = text(reply.cheque_no);
    if (text(reply.cheque_date)) photo.cheque_date = text(reply.cheque_date);
    if (typeof reply.amount === "number" && reply.amount > 0) photo.amount = reply.amount;
    if (text(reply.payee_name)) photo.payee_name = text(reply.payee_name);
    return photo;
};

/**
 * The soft payee warning, from `api/payment_autofill.match_payee_to_vendor`'s reply: the payee and
 * the Vendor's name when the payee clearly is not that Vendor, else null. It never blocks a save.
 */
export const payeeMismatch = (message: unknown): { payee: string; vendorName: string } | null => {
    if (!message || typeof message !== "object") return null;
    const reply = message as Record<string, unknown>;
    if (reply.match !== false) return null;
    return { payee: text(reply.extracted), vendorName: text(reply.expected_name) };
};

const FIELDS: ChequePhotoField[] = ["bank", "cheque_no", "cheque_date", "amount", "payee_name"];

/** True while the form's `field` holds exactly what `photo` said. */
export const isFromPhoto = (field: ChequePhotoField, current: ChequeFormInput, photo: ChequePhoto | null): boolean => {
    if (!photo || photo[field] === undefined) return false;
    switch (field) {
        case "bank":
            return current.bank === photo.bank && (photo.bank !== CHEQUE_BANK.OTHERS || current.bank_name?.trim() === photo.bank_name);
        case "amount":
            // The number input hands its value back as text.
            return current.amount !== ("" as unknown) && Number(current.amount) === photo.amount;
        default:
            return (current[field] ?? "").toString().trim() === photo[field];
    }
};

/** One field's form values as `photo` gives them. */
const valuesOf = (field: ChequePhotoField, photo: ChequePhoto): Partial<ChequeFormInput> =>
    field === "bank" ? { bank: photo.bank, bank_name: photo.bank_name ?? "" } : { [field]: photo[field] };

/** One field's form values when empty. */
const emptyOf = (field: ChequePhotoField): Partial<ChequeFormInput> =>
    field === "bank"
        ? { bank: EMPTY_CHEQUE_FORM.bank, bank_name: EMPTY_CHEQUE_FORM.bank_name }
        : { [field]: EMPTY_CHEQUE_FORM[field] };

/**
 * The form values to set when photo `next` is read. `previous` is the photo it replaces, if any.
 *
 * A field `next` could read takes its value. A field it could not read keeps what the user has,
 * except a value the previous photo put there and nobody changed: that belongs to the old cheque,
 * so it is cleared.
 */
export const photoFill = (current: ChequeFormInput, previous: ChequePhoto | null, next: ChequePhoto): Partial<ChequeFormInput> => {
    const fill: Partial<ChequeFormInput> = {};
    for (const field of FIELDS) {
        if (next[field] !== undefined) Object.assign(fill, valuesOf(field, next));
        else if (isFromPhoto(field, current, previous)) Object.assign(fill, emptyOf(field));
    }
    return fill;
};
