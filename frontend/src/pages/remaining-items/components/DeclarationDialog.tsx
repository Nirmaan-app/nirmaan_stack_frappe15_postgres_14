import React, { useEffect, useMemo, useState } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ShieldAlert } from "lucide-react";
import { FormEntry } from "../hooks/useRemainingItemsForm";
import { useUserData } from "@/hooks/useUserData";
import { formatDate } from "@/utils/FormatDate";

/* ─────────────────────────────────────────────────────────────
   DECLARATION DIALOG

   Final confirmation step before submitting the remaining items
   inventory report. Displays a summary of all entries grouped
   by category, formal declaration clauses, and requires the
   user to acknowledge accuracy before submission.

   This is a compliance gate — not a generic confirm dialog.
   ───────────────────────────────────────────────────────────── */

interface DeclarationDialogProps {
  /** Dialog open state */
  open: boolean;
  /** Callback when dialog open state changes */
  onOpenChange: (open: boolean) => void;
  /** All form entries to summarize */
  entries: FormEntry[];
  /** Callback to trigger the actual API submission */
  onConfirm: () => void;
  /** Whether the submission request is in flight */
  isSubmitting: boolean;
  /** Project city for the declaration place line */
  projectCity?: string;
}

export const DeclarationDialog: React.FC<DeclarationDialogProps> = ({
  open,
  onOpenChange,
  entries,
  onConfirm,
  isSubmitting,
  projectCity,
}) => {
  const { full_name } = useUserData();
  const [confirmed, setConfirmed] = useState(false);

  // Reset checkbox when dialog opens or closes.
  // This is the standard pattern for syncing transient UI state to a modal's
  // open/close lifecycle — acceptable per React best practices for dialogs.
  useEffect(() => {
    setConfirmed(false);
  }, [open]);

  // Group entries by category, preserving insertion order
  const groupedEntries = useMemo(() => {
    const groups: { category: string; items: FormEntry[] }[] = [];
    const seen = new Map<string, number>();

    for (const entry of entries) {
      const idx = seen.get(entry.category);
      if (idx !== undefined) {
        groups[idx].items.push(entry);
      } else {
        seen.set(entry.category, groups.length);
        groups.push({ category: entry.category, items: [entry] });
      }
    }

    return groups;
  }, [entries]);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-lg">
        <AlertDialogHeader className="space-y-4">
          {/* Icon badge */}
          <div className="mx-auto sm:mx-0 flex items-center justify-center w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/30">
            <ShieldAlert className="w-6 h-6 text-amber-600 dark:text-amber-400" />
          </div>

          <div className="space-y-2">
            <AlertDialogTitle className="text-lg font-semibold">
              Declaration of Accuracy
            </AlertDialogTitle>

            <AlertDialogDescription asChild>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">
                  Please review the quantities below before submitting. This
                  declaration serves as a formal record of the reported
                  inventory figures.
                </p>
              </div>
            </AlertDialogDescription>
          </div>
        </AlertDialogHeader>

        {/* ── Scrollable item summary ── */}
        <div className="rounded-md border border-border bg-muted/30 overflow-hidden">
          <div className="max-h-[240px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-muted">
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-3 font-medium text-muted-foreground">
                    Item
                  </th>
                  <th className="text-right py-2 px-3 font-medium text-muted-foreground whitespace-nowrap">
                    Remaining Qty
                  </th>
                </tr>
              </thead>
              <tbody>
                {groupedEntries.map((group) => (
                  <React.Fragment key={group.category}>
                    <tr className="border-b border-border/50">
                      <td
                        colSpan={2}
                        className="py-1.5 px-3 bg-muted/50"
                      >
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          {group.category}
                        </span>
                      </td>
                    </tr>
                    {group.items.map((item) => (
                      <tr
                        key={`${item.category}_${item.item_id}`}
                        className="border-b border-border/30 last:border-b-0"
                      >
                        <td className="py-1.5 px-3 text-foreground">
                          {item.item_name}
                        </td>
                        <td className="py-1.5 px-3 text-right font-mono text-foreground tabular-nums">
                          {item.remaining_quantity ?? "—"}
                          {item.unit ? (
                            <span className="ml-1 text-xs text-muted-foreground font-sans">
                              {item.unit}
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Declaration clauses ── */}
        <div className="space-y-3">
          <ol className="list-decimal list-outside ml-5 space-y-2 text-sm text-foreground/90">
            <li>
              I have physically verified the remaining quantities reported above
              at the project site.
            </li>
            <li>
              I understand that these figures will be used for financial
              reconciliation and inventory valuation.
            </li>
            <li>
              I accept responsibility for the accuracy of this data and
              acknowledge that discrepancies may require explanation.
            </li>
          </ol>

          {/* ── Confirmation checkbox — official declaration format ── */}
          <label className="flex items-start gap-3 cursor-pointer select-none rounded-md border border-border bg-muted/30 p-3.5 transition-colors hover:bg-muted/50">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-primary"
            />
            <div className="text-sm text-foreground leading-relaxed space-y-2.5">
              <p>
                I, <span className="font-semibold underline underline-offset-2">{full_name || "—"}</span>,
                hereby confirm that all quantities reported above are accurate
                and have been physically verified at the project site.
              </p>
              <div className="flex flex-col gap-1 text-[13px] text-foreground/80 pt-0.5">
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-12 shrink-0">Place:</span>
                  <span className="font-medium">{projectCity || "—"}</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-12 shrink-0">Date:</span>
                  <span className="font-medium">{formatDate(new Date())}</span>
                </div>
              </div>
            </div>
          </label>
        </div>

        {/* ── Footer actions ── */}
        <AlertDialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            disabled={!confirmed || isSubmitting}
          >
            {isSubmitting ? "Submitting..." : "Confirm & Submit"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default DeclarationDialog;
