/**
 * The four Payee bank fields (spec #1420, approved mockup screen 3): holder name, account number,
 * the account number again, IFSC. Paste is turned off in both number boxes, the IFSC fills in the
 * bank and branch, and an account another Payee already holds shows that Payee with a link to it.
 *
 * Driven by `usePayeeBankForm`. Add Payee renders it; the new-vendor form (#1425) and the Expense
 * Request (#1429) reuse it, so the same rules hold everywhere a Payee is added.
 */

import type { ClipboardEvent, ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertCircle } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { accountsMatch, cleanAccountNumber, duplicateSentence } from "@/utils/payees/payeeForm";
import { payeeHref } from "@/utils/payees/payeeRoutes";

import type { PayeeBankForm } from "./usePayeeBankForm";

const blockPaste = (e: ClipboardEvent<HTMLInputElement>) => e.preventDefault();

interface PayeeBankFieldsProps {
    payeeForm: PayeeBankForm;
    disabled?: boolean;
}

export function PayeeBankFields({ payeeForm, disabled }: PayeeBankFieldsProps) {
    const { form, setField, bank, lookingUp, ifscError, duplicate } = payeeForm;
    const mismatch =
        !!cleanAccountNumber(form.confirm_account_number) && !accountsMatch(form) ? "The account numbers don't match." : null;

    return (
        <div className="flex flex-col gap-4">
            <Row id="payee_account_name" label="Account Holder Name" help="As the bank has it. This is the name the bank file sends.">
                <Input
                    id="payee_account_name"
                    value={form.account_name}
                    onChange={(e) => setField("account_name", e.target.value)}
                    disabled={disabled}
                    autoComplete="off"
                />
            </Row>
            <Row id="payee_account_number" label="Account Number" help="Type it. Paste is turned off.">
                <Input
                    id="payee_account_number"
                    type="password"
                    value={form.account_number}
                    onChange={(e) => setField("account_number", e.target.value)}
                    onPaste={blockPaste}
                    onDrop={(e) => e.preventDefault()}
                    disabled={disabled}
                    autoComplete="new-password"
                    inputMode="numeric"
                />
            </Row>
            <Row
                id="payee_confirm_account_number"
                label="Confirm Account Number"
                help="Type it again. Paste is turned off."
                error={mismatch}
            >
                <Input
                    id="payee_confirm_account_number"
                    value={form.confirm_account_number}
                    onChange={(e) => setField("confirm_account_number", e.target.value)}
                    onPaste={blockPaste}
                    onDrop={(e) => e.preventDefault()}
                    disabled={disabled}
                    autoComplete="off"
                    inputMode="numeric"
                />
            </Row>
            <Row id="payee_ifsc" label="IFSC Code" error={ifscError}>
                <Input
                    id="payee_ifsc"
                    value={form.ifsc}
                    maxLength={11}
                    placeholder="e.g. SBIN0005943"
                    onChange={(e) => setField("ifsc", e.target.value)}
                    disabled={disabled}
                    autoComplete="off"
                />
                {lookingUp && <p className="mt-1.5 text-xs text-muted-foreground">Looking up the IFSC...</p>}
                {bank && (
                    <p className="mt-1.5 text-xs text-green-700">
                        {bank.bank_name}
                        {bank.bank_branch ? ` - ${bank.bank_branch}` : ""}
                    </p>
                )}
            </Row>

            {duplicate && (
                <div role="alert" className="flex gap-2.5 rounded-md border border-red-200 bg-red-50 px-3.5 py-3">
                    <AlertCircle className="mt-0.5 h-[18px] w-[18px] shrink-0 text-red-600" aria-hidden="true" />
                    <div className="text-[13px] leading-normal text-red-900">
                        <p className="font-semibold">This account is already a payee</p>
                        <p className="mt-0.5">{duplicateSentence(duplicate)}</p>
                        <p className="mt-1.5">
                            <Link to={payeeHref(duplicate.name, duplicate.status)} className="font-semibold text-red-700 hover:underline">
                                Open {duplicate.name}
                            </Link>
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}

interface RowProps {
    id: string;
    label: string;
    help?: string;
    error?: string | null;
    children: ReactNode;
}

/** One labelled field: label on the left, the input with its help or error line on the right. */
function Row({ id, label, help, error, children }: RowProps) {
    return (
        <div className="grid grid-cols-1 items-start gap-1.5 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-3">
            <Label htmlFor={id} className="sm:pt-2.5 sm:text-right">
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
