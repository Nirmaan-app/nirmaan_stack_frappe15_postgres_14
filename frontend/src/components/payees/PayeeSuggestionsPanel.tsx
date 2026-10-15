/**
 * "Payees that look like this vendor" (spec #1420, approved mockup screen 5): the Active Payees the
 * server ranks for the vendor's name and PAN (`services/payees/matching.py`), each labelled Strong
 * match or Name only, with its account and links, and a "Use this payee" button.
 */

import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PAYEE_MATCH, type PayeeSuggestion } from "@/types/NirmaanStack/Payee";
import { getFrappeError } from "@/utils/frappeErrors";
import { accountLine, MATCH_LABEL, suggestionLinkLine } from "@/utils/payees/payeeChoice";

interface PayeeSuggestionsPanelProps {
    /** False until a name or PAN has been typed. */
    asked: boolean;
    suggestions: PayeeSuggestion[];
    /** The new vendor's PAN as typed: no PAN, no word about PAN on the cards. */
    vendorPan?: string;
    isLoading: boolean;
    error?: unknown;
    /** The Payee the vendor is set to use now, marked on its card. */
    chosen?: string | null;
    onUse: (payee: string) => void;
    className?: string;
}

export function PayeeSuggestionsPanel({
    asked,
    suggestions,
    vendorPan,
    isLoading,
    error,
    chosen,
    onUse,
    className,
}: PayeeSuggestionsPanelProps) {
    return (
        <aside
            aria-labelledby="payee-suggestions-title"
            className={cn("flex flex-col gap-3.5 rounded-xl border p-[18px] shadow-sm", className)}
        >
            <div>
                <h2 id="payee-suggestions-title" className="text-base font-semibold">
                    Payees that look like this vendor
                </h2>
                <p className="mt-1 text-[13px] text-muted-foreground">
                    Matched on name, and on the PAN of vendors already linked. Check these before typing new details.
                </p>
            </div>

            {!asked && <p className="text-[13px] text-muted-foreground">Type the vendor name or PAN to see matches.</p>}
            {asked && isLoading && (
                <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Looking for matches...
                </p>
            )}
            {asked && !!error && <p className="text-[13px] text-destructive">{getFrappeError(error)}</p>}
            {asked && !isLoading && !error && suggestions.length === 0 && (
                <p className="text-[13px] text-muted-foreground">No payee on record looks like this vendor.</p>
            )}

            {suggestions.map((s) => {
                const strong = s.match === PAYEE_MATCH.STRONG;
                const isChosen = s.name === chosen;
                return (
                    <div key={s.name} className="flex flex-col gap-2 rounded-lg border p-3.5">
                        <div className="flex items-baseline justify-between gap-2">
                            <b className="text-sm">{s.account_name}</b>
                            <span
                                className={cn(
                                    "shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold",
                                    strong ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800",
                                )}
                            >
                                {MATCH_LABEL[s.match]}
                            </span>
                        </div>
                        <p className="text-[13px] tabular-nums text-muted-foreground">{accountLine(s)}</p>
                        <p className="text-[13px] text-muted-foreground">{suggestionLinkLine(s, vendorPan)}</p>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className={cn("self-start", strong && "border-primary text-primary hover:text-primary")}
                            disabled={isChosen}
                            onClick={() => onUse(s.name)}
                        >
                            {isChosen ? "Chosen for this vendor" : "Use this payee"}
                        </Button>
                    </div>
                );
            })}
        </aside>
    );
}
