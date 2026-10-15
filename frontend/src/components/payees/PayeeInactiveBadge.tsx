/**
 * The "Inactive" tag beside a Payee that has been marked Inactive (spec #1420): a record already
 * pointing at it keeps it, so whoever reads the record must see it. `alert` (red) where money is
 * about to be paid ("Payment need to paid"); `muted` everywhere else.
 */

import { cn } from "@/lib/utils";

/** The "Inactive" tag: `alert` (red) where the row is not paid until Change account, else `muted`. */
export function PayeeInactiveBadge({ tone = "muted", className }: { tone?: "muted" | "alert"; className?: string }) {
    return (
        <span
            className={cn(
                "shrink-0 rounded-md border px-2 py-0.5 text-xs font-semibold",
                tone === "alert" ? "border-red-300 bg-red-50 text-red-700" : "border-zinc-300 bg-zinc-100 text-zinc-600",
                className,
            )}
        >
            Inactive
        </span>
    );
}
