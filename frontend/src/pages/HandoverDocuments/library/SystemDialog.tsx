// Add or edit one HOD System (the library's top level): what it is called, the package it belongs to,
// whether it can still be added to a project, and the keywords that narrow what it reads when several
// systems share one package. Everything a document carries — the text blocks, the tools, the warranty
// equipment and which documents a new project starts with switched off — is set on its own row in the
// document list under the system.

import { Loader2 } from "lucide-react";
import * as React from "react";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { getFrappeError } from "@/utils/frappeErrors";

import type { HodDocumentMeta } from "../types";
import {
  HOD_SYSTEM_DOCTYPE,
  HodSystemAdmin,
  useHodLibraryMutations,
} from "./hodLibraryApi";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Editing an existing system, or undefined to add one. */
  system?: HodSystemAdmin;
  workPackages: string[];
  documents: HodDocumentMeta[];
  onSaved: () => void | Promise<unknown>;
}

interface Draft {
  system_name: string;
  display_name: string;
  work_package: string;
  is_active: boolean;
  tools: string;
  warranty_equipment: string;
  source_keywords: string;
  default_disabled: string[];
}

const emptyDraft: Draft = {
  system_name: "",
  display_name: "",
  work_package: "",
  is_active: true,
  tools: "",
  warranty_equipment: "",
  source_keywords: "",
  default_disabled: [],
};

const draftOf = (system?: HodSystemAdmin): Draft =>
  system
    ? {
        system_name: system.system_name,
        display_name: system.display_name,
        work_package: system.work_package,
        is_active: !!system.is_active,
        tools: system.tools ?? "",
        warranty_equipment: system.warranty_equipment ?? "",
        source_keywords: system.source_keywords ?? "",
        default_disabled: system.default_disabled,
      }
    : emptyDraft;

export const SystemDialog: React.FC<Props> = ({
  open,
  onOpenChange,
  system,
  workPackages,
  documents,
  onSaved,
}) => {
  const [draft, setDraft] = React.useState<Draft>(draftOf(system));
  const [error, setError] = React.useState("");
  const { createDoc, updateDoc, saving } = useHodLibraryMutations();

  React.useEffect(() => {
    if (open) {
      setDraft(draftOf(system));
      setError("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, system?.name]);

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const save = async () => {
    const name = draft.system_name.trim();
    if (!name || !draft.display_name.trim() || !draft.work_package) {
      setError("Name, printed name and Work Package are needed.");
      return;
    }
    // The document keys keep the index order, so the stored lines read the same way every time.
    const values = {
      display_name: draft.display_name.trim(),
      work_package: draft.work_package,
      is_active: draft.is_active ? 1 : 0,
      tools: draft.tools.trim(),
      warranty_equipment: draft.warranty_equipment.trim(),
      source_keywords: draft.source_keywords.trim(),
      default_disabled_documents: documents
        .filter((d) => draft.default_disabled.includes(d.key))
        .map((d) => d.key)
        .join("\n"),
    };
    try {
      if (system) {
        await updateDoc(HOD_SYSTEM_DOCTYPE, system.name, values);
      } else {
        await createDoc(HOD_SYSTEM_DOCTYPE, { system_name: name, ...values });
      }
      await onSaved();
      toast({
        title: system ? "System updated" : "System added",
        description: `${name} is saved.`,
        variant: "success",
      });
      onOpenChange(false);
    } catch (e) {
      setError(getFrappeError(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {system ? `Edit ${system.system_name}` : "New handover system"}
          </DialogTitle>
          <DialogDescription>
            What the system is called and where it belongs. Its documents, text
            blocks, tools and warranty equipment are set up in the list below it.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-xs text-gray-600">Name</Label>
              <Input
                className="h-9"
                placeholder="Electrical"
                value={draft.system_name}
                disabled={!!system}
                onChange={(e) => set({ system_name: e.target.value })}
              />
              <p className="text-[11px] text-gray-500">
                {system
                  ? "The name cannot be changed here."
                  : "Shown on the project tab."}
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-gray-600">Printed name</Label>
              <Input
                className="h-9"
                placeholder="ELECTRICAL SYSTEM"
                value={draft.display_name}
                onChange={(e) => set({ display_name: e.target.value })}
              />
              <p className="text-[11px] text-gray-500">
                Printed as PACKAGE on every page.
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-gray-600">Work Package</Label>
              <Select
                value={draft.work_package}
                onValueChange={(v) => set({ work_package: v })}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  {workPackages.map((wp) => (
                    <SelectItem key={wp} value={wp}>
                      {wp}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-gray-500">
                Projects with this package see the system first.
              </p>
            </div>
          </div>

          <label className="flex w-fit items-center gap-2 text-sm">
            <Checkbox
              checked={draft.is_active}
              onCheckedChange={(c) => set({ is_active: c === true })}
            />
            Active — can be added to a project
          </label>

          <div className="space-y-1">
            <Label className="text-xs text-gray-600">
              Keywords (one per line)
            </Label>
            <Textarea
              rows={3}
              placeholder={"VESDA\nCritical Room ELV"}
              value={draft.source_keywords}
              onChange={(e) => set({ source_keywords: e.target.value })}
            />
            <p className="text-[11px] text-gray-500">
              Only needed when several systems share one Work Package (Critical
              Room ELV = GSS, VESDA, WLD &amp; RRS). Each keyword is matched as
              a whole word against Commission Report tasks and As Built
              drawings.
            </p>
          </div>

          {error && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
