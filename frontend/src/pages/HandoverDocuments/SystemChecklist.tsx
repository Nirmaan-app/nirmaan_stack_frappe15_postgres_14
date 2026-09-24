// One system's 16-document checklist: the on/off switch, the status (derived by the server from what was
// done), remarks, and the Commission-style Actions cell. Switched-off rows are greyed, blocked, and left out of
// the printed checklist and the binder (S.No closes up).

import {
  AlertTriangle,
  BookOpenText,
  FileText,
  Loader2,
  Trash2,
} from "lucide-react";
import * as React from "react";

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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { getFrappeError } from "@/utils/frappeErrors";

import { DocumentDialog } from "./DocumentDialog";
import { MaterialTdsDialog } from "./MaterialTdsDialog";
import { HodActionCell } from "./HodActionCell";
import { SHOW_BINDER_BUTTON, type HodRowPatch } from "./hodApi";
import {
  hodChecklistPdfUrl,
  hodDocumentPdfUrl,
  hodPdfFilename,
  usePdfDownload,
} from "./hodDownloads";
import {
  documentChip,
  orderRows,
  printedNumbers,
  rowEditable,
} from "./hodRules";
import type {
  HodCounts,
  HodDocumentMeta,
  HodProjectInfo,
  HodRow,
  HodStatus,
  HodSystemOption,
} from "./types";
import type { BinderProgress, HodJob } from "./useHodBinder";

const STATUS_STYLE: Record<HodStatus, string> = {
  Pending: "bg-gray-100 text-gray-600",
  "Form Filled": "bg-blue-50 text-blue-700",
  Completed: "bg-green-50 text-green-700",
};

const RemarksCell: React.FC<{
  row: HodRow;
  disabled: boolean;
  onSave: (v: string) => Promise<void>;
}> = ({ row, disabled, onSave }) => {
  const [value, setValue] = React.useState(row.remarks || "");
  React.useEffect(() => setValue(row.remarks || ""), [row.remarks]);
  return (
    <Input
      className="h-8 text-sm"
      placeholder={disabled ? "" : "Remarks"}
      value={value}
      disabled={disabled}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        if (value !== (row.remarks || ""))
          onSave(value).catch(() => setValue(row.remarks || ""));
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
};

export interface SystemChecklistProps {
  project: HodProjectInfo;
  system: HodSystemOption;
  rows: HodRow[];
  counts: HodCounts | undefined;
  documents: HodDocumentMeta[];
  canEdit: boolean;
  updateRow: (name: string, patch: HodRowPatch) => Promise<unknown>;
  /** `force`: the user confirmed that the system's entries are deleted with it. */
  onRemoveSystem: (force: boolean) => Promise<void>;
  /** The server-built PDF running for this user (binder or one document's content), if any. */
  job: HodJob | null;
  progress: BinderProgress | null;
  /** Start a build: the binder (`document` null) or one document's content. */
  onBuild: (document: string | null, title: string) => void;
}

export const SystemChecklist: React.FC<SystemChecklistProps> = ({
  project,
  system,
  rows,
  counts,
  documents,
  canEdit,
  updateRow,
  onRemoveSystem,
  job,
  progress,
  onBuild,
}) => {
  const metaByKey = React.useMemo(
    () => new Map(documents.map((d) => [d.key, d])),
    [documents],
  );
  const ordered = React.useMemo(
    () => orderRows(rows, documents),
    [rows, documents],
  );
  const numbers = React.useMemo(
    () => printedNumbers(rows, documents),
    [rows, documents],
  );
  const [savingRow, setSavingRow] = React.useState<string | null>(null);
  const [openRow, setOpenRow] = React.useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);
  const { busyKey, download } = usePdfDownload();

  const building = job !== null;
  const buildingBinderHere = job?.hodSystem === system.name && !job.document;
  const binderTitle = `${system.display_name} — ${project.project_name}`;
  // Owner 2026-09-23: the binder is the client's finished set, so it downloads only once every
  // switched-on document is Completed. Until then the button says how many
  // are left. A document the project does not need is switched off and stops counting.
  const remaining = counts ? counts.needed - counts.completed : 0;
  const binderReady = !!counts && counts.needed > 0 && remaining === 0;
  const touched = counts?.touched ?? 0;

  const patch = React.useCallback(
    async (row: HodRow, p: HodRowPatch) => {
      setSavingRow(row.name);
      try {
        await updateRow(row.name, p);
      } catch (error) {
        toast({
          title: "Could not save",
          description: getFrappeError(error),
          variant: "destructive",
        });
        throw error;
      } finally {
        setSavingRow(null);
      }
    },
    [updateRow],
  );

  /** A From Nirmaan document ticked off by hand (owner 2026-09-24). The flag lives in `form_data`, so
   *  the status stays derived -- nothing on this screen writes `status`. */
  const setCompleted = async (row: HodRow, completed: boolean) => {
    const form_data = { ...(row.form_data || {}) };
    if (completed) form_data.completed = true;
    else delete form_data.completed;
    await patch(row, { form_data });
    if (completed)
      toast({
        title: "Completed",
        description: "It is ticked on the checklist and goes into the binder.",
        variant: "success",
      });
  };

  const downloadRow = (row: HodRow, meta: HodDocumentMeta) => {
    if (meta.kind === "app") {
      const mine =
        job?.hodSystem === system.name && job.document === row.document;
      if (mine) return; // already being prepared for this row; the button shows it
      // A saved selection IS the answer to "which records?" (owner 2026-09-24), so the download starts
      // straight away and the picker is not asked again. Without one, pick first (owner 2026-09-22).
      if (Array.isArray(row.form_data?.selected))
        return onBuild(row.document, meta.title);
      return setOpenRow(row.name);
    }
    download(
      `doc:${row.name}`,
      hodDocumentPdfUrl(row.name),
      hodPdfFilename(
        project.project_name,
        system.name,
        `${meta.no}`,
        meta.title,
      ),
    );
  };

  /** Keep the ticked records on the row without downloading anything. Saving is the REVIEW a From
   *  Nirmaan document is marked completed on (owner 2026-09-24), so it must not cost a PDF. */
  const saveSelected = async (row: HodRow, selected: string[]) => {
    await patch(row, {
      form_data: { ...(row.form_data || {}), selected },
    });
    setOpenRow(null); // the review is done -- close it, like Download selected does
    toast({
      title: "Selection saved",
      description: `${selected.length} record${selected.length === 1 ? "" : "s"} go into the handover. You can mark the document completed now.`,
      variant: "success",
    });
  };

  /** Keep the ticked reports on the row (so the binder takes the same ones), then build the download. */
  const downloadSelected = async (
    row: HodRow,
    meta: HodDocumentMeta,
    selected: string[],
  ) => {
    if (rowEditable(row, canEdit)) {
      try {
        await updateRow(row.name, {
          form_data: { ...(row.form_data || {}), selected },
        });
      } catch (error) {
        toast({
          title: "Could not save the selection",
          description: getFrappeError(error),
          variant: "destructive",
        });
        return;
      }
    }
    setOpenRow(null);
    onBuild(row.document, meta.title);
  };

  const openRowData = openRow
    ? ordered.find((r) => r.name === openRow)
    : undefined;
  const openMeta = openRowData
    ? metaByKey.get(openRowData.document)
    : undefined;
  const checklistKey = `checklist:${system.name}`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-900">
            {system.display_name}
          </p>
          <p className="text-xs text-gray-500">
            {counts ? `${counts.completed} of ${counts.needed} completed` : ""}
            {counts?.filled ? ` · ${counts.filled} form filled` : ""}
            {counts?.off ? ` · ${counts.off} switched off` : ""} · Work package:{" "}
            {system.work_package}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            disabled={busyKey === checklistKey}
            onClick={() =>
              download(
                checklistKey,
                hodChecklistPdfUrl(project.name, system.name),
                hodPdfFilename(
                  project.project_name,
                  system.name,
                  "Handover_Checklist",
                ),
              )
            }
          >
            {busyKey === checklistKey ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <FileText className="mr-1 h-3.5 w-3.5" />
            )}
            Checklist PDF
          </Button>
          {SHOW_BINDER_BUTTON && (
            <Button
              size="sm"
              className="h-8"
              disabled={!binderReady || (building && !buildingBinderHere)}
              title={
                binderReady
                  ? "Cover, checklist and every document in one PDF"
                  : `The binder is ready once every document is Completed — ${remaining} to go`
              }
              onClick={() => onBuild(null, binderTitle)}
            >
              {buildingBinderHere ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <BookOpenText className="mr-1 h-3.5 w-3.5" />
              )}
              {buildingBinderHere
                ? progress
                  ? `Building ${progress.done}/${progress.total}`
                  : "Starting…"
                : binderReady
                  ? "Download binder"
                  : `Download binder (${remaining} to go)`}
            </Button>
          )}
          {canEdit && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-gray-500 hover:text-red-600"
              onClick={() => setConfirmRemove(true)}
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" /> Remove system
            </Button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[980px] border-collapse text-sm">
          <thead>
            <tr className="bg-gray-50 text-left text-xs font-semibold text-gray-600">
              <th className="w-14 px-2 py-2 text-center">S.No</th>
              <th className="px-2 py-2">Document</th>
              <th className="w-16 px-2 py-2 text-center">Use</th>
              <th className="w-28 px-2 py-2 text-center">Status</th>
              <th className="w-60 px-2 py-2">Remarks</th>
              <th className="w-64 px-2 py-2 text-center">Actions</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((row) => {
              const meta = metaByKey.get(row.document);
              if (!meta) return null;
              const off = !!row.disabled;
              const editable = rowEditable(row, canEdit);
              const kind = documentChip(meta);
              const contentBusy =
                job?.hodSystem === system.name && job.document === row.document;
              const rowBusy =
                savingRow === row.name ||
                busyKey === `doc:${row.name}` ||
                contentBusy;
              return (
                <tr
                  key={row.name}
                  className={cn(
                    "border-t",
                    off && "bg-gray-50/80 text-gray-400",
                  )}
                >
                  <td className="px-2 py-2 text-center">
                    {off ? "—" : numbers.get(row.document)}
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "font-medium",
                          off ? "text-gray-400 line-through" : "text-gray-900",
                        )}
                      >
                        {meta.title}
                      </span>
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[10px] font-medium",
                          off ? "bg-gray-100 text-gray-400" : kind.className,
                        )}
                      >
                        {kind.label}
                      </span>
                    </div>
                  </td>
                  <td className="px-2 py-2 text-center">
                    <Switch
                      checked={!off}
                      disabled={!canEdit || savingRow === row.name}
                      title={
                        off
                          ? "Switched off: not needed for this project"
                          : "Needed for this project"
                      }
                      onCheckedChange={(on) =>
                        patch(row, { disabled: !on }).catch(() => undefined)
                      }
                    />
                  </td>
                  <td className="px-2 py-2 text-center">
                    {off ? (
                      <span className="text-[11px] text-gray-400">—</span>
                    ) : (
                      <span
                        className={cn(
                          "inline-block rounded-full px-2 py-0.5 text-[11px] font-medium",
                          STATUS_STYLE[row.status],
                        )}
                      >
                        {row.status}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <RemarksCell
                      row={row}
                      disabled={!editable || savingRow === row.name}
                      onSave={(v) => patch(row, { remarks: v })}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <HodActionCell
                      row={row}
                      meta={meta}
                      canEdit={editable}
                      busy={
                        rowBusy ||
                        (meta.kind === "app" && building && !contentBusy)
                      }
                      onOpen={() => setOpenRow(row.name)}
                      onDownload={() => downloadRow(row, meta)}
                      onSetCompleted={(completed) =>
                        setCompleted(row, completed).catch(() => undefined)
                      }
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {openRowData && openMeta && openMeta.key === "material_tds" && (
        <MaterialTdsDialog
          open={!!openRow}
          onOpenChange={(o) => !o && setOpenRow(null)}
          projectId={project.name}
          projectName={project.project_name}
          hodSystem={system.name}
          displayName={system.display_name}
          row={openRowData}
          canEdit={rowEditable(openRowData, canEdit)}
          onSaveSelected={async (selected) => {
            await updateRow(openRowData.name, {
              form_data: { ...(openRowData.form_data || {}), selected },
            });
          }}
        />
      )}

      {openRowData && openMeta && openMeta.key !== "material_tds" && (
        <DocumentDialog
          open={!!openRow}
          onOpenChange={(o) => !o && setOpenRow(null)}
          projectId={project.name}
          customerName={project.customer_name}
          hodSystem={system.name}
          displayName={system.display_name}
          row={openRowData}
          meta={openMeta}
          siblings={ordered}
          // Marking a document completed is a tick, not a signature: the form stays editable.
          readOnly={!rowEditable(openRowData, canEdit)}
          onSave={async (formData) => {
            await updateRow(openRowData.name, { form_data: formData });
          }}
          onDownloadSelected={(selected) =>
            downloadSelected(openRowData, openMeta, selected)
          }
          onSaveSelected={(selected) => saveSelected(openRowData, selected)}
        />
      )}


      <AlertDialog
        open={confirmRemove}
        onOpenChange={(o) => !removing && setConfirmRemove(o)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              {touched > 0 && (
                <AlertTriangle className="h-5 w-5 text-amber-500" />
              )}
              Remove {system.display_name}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                {touched > 0 ? (
                  <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
                    <span className="font-semibold">
                      {touched} document{touched !== 1 ? "s" : ""} already{" "}
                      {touched !== 1 ? "have" : "has"} entries
                    </span>{" "}
                    — filled forms, remarks or switched
                    documents. Removing the system deletes all of it, and it
                    cannot be undone.
                  </p>
                ) : (
                  <p>
                    Its 16 handover documents are removed from this project.
                    Nothing has been entered on them yet.
                  </p>
                )}
                <p>Are you sure you want to remove this system?</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              disabled={removing}
              onClick={async (e) => {
                e.preventDefault();
                setRemoving(true);
                try {
                  await onRemoveSystem(touched > 0);
                  setConfirmRemove(false);
                } catch {
                  // the caller already showed the error; keep the dialog open
                } finally {
                  setRemoving(false);
                }
              }}
            >
              {removing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {touched > 0 ? "Remove anyway" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
