/**
 * "Where do we pay this vendor?" (#1425, spec #1420, approved mockup screens 5 and 6): use a Payee
 * already on record, picked from "Payees that look like this vendor" through the confirmation, or
 * enter new bank details (the same fields and rules as Add Payee). A duplicate of a Payee on record
 * offers that Payee instead.
 *
 * Driven by `useVendorPayeeChoice`; the form that holds it sends `choice.answer()` on save. The
 * new-vendor form renders it; the vendor page's Change account (#1426) reuses it.
 */

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radiogroup";
import { cn } from "@/lib/utils";
import { PAYEE_STATUS } from "@/types/NirmaanStack/Payee";
import { accountLine, VENDOR_PAYEE_MODE, type VendorPayeeMode } from "@/utils/payees/payeeChoice";

import { PayeeBankFields } from "./PayeeBankFields";
import { PayeeSuggestionsPanel } from "./PayeeSuggestionsPanel";
import { UsePayeeDialog } from "./UsePayeeDialog";
import type { VendorPayeeChoice } from "./useVendorPayeeChoice";
import { useVendorPayeeSuggestions } from "./vendorPayeeApi";

interface VendorPayeeSectionProps {
    choice: VendorPayeeChoice;
    /** The vendor's name and PAN as typed: what the suggestions match on, and what the confirmation names. */
    vendorName?: string;
    vendorPan?: string;
    disabled?: boolean;
}

const OPTIONS: { mode: VendorPayeeMode; title: string; help: string }[] = [
    {
        mode: VENDOR_PAYEE_MODE.EXISTING,
        title: "Use a payee already on record",
        help: "Pick one from the matches. Best when this is another branch of a company we already pay.",
    },
    {
        mode: VENDOR_PAYEE_MODE.NEW,
        title: "Enter new bank details",
        help: "Adds a new payee and links this vendor to it.",
    },
];

export function VendorPayeeSection({ choice, vendorName, vendorPan, disabled }: VendorPayeeSectionProps) {
    const [confirming, setConfirming] = useState<string | null>(null);
    const suggestions = useVendorPayeeSuggestions(vendorName, vendorPan);
    const { mode, setMode, chosen, payeeForm } = choice;

    return (
        <div className="flex flex-wrap items-start gap-8">
            <div className="flex min-w-0 flex-[999_1_420px] flex-col gap-4">
                <fieldset className="flex flex-col gap-2" disabled={disabled}>
                    <legend className="mb-1.5 text-sm font-medium">Where do we pay this vendor?</legend>
                    <RadioGroup
                        value={mode}
                        onValueChange={(value) => setMode(value as VendorPayeeMode)}
                        className="gap-2"
                    >
                        {OPTIONS.map((o) => (
                            <label
                                key={o.mode}
                                htmlFor={`vendor-payee-${o.mode}`}
                                className={cn(
                                    "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3.5 py-3",
                                    mode === o.mode && "border-primary bg-primary/5",
                                )}
                            >
                                <RadioGroupItem id={`vendor-payee-${o.mode}`} value={o.mode} className="mt-0.5" />
                                <span>
                                    <b className="text-sm">{o.title}</b>
                                    <br />
                                    <span className="text-[13px] text-muted-foreground">{o.help}</span>
                                </span>
                            </label>
                        ))}
                    </RadioGroup>
                </fieldset>

                {mode === VENDOR_PAYEE_MODE.EXISTING ? (
                    chosen ? (
                        <div className="rounded-lg border bg-muted/40 px-3.5 py-3 text-sm">
                            <p className="font-semibold">This vendor will be paid into {chosen.account_name}</p>
                            <p className="mt-0.5 tabular-nums text-muted-foreground">{accountLine(chosen)}</p>
                            <p className="mt-1.5 text-[13px] text-muted-foreground">
                                To pick another, use a different match.
                            </p>
                        </div>
                    ) : (
                        <p className="rounded-lg border border-dashed px-3.5 py-3 text-[13px] text-muted-foreground">
                            Pick a payee from "Payees that look like this vendor". If the one you want is not
                            there, enter new bank details: an account already on record is offered to you.
                        </p>
                    )
                ) : (
                    <PayeeBankFields
                        payeeForm={payeeForm}
                        disabled={disabled}
                        layout="form"
                        duplicateAction={(dup) =>
                            dup.status === PAYEE_STATUS.ACTIVE ? (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="border-red-300 text-red-700 hover:text-red-800"
                                    onClick={() => setConfirming(dup.name)}
                                >
                                    Use {dup.name} instead
                                </Button>
                            ) : (
                                <span className="font-semibold">
                                    It is Inactive, so it can't be used: ask Accounts which account to pay.
                                </span>
                            )
                        }
                    />
                )}
            </div>

            <PayeeSuggestionsPanel
                className="min-w-0 flex-[1_1_320px]"
                asked={suggestions.asked}
                suggestions={suggestions.suggestions}
                isLoading={suggestions.isLoading}
                error={suggestions.error}
                chosen={mode === VENDOR_PAYEE_MODE.EXISTING ? chosen?.name : null}
                onUse={setConfirming}
            />

            <UsePayeeDialog
                payee={confirming}
                vendorLabel={vendorName}
                onCancel={() => setConfirming(null)}
                onConfirm={(picked) => {
                    choice.choose(picked);
                    setConfirming(null);
                }}
            />
        </div>
    );
}
