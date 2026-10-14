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
import type { PayeeSummary } from "@/types/NirmaanStack/Payee";
import { accountsMatch, cleanAccountNumber, duplicateSentence } from "@/utils/payees/payeeForm";
import { payeeHref } from "@/utils/payees/payeeRoutes";

import type { PayeeBankForm } from "./usePayeeBankForm";

const blockPaste = (e: ClipboardEvent<HTMLInputElement>) => e.preventDefault();

interface PayeeBankFieldsProps {
    payeeForm: PayeeBankForm;
    disabled?: boolean;
    /** Offer "Pick this payee" on the duplicate block instead of a link to the Payees page, for a
     *  screen whose user can't open that page (the Expense Request's picker). */
    onUseDuplicate?: (duplicate: PayeeSummary) => void;
    /** Labels above the fields at every width, for a narrow container such as a dialog section. */
    stacked?: boolean;
}

export function PayeeBankFields({ payeeForm, disabled, onUseDuplicate, stacked }: PayeeBankFieldsProps) {
    const { form, setField, bank, lookingUp, ifscError, duplicate } = payeeForm;
    const mismatch =
        !!cleanAccountNumber(form.confirm_account_number) && !accountsMatch(form) ? "The account numbers don't match." : null;

    return (
        <div className="flex flex-col gap-4">
            <Row stacked={stacked} id="payee_account_name" label="Account Holder Name" help="As the bank has it. This is the name the bank file sends.">
                <Input
                    id="payee_account_name"
                    value={form.account_name}
                    onChange={(e) => setField("account_name", e.target.value)}
                    disabled={disabled}
                    autoComplete="off"
                />
            </Row>
            <Row stacked={stacked} id="payee_account_number" label="Account Number" help="Type it. Paste is turned off.">
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
                stacked={stacked}
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
            <Row stacked={stacked} id="payee_ifsc" label="IFSC Code" error={ifscError}>
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
                            {onUseDuplicate ? (
                                <button
                                    type="button"
                                    onClick={() => onUseDuplicate(duplicate)}
                                    className="font-semibold text-red-700 hover:underline"
                                >
                                    Pick {duplicate.name} instead
                                </button>
                            ) : (
                                <Link to={payeeHref(duplicate.name, duplicate.status)} className="font-semibold text-red-700 hover:underline">
                                    Open {duplicate.name}
                                </Link>
                            )}
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}

interface RowProps {
    stacked?: boolean;
    id: string;
    label: string;
    help?: string;
    error?: string | null;
    children: ReactNode;
}

/** One labelled field: label on the left, the input with its help or error line on the right. */
function Row({ stacked, id, label, help, error, children }: RowProps) {
    return (
        <div
            className={
                stacked
                    ? "flex flex-col gap-1.5"
                    : "grid grid-cols-1 items-start gap-1.5 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-3"
            }
        >
            <Label htmlFor={id} className={stacked ? undefined : "sm:pt-2.5 sm:text-right"}>
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
