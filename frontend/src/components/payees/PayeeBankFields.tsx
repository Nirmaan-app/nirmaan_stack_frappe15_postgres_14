/**
 * The four Payee bank fields (spec #1420, approved mockup screens 3 and 5): holder name, account
 * number, the account number again, IFSC. Paste is turned off in both number boxes, the IFSC fills in
 * the bank and branch, and an account another Payee already holds shows that Payee.
 *
 * Driven by `usePayeeBankForm`. Add Payee renders it as a dialog (`layout="dialog"`: labels on the
 * left); the vendor screens (#1425/#1426) render it inside their forms (`layout="form"`: labels on
 * top, Bank Name and Branch as read-only boxes) and the Expense Request (#1429) reuses it too, so
 * the same rules hold everywhere a Payee is added.
 */

import { useState, type ClipboardEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertCircle } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { PayeeSummary } from "@/types/NirmaanStack/Payee";
import { accountsMatch, cleanAccountNumber, duplicateSentence, ifscShapeProblem } from "@/utils/payees/payeeForm";
import { payeeHref } from "@/utils/payees/payeeRoutes";

import type { PayeeBankForm } from "./usePayeeBankForm";

const blockPaste = (e: ClipboardEvent<HTMLInputElement>) => e.preventDefault();

// Password managers offer to save or fill any `type=password` box, and their popup covered the form
// (#1420 walk D7). So the account number is a text box drawn as dots, and tells them to keep out.
const NOT_A_PASSWORD = {
    autoComplete: "off",
    "data-1p-ignore": "true",
    "data-lpignore": "true",
    "data-bwignore": "true",
    "data-form-type": "other",
} as const;

type Layout = "dialog" | "form";

interface PayeeBankFieldsProps {
    payeeForm: PayeeBankForm;
    disabled?: boolean;
    /** `dialog` (default): labels on the left, as Add Payee. `form`: labels on top, as the vendor form. */
    layout?: Layout;
    /**
     * What the duplicate block offers. Default: a link to open that Payee on the Payees page (only
     * Accounts and Admin may). The vendor screens offer "Use this payee" instead.
     */
    duplicateAction?: (duplicate: PayeeSummary) => ReactNode;
}

export function PayeeBankFields({ payeeForm, disabled, layout = "dialog", duplicateAction }: PayeeBankFieldsProps) {
    const { form, setField, bank, lookingUp, ifscError, duplicate } = payeeForm;
    const [leftIfsc, setLeftIfsc] = useState(false);
    const mismatch =
        !!cleanAccountNumber(form.confirm_account_number) && !accountsMatch(form) ? "The account numbers don't match." : null;
    const inForm = layout === "form";

    return (
        <div className="flex flex-col gap-4">
            <Row
                layout={layout}
                id="payee_account_name"
                label={inForm ? "Account Name" : "Account Holder Name"}
                help="As the bank has it. This is the name the bank file sends."
            >
                <Input
                    id="payee_account_name"
                    value={form.account_name}
                    placeholder={inForm ? "Enter Account Name" : undefined}
                    onChange={(e) => setField("account_name", e.target.value)}
                    disabled={disabled}
                    autoComplete="off"
                />
            </Row>
            <Row layout={layout} id="payee_account_number" label="Account Number" help="Type it. Paste is turned off.">
                <Input
                    id="payee_account_number"
                    value={form.account_number}
                    placeholder={inForm ? "Enter Account Number" : undefined}
                    onChange={(e) => setField("account_number", e.target.value)}
                    onPaste={blockPaste}
                    onDrop={(e) => e.preventDefault()}
                    disabled={disabled}
                    className="[-webkit-text-security:disc]"
                    {...NOT_A_PASSWORD}
                    inputMode="numeric"
                />
            </Row>
            <Row
                layout={layout}
                id="payee_confirm_account_number"
                label="Confirm Account Number"
                help="Type it again. Paste is turned off."
                error={mismatch}
            >
                <Input
                    id="payee_confirm_account_number"
                    value={form.confirm_account_number}
                    placeholder={inForm ? "Enter Account Number again" : undefined}
                    onChange={(e) => setField("confirm_account_number", e.target.value)}
                    onPaste={blockPaste}
                    onDrop={(e) => e.preventDefault()}
                    disabled={disabled}
                    autoComplete="off"
                    inputMode="numeric"
                />
            </Row>
            <Row
                layout={layout}
                id="payee_ifsc"
                label="IFSC Code"
                error={ifscError ?? ifscShapeProblem(form.ifsc, { left: leftIfsc })}
                help={inForm && !lookingUp ? "Bank Name and Branch fill in automatically from this code." : undefined}
            >
                <Input
                    id="payee_ifsc"
                    value={form.ifsc}
                    maxLength={11}
                    placeholder={inForm ? "Enter IFSC Code" : "e.g. SBIN0005943"}
                    onChange={(e) => {
                        setLeftIfsc(false);
                        setField("ifsc", e.target.value);
                    }}
                    onBlur={() => setLeftIfsc(true)}
                    disabled={disabled}
                    autoComplete="off"
                />
                {lookingUp && <p className="mt-1.5 text-xs text-muted-foreground">Looking up the IFSC...</p>}
                {bank && !inForm && (
                    <p className="mt-1.5 text-xs text-green-700">
                        {bank.bank_name}
                        {bank.bank_branch ? ` - ${bank.bank_branch}` : ""}
                    </p>
                )}
            </Row>
            {inForm && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <ReadOnlyBox id="payee_bank_name" label="Bank Name" value={bank?.bank_name} />
                    <ReadOnlyBox id="payee_bank_branch" label="Bank Branch" value={bank?.bank_branch} />
                </div>
            )}

            {duplicate && (
                <div role="alert" className="flex gap-2.5 rounded-md border border-red-200 bg-red-50 px-3.5 py-3">
                    <AlertCircle className="mt-0.5 h-[18px] w-[18px] shrink-0 text-red-600" aria-hidden="true" />
                    <div className="text-[13px] leading-normal text-red-900">
                        <p className="font-semibold">This account is already a payee</p>
                        <p className="mt-0.5">{duplicateSentence(duplicate)}</p>
                        <div className="mt-1.5">
                            {duplicateAction ? (
                                duplicateAction(duplicate)
                            ) : (
                                <Link to={payeeHref(duplicate.name)} className="font-semibold text-red-700 hover:underline">
                                    Open {duplicate.name}
                                </Link>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

interface RowProps {
    layout: Layout;
    id: string;
    label: string;
    help?: string;
    error?: string | null;
    children: ReactNode;
}

/** One labelled field: label on the left (dialog) or on top (form), the input with its help or error line. */
function Row({ layout, id, label, help, error, children }: RowProps) {
    const dialog = layout === "dialog";
    return (
        <div
            className={cn(
                "grid grid-cols-1 items-start gap-1.5",
                dialog && "sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-3",
            )}
        >
            <Label htmlFor={id} className={cn(dialog && "sm:pt-2.5 sm:text-right")}>
                {label}
                <span className="text-destructive">*</span>
            </Label>
            <div>
                {children}
                {error ? (
                    <p className="mt-1.5 text-xs text-destructive">{error}</p>
                ) : (
                    help && <p className="mt-1.5 text-xs text-muted-foreground">{help}</p>
                )}
            </div>
        </div>
    );
}

/** A box the IFSC lookup fills (the vendor form's Bank Name and Branch). */
function ReadOnlyBox({ id, label, value }: { id: string; label: string; value?: string | null }) {
    return (
        <div className="grid grid-cols-1 gap-1.5">
            <Label htmlFor={id}>
                {label} <span className="font-normal text-muted-foreground">(auto-filled from IFSC)</span>
            </Label>
            <Input id={id} disabled value={value ?? ""} placeholder="Fills in from IFSC Code" />
        </div>
    );
}
