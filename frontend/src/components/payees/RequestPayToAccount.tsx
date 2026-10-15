/**
 * The request-payment dialogs' "Will be paid into" box (#1437, spec #1420 story 37, ADR-0033): the
 * vendor's account, read-only, so whoever raises a PO, Work Order or credit payment sees where the
 * money goes before submitting. The server copies this account onto the payment when it is saved
 * (`services/payees/pay_to.fill_payment_from_vendor`); nothing here sends it.
 *
 * Reads the vendor's Payee under the same SWR key as the payment-request gate (`useVendorPayeeGate`),
 * so the box and the gate never disagree and cost one request. The gate still blocks a vendor with no
 * Payee; this box only says so.
 */

import type { ReactNode } from "react";

import { AccountDetailsGrid } from "@/components/payees/AccountDetailsGrid";
import { useVendorAccount } from "@/components/payees/vendorPayeeAccount";
import { cn } from "@/lib/utils";

interface RequestPayToAccountProps {
    /** The vendor the payment is for; nothing is read while it is unknown. */
    vendor: string | undefined;
    /** The vendor's name, for the no-account line. */
    vendorLabel?: string | null;
    className?: string;
}

export function RequestPayToAccount({ vendor, vendorLabel, className }: RequestPayToAccountProps) {
    const { account, isLoading, error } = useVendorAccount(vendor);
    const payee = account?.payee;
    const who = vendorLabel?.trim() || account?.vendor_name || "This vendor";

    let body: ReactNode;
    if (isLoading || (!account && !error)) {
        body = <p className="text-sm text-muted-foreground">Loading the vendor's bank account…</p>;
    } else if (error) {
        body = <p className="text-sm text-destructive">Couldn't load the vendor's bank account. Close and try again.</p>;
    } else if (!payee) {
        body = (
            <p className="text-sm">
                {who} has no bank account on record. Add one on the vendor page to request this payment.
            </p>
        );
    } else {
        body = <AccountDetailsGrid account={payee} />;
    }

    return (
        <section
            aria-labelledby="request-pay-to-heading"
            className={cn(
                "flex flex-col gap-2 rounded-md border px-3 py-3",
                !isLoading && account && !payee ? "border-amber-400 bg-amber-50 dark:bg-amber-950/30" : "bg-muted/40",
                className,
            )}
        >
            <h3 id="request-pay-to-heading" className="text-xs font-semibold uppercase text-muted-foreground">
                Will be paid into
            </h3>
            {body}
            {payee && (
                <p className="text-xs text-muted-foreground">
                    The payment keeps this account even if the vendor's bank details change later.
                </p>
            )}
        </section>
    );
}
