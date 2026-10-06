// One system's 16-document checklist: the on/off switch, the status (derived by the server from what was
// done), remarks, and the Commission-style Actions cell. Switched-off rows are greyed, blocked, and left out of
// the printed checklist and the binder (S.No closes up).

import {
  AlertTriangle,
  BookOpenText,
  FileText,
  Loader2,
  MoreHorizontal,
  Pencil,
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
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { getFrappeError } from "@/utils/frappeErrors";

import { DocumentDialog } from "./DocumentDialog";
import { MaterialTdsDialog } from "./MaterialTdsDialog";
import { HodActionCell } from "./HodActionCell";
import { ReportPreviewDialog } from "@/pages/CommissionReport/components/ReportPreviewDialog";
import {
  SHOW_BINDER_BUTTON,
  useHodFileUpload,
  type HodRowPatch,
} from "./hodApi";
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
  isSaved,
  needsSaving,
  rowEditable,
  uploadedFile,
} from "./hodRules";
import type {
  HodCounts,
  HodDocumentMeta,
  HodProjectInfo,
  HodRow,
  HodStatus,
  HodSystemOption,
  HodUpload,
} from "./types";
import type { BinderProgress, HodJob } from "./useHodBinder";

const STATUS_STYLE: Record<HodStatus, string> = {
  YES: "bg-green-600 text-white border-green-600",
  NO: "bg-gray-100 text-gray-600 border-gray-300",
  NA: "bg-amber-50 text-amber-700 border-amber-300",
};
const STATUSES: HodStatus[] = ["YES", "NO", "NA"];

/** What "save it first" means. Only a From Nirmaan document can be refused now (`needsSaving`), so
 *  there is one case left: its records have to be ticked -- or its own file uploaded (2026-10-06). */
const YES_HINT =
  "Open the records, tick what goes into the handover and save — or upload the document from the ⋯ menu — then set it to YES.";

/** The handover answer for one document: the current value with an edit icon, changed from a small
 *  dropdown. YES is the one that costs something -- it puts the document in the binder -- so on a From
 *  Nirmaan document it is refused until its records are ticked, and the refusal says what to do. */
const StatusCell: React.FC<{
  row: HodRow;
  meta: HodDocumentMeta;
  disabled: boolean;
  onPick: (status: HodStatus) => void;
}> = ({ row, meta, disabled, onPick }) => {
  const current = row.status || "NO";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          disabled={disabled}
          title={disabled ? undefined : "Change the checklist status"}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition",
            STATUS_STYLE[current],
            !disabled && "hover:opacity-90",
            disabled && "cursor-not-allowed opacity-60",
          )}
        >
          {current}
          {!disabled && <Pencil className="h-3 w-3 opacity-70" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="min-w-[15rem]">
        {STATUSES.map((s) => (
          <DropdownMenuItem
            key={s}
            onClick={() => onPick(s)}
            className="gap-2 text-xs"
          >
            <span
              className={cn(
                "inline-block w-9 rounded-full border px-1 text-center text-[10px] font-semibold",
                STATUS_STYLE[s],
              )}
            >
              {s}
            </span>
            <span className="text-gray-600">
              {s === "YES"
                ? !needsSaving(meta) || isSaved(row)
                  ? "— document goes into the binder"
                  : `— save ${meta.title} first`
                : "— document skipped in the binder"}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
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
  // The document someone tried to mark YES before saving it.
  const [yesBlocked, setYesBlocked] = React.useState<{
    row: HodRow;
    meta: HodDocumentMeta;
  } | null>(null);
  // There is no longer a "YES still owed" latch (owner 2026-09-28): EVERY save answers the document
  // YES by itself (`saveAnswersYes`), so opening a blocked document and saving applies it without one.
  const [confirmRemove, setConfirmRemove] = React.useState(false);
  // The checklist is previewed before it is saved; the dialog carries its own Download.
  const [showChecklist, setShowChecklist] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);
  const { busyKey, download } = usePdfDownload();
  const { uploadToRow } = useHodFileUpload();

  const building = job !== null;
  const buildingBinderHere = job?.hodSystem === system.name && !job.document;
  const binderTitle = `${system.display_name} — ${project.project_name}`;
  // Owner 2026-09-28, REPLACING the 2026-09-23 "unlocks only once every document is answered YES":
  // a NO or NA document no longer holds the binder back. It never did anything TO the binder -- the
  // server keeps YES rows only (`build_plan`), so a NO document already stays on the printed
  // checklist with its answer and contributes no pages. The count is now INFORMATION, in the header
  // line and the button's tooltip, not a gate. Switched-on rows are still required: with none there
  // is no checklist to print.
  const remaining = counts ? counts.needed - counts.completed : 0;
  const allAnswered = !!counts && counts.needed > 0 && remaining === 0;
  const answeredYes = counts?.completed ?? 0;
  const binderEnabled = !!counts && counts.needed > 0;
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

  const saveSelected = async (
    row: HodRow,
    meta: HodDocumentMeta,
    selected: string[],
  ) => {
    const form_data = { ...(row.form_data || {}), selected };
    const yes = saveAnswersYes(meta, form_data);
    await patch(row, yes ? { form_data, status: "YES" } : { form_data });
    setOpenRow(null); // the review is done -- close it, like Download selected does
    toast({
      title: yes ? "Saved and marked YES" : "Selection saved",
      description: yes
        ? `${selected.length} record${selected.length === 1 ? "" : "s"} go into the handover binder.`
        : "Tick the records that go into the handover, then save again.",
      variant: "success",
    });
  };

  const downloadRow = (row: HodRow, meta: HodDocumentMeta) => {
    // An uploaded file IS the document (owner 2026-10-06): `document_pdf` serves it, on every kind.
    if (meta.kind === "app" && !uploadedFile(row)) {
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

  /** Does a SAVE of this data answer the document YES? (owner 2026-09-28, widening the 2026-09-24
   *  rule from a YES that was merely OWED to every save.) Saving a document IS the review it is
   *  answered on, so the status rides the SAME write -- the server then judges YES against the data
   *  being saved, never against what was on the row a moment ago.
   *
   *  A form or a library text is always answerable, so its save always answers YES. A FROM NIRMAAN
   *  document must have records ticked (`checklist.can_be_yes`), so a save that ticks nothing only
   *  stores; the server would refuse the YES.
   *
   *  ⚠️ This overrides an explicit NA too: saving a document the project had marked "not applicable"
   *  states that it IS being handed over. The answer stays one dropdown click away either way. */
  const saveAnswersYes = (
    meta: HodDocumentMeta,
    form_data: Record<string, unknown>,
  ): boolean => (needsSaving(meta) ? isSaved({ form_data }) : true);

  /** The handover answer. NO and NA go straight through, and so does YES on a form or a library text --
   *  it prints from its own layout with nothing filled in (owner 2026-09-28). Only a From Nirmaan
   *  document is refused until its records are ticked; the server refuses it too
   *  (`checklist.can_be_yes`), this is the message that explains it. */
  const pickStatus = async (
    row: HodRow,
    meta: HodDocumentMeta,
    status: HodStatus,
  ) => {
    if (row.status === status) return;
    if (status === "YES" && needsSaving(meta) && !isSaved(row)) {
      setYesBlocked({ row, meta });
      return;
    }
    await patch(row, { status }).catch(() => undefined);
  };

  /** The project's own file REPLACES what Nirmaan generates for the document (any of the 16, owner
   *  2026-10-06): Preview, Download and the binder hand it over from now on. An upload is a save of the
   *  document, so it answers YES like every other save (`saveAnswersYes`; on a From Nirmaan document the
   *  file counts as saved content). Returns what was stored, or null when it failed (the toast already
   *  said why). */
  const uploadFile = async (
    row: HodRow,
    meta: HodDocumentMeta,
    file: File,
  ): Promise<HodUpload | null> => {
    setSavingRow(row.name);
    try {
      const upload = await uploadToRow(row.name, file);
      const form_data = { ...(row.form_data || {}), upload };
      const yes = saveAnswersYes(meta, form_data);
      await updateRow(row.name, yes ? { form_data, status: "YES" } : { form_data });
      toast({
        title: yes ? "Uploaded and marked YES" : "Uploaded",
        description: `${meta.title} now hands over ${upload.file_name}.`,
        variant: "success",
      });
      return upload;
    } catch (error) {
      toast({
        title: "Upload failed",
        description: getFrappeError(error),
        variant: "destructive",
      });
      return null;
    } finally {
      setSavingRow(null);
    }
  };

  /** Back to the generated document. The answer is left as it is. */
  const removeUpload = async (
    row: HodRow,
    meta: HodDocumentMeta,
  ): Promise<boolean> => {
    const form_data = { ...(row.form_data || {}) };
    delete form_data.upload;
    try {
      await patch(row, { form_data });
    } catch {
      return false; // `patch` already showed the error
    }
    toast({
      title: "Upload removed",
      description: `${meta.title} is generated by Nirmaan again.`,
      variant: "success",
    });
    return true;
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

  return (
    <div className="space-y-3">
      {/* One card per system: its name, how far it has got, and the actions that act on THIS
          system -- so which tab a download belongs to is never in doubt. The destructive
          "Remove system" moved into the "..." menu, off the primary button's elbow (owner 2026-09-28). */}
      <div className="overflow-hidden rounded-lg border bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-3 py-2.5">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-gray-900">
                {system.display_name}
              </p>
              <span
                className="rounded bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-600 ring-1 ring-gray-200"
                title="Work package"
              >
                {system.work_package}
              </span>
            </div>
            {counts && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                <div
                  className="h-1.5 w-24 overflow-hidden rounded-full bg-gray-200"
                  title={`${counts.completed} of ${counts.needed} answered YES`}
                >
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      allAnswered ? "bg-green-600" : "bg-blue-500",
                    )}
                    style={{
                      width: `${counts.needed ? (counts.completed / counts.needed) * 100 : 0}%`,
                    }}
                  />
                </div>
                <span>
                  <b className="font-semibold text-gray-900">
                    {counts.completed}
                  </b>{" "}
                  of {counts.needed} answered YES
                </span>
                {counts.na > 0 && (
                  <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                    {counts.na} NA
                  </span>
                )}
                {counts.off > 0 && (
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
                    {counts.off} disabled
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Shown first, saved from inside the preview -- the same way a row's Preview works
                (owner 2026-09-28). It used to download straight off the button. */}
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => setShowChecklist(true)}
            >
              <FileText className="mr-1 h-3.5 w-3.5" />
              Checklist PDF
            </Button>
            {SHOW_BINDER_BUTTON && (
              <Button
                size="sm"
                className="h-8"
                disabled={!binderEnabled || (building && !buildingBinderHere)}
                title={
                  allAnswered
                    ? "Cover, checklist and every document in one PDF"
                    : answeredYes === 0
                      ? "Cover and checklist only — no document is answered YES yet, so no pages follow"
                      : `Cover, checklist and the ${answeredYes} document${answeredYes === 1 ? "" : "s"} answered YES — the other ${remaining} keep their answer on the checklist with no pages behind them`
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
                  : "Download binder"}
              </Button>
            )}
            {canEdit && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-gray-500"
                    title={`More options for ${system.display_name}`}
                    aria-label={`More options for ${system.display_name}`}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem
                    className="gap-2 text-sm text-red-600 focus:text-red-600"
                    onClick={() => setConfirmRemove(true)}
                  >
                    <Trash2 className="h-4 w-4" /> Remove system
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs font-semibold text-gray-600">
                <th className="w-14 px-2 py-2 text-center">S.No</th>
                <th className="px-2 py-2">Document</th>
                <th className="w-24 px-2 py-2 text-center">Enable / Disable</th>
                <th className="w-40 px-2 py-2 text-center">Checklist Status</th>
                <th className="w-72 px-2 py-2 text-center">Actions</th>
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
                      "border-t transition-colors",
                      off
                        ? "bg-gray-50/80 text-gray-400"
                        : "hover:bg-gray-50/70",
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
                            ? "Disabled: not needed for this project"
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
                        <StatusCell
                          row={row}
                          meta={meta}
                          disabled={!editable || savingRow === row.name}
                          onPick={(status) => pickStatus(row, meta, status)}
                        />
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <HodActionCell
                        row={row}
                        meta={meta}
                        canEdit={editable}
                        // Disabled while any build runs (the server takes one at a time) but only THIS
                        // row's own work spins its button.
                        busy={
                          rowBusy ||
                          (meta.kind === "app" && building && !contentBusy)
                        }
                        working={rowBusy}
                        onOpen={() => setOpenRow(row.name)}
                        onDownload={() => downloadRow(row, meta)}
                        onUpload={(file) => void uploadFile(row, meta, file)}
                        onRemoveUpload={() => void removeUpload(row, meta)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showChecklist && (
        <ReportPreviewDialog
          open
          onOpenChange={(o) => !o && setShowChecklist(false)}
          pdfUrl={hodChecklistPdfUrl(project.name, system.name)}
          title={`Handover Checklist — ${system.display_name}`}
          fileName={hodPdfFilename(
            project.project_name,
            system.name,
            "Handover_Checklist",
          )}
          canDownload
          closeOnDownload
        />
      )}

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
          onSaveSelected={async (selected, markYes) => {
            // An export saves the ticks too, but ONLY the Save-selection button is the review that
            // answers the document (owner 2026-09-28) -- a download must never change the answer.
            const form_data = { ...(openRowData.form_data || {}), selected };
            const yes = !!markYes && saveAnswersYes(openMeta, form_data);
            await updateRow(
              openRowData.name,
              yes ? { form_data, status: "YES" } : { form_data },
            );
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
          // Answering YES is a statement, not a signature: the form stays editable.
          readOnly={!rowEditable(openRowData, canEdit)}
          onSave={async (formData) => {
            const yes = saveAnswersYes(openMeta, formData);
            await updateRow(
              openRowData.name,
              yes
                ? { form_data: formData, status: "YES" }
                : { form_data: formData },
            );
            toast({
              title: yes ? "Saved and marked YES" : "Saved",
              description: yes
                ? `${openMeta.title} goes into the handover binder.`
                : `${openMeta.title} is saved.`,
              variant: "success",
            });
          }}
          onDownloadSelected={(selected) =>
            downloadSelected(openRowData, openMeta, selected)
          }
          onSaveSelected={(selected) =>
            saveSelected(openRowData, openMeta, selected)
          }
          uploading={savingRow === openRowData.name}
          onUpload={(file) => uploadFile(openRowData, openMeta, file)}
          onRemoveUpload={() => removeUpload(openRowData, openMeta)}
        />
      )}


      <AlertDialog
        open={!!yesBlocked}
        onOpenChange={(o) => !o && setYesBlocked(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Save it first
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-gray-600">
                <p>
                  <b>{yesBlocked?.meta.title}</b> has no records ticked for the
                  handover and no uploaded file yet, so it cannot be marked YES.
                </p>
                <p>{YES_HINT}</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Close</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                // No latch needed: saving the ticks answers YES on its own (owner 2026-09-28).
                const name = yesBlocked?.row.name ?? null;
                setYesBlocked(null);
                setOpenRow(name);
              }}
            >
              Open it now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
