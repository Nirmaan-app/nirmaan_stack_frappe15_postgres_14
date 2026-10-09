// "Create Handover Documents" / "Add System": choose the systems this project hands over (owner ruling
// 2026-09-21 — systems are added on purpose, never automatically). Several can be chosen at once; the
// server adds them all or none. Styled after the Commission Report's "Create" dialog.

import { Grid3X3, FolderArchive, Loader2 } from "lucide-react";
import * as React from "react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

import type { HodSystemOption } from "./types";

export const AddSystemDialog: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectName: string;
  /** First time on this project ("Create Handover Documents") or adding more ("Add Package"). A system is
   *  called a PACKAGE on screen (owner 2026-10-06, UI wording only). */
  firstTime: boolean;
  systems: HodSystemOption[];
  onAdd: (systems: string[]) => Promise<void>;
}> = ({ open, onOpenChange, projectName, firstTime, systems, onAdd }) => {
  const [selected, setSelected] = React.useState<string[]>([]);
  const [adding, setAdding] = React.useState(false);

  React.useEffect(() => {
    if (open) setSelected([]);
  }, [open]);

  const available = systems.filter((s) => !s.added && s.is_active);
  const suggested = available.filter((s) => s.suggested);
  const others = available.filter((s) => !s.suggested);

  const toggle = (name: string) =>
    setSelected((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );

  const confirm = async () => {
    if (!selected.length) return;
    setAdding(true);
    try {
      await onAdd(selected);
      onOpenChange(false);
    } catch {
      // The caller has already shown the error; keep the dialog open with the choice intact.
    } finally {
      setAdding(false);
    }
  };

  const group = (title: string, hint: string, list: HodSystemOption[]) =>
    list.length > 0 && (
      <div className="rounded border border-gray-200 p-4">
        <Label className="text-xs font-medium uppercase tracking-wide text-gray-600">
          {title}
        </Label>
        <p className="mb-3 mt-1 text-xs text-gray-400">{hint}</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {list.map((s) => {
            const isSelected = selected.includes(s.name);
            return (
              <Button
                key={s.name}
                type="button"
                variant={isSelected ? "default" : "outline"}
                size="sm"
                title={s.display_name}
                onClick={() => toggle(s.name)}
                className="h-auto min-h-[40px] flex-col items-start justify-center whitespace-normal py-2 text-left text-xs"
              >
                <span className="font-semibold">{s.name}</span>
                <span className="text-[10px] font-normal opacity-70">
                  {s.work_package}
                </span>
              </Button>
            );
          })}
        </div>
      </div>
    );

  return (
    <AlertDialog open={open} onOpenChange={(o) => !adding && onOpenChange(o)}>
      <AlertDialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-pink-100">
              <FolderArchive className="h-5 w-5 text-pink-600" />
            </div>
            <span>
              {firstTime ? "Create Handover Documents" : "Add Package"}
            </span>
          </AlertDialogTitle>
          <AlertDialogDescription className="ml-[52px]">
            {firstTime
              ? "Setting up handover documents for "
              : "Adding packages to the handover of "}
            <span className="font-semibold text-primary">{projectName}</span>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex items-center gap-2 border-b border-gray-100 pb-2">
            <Grid3X3 className="h-4 w-4 text-gray-500" />
            <Label className="text-sm font-medium text-gray-700">
              Choose Packages <span className="text-red-500">*</span>
            </Label>
          </div>

          {available.length === 0 ? (
            <div className="rounded border border-dashed border-gray-200 p-4 text-center text-sm text-gray-400">
              {systems.length
                ? "Every package is already added to this project."
                : "No handover package is set up yet."}
            </div>
          ) : (
            <>
              {group(
                "Packages on this project",
                "Their work package is one of this project's",
                suggested,
              )}
              {group(
                suggested.length ? "Other packages" : "Packages",
                "Each package gets the 16 handover documents",
                others,
              )}
            </>
          )}

          {selected.length > 0 && (
            <p className="text-xs text-gray-500">
              {selected.length} package{selected.length !== 1 ? "s" : ""}{" "}
              selected — each gets the 16 handover documents
            </p>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={adding}>Cancel</AlertDialogCancel>
          <Button onClick={confirm} disabled={!selected.length || adding}>
            {adding && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirm
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
