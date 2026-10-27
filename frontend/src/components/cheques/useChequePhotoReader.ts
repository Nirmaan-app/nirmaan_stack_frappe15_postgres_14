import { useRef, useState } from "react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";

import { toast } from "@/components/ui/use-toast";
import {
    CHEQUE_PHOTO_FIELDS,
    parseChequePhotoReply,
    payeeMismatch,
    photoFill,
    type ChequePhoto,
    type ChequePhotoField,
    type ChequePhotoValues,
} from "@/utils/cheques/chequePhoto";
import { getFrappeError } from "@/utils/frappeErrors";

const READ_PHOTO_API = "nirmaan_stack.api.payment_autofill.extract_payment_fields";
const MATCH_PAYEE_API = "nirmaan_stack.api.payment_autofill.match_payee_to_vendor";

/**
 * Reads a cheque photo into the cheque form (spec #1407, #1409). The rules live in
 * `utils/cheques/chequePhoto.ts`; this hook only calls the reader and hands the values to the form.
 *
 * `getValues` and `setValues` are the form's: the Security Deposit cheque form's, or the Request Payment dialog's Cheque
 * mode (#1414), which passes the `fields` it has. Read results that arrive after a newer photo was
 * picked (or the form was closed) are dropped.
 */
export const useChequePhotoReader = <V extends ChequePhotoValues>(
    getValues: () => V,
    setValues: (fill: Partial<V>) => void,
    fields: readonly ChequePhotoField[] = CHEQUE_PHOTO_FIELDS,
) => {
    const { call } = useFrappePostCall<{ message: unknown }>(READ_PHOTO_API);
    /** What the last photo read said; null before one is read. Drives the "From photo" tags. */
    const [photo, setPhoto] = useState<ChequePhoto | null>(null);
    const [reading, setReading] = useState(false);
    const photoRef = useRef<ChequePhoto | null>(null);
    const session = useRef(0);

    /** Stop listening for the read in flight, if any. */
    const cancel = () => {
        session.current += 1;
        setReading(false);
    };

    /** Forget the photo too: a fresh form. */
    const reset = () => {
        cancel();
        photoRef.current = null;
        setPhoto(null);
    };

    /**
     * Read the uploaded photo at `fileUrl` and fill the form with what it says. Resolves true when
     * this read was still the current one at the end (not superseded or cancelled), read or not.
     */
    const read = async (fileUrl: string): Promise<boolean> => {
        const mine = ++session.current;
        setReading(true);
        try {
            const res = await call({ file_url: fileUrl, mode: "cheque" });
            if (mine !== session.current) return false;
            const next = parseChequePhotoReply(res.message);
            setValues(photoFill(getValues(), photoRef.current, next, fields));
            photoRef.current = next;
            setPhoto(next);
            if (Object.keys(next).length === 0) {
                toast({ title: "Could not read the cheque photo", description: "Fill in the cheque's details by hand." });
            }
        } catch (e) {
            if (mine !== session.current) return false;
            toast({ title: "Could not read the cheque photo", description: getFrappeError(e), variant: "destructive" });
        } finally {
            if (mine === session.current) setReading(false);
        }
        return mine === session.current;
    };

    return { photo, reading, read, cancel, reset };
};

/**
 * The soft warning when `payee` (read off the photo) does not look like the picked `vendor`.
 * Re-checked whenever either changes, so the order the user fills them in does not matter.
 */
export const usePayeeVendorMismatch = (payee: string | undefined, vendor: string | undefined) => {
    const { data } = useFrappeGetCall<{ message: unknown }>(
        MATCH_PAYEE_API,
        { payee, vendor },
        payee && vendor ? `cheque-payee-vendor:${vendor}:${payee}` : null,
    );
    return payee && vendor ? payeeMismatch(data?.message) : null;
};
