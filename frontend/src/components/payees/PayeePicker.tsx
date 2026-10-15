/**
 * Choose who gets paid (spec #1420 ticket #1429, approved mockup screen 10): **Pick a payee**
 * (search Active Payees by name or account number; each match shows its account, IFSC, bank and how
 * often it has been paid) or **Add new payee** (the Add Payee fields and rules, inline).
 *
 * Driven by `usePayeeChoice`, which the saving screen calls `resolve()` on. Reused by the request
 * formats (#1430) and Record Payment's "Change payee" (#1431).
 */

import { useEffect, useRef, useState } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { PAYEE_STATUS, type PayeeOption } from "@/types/NirmaanStack/Payee";
import { payeeAccountLine, timesPaidText } from "@/utils/payees/expensePayee";
import { bankLine } from "@/utils/payees/payeeForm";

import { PayeeBankFields } from "./PayeeBankFields";
import { PayeeInactiveBadge } from "./PayeeInactiveBadge";
import type { PayeeChoice } from "./usePayeeChoice";

const DEBOUNCE_MS = 300;
const MIN_SEARCH_LENGTH = 2;

interface PayeePickerProps {
    choice: PayeeChoice;
    disabled?: boolean;
}

export function PayeePicker({ choice, disabled }: PayeePickerProps) {
    const { mode, setMode } = choice;
    return (
        <div className="flex flex-col gap-3">
            <div className="flex gap-1.5" role="group" aria-label="Payee">
                <ModeButton active={mode === "pick"} onClick={() => setMode("pick")} disabled={disabled}>
                    Pick a payee
                </ModeButton>
                <ModeButton active={mode === "new"} onClick={() => setMode("new")} disabled={disabled}>
                    Add new payee
                </ModeButton>
            </div>
            {mode === "pick" ? (
                <PickPanel choice={choice} disabled={disabled} />
            ) : (
                <div className="flex flex-col gap-3">
                    <PayeeBankFields
                        payeeForm={choice.bankForm}
                        disabled={disabled || choice.adding}
                        layout="form"
                        // A raiser can't open the Payees page, so the block offers the Payee to pick.
                        duplicateAction={(dup) => (
                            <button
                                type="button"
                                onClick={() => {
                                    choice.bankForm.reset();
                                    choice.pick(dup);
                                }}
                                className="font-semibold text-red-700 hover:underline"
                            >
                                Pick {dup.name} instead
                            </button>
                        )}
                    />
                    <p className="text-xs text-muted-foreground">
                        This adds a new payee. If the account is already on record, you'll be asked to pick that payee
                        instead.
                    </p>
                </div>
            )}
        </div>
    );
}

function ModeButton({
    active,
    onClick,
    disabled,
    children,
}: {
    active: boolean;
    onClick: () => void;
    disabled?: boolean;
    children: string;
}) {
    return (
        <Button
            type="button"
            size="sm"
            variant={active ? "default" : "outline"}
            aria-pressed={active}
            className="h-8 flex-1"
            onClick={onClick}
            disabled={disabled}
        >
            {children}
        </Button>
    );
}

function PickPanel({ choice, disabled }: PayeePickerProps) {
    const { picked, pick } = choice;
    const [text, setText] = useState("");
    const [query, setQuery] = useState("");
    const timer = useRef<ReturnType<typeof setTimeout>>();
    useEffect(() => () => clearTimeout(timer.current), []);

    const onType = (value: string) => {
        setText(value);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setQuery(value.trim()), DEBOUNCE_MS);
    };

    const searching = query.length >= MIN_SEARCH_LENGTH;
    const { data, isLoading } = useFrappeGetCall<{ message: PayeeOption[] }>(
        choice.searchApi,
        { text: query },
        searching ? `payee_search_${choice.searchApi}_${query}` : null,
    );
    const matches = (searching ? data?.message ?? [] : []).filter((p) => p.name !== picked?.name);

    // A pick ends the search: its results (and "No active payee matches") would otherwise linger
    // under the picked card.
    const choose = (payee: PayeeOption) => {
        pick(payee);
        clearTimeout(timer.current);
        setText("");
        setQuery("");
    };

    return (
        <div className="flex flex-col gap-2">
            <Label htmlFor="payee_search">Payee</Label>
            <Input
                id="payee_search"
                value={text}
                onChange={(e) => onType(e.target.value)}
                placeholder="Search by name or account number"
                autoComplete="off"
                disabled={disabled}
            />
            {picked && (
                <div className="relative">
                    <PayeeCard payee={picked} selected onClick={() => pick(null)} disabled={disabled} />
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1 h-7 w-7"
                        aria-label="Clear the picked payee"
                        title="Clear"
                        onClick={() => pick(null)}
                        disabled={disabled}
                    >
                        <X className="h-4 w-4" />
                    </Button>
                </div>
            )}
            {matches.map((p) => (
                <PayeeCard key={p.name} payee={p} onClick={() => choose(p)} disabled={disabled} />
            ))}
            {searching && isLoading && <p className="text-xs text-muted-foreground">Searching...</p>}
            {searching && !isLoading && matches.length === 0 && (
                <p className="text-xs text-muted-foreground">No active payee matches “{query}”.</p>
            )}
            <p className="text-xs text-muted-foreground">Not here? Use Add new payee.</p>
        </div>
    );
}

interface PayeeCardProps {
    payee: PayeeOption;
    selected?: boolean;
    onClick: () => void;
    disabled?: boolean;
}

/** One Payee as a button: holder name, account and IFSC, bank and branch, how often paid. Clicking
 *  the selected one clears it. */
function PayeeCard({ payee, selected, onClick, disabled }: PayeeCardProps) {
    const bank = bankLine(payee);
    const paid = payee.times_paid === undefined ? "" : timesPaidText(payee.times_paid);
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            aria-pressed={!!selected}
            title={selected ? "Picked. Click to clear." : "Pick this payee"}
            className={cn(
                "w-full rounded-md border bg-background px-3 py-2.5 text-left text-[13px] leading-relaxed tabular-nums",
                selected && "pr-10",
                selected ? "border-primary ring-1 ring-primary" : "text-muted-foreground hover:border-foreground/30",
            )}
        >
            <span className="block text-sm font-semibold text-foreground">{payee.account_name}</span>
            <span className="block">{payeeAccountLine(payee)}</span>
            {(bank || paid) && <span className="block">{[bank, paid].filter(Boolean).join(". ")}</span>}
        </button>
    );
}

/**
 * A Payee shown read-only (the vendor's own, on the request; the payee on a review). An Inactive one
 * says so: a vendor's Payee is carried even when Inactive, so whoever reviews the request sees it.
 */
export function PayeeReadOnly({ payee, note }: { payee: PayeeOption; note?: string }) {
    const bank = bankLine(payee);
    return (
        <div className="rounded-md border bg-background px-3 py-2.5 text-[13px] leading-relaxed tabular-nums">
            <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                {payee.account_name}
                {payee.status === PAYEE_STATUS.INACTIVE && <PayeeInactiveBadge />}
            </span>
            <span className="block">{payeeAccountLine(payee)}</span>
            {bank && <span className="block">{bank}</span>}
            {note && <p className="mt-1.5 text-xs text-muted-foreground">{note}</p>}
        </div>
    );
}
