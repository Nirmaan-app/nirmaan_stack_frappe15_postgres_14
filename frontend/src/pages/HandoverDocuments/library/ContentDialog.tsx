// Add or edit one block of library text for a system: an O&M manual, a Do's & Don'ts, or a maintenance
// checklist. What the form asks for follows the kind — the manual is written text, the other two are
// lists, one item per line, exactly as they print.

import { Eye, Loader2, Pencil } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
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

import {
  HOD_CONTENT_DOCTYPE,
  HodLibraryBlockAdmin,
  LibraryDocument,
  useHodLibraryMutations,
} from "./hodLibraryApi";

/** What each kind calls its two lists; the manual uses the text box instead. */
const LIST_LABELS: Record<LibraryDocument, [string, string] | null> = {
  "O&M Manual": null,
  "Do's & Don'ts": ["Do's (one per line)", "Don'ts (one per line)"],
  "Maintenance Checklist": [
    "Six-monthly checks (one per line)",
    "Yearly checks (one per line)",
  ],
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hodSystem: string;
  /** Editing an existing block, or undefined to add one of `document`. */
  block?: HodLibraryBlockAdmin;
  document: LibraryDocument;
  libraryDocuments: LibraryDocument[];
  onSaved: () => void | Promise<unknown>;
}

interface Draft {
  document: LibraryDocument;
  title: string;
  sub_system: string;
  display_order: string;
  content: string;
  list_1: string;
  list_2: string;
}

const draftOf = (
  document: LibraryDocument,
  block?: HodLibraryBlockAdmin,
): Draft => ({
  document: block?.document ?? document,
  title: block?.title ?? "",
  sub_system: block?.sub_system ?? "",
  display_order: String(block?.display_order ?? 0),
  content: block?.content ?? "",
  list_1: block?.list_1 ?? "",
  list_2: block?.list_2 ?? "",
});

export const ContentDialog: React.FC<Props> = ({
  open,
  onOpenChange,
  hodSystem,
  block,
  document,
  libraryDocuments,
  onSaved,
}) => {
  const [draft, setDraft] = React.useState<Draft>(draftOf(document, block));
  const [preview, setPreview] = React.useState(false);
  const [error, setError] = React.useState("");
  const { createDoc, updateDoc, saving } = useHodLibraryMutations();

  React.useEffect(() => {
    if (open) {
      setDraft(draftOf(document, block));
      setPreview(false);
      setError("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, block?.name, document]);

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const listLabels = LIST_LABELS[draft.document];

  const save = async () => {
    if (!draft.title.trim()) {
      setError("A title is needed — it is the heading on the printed page.");
      return;
    }
    const values = {
      hod_system: hodSystem,
      document: draft.document,
      title: draft.title.trim(),
      sub_system: draft.sub_system.trim(),
      display_order: Number(draft.display_order) || 0,
      content: listLabels ? "" : draft.content,
      list_1: listLabels ? draft.list_1 : "",
      list_2: listLabels ? draft.list_2 : "",
    };
    try {
      if (block) {
        await updateDoc(HOD_CONTENT_DOCTYPE, block.name, values);
      } else {
        await createDoc(HOD_CONTENT_DOCTYPE, values);
      }
      await onSaved();
      toast({
        title: block ? "Text updated" : "Text added",
        description: `${values.title} is saved.`,
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
            {block ? `Edit ${block.title}` : `New ${draft.document}`}
          </DialogTitle>
          <DialogDescription>
            {hodSystem} — every project that hands this system over prints this
            text, with its own blanks and picks.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1">
              <Label className="text-xs text-gray-600">Kind</Label>
              <Select
                value={draft.document}
                onValueChange={(v) => set({ document: v as LibraryDocument })}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {libraryDocuments.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs text-gray-600">Title</Label>
              <Input
                className="h-9"
                placeholder="MAINTENANCE CHECKLIST - VRF SYSTEM"
                value={draft.title}
                onChange={(e) => set({ title: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-gray-600">Order</Label>
              <Input
                className="h-9"
                type="number"
                value={draft.display_order}
                onChange={(e) => set({ display_order: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-gray-600">Part (optional)</Label>
            <Input
              className="h-9 max-w-xs"
              placeholder="VRF"
              value={draft.sub_system}
              onChange={(e) => set({ sub_system: e.target.value })}
            />
            <p className="text-[11px] text-gray-500">
              Only when a system has several of this kind (HVAC: DX, Duct,
              VRF…). A project ticks the parts it hands over. Left empty, this
              block is always included. Renaming a part unticks it on projects
              that already picked.
            </p>
          </div>

          {listLabels ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {([0, 1] as const).map((i) => (
                <div key={i} className="space-y-1">
                  <Label className="text-xs text-gray-600">
                    {listLabels[i]}
                  </Label>
                  <Textarea
                    rows={12}
                    className="font-mono text-[13px]"
                    value={i === 0 ? draft.list_1 : draft.list_2}
                    onChange={(e) =>
                      set(
                        i === 0
                          ? { list_1: e.target.value }
                          : { list_2: e.target.value },
                      )
                    }
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-gray-600">Manual text</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setPreview((p) => !p)}
                >
                  {preview ? (
                    <>
                      <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                    </>
                  ) : (
                    <>
                      <Eye className="mr-1 h-3.5 w-3.5" /> Preview
                    </>
                  )}
                </Button>
              </div>
              {preview ? (
                <div
                  className="max-h-[420px] overflow-y-auto rounded-md border px-4 py-3 text-sm text-gray-700 [&_h4]:mb-1 [&_h4]:mt-3 [&_h4]:font-semibold [&_img]:my-2 [&_img]:max-w-full [&_li]:mb-0.5 [&_p]:my-1 [&_table]:my-2 [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:px-2 [&_th]:py-1 [&_ul]:list-disc [&_ul]:pl-5"
                  // Library HTML is written here and sanitised by Frappe when it is saved.
                  dangerouslySetInnerHTML={{ __html: draft.content }}
                />
              ) : (
                <Textarea
                  rows={16}
                  className="font-mono text-[13px]"
                  value={draft.content}
                  onChange={(e) => set({ content: e.target.value })}
                />
              )}
              <p className="text-[11px] text-gray-500">
                Written as HTML (headings, paragraphs, lists, tables). A word a
                project must fill goes in square brackets, e.g. [Facility Name];
                it becomes a box on the project's O&amp;M form. Pictures are
                pasted into this block in Desk.
              </p>
            </div>
          )}

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
