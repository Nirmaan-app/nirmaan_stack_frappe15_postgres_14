import { useEffect, useMemo, useRef, useState } from "react";
import ReactSelect, { type MultiValue } from "react-select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/use-toast";
import { getFrappeError } from "@/utils/frappeErrors";
import { useBillingManagers, useBillingMutations } from "../data/useBillingQueries";
import type { BillingTracker } from "../types";
import { inr, poAmount, poInputOf } from "../utils/billingFormat";
import { type ManagerOption, managerSelectStyles } from "./SetupBillingDialog";

interface EditPackageDialogProps {
  project: string;
  /** The package being edited; null closes the dialog. */
  tracker: BillingTracker | null;
  onClose: () => void;
}

/**
 * Edit one package's PO value and assigned users (Admin, from the package table).
 * Saves through the same setup endpoint as the Packages dialog, sending only this package.
 */
export function EditPackageDialog({ project, tracker, onClose }: EditPackageDialogProps) {
  const { data: users, isLoading: usersLoading } = useBillingManagers();
  const { setupBilling, loading } = useBillingMutations();
  const [assigned, setAssigned] = useState<string[]>([]);
  const [po, setPo] = useState("");

  // Fill from the package when the dialog opens, and only then: a refetch must not wipe edits.
  const openedFor = useRef<string | null>(null);
  useEffect(() => {
    if (tracker && openedFor.current !== tracker.name) {
      setAssigned(tracker.billing_managers.map((m) => m.user));
      setPo(poInputOf(tracker.po_value));
    }
    openedFor.current = tracker?.name ?? null;
  }, [tracker]);

  // Billing users can be picked; a saved user outside that list still shows by name.
  const options = useMemo<ManagerOption[]>(
    () => (users || []).map((u) => ({ value: u.email, label: u.full_name || u.email })),
    [users],
  );
  const optionByUser = useMemo(() => {
    const map = new Map<string, ManagerOption>();
    tracker?.billing_managers.forEach((m) => map.set(m.user, { value: m.user, label: m.full_name || m.user }));
    options.forEach((o) => map.set(o.value, o));
    return map;
  }, [tracker, options]);

  const poValue = poAmount(po);

  const save = async () => {
    if (!tracker || poValue === null) return;
    try {
      await setupBilling(project, [{ package: tracker.package, billing_managers: assigned, po_value: poValue }]);
      toast({ title: `${tracker.package} updated`, variant: "success" });
      onClose();
    } catch (e: any) {
      toast({ title: "Could not save the package", description: getFrappeError(e), variant: "destructive" });
    }
  };

  return (
    <Dialog open={!!tracker} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Edit {tracker?.package}</DialogTitle>
          <DialogDescription>PO value and the users assigned to this package.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium" htmlFor="edit-package-po">
              PO value
            </label>
            <Input
              id="edit-package-po"
              inputMode="decimal"
              placeholder="e.g. 92L or 1.2cr"
              value={po}
              onChange={(e) => setPo(e.target.value)}
            />
            <p className={poValue === null ? "mt-1 text-xs font-semibold text-red-700" : "mt-1 text-xs text-muted-foreground"}>
              {poValue === null ? "Can't read this amount" : poValue ? inr(poValue) : "Not set"}
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium">Assigned</label>
            <ReactSelect<ManagerOption, true>
              isMulti
              isLoading={usersLoading}
              options={options}
              value={assigned.map((user) => optionByUser.get(user) ?? { value: user, label: user })}
              onChange={(chosen: MultiValue<ManagerOption>) => setAssigned(chosen.map((o) => o.value))}
              placeholder="Add users…"
              noOptionsMessage={() => "No billing users found"}
              aria-label={`Users assigned to ${tracker?.package ?? "package"}`}
              classNamePrefix="react-select"
              menuPortalTarget={document.body}
              menuPlacement="auto"
              styles={managerSelectStyles}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={poValue === null || loading}>
            {loading ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
