import { useRef, useState } from "react";
import type { FieldValues, UseFormReturn } from "react-hook-form";
import { useFrappeFileUpload } from "frappe-react-sdk";

import type { ChequeDetail } from "@/components/cheques/useChequeDetail";
import { useChequePhotoReader } from "@/components/cheques/useChequePhotoReader";
import { shrinkChequePhoto } from "@/components/cheques/shrinkChequePhoto";
import { toast } from "@/components/ui/use-toast";
import type { ChequePhotoField } from "@/utils/cheques/chequePhoto";
import { PHOTO_HEADER_FILLS } from "@/utils/cheques/chequeEdit";
import { getFrappeError } from "@/utils/frappeErrors";

/**
 * The header every Cheque form holds (a Payment cheque's Edit and the Security Deposit form, spec #1477, #1514):
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

/**
 * A Cheque form's photo: uploads it as soon as it is picked, so the form holds its file URL, then reads it into
 * the header fields. `fills` are the boxes it may fill: all of a new Cheque's header; on an Edit, only the boxes
 * the Edit opens (`utils/cheques/chequeEdit.editPhotoFills`), so a replaced photo never changes a locked one, and
 * with none open it is not read. Clearing a replacement photo on an edit goes back to the recorded one.
 */
export const useChequePhotoUpload = <T extends ChequeHeaderInput, V extends FieldValues>(
    form: UseFormReturn<T, unknown, V>,
    edit?: ChequeDetail,
    fills: readonly ChequePhotoField[] = PHOTO_HEADER_FILLS,
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
    }, fills);

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
            // A large phone photo is redrawn as a JPG first (`shrinkChequePhoto`).
            const uploaded = await upload(await shrinkChequePhoto(file), { isPrivate: true });
            if (session !== uploadSession.current) return;
            header.setValue("attachment", uploaded.file_url, { shouldValidate: true });
            // A replaced photo is read again; what only the old one said is cleared.
            if (fills.length) void reader.read(uploaded.file_url);
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
