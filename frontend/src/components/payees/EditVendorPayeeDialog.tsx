/**
 * The vendor screens' Edit of a vendor's Payee (#1435): the vendor page's Edit bank details and the
 * rename prompt's "Update the holder name". `EditPayeeDialog` saved through
 * `api/payees/vendor_payee.edit_vendor_payee`, which edits the vendor's own Payee in place for anyone
 * who may set a vendor's bank details. Reads the vendors paid into the Payee (`usePayeeWithLinks`) to
 * name them before saving when there are several.
 *
 * Mount it per edit (render it only while open).
 */

import type { PayeeSummary } from "@/types/NirmaanStack/Payee";

import { EditPayeeDialog } from "./EditPayeeDialog";
import { CHECK_VENDOR_PAYEE_API, EDIT_VENDOR_PAYEE_API, usePayeeWithLinks } from "./vendorPayeeApi";

interface EditVendorPayeeDialogProps {
    vendor: string;
    payee: PayeeSummary;
    title: string;
    holderName?: string;
    onClose: () => void;
    onSaved?: (payee: PayeeSummary) => void;
}

export function EditVendorPayeeDialog({ vendor, payee, title, holderName, onClose, onSaved }: EditVendorPayeeDialogProps) {
    const { choice } = usePayeeWithLinks(payee.vendors > 1 ? payee.name : null);
    return (
        <EditPayeeDialog
            payee={payee}
            vendors={payee.vendors > 1 ? choice?.linked_vendors : []}
            endpoint={{ saveApi: EDIT_VENDOR_PAYEE_API, saveArgs: { vendor }, checkApi: CHECK_VENDOR_PAYEE_API }}
            title={title}
            holderName={holderName}
            onClose={onClose}
            onSaved={onSaved}
        />
    );
}
