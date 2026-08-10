import React, { useMemo } from "react";
import { formatDistanceToNow } from "date-fns";
import { FileText, Clock, AlertTriangle } from "lucide-react";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/* ─────────────────────────────────────────────────────────────
   WHY THIS IS A SEPARATE COMPONENT, NOT `components/ui/draft-resume-dialog`

   The shared dialog is used by Approve New PR and by Project creation. It IS
   parametric, but its non-PR fallback copy is hardcoded to project creation:

       'You have an unfinished project setup. …'

   which is simply untrue on this screen — a TDS request cart is not a project
   setup. Fixing that properly would mean an optional `description` prop on the
   shared file, i.e. editing a component the PR flow renders.

   OWNER RULING: the PR draft flow must not be disturbed, at all. So this screen
   gets its own dialog and the shared one is left byte-untouched. That is a
   deliberate exception to ADR-0010 F3 ("near-twin flows are one parametric
   module, not a copy") — the cost of the duplicate is accepted in exchange for
   a guarantee that a working flow cannot regress.

   ⚠️ If this ever needs to converge with the shared dialog, the merge direction
   is to add the optional prop THERE and delete this file — not to widen this one.

   The duplication does buy one thing the shared dialog cannot express without
   that prop: an honest summary of what is actually in the saved cart.
   ───────────────────────────────────────────────────────────── */

interface TdsDraftResumeDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Load the saved cart. */
    onResume: () => void;
    /** Discard the saved cart and begin empty. */
    onStartFresh: () => void;
    /** ISO timestamp of the last save. */
    draftDate: string | null;
    /** How many rows the saved cart holds. */
    itemCount: number;
    /** Rows whose uploaded datasheet could not be saved (a File is not storable). */
    needsReattachCount?: number;
}

export const TdsDraftResumeDialog: React.FC<TdsDraftResumeDialogProps> = ({
    open,
    onOpenChange,
    onResume,
    onStartFresh,
    draftDate,
    itemCount,
    needsReattachCount = 0,
}) => {
    const relativeTime = useMemo(() => {
        if (!draftDate) return null;
        try {
            return formatDistanceToNow(new Date(draftDate), { addSuffix: true });
        } catch {
            return null;
        }
    }, [draftDate]);

    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            {/* A choice is REQUIRED — the two buttons are the only exits.
                Dismissing with Escape would close the dialog without resolving the
                draft, leaving autosave disabled for the session (the manager only
                enables saving once the decision is made). AlertDialog already
                ignores outside clicks; this closes the Escape route too. */}
            <AlertDialogContent
                className="max-w-md"
                onEscapeKeyDown={(e) => e.preventDefault()}
            >
                <AlertDialogHeader>
                    <div className="flex items-center justify-center w-11 h-11 rounded-full bg-primary/10 mb-2">
                        <FileText className="w-5 h-5 text-primary" />
                    </div>

                    <AlertDialogTitle className="text-lg font-semibold">
                        Continue your saved TDS request?
                    </AlertDialogTitle>

                    <AlertDialogDescription asChild>
                        <div className="space-y-3">
                            <p className="text-sm text-muted-foreground">
                                You have {itemCount} item{itemCount === 1 ? "" : "s"} saved from an earlier
                                session on this project. Continue where you left off, or clear them and start fresh.
                            </p>

                            <div className="rounded-lg border border-border bg-muted/30 overflow-hidden">
                                <div className="flex items-center gap-3 px-3 py-2.5">
                                    <div className="flex items-center justify-center w-8 h-8 rounded-md bg-primary/10 shrink-0">
                                        <FileText className="w-4 h-4 text-primary" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-xs text-muted-foreground uppercase tracking-wider">
                                            Saved items
                                        </p>
                                        <p className="text-sm font-medium text-foreground">
                                            {itemCount} item{itemCount === 1 ? "" : "s"}
                                        </p>
                                    </div>
                                </div>

                                {relativeTime && (
                                    <div className="flex items-center gap-2 px-3 py-2 border-t border-border/50">
                                        <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                        <span className="text-xs text-muted-foreground">Saved {relativeTime}</span>
                                    </div>
                                )}
                            </div>

                            {/* Said up front, because it is the one thing resuming cannot give back. */}
                            {needsReattachCount > 0 && (
                                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                                    <p className="text-xs text-amber-800">
                                        {needsReattachCount} of them {needsReattachCount === 1 ? "is a" : "are"} new
                                        request{needsReattachCount === 1 ? "" : "s"} whose uploaded datasheet could not
                                        be saved. You will need to remove{" "}
                                        {needsReattachCount === 1 ? "it" : "them"} and file the request again.
                                    </p>
                                </div>
                            )}
                        </div>
                    </AlertDialogDescription>
                </AlertDialogHeader>

                <AlertDialogFooter className="flex-col-reverse sm:flex-row sm:justify-end gap-2">
                    <AlertDialogCancel onClick={onStartFresh} className="mt-0">
                        Clear &amp; start fresh
                    </AlertDialogCancel>
                    <AlertDialogAction onClick={onResume}>Continue</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};

export default TdsDraftResumeDialog;
