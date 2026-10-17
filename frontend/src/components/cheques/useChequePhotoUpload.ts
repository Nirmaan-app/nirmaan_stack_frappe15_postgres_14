import { useRef, useState } from "react";
import type { FieldValues, UseFormReturn } from "react-hook-form";
import { useFrappeFileUpload } from "frappe-react-sdk";

import type { ChequeDetail } from "@/components/cheques/useChequeDetail";
import { useChequePhotoReader } from "@/components/cheques/useChequePhotoReader";
import { toast } from "@/components/ui/use-toast";
import type { ChequePhotoField } from "@/utils/cheques/chequePhoto";
import { getFrappeError } from "@/utils/frappeErrors";

/**
 * The header every Cheque form holds (Add Cheque's Payment form and the Security Deposit form, spec #1477):
 * the photo, bank, number, date and amount, as the inputs hold them (an amount input hands back text).
 */
export type ChequeHeaderInput = {
    attachment?: string;
    bank: string;
    bank_name?: string;
    cheque_no: string;
    cheque_date: string;
    amount: number | string;
};

/**
 * Each Cheque form as the header fields see it. The forms' own types carry more fields; the header touches
 * only these, so this one cast stands in for a generic field path on every `setValue` and `FormField`.
 */
export const asHeaderForm = <T extends ChequeHeaderInput, V extends FieldValues>(form: UseFormReturn<T, unknown, V>) =>
    form as unknown as UseFormReturn<ChequeHeaderInput>;

/** What the photo fills. The payee read off it only helps check the Vendor (or type the name). */
const PHOTO_FILLS: readonly ChequePhotoField[] = ["bank", "cheque_no", "cheque_date", "amount"];

/**
 * A Cheque form's photo: uploads it as soon as it is picked, so the form holds its file URL, then reads a new
 * Cheque's photo into the header fields. An edit keeps what was recorded, so its replaced photo is not read.
 * Clearing a replacement photo on an edit goes back to the recorded one.
 */
export const useChequePhotoUpload = <T extends ChequeHeaderInput, V extends FieldValues>(
    form: UseFormReturn<T, unknown, V>,
    edit?: ChequeDetail,
) => {
    const header = asHeaderForm(form);
    const { upload, loading: uploading } = useFrappeFileUpload();
    const [photo, setPhoto] = useState<File | null>(null);
    // A photo replaced while the first is still uploading must not land the first one's URL.
    const uploadSession = useRef(0);

    const reader = useChequePhotoReader(header.getValues, (fill) => {
        for (const [field, value] of Object.entries(fill)) {
            header.setValue(field as keyof ChequeHeaderInput, value as never, {
                shouldDirty: true,
                shouldValidate: header.formState.isSubmitted,
            });
        }
    }, PHOTO_FILLS);

    const handlePhoto = async (file: File | null) => {
        const session = ++uploadSession.current;
        reader.cancel();
        setPhoto(file);
        header.setValue("attachment", edit?.attachment ?? "", { shouldValidate: false });
        if (!file) return;
        try {
            // Uploaded unattached: Frappe's upload checks WRITE permission on the doctype it attaches
            // to, and the Cheques DocPerms give these users read only (the cheques service writes).
            // Saving the Cheque attaches the File to it (`attach_files_to_document`).
            const uploaded = await upload(file, { isPrivate: true });
            if (session !== uploadSession.current) return;
            header.setValue("attachment", uploaded.file_url, { shouldValidate: true });
            // A replaced photo is read again; what only the old one said is cleared.
            if (!edit) void reader.read(uploaded.file_url);
        } catch (e) {
            if (session !== uploadSession.current) return;
            setPhoto(null);
            toast({ title: "Could not upload the photo", description: getFrappeError(e), variant: "destructive" });
        }
    };

    return { photo, handlePhoto, uploading, reader };
};

/** A Cheque form's photo state, as `useChequePhotoUpload` returns it. */
export type ChequePhotoUpload = ReturnType<typeof useChequePhotoUpload>;
