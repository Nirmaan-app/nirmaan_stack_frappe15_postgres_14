/**
 * After a vendor is renamed on the edit screen (#1426, spec #1420, approved mockup screen 8): ask what
 * happens to its bank account, then do it. Keep paying the same account closes; Update the holder
 * name edits the vendor's Payee in place (`EditVendorPayeeDialog`, #1435: anyone who may set the
 * vendor's bank details), started with the new name; Enter new bank details opens Use a different
 * payee. Decide later closes.
 *
 * Mounted only when `renameNeedsPrompt` says to ask (the vendor has a Payee whose holder name is not the
 * new name): the page decides that in its rename handler.
 */

import { useState } from "react";

import { ChangeVendorAccountDialog } from "@/components/payees/ChangeVendorAccountDialog";
import { EditVendorPayeeDialog } from "@/components/payees/EditVendorPayeeDialog";
import { useVendorAccount } from "@/components/payees/vendorPayeeAccount";
import { VendorRenamePrompt } from "@/components/payees/VendorRenamePrompt";
import { canSetVendorPayee } from "@/constants/roles";
import { useUserData } from "@/hooks/useUserData";
import { RENAME_CHOICE, type RenameChoice } from "@/utils/payees/vendorAccount";

export interface VendorRename {
    before: string;
    after: string;
}

interface VendorRenameFlowProps {
    vendor: { name: string; vendor_pan?: string | null };
    rename: VendorRename;
    onDone: () => void;
}

type Step = "prompt" | typeof RENAME_CHOICE.HOLDER_NAME | typeof RENAME_CHOICE.NEW_BANK;

export function VendorRenameFlow({ vendor, rename, onDone }: VendorRenameFlowProps) {
    const { role, user_id } = useUserData();
    const { account, refresh } = useVendorAccount(vendor.name);
    const [step, setStep] = useState<Step>("prompt");

    const payee = account?.payee ?? null;
    if (!payee) return null;

    const choose = (choice: RenameChoice) => {
        if (choice === RENAME_CHOICE.KEEP) onDone();
        else setStep(choice);
    };
    const finish = (open: boolean) => {
        if (!open) onDone();
    };

    return (
        <>
            <VendorRenamePrompt
                open={step === "prompt"}
                vendorName={rename.after}
                holderName={payee.account_name}
                otherVendors={account?.other_vendors ?? 0}
                canEditHolderName={canSetVendorPayee(role, user_id)}
                onChoose={choose}
                onDecideLater={onDone}
            />
            {step === RENAME_CHOICE.HOLDER_NAME && (
                <EditVendorPayeeDialog
                    vendor={vendor.name}
                    payee={payee}
                    title="Update the holder name"
                    holderName={rename.after}
                    onClose={onDone}
                    onSaved={() => refresh()}
                />
            )}
            <ChangeVendorAccountDialog
                open={step === RENAME_CHOICE.NEW_BANK}
                onOpenChange={finish}
                vendor={{ name: vendor.name, vendor_name: rename.after, vendor_pan: vendor.vendor_pan }}
                currentPayee={payee.name}
                title="Enter new bank details"
                onChanged={() => refresh()}
            />
        </>
    );
}
