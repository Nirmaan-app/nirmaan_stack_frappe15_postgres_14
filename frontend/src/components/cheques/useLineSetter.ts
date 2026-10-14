import { useFormContext } from "react-hook-form";

import type { ChequeFormInput } from "@/utils/cheques/chequeForm";
import type { ChequeLineDraft } from "@/utils/cheques/chequeLines";

/**
 * Sets one box of the Add Cheque dialog's line `index` from another box's pick. It validates only once
 * the form was submitted, as the boxes' own changes do: a box cleared before then must not show an
 * error ("Pick the ...") that its later pick, unvalidated until submit, would leave stale.
 */
export const useLineSetter = (index: number) => {
    const { setValue, formState } = useFormContext<ChequeFormInput>();
    return (name: keyof ChequeLineDraft, value: string | number) =>
        setValue(`lines.${index}.${name}`, value, { shouldValidate: formState.isSubmitted, shouldDirty: true });
};
