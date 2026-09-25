// Which stakeholder logos print at the top of THIS PROJECT'S handover documents (owner 2026-09-24).
//
// The six come from the project's `Project TDS Setting`; a role can only be ticked when that setting
// carries BOTH a name and a logo for it. A role that cannot be ticked is shown GREYED WITH THE REASON
// and a link to the TDS tab -- hiding it is what makes people ask where a stakeholder went.
//
// Nothing ticked means every available logo prints, so a project is already right before anyone opens
// this. The print ORDER is fixed (the server's `ROLE_ORDER`), not the order they were ticked, so every
// project's documents look alike -- the dialog says so rather than letting people guess.

import { Loader2 } from "lucide-react";
import * as React from "react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { getFrappeError } from "@/utils/frappeErrors";

import { useHeaderRoles, useSetHeaderRoles } from "./hodApi";

interface HeaderLogosDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  canEdit: boolean;
}

/** Why a role cannot be ticked, in the user's terms. */
const missingReason = (name: string, logo: string): string => {
  if (!name && !logo) return "no name or logo yet";
  if (!logo) return "no logo yet";
  return "no name yet";
};

export const HeaderLogosDialog: React.FC<HeaderLogosDialogProps> = ({
  open,
  onOpenChange,
  projectId,
  canEdit,
}) => {
  const { header, isLoading, mutate } = useHeaderRoles(projectId, open);
  const { setHeaderRoles, saving } = useSetHeaderRoles();
  const [picked, setPicked] = React.useState<Set<string>>(new Set());

  // Fresh from the server every time it opens -- never a stale draft from a previous visit.
  React.useEffect(() => {
    if (open && header) setPicked(new Set(header.selected));
  }, [open, header]);

  const toggle = (role: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      next.has(role) ? next.delete(role) : next.add(role);
      return next;
    });

  const save = async () => {
    try {
      await setHeaderRoles(projectId, Array.from(picked));
      await mutate();
      toast({
        title: "Saved",
        description: "The handover documents will print these logos.",
        variant: "success",
      });
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Could not save",
        description: getFrappeError(error),
        variant: "destructive",
      });
    }
  };

  const roles = header?.roles ?? [];
  const anySelectable = roles.some((r) => r.selectable);

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Header logos</DialogTitle>
          <DialogDescription>
            Which logos print at the top of this project's handover documents.
            The Completion Certificate and Equipment Warranty carry the company
            letterhead instead.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-10 text-sm text-gray-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : !roles.length ? (
          <p className="py-6 text-sm text-gray-600">
            This project has no TDS Repository set up, so there are no logos to
            choose from yet.
          </p>
        ) : (
          <div className="space-y-1">
            {roles.map((r) => {
              const on = picked.has(r.role);
              return (
                <label
                  key={r.role}
                  className={cn(
                    "flex items-center gap-3 rounded-md border px-3 py-2",
                    r.selectable
                      ? "cursor-pointer hover:bg-gray-50"
                      : "cursor-not-allowed bg-gray-50 opacity-70",
                  )}
                >
                  <Checkbox
                    checked={on}
                    disabled={!r.selectable || !canEdit || saving}
                    onCheckedChange={() => r.selectable && toggle(r.role)}
                  />
                  <span className="flex h-8 w-16 shrink-0 items-center justify-center overflow-hidden rounded border bg-white">
                    {r.logo ? (
                      <img
                        src={r.logo}
                        alt={r.name}
                        className="max-h-7 max-w-full object-contain"
                      />
                    ) : (
                      <span className="text-[10px] text-gray-400">—</span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-gray-800">
                      {r.name || "—"}
                    </span>
                    <span className="block text-xs text-gray-500">
                      {r.label}
                      {!r.selectable && (
                        <>
                          {" · "}
                          {missingReason(r.name, r.logo)}
                          {" — "}
                          <Link
                            to={`/projects/${projectId}?tab=tds`}
                            className="text-blue-600 hover:underline"
                          >
                            add it on the TDS tab
                          </Link>
                        </>
                      )}
                    </span>
                  </span>
                </label>
              );
            })}

            <p className="pt-2 text-xs text-gray-500">
              They print in this order: Nirmaan · GC Contractor · Client ·
              Project Manager · Architect · Consultant.
              {anySelectable &&
                " Nothing ticked means every available logo prints."}
            </p>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            {canEdit ? "Cancel" : "Close"}
          </Button>
          {canEdit && (
            <Button onClick={save} disabled={saving || !anySelectable}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Save
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
