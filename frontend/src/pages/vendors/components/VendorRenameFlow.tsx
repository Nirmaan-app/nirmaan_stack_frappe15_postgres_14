/**
 * After a vendor is renamed on the edit screen (#1426, spec #1420, approved mockup screen 8): ask what
 * happens to its bank account, then do it. Keep paying the same account closes; Update the holder
 * name opens the Payee module's holder-name edit (`EditHolderNameDialog`, Accounts and Admins only),
 * started with the new name; Enter new bank details opens Change account. Decide later closes.
 *
 * Mounted only when `renameNeedsPrompt` says to ask (the vendor has a Payee whose holder name is not the
 * new name): the page decides that in its rename handler.
 */

import { useState } from "react";

import { ChangeVendorAccountDialog } from "@/components/payees/ChangeVendorAccountDialog";
import { EditHolderNameDialog } from "@/components/payees/EditHolderNameDialog";
import { useVendorAccount } from "@/components/payees/vendorPayeeAccount";
import { VendorRenamePrompt } from "@/components/payees/VendorRenamePrompt";
import { canManagePayees } from "@/constants/roles";
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
                canEditHolderName={canManagePayees(role, user_id)}
                onChoose={choose}
                onDecideLater={onDone}
            />
            <EditHolderNameDialog
                open={step === RENAME_CHOICE.HOLDER_NAME}
                onOpenChange={finish}
                payee={payee}
                initialName={rename.after}
                onSaved={() => refresh()}
            />
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
