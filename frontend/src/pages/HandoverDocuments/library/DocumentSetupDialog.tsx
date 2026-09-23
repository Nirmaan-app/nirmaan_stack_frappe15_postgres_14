// One of the 16 handover documents, opened from its row in the library list: what this system
// carries for it. Three documents hold text blocks (O&M manual, Do's & Don'ts, maintenance
// checklist), two hold a list of lines on the system itself (tools, warranty equipment); the rest
// are filled on the project or read live from another Nirmaan feature, and only say so.
//
// Editing a text block is the parent's job (it swaps this dialog for the block editor), so the two
// dialogs never stack.

import { Eye, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { ReportPreviewDialog } from "@/pages/CommissionReport/components/ReportPreviewDialog";
import { getFrappeError } from "@/utils/frappeErrors";

import { hodDocumentPdfUrl } from "../hodDownloads";

import type { HodDocumentMeta } from "../types";
import {
  blockSummary,
  documentSetup,
  HOD_SYSTEM_DOCTYPE,
  HodLibraryBlockAdmin,
  HodSystemAdmin,
  useHodLibraryMutations,
  useHodPreviewRow,
} from "./hodLibraryApi";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  system: HodSystemAdmin;
  meta: HodDocumentMeta;
  canEdit: boolean;
  /** Add a block (no argument) or edit one — the parent closes this dialog and opens the editor. */
  onEditBlock: (block?: HodLibraryBlockAdmin) => void;
  onDeleteBlock: (block: HodLibraryBlockAdmin) => void;
  onSaved: () => void | Promise<unknown>;
}

/** Why a document has nothing to set up here. */
const NOTHING_TO_SET_UP: Record<string, string> = {
  form: "This document is a form the project team fills in on the project itself. The library keeps nothing for it — every project types its own.",
  app: "This document is read live from another Nirmaan feature when the project downloads it. Nothing is copied into the library, so there is nothing to set up here.",
};

export const DocumentSetupDialog: React.FC<Props> = ({
  open,
  onOpenChange,
  system,
  meta,
  canEdit,
  onEditBlock,
  onDeleteBlock,
  onSaved,
}) => {
  const setup = documentSetup(meta, system);
  const stored = setup.field ? (system[setup.field] ?? "") : "";
  const [text, setText] = React.useState(stored);
  const [error, setError] = React.useState("");
  const { updateDoc, saving } = useHodLibraryMutations();
  // What this document looks like on paper, printed from the project that worked on it last.
  const { preview, isLoading: previewLoading } = useHodPreviewRow(
    system.name,
    meta.key,
    open,
  );
  const [previewOpen, setPreviewOpen] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setText(setup.field ? (system[setup.field] ?? "") : "");
      setError("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, meta.key, system.name]);

  const blocks = meta.library
    ? system.contents.filter((c) => c.document === meta.library)
    : [];

  const saveLines = async () => {
    if (!setup.field) return;
    try {
      await updateDoc(HOD_SYSTEM_DOCTYPE, system.name, {
        [setup.field]: text.trim(),
      });
      await onSaved();
      toast({ title: `${meta.title} saved`, variant: "success" });
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
            {meta.no}. {meta.title}
          </DialogTitle>
          <DialogDescription>
            {system.system_name} · printed on every project that hands this
            system over.
          </DialogDescription>
        </DialogHeader>

        {setup.setup === "blocks" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-gray-600">
                {blocks.length === 0
                  ? "Nothing yet — this document prints empty."
                  : `${blocks.length} text block${blocks.length === 1 ? "" : "s"}, printed in this order.`}
              </p>
              {canEdit && (
                <Button size="sm" variant="outline" onClick={() => onEditBlock()}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> Add block
                </Button>
              )}
            </div>

            {blocks.length > 0 && (
              <div className="overflow-hidden rounded-md border">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-left text-xs font-semibold text-gray-600">
                      <th className="w-16 px-3 py-2">Order</th>
                      <th className="px-3 py-2">Title</th>
                      <th className="w-28 px-3 py-2">Part</th>
                      <th className="w-48 px-3 py-2">Holds</th>
                      {canEdit && <th className="w-20 px-3 py-2" />}
                    </tr>
                  </thead>
                  <tbody>
                    {blocks.map((b) => (
                      <tr key={b.name} className="border-t">
                        <td className="px-3 py-2 text-gray-500">
                          {b.display_order ?? 0}
                        </td>
                        <td className="px-3 py-2 font-medium text-gray-800">
                          {b.title}
                        </td>
                        <td className="px-3 py-2 text-gray-600">
                          {b.sub_system || "—"}
                        </td>
                        <td className="px-3 py-2 text-gray-500">
                          {blockSummary(b)}
                        </td>
                        {canEdit && (
                          <td className="px-3 py-2">
                            <div className="flex gap-1">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                                title="Edit"
                                onClick={() => onEditBlock(b)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-gray-400 hover:text-red-600"
                                title="Delete"
                                onClick={() => onDeleteBlock(b)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {setup.setup === "lines" && (
          <div className="space-y-1">
            <Label className="text-xs text-gray-600">{setup.label}</Label>
            <Textarea
              rows={12}
              value={text}
              disabled={!canEdit}
              onChange={(e) => setText(e.target.value)}
            />
            <p className="text-[11px] text-gray-500">
              {meta.key === "recommended_tools"
                ? "Each line prints as one tool; the project team writes its remarks against it."
                : "Each line prints as one piece of equipment; the project can change the list before it prints."}
            </p>
          </div>
        )}

        {setup.setup === "none" && (
          <p className="rounded-md bg-gray-50 px-3 py-3 text-sm text-gray-600">
            {NOTHING_TO_SET_UP[meta.kind] ??
              "Nothing is kept in the library for this document."}
            {meta.kind === "app" && system.source_keywords && (
              <>
                {" "}
                What it reads is narrowed by this system&apos;s keywords (
                {system.source_keywords.split("\n").filter(Boolean).join(", ")}),
                changed under Edit on the system.
              </>
            )}
          </p>
        )}

        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <DialogFooter className="sm:justify-between">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={previewLoading || !preview?.name}
              title={
                preview?.name
                  ? `Printed from ${preview.project_name}`
                  : "No project hands this system over yet, so there is nothing to print"
              }
              onClick={() => setPreviewOpen(true)}
            >
              <Eye className="mr-1 h-3.5 w-3.5" /> Preview PDF
            </Button>
            {preview?.name && (
              <span className="hidden text-xs text-gray-500 sm:inline">
                from {preview.project_name}
              </span>
            )}
          </div>
          <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            {setup.setup === "lines" && canEdit ? "Cancel" : "Close"}
          </Button>
          {setup.setup === "lines" && canEdit && (
            <Button onClick={saveLines} disabled={saving || text === stored}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          )}
          </div>
        </DialogFooter>
      </DialogContent>

      {previewOpen && preview?.name && (
        <ReportPreviewDialog
          open
          onOpenChange={setPreviewOpen}
          pdfUrl={hodDocumentPdfUrl(preview.name)}
          title={`${meta.title} — ${preview.project_name}`}
          fileName={`${meta.title}.pdf`}
          canDownload
        />
      )}
    </Dialog>
  );
};
