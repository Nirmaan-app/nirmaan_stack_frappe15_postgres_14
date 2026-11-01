/**
 * Table cells that show the short form and open a card with the whole thing: the bank account a claim is
 * paid into, and its title with the full description. Used by every Reimbursements tab.
 *
 * The card opens on hover AND on click / tap. Built on the Radix primitive rather than the shared
 * `ui/hover-card`, which, on any screen reporting touch support (a touch laptop included), opens only on a
 * long press and never on hover -- so the bank details would not show for a mouse user on such a machine.
 */

import { Landmark } from "lucide-react";
import * as HoverCardPrimitive from "@radix-ui/react-hover-card";
import { useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { Reimbursement } from "@/types/NirmaanStack/Reimbursement";

/** Hover (mouse) or click / tap (anything) opens the card; moving away or clicking again closes it. */
function DetailsCard({ trigger, children, className }: { trigger: ReactNode; children: ReactNode; className?: string }) {
    const [open, setOpen] = useState(false);
    return (
        <HoverCardPrimitive.Root open={open} onOpenChange={setOpen} openDelay={200} closeDelay={150}>
            <HoverCardPrimitive.Trigger asChild>
                <div
                    role="button"
                    tabIndex={0}
                    className="min-w-0 cursor-pointer"
                    onClick={() => setOpen((o) => !o)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setOpen((o) => !o);
                        }
                    }}
                >
                    {trigger}
                </div>
            </HoverCardPrimitive.Trigger>
            <HoverCardPrimitive.Portal>
                <HoverCardPrimitive.Content
                    align="start"
                    sideOffset={8}
                    className={cn(
                        "z-50 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none",
                        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
                        className,
                    )}
                >
                    {children}
                </HoverCardPrimitive.Content>
            </HoverCardPrimitive.Portal>
        </HoverCardPrimitive.Root>
    );
}

type PayTo = Pick<
    Reimbursement,
    "pay_to_account_name" | "pay_to_account_number" | "pay_to_ifsc" | "pay_to_bank_name" | "pay_to_bank_branch"
>;

/** "Holder / Bank ••••1234" in the cell; the full account (number, IFSC, bank, branch) in the card. */
export function PayToCell({ claim }: { claim: PayTo }) {
    const number = claim.pay_to_account_number ?? "";
    return (
        <DetailsCard
            className="w-80"
            trigger={
                <>
                    <div className="truncate underline decoration-dotted underline-offset-4">{claim.pay_to_account_name}</div>
                    <div className="text-[11px] text-muted-foreground">
                        {claim.pay_to_bank_name} <span className="font-mono">{number ? `••••${number.slice(-4)}` : ""}</span>
                    </div>
                </>
            }
        >
            <div className="flex items-start gap-3">
                <Landmark className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <dl className="grid min-w-0 flex-1 grid-cols-[110px_minmax(0,1fr)] gap-x-2 gap-y-1 text-sm">
                    <dt className="text-muted-foreground">Account holder</dt>
                    <dd className="break-words font-medium">{claim.pay_to_account_name || "--"}</dd>
                    <dt className="text-muted-foreground">Account number</dt>
                    <dd className="break-all font-mono">{number || "--"}</dd>
                    <dt className="text-muted-foreground">IFSC</dt>
                    <dd className="font-mono">{claim.pay_to_ifsc || "--"}</dd>
                    <dt className="text-muted-foreground">Bank</dt>
                    <dd className="break-words">{claim.pay_to_bank_name || "--"}</dd>
                    <dt className="text-muted-foreground">Branch</dt>
                    <dd className="break-words">{claim.pay_to_bank_branch || "--"}</dd>
                </dl>
            </div>
        </DetailsCard>
    );
}

/** The title with one line of description in the cell; the title and the whole description in the card. */
export function TitleCell({ claim }: { claim: Pick<Reimbursement, "title" | "description"> }) {
    if (!claim.description) {
        return <div className="truncate font-medium" title={claim.title}>{claim.title}</div>;
    }
    return (
        <DetailsCard
            className="w-96"
            trigger={
                <div className="min-w-0">
                    <div className="truncate font-medium">{claim.title}</div>
                    <div className="truncate text-[11px] text-muted-foreground underline decoration-dotted underline-offset-4">
                        {claim.description}
                    </div>
                </div>
            }
        >
            <p className="break-words text-sm font-semibold">{claim.title}</p>
            <p className="mt-1.5 whitespace-pre-wrap break-words text-sm text-muted-foreground">{claim.description}</p>
        </DetailsCard>
    );
}
