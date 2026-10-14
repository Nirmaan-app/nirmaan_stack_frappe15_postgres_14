/**
 * "The bank account is still in the old name" (#1426, spec #1420, approved mockup screen 8): asked
 * after a vendor with a Payee is renamed. Keep paying the same account, update the holder name
 * (Accounts and Admins only: the Payee module's holder-name edit refuses anyone else), or enter new
 * bank details. "Decide later" never blocks the rename, which is already saved.
 *
 * When to ask is `utils/payees/vendorAccount.renameNeedsPrompt`; the caller acts on the choice.
 */

import { useState } from "react";

import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radiogroup";
import { cn } from "@/lib/utils";
import { RENAME_CHOICE, holderNameChoiceHelp, type RenameChoice } from "@/utils/payees/vendorAccount";

interface VendorRenamePromptProps {
    open: boolean;
    /** The vendor's new name, and the holder name its Payee still carries. */
    vendorName: string;
    holderName: string;
    otherVendors: number;
    /** Whether this user may change a holder name (`canManagePayees`); the server checks again. */
    canEditHolderName: boolean;
    onChoose: (choice: RenameChoice) => void;
    onDecideLater: () => void;
}

export function VendorRenamePrompt({
    open,
    vendorName,
    holderName,
    otherVendors,
    canEditHolderName,
    onChoose,
    onDecideLater,
}: VendorRenamePromptProps) {
    const [choice, setChoice] = useState<RenameChoice>(RENAME_CHOICE.KEEP);

    const options: { value: RenameChoice; title: string; help: string; disabled?: boolean }[] = [
        {
            value: RENAME_CHOICE.KEEP,
            title: "Keep paying the same account",
            help: "The company renamed itself but kept its bank account.",
        },
        {
            value: RENAME_CHOICE.HOLDER_NAME,
            title: "Update the holder name",
            help: holderNameChoiceHelp(otherVendors),
            disabled: !canEditHolderName,
        },
        {
            value: RENAME_CHOICE.NEW_BANK,
            title: "Enter new bank details",
            help: "The new company has a different account. This adds a new payee for this vendor only.",
        },
    ];

    const close = (next: boolean) => {
        if (!next) onDecideLater();
    };

    return (
        <AlertDialog open={open} onOpenChange={close}>
            <AlertDialogContent className="sm:max-w-[540px]">
                <AlertDialogHeader>
                    <AlertDialogTitle>The bank account is still in the old name</AlertDialogTitle>
                    <AlertDialogDescription className="leading-relaxed">
                        You renamed this vendor to <b>{vendorName}</b>. Its bank account is held by{" "}
                        <b>{holderName}</b>. What should happen to the account?
                    </AlertDialogDescription>
                </AlertDialogHeader>

                <fieldset>
                    <legend className="sr-only">Bank account</legend>
                    <RadioGroup value={choice} onValueChange={(v) => setChoice(v as RenameChoice)} className="gap-2">
                        {options.map((o) => (
                            <label
                                key={o.value}
                                htmlFor={`vendor-rename-${o.value}`}
                                className={cn(
                                    "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm leading-snug",
                                    choice === o.value && "border-primary bg-primary/5",
                                    o.disabled && "cursor-not-allowed opacity-60",
                                )}
                            >
                                <RadioGroupItem
                                    id={`vendor-rename-${o.value}`}
                                    value={o.value}
                                    disabled={o.disabled}
                                    className="mt-0.5"
                                />
                                <span>
                                    <b>{o.title}</b>
                                    <br />
                                    <span className="text-[13px] text-muted-foreground">{o.help}</span>
                                </span>
                            </label>
                        ))}
                    </RadioGroup>
                </fieldset>

                <AlertDialogFooter>
                    <Button variant="outline" onClick={onDecideLater}>
                        Decide later
                    </Button>
                    <Button onClick={() => onChoose(choice)}>Continue</Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
