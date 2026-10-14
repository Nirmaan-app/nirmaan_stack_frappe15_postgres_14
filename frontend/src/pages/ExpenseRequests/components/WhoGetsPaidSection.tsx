// The request's "Who gets paid" section (spec #1420 ticket #1429, approved mockup screen 10).
//
// Shown when the expense type asks (Required or Optional). Three states:
//   * a vendor is picked  -> that vendor's Payee, read-only (or a note that it has none);
//   * no vendor, pick     -> search existing Payees;
//   * no vendor, add new  -> the Add Payee fields, inline.
// The rules are the server's (`services/payees/expense_rules.py`); `utils/payees/expensePayee`
// mirrors them for the help line and the blocking note.

import React from "react";
import { TailSpin } from "react-loader-spinner";

import { PayeePicker, PayeeReadOnly } from "@/components/payees/PayeePicker";
import type { PayeeChoice } from "@/components/payees/usePayeeChoice";
import type { PayeeSummary } from "@/types/NirmaanStack/Payee";
import { PAYEE_RULE, asPayeeRule, whoGetsPaidHelp } from "@/utils/payees/expensePayee";

/** The picked vendor and its Payee, as `get_vendor_payee` returns them. */
export interface VendorPayee {
    vendor: string;
    vendor_name: string | null;
    payee: PayeeSummary | null;
}

interface Props {
    rule: string;
    expenseType: string;
    /** Set while a vendor (not "Others (No Vendor)") is picked. */
    vendorChosen: boolean;
    vendorPayee: VendorPayee | null;
    vendorPayeeLoading: boolean;
    choice: PayeeChoice;
    /** Why the request can't be sent yet because of who gets paid, shown under the section. */
    problem: string | null;
    disabled?: boolean;
}

export const WhoGetsPaidSection: React.FC<Props> = ({
    rule, expenseType, vendorChosen, vendorPayee, vendorPayeeLoading, choice, problem, disabled,
}) => {
    const required = asPayeeRule(rule) === PAYEE_RULE.REQUIRED;
    // What still blocks sending, under the picker. The IFSC lookup and the duplicate block already
    // speak for themselves inside the fields, so they are not repeated here.
    const { duplicate, lookingUp } = choice.bankForm;
    const note = choice.mode === "new"
        ? (duplicate || lookingUp ? null : choice.problem)
        : problem;
    return (
        <section
            aria-labelledby="who-gets-paid"
            className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-3.5"
        >
            <div>
                <h3 id="who-gets-paid" className="text-sm font-semibold">
                    Who gets paid{required && <span className="text-destructive">*</span>}
                </h3>
                <p className="mt-0.5 text-xs text-muted-foreground">{whoGetsPaidHelp(rule, expenseType)}</p>
            </div>

            {vendorChosen ? (
                vendorPayeeLoading ? (
                    <div className="flex justify-center py-2"><TailSpin height={20} width={20} color="#71717a" /></div>
                ) : vendorPayee?.payee ? (
                    <PayeeReadOnly
                        payee={vendorPayee.payee}
                        note={"This is the vendor's account. To pay someone else, set Vendor to Others (No Vendor)."}
                    />
                ) : (
                    <p className="rounded-md border bg-background px-3 py-2.5 text-[13px]">
                        {problem ?? `${vendorPayee?.vendor_name || "This vendor"} has no bank account on record yet. ` +
                            "To pay someone else, set Vendor to Others (No Vendor)."}
                    </p>
                )
            ) : (
                <>
                    <PayeePicker choice={choice} disabled={disabled} />
                    {note && <p className="text-xs text-muted-foreground">{note}</p>}
                </>
            )}
        </section>
    );
};

export default WhoGetsPaidSection;
