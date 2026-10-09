// One package's 16-document checklist (a "package" on screen is an HOD System -- owner 2026-10-06, UI
// wording only): the on/off switch, the status, and the Actions cell.
//
// The SWITCH is the checklist's YES / NO (owner 2026-10-06): on = YES, the document is on the printed
// checklist; off = NO, greyed, blocked, and left out of the printed checklist and the binder (S.No closes
// up). The STATUS is the document's own progress -- Not Started / WIP / Done -- and only a Done document
// puts pages in the binder.

import {
  AlertTriangle,
  BookOpenText,
  FileSignature,
  FileText,
  Loader2,
  MoreHorizontal,
  Pencil,
  Replace,
  Trash2,
  Upload,
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
import SITEURL from "@/constants/siteURL";
import { cn } from "@/lib/utils";
import { formatDate } from "@/utils/FormatDate";
import { getFrappeError } from "@/utils/frappeErrors";

import { BinderDialog } from "./BinderDialog";
import { DocumentDialog } from "./DocumentDialog";
import { MaterialTdsDialog } from "./MaterialTdsDialog";
import { HodActionCell } from "./HodActionCell";
import { ReportPreviewDialog } from "@/pages/CommissionReport/components/ReportPreviewDialog";
import {
  SHOW_BINDER_BUTTON,
  SIGNED_COPY_ACCEPT,
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
  STATUS_STYLE,
} from "./hodRules";
import type {
  HodCounts,
  HodDocumentMeta,
  HodProjectInfo,
  HodRow,
  HodSignedCopy,
  HodStatus,
  HodSystemOption,
} from "./types";
import type { BinderProgress, HodJob } from "./useHodBinder";

/** Mirrors `services/hod/checklist.STATUSES`. */
const STATUSES: HodStatus[] = ["Not Started", "WIP", "Done"];

/** What "save it first" means. Only a From Nirmaan document can be refused (`needsSaving`): its records
 *  have to be ticked. */
const DONE_HINT =
  "Open the records, tick what goes into the handover and Mark as Done.";

/** One document's progress: the current status with an edit icon, changed from a small dropdown. Done is
 *  the one that costs something -- it puts the document's pages in the binder -- so on a From Nirmaan
 *  document it is refused until its records are ticked, and the refusal says what
 *  to do. Only users who can edit the row get the dropdown. */
const StatusCell: React.FC<{
  row: HodRow;
  meta: HodDocumentMeta;
  disabled: boolean;
  onPick: (status: HodStatus) => void;
}> = ({ row, meta, disabled, onPick }) => {
  const current: HodStatus = STATUSES.includes(row.status) ? row.status : "Not Started";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          disabled={disabled}
          title={disabled ? undefined : "Change the status"}
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
      <DropdownMenuContent align="center" className="min-w-[17rem]">
        {STATUSES.map((s) => (
          <DropdownMenuItem
            key={s}
            onClick={() => onPick(s)}
            className="gap-2 text-xs"
          >
            <span
              className={cn(
                "inline-block w-[4.5rem] rounded-full border px-1 text-center text-[10px] font-semibold",
                STATUS_STYLE[s],
              )}
            >
              {s}
            </span>
            <span className="text-gray-600">
              {s === "Done"
                ? !needsSaving(meta) || isSaved(row)
                  ? "— its pages go into the binder"
                  : "— tick its records first"
                : "— on the checklist, no pages yet"}
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
  /** `force`: the user confirmed that the package's entries are deleted with it. */
  onRemoveSystem: (force: boolean) => Promise<void>;
  /** The server-built PDF running for this user (binder or one document's content), if any. */
  job: HodJob | null;
  progress: BinderProgress | null;
  /** Start a build: the binder (`document` null) or one document's content. */
  onBuild: (document: string | null, title: string) => void;
  /** The package's signed handover copy, if one was uploaded (owner 2026-10-06). Stored only. */
  signedCopy: HodSignedCopy | null;
  /** Store (or replace) the package's signed copy. */
  onUploadSignedCopy: (file: File) => Promise<void>;
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
  signedCopy,
  onUploadSignedCopy,
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
  // The From Nirmaan document someone tried to mark Done with nothing ticked.
  const [doneBlocked, setDoneBlocked] = React.useState<{
    row: HodRow;
    meta: HodDocumentMeta;
  } | null>(null);
  // No "Done still owed" latch: Mark as Done in the dialog writes Done in the same save
  // (`saveMarksDone`), so opening a blocked document and marking it applies it without one.
  const [confirmRemove, setConfirmRemove] = React.useState(false);
  // The checklist is previewed before it is saved; the dialog carries its own Download.
  const [showChecklist, setShowChecklist] = React.useState(false);
  // "Download binder" first lists what goes in and what is skipped (owner 2026-10-06).
  const [confirmBinder, setConfirmBinder] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);
  const signedInput = React.useRef<HTMLInputElement>(null);
  const [uploadingSigned, setUploadingSigned] = React.useState(false);
  const signedHref = signedCopy
    ? signedCopy.url.startsWith("http")
      ? signedCopy.url
      : SITEURL + signedCopy.url
    : "";
  const { busyKey, download } = usePdfDownload();

  const building = job !== null;
  const buildingBinderHere = job?.hodSystem === system.name && !job.document;
  // The binder dialog closes when THIS binder's build ends -- downloaded or failed, the toast says which.
  const wasBuildingRef = React.useRef(false);
  React.useEffect(() => {
    if (wasBuildingRef.current && !buildingBinderHere) setConfirmBinder(false);
    wasBuildingRef.current = buildingBinderHere;
  }, [buildingBinderHere]);
  const binderTitle = `${system.display_name} — ${project.project_name}`;
  // A WIP or Not Started document does not hold the binder back (owner 2026-09-28, kept 2026-10-06): the
  // server keeps Done rows only (`build_plan`), so the others stay on the printed checklist as YES with
  // no pages behind them. The count is INFORMATION, in the header line and the button's tooltip, not a
  // gate. Switched-on rows are still required: with none there is no checklist to print.
  const remaining = counts ? counts.needed - counts.completed : 0;
  const allDone = !!counts && counts.needed > 0 && remaining === 0;
  const doneCount = counts?.completed ?? 0;
  const binderEnabled = !!counts && counts.needed > 0;
  const touched = counts?.touched ?? 0;
  // Removing the package deletes its entries AND its signed copy, so either one asks first.
  const hasEntries = touched > 0 || !!signedCopy;

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
    const done = saveMarksDone(meta, form_data);
    await patch(row, done ? { form_data, status: "Done" } : { form_data });
    setOpenRow(null); // the review is done -- close it, like Download selected does
    toast({
      title: done ? "Marked as Done" : "Selection saved",
      description: done
        ? `${selected.length} record${selected.length === 1 ? "" : "s"} go into the handover binder.`
        : "Tick the records that go into the handover, then Mark as Done again.",
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

  /** Does "Mark as Done" on this data make the document Done? (owner 2026-10-06; the save that answered
   *  YES since 2026-09-28.) The status rides the SAME write as the data, so the server judges Done against
   *  the data being saved, never against what was on the row a moment ago.
   *
   *  A form or a library text is always ready, so it always becomes Done. A FROM NIRMAAN document must
   *  have records ticked (`checklist.can_be_done`), so a save that ticks nothing only stores; the server
   *  would refuse Done. */
  const saveMarksDone = (
    meta: HodDocumentMeta,
    form_data: Record<string, unknown>,
  ): boolean => (needsSaving(meta) ? isSaved({ form_data }) : true);

  /** The status dropdown. WIP and Not Started go straight through, and so does Done on a form or a
   *  library text -- it prints from its own layout with nothing filled in (owner 2026-09-28). Only a From
   *  Nirmaan document is refused until its records are ticked; the server refuses it too
   *  (`checklist.can_be_done`), this is the message that explains it. */
  const pickStatus = async (
    row: HodRow,
    meta: HodDocumentMeta,
    status: HodStatus,
  ) => {
    if (row.status === status) return;
    if (status === "Done" && needsSaving(meta) && !isSaved(row)) {
      setDoneBlocked({ row, meta });
      return;
    }
    await patch(row, { status }).catch(() => undefined);
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
      {/* One card per package: its name, how far it has got, and the actions that act on THIS
          package -- so which tab a download belongs to is never in doubt. The destructive
          "Remove package" sits in the "..." menu, off the primary button's elbow (owner 2026-09-28). */}
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
                  title={`${counts.completed} of ${counts.needed} Done`}
                >
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      allDone ? "bg-green-600" : "bg-blue-500",
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
                  of {counts.needed} Done
                </span>
                {counts.wip > 0 && (
                  <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                    {counts.wip} WIP
                  </span>
                )}
                {counts.off > 0 && (
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
                    {counts.off} disabled
                  </span>
                )}
              </div>
            )}
            {/* The package's signed copy, stored only -- Download binder always builds from the
                current documents (owner 2026-10-06). */}
            {signedCopy && (
              <p className="flex flex-wrap items-center gap-1 text-xs text-gray-600">
                <FileSignature className="h-3.5 w-3.5 text-green-600" />
                Signed copy:
                <a
                  href={signedHref}
                  target="_blank"
                  rel="noreferrer"
                  className="max-w-[16rem] truncate font-medium text-blue-700 hover:underline"
                  title={signedCopy.file_name}
                >
                  {signedCopy.file_name}
                </a>
                <span className="text-gray-400">
                  · uploaded {formatDate(signedCopy.uploaded_on)}
                </span>
              </p>
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
                  allDone
                    ? "Cover, logos, checklist and every document in one PDF"
                    : doneCount === 0
                      ? "Cover, logos and checklist only — no document is Done yet, so no pages follow"
                      : `Cover, logos, checklist and the ${doneCount} Done document${doneCount === 1 ? "" : "s"} — the other ${remaining} stay on the checklist with no pages behind them until they are Done`
                }
                onClick={() => setConfirmBinder(true)}
              >
                {/* No spinner here: the build's progress shows in the binder dialog only (owner
                    2026-10-06); while it builds, this button reopens that dialog. */}
                <BookOpenText className="mr-1 h-3.5 w-3.5" />
                Download binder
              </Button>
            )}
            {(canEdit || signedCopy) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild disabled={uploadingSigned}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-gray-500"
                    disabled={uploadingSigned}
                    title={`More options for ${system.display_name}`}
                    aria-label={`More options for ${system.display_name}`}
                  >
                    {uploadingSigned ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <MoreHorizontal className="h-4 w-4" />
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  {canEdit && (
                    <DropdownMenuItem
                      className="gap-2 text-sm"
                      onClick={() => signedInput.current?.click()}
                    >
                      {signedCopy ? (
                        <Replace className="h-4 w-4" />
                      ) : (
                        <Upload className="h-4 w-4" />
                      )}
                      {signedCopy ? "Replace signed copy" : "Upload signed copy"}
                    </DropdownMenuItem>
                  )}
                  {signedCopy && (
                    <DropdownMenuItem
                      className="gap-2 text-sm"
                      onClick={() => window.open(signedHref, "_blank", "noopener")}
                    >
                      <FileSignature className="h-4 w-4" /> View signed copy
                    </DropdownMenuItem>
                  )}
                  {canEdit && (
                    <DropdownMenuItem
                      className="gap-2 text-sm text-red-600 focus:text-red-600"
                      onClick={() => setConfirmRemove(true)}
                    >
                      <Trash2 className="h-4 w-4" /> Remove package
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {canEdit && (
              <input
                ref={signedInput}
                type="file"
                accept={SIGNED_COPY_ACCEPT}
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  setUploadingSigned(true);
                  try {
                    await onUploadSignedCopy(file);
                  } finally {
                    setUploadingSigned(false);
                  }
                }}
              />
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs font-semibold text-gray-600">
                <th className="w-14 px-2 py-2 text-center">S.No</th>
                <th className="px-2 py-2">Document</th>
                <th
                  className="w-24 px-2 py-2 text-center"
                  title="Enabled = YES on the printed checklist. Disabled = left off the checklist and the binder."
                >
                  Enable / Disable
                </th>
                <th className="w-40 px-2 py-2 text-center">Status</th>
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
                            ? "Disabled: left off the checklist and the binder"
                            : "Enabled: YES on the checklist"
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
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <BinderDialog
        open={confirmBinder}
        onOpenChange={setConfirmBinder}
        displayName={system.display_name}
        rows={rows}
        documents={documents}
        building={buildingBinderHere}
        progress={buildingBinderHere ? progress : null}
        // The dialog stays open: the progress shows in it.
        onDownload={() => onBuild(null, binderTitle)}
      />

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
          onSaveSelected={async (selected, markDone) => {
            // An export saves the ticks too, but ONLY the Mark-as-Done button is the review that
            // makes the document Done (owner 2026-09-28) -- a download must never change the status.
            const form_data = { ...(openRowData.form_data || {}), selected };
            const done = !!markDone && saveMarksDone(openMeta, form_data);
            await updateRow(
              openRowData.name,
              done ? { form_data, status: "Done" } : { form_data },
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
          // Done is a statement, not a signature: the form stays editable.
          readOnly={!rowEditable(openRowData, canEdit)}
          onSave={async (formData) => {
            const done = saveMarksDone(openMeta, formData);
            await updateRow(
              openRowData.name,
              done
                ? { form_data: formData, status: "Done" }
                : { form_data: formData },
            );
            toast({
              title: done ? "Marked as Done" : "Saved",
              description: done
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
        />
      )}


      <AlertDialog
        open={!!doneBlocked}
        onOpenChange={(o) => !o && setDoneBlocked(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Nothing to hand over yet
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-gray-600">
                <p>
                  <b>{doneBlocked?.meta.title}</b> has no records ticked for the
                  handover yet, so it cannot be marked Done.
                </p>
                <p>{DONE_HINT}</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Close</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                // No latch needed: Mark as Done on the ticks makes it Done on its own.
                const name = doneBlocked?.row.name ?? null;
                setDoneBlocked(null);
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
              {hasEntries && (
                <AlertTriangle className="h-5 w-5 text-amber-500" />
              )}
              Remove {system.display_name}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                {touched > 0 && (
                  <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
                    <span className="font-semibold">
                      {touched} document{touched !== 1 ? "s" : ""} already{" "}
                      {touched !== 1 ? "have" : "has"} entries
                    </span>{" "}
                    — filled forms, remarks or switched
                    documents. Removing the package deletes all of it, and it
                    cannot be undone.
                  </p>
                )}
                {signedCopy && (
                  <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
                    Its <span className="font-semibold">signed copy</span> (
                    {signedCopy.file_name}) is removed from the package too.
                  </p>
                )}
                {!hasEntries && (
                  <p>
                    Its 16 handover documents are removed from this project.
                    Nothing has been entered on them yet.
                  </p>
                )}
                <p>Are you sure you want to remove this package?</p>
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
                  await onRemoveSystem(hasEntries);
                  setConfirmRemove(false);
                } catch {
                  // the caller already showed the error; keep the dialog open
                } finally {
                  setRemoving(false);
                }
              }}
            >
              {removing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {hasEntries ? "Remove anyway" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
