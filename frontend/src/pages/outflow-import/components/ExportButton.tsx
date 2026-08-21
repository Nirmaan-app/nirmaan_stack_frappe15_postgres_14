// src/pages/outflow-import/components/ExportButton.tsx

import { useCallback, useState } from "react";
import { Download, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";

interface Props {
    /**
     * How many rows the current view holds.
     *
     * ⚠️ IT IS HERE ONLY TO ANSWER "IS THERE ANYTHING TO TAKE". This button does not count, fetch or
     * cap anything -- the server counts under the same filters and REFUSES over its own ceiling, and
     * that refusal names both numbers. A second opinion about size in the client would be free to
     * disagree with the one that actually decides.
     */
    total: number;
    /** The caller's own reason to withhold the action (a view with no table under it, say). */
    disabled?: boolean;
    /**
     * Fetch the rows and write the file.
     *
     * ⚠️ THE FETCH BELONGS TO THE CALLER, NOT TO THIS BUTTON. Three surfaces export three different
     * populations through two different endpoints, and each one already owns the query it is
     * showing; a button that assembled the query would be a fourth copy of it, free to drift from
     * the table beside it. This owns exactly one thing: whether it is currently busy.
     */
    onExport: () => Promise<void>;
    /** Overridable for a surface where "Export" alone would be ambiguous. Rarely needed. */
    label?: string;
    className?: string;
}

/**
 * "Take this view with you" -- the one control that turns what is on screen into a file.
 *
 * ⚠️ IT SAYS "Export", NEVER "Export CSV". The file extension is not the reader's decision and not
 * their concern: there is one format, the download itself names it, and spelling it on the button
 * spends width stating a fact nobody is choosing.
 *
 * ⚠️ THE BUSY STATE IS ITS OWN AND IT IS NOT OPTIONAL. These exports are UNPAGED -- up to twenty
 * thousand rows -- so the round trip is visibly slow on a wide view. Without it the button looks
 * inert and gets pressed again, which fires a second full query behind the first.
 *
 * ⚠️ A REJECTED `onExport` STOPS THE SPINNER AND SAYS NOTHING. The caller reports -- inline, in its
 * own voice, in the place the click happened -- because only the caller knows what population was
 * being asked for. Swallowing here would be wrong if this were the last handler; it is not, and a
 * button that spun forever on a refusal would be worse than one that simply stops.
 */
export const ExportButton = ({ total, disabled, onExport, label = "Export", className }: Props) => {
    const [busy, setBusy] = useState(false);

    const handleClick = useCallback(async () => {
        if (busy) return;
        setBusy(true);
        try {
            await onExport();
        } catch {
            // Deliberately silent -- see the note above. The caller surfaces the server's sentence.
        } finally {
            setBusy(false);
        }
    }, [busy, onExport]);

    const nothingToExport = total === 0;

    return (
        <Button
            type="button"
            variant="outline"
            size="sm"
            // `h-8` matches the search input and the rest of this toolbar row; `size="sm"` alone is
            // `h-9` on a desktop viewport and would sit a pixel proud of everything beside it.
            className={`h-8 ${className ?? ""}`.trim()}
            disabled={busy || disabled || nothingToExport}
            onClick={handleClick}
            // ⚠️ A DISABLED BUTTON MUST SAY WHY. "Nothing to export" is the whole of the reason here,
            // and without it an empty view reads as a broken control.
            title={nothingToExport ? "Nothing to export" : undefined}
            aria-busy={busy}
        >
            {busy ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
                <Download className="mr-1.5 h-3.5 w-3.5" />
            )}
            {busy ? "Exporting…" : label}
        </Button>
    );
};
