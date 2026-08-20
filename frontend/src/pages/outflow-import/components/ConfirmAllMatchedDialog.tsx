// src/pages/outflow-import/components/ConfirmAllMatchedDialog.tsx

import { useState } from "react";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogTitle,
} from "@/components/ui/dialog";

import { ConfirmMatchedPanel } from "./ConfirmMatchedPanel";

interface Props {
    /**
     * The population to confirm over — the SAME filter set the master table and the summary use
     * (slice P1).
     *
     * ⚠️ IT WAS `batch?: string`, AND THE WIDENING IS NOT COSMETIC. The panel's button is labelled
     * with `confirmable_rows` from `get_outflow_summary`, which now counts a PERIOD. If this dialog
     * kept asking for one import, the button would offer a number this list could not produce —
     * which is precisely the "button 688, table 893" defect the `stale` bucket exists to explain,
     * except unexplainable, because the missing rows would have no property in common. Both sides
     * pass the same object to the same server-side `_row_filters`.
     */
    filters: Record<string, unknown>;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSettled: () => Promise<void> | void;
}

/**
 * "Confirm all matched", as a dialog off the summary panel.
 *
 * ⚠️ THE WORK IS ALL IN `ConfirmMatchedPanel` NOW (slice CF/S6), AND THIS FILE IS DELIBERATELY THIN.
 * The same panel is step 4 of the Cashfree import wizard, and the owner's ruling there was that one
 * dialog must not close so another can open. Two copies of a tree that decides what a click WRITES —
 * including how many approved amounts it rewrites — would be free to disagree about that, which is
 * the one disagreement this screen cannot afford.
 *
 * ⚠️ NOT THE EXTRACTION THE CASHBOOK SLICE REJECTED. That one tried to share the three-level
 * tri-state TREE with `CashbookReviewTree`, and the finding stands: strip the tri-state selection
 * and no component remains. This moves the whole panel — tree, selection, safety bar and settle loop
 * together — out of its shell. Nothing is shared with `CashbookReviewTree`.
 *
 * ⚠️ IT STILL REFUSES TO CLOSE MID-WRITE. That was `running`, private to the old component; the
 * panel now reports it through `onRunningChange`, because only a host knows what its own dismiss is.
 */
export const ConfirmAllMatchedDialog = ({ filters, open, onOpenChange, onSettled }: Props) => {
    const [running, setRunning] = useState(false);

    return (
        <Dialog open={open} onOpenChange={(next) => (running ? null : onOpenChange(next))}>
            <DialogContent className="max-w-5xl">
                {/* The Radix chrome is passed IN rather than wrapped around: the heading text
                    depends on the panel's own state (it becomes "Confirmation results" once the
                    loop has run), and `DialogContent` needs a real `DialogTitle` for
                    accessibility. */}
                <ConfirmMatchedPanel
                    filters={filters}
                    active={open}
                    onClose={() => onOpenChange(false)}
                    onSettled={onSettled}
                    onRunningChange={setRunning}
                    Title={DialogTitle}
                    Description={DialogDescription}
                    Footer={DialogFooter}
                />
            </DialogContent>
        </Dialog>
    );
};
