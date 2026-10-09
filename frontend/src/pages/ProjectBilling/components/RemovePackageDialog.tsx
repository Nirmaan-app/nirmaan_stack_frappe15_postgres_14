import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/use-toast";
import { getFrappeError } from "@/utils/frappeErrors";
import { useBillingMutations, usePackageRemovalSummary } from "../data/useBillingQueries";
import { inr, removalConfirmed } from "../utils/billingFormat";

interface RemovePackageDialogProps {
  /** The package to remove from its project; null closes the dialog. */
  tracker: { name: string; package: string } | null;
  onClose: () => void;
  /** Called after the package is removed (e.g. to switch the package tabs back to All). */
  onRemoved?: () => void;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Admin: remove a package from its project (owner, 2026-10-05). Shows exactly what goes with it,
 * from the server, and asks for the package's name to be typed before the Remove button works.
 * The server checks the role and the typed name again and deletes everything in one transaction.
 */
export function RemovePackageDialog({ tracker, onClose, onRemoved }: RemovePackageDialogProps) {
  const { data, isLoading, error } = usePackageRemovalSummary(tracker?.name ?? null);
  const summary = data?.message;
  const { removeProjectPackage, loading } = useBillingMutations();
  const [typed, setTyped] = useState("");

  // A fresh confirmation for every package the dialog opens on.
  useEffect(() => setTyped(""), [tracker?.name]);

  const confirmed = !!tracker && removalConfirmed(typed, tracker.package);

  const remove = async () => {
    if (!tracker || !confirmed) return;
    try {
      await removeProjectPackage(tracker.name, typed);
      toast({ title: `${tracker.package} removed from ${summary?.project_name ?? "the project"}`, variant: "success" });
      onRemoved?.();
      onClose();
    } catch (e: any) {
      toast({ title: "Could not remove the package", description: getFrappeError(e), variant: "destructive" });
    }
  };

  return (
    <Dialog open={!!tracker} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>
            Remove {tracker?.package} from {summary?.project_name ?? "this project"}?
          </DialogTitle>
          <DialogDescription>This permanently deletes:</DialogDescription>
        </DialogHeader>

        {isLoading || !summary ? (
          <p className="text-sm text-muted-foreground">
            {error ? getFrappeError(error) : "Counting what goes with it…"}
          </p>
        ) : (
          <ul className="space-y-1.5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
            <li>
              • <span className="font-semibold">{plural(summary.bills, "bill")}</span>: {inr(summary.billed)} billed,{" "}
              {inr(summary.approved)} approved
              {summary.attachments > 0 && ` (${plural(summary.attachments, "attachment")})`}
              {summary.na_bills > 0 && `, including ${summary.na_bills} NA`}
            </li>
            <li>
              • <span className="font-semibold">{plural(summary.dc_entries, "Supply DC entry", "Supply DC entries")}</span>{" "}
              ({inr(summary.supply_dc)})
            </li>
            <li>
              • its managers ({summary.managers.join(", ") || "none"}) and PO value ({inr(summary.po_value)})
            </li>
          </ul>
        )}

        <p className="text-xs text-muted-foreground">
          A copy of each is kept in Deleted Documents in Desk, where an Admin can restore it.
        </p>

        <div>
          <label htmlFor="remove-package-confirm" className="mb-1.5 block text-sm font-medium">
            Type <span className="font-bold">{tracker?.package}</span> to confirm
          </label>
          <Input
            id="remove-package-confirm"
            autoComplete="off"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && remove()}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={!confirmed || !summary || loading} onClick={remove}>
            {loading ? "Removing…" : "Remove package"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
