// One system's 16-document checklist: the on/off switch, the status (derived by the server from what was
// done), remarks, and the Commission-style Actions cell. Switched-off rows are greyed, blocked, and left out of
// the printed checklist and the binder (S.No closes up).

import {
  AlertTriangle,
  BookOpenText,
  FileText,
  Loader2,
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
  isSaved,
  needsSaving,
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
  YES: "bg-green-600 text-white border-green-600",
  NO: "bg-gray-100 text-gray-600 border-gray-300",
  NA: "bg-amber-50 text-amber-700 border-amber-300",
};
const STATUSES: HodStatus[] = ["YES", "NO", "NA"];

/** What "save it first" means for each kind of document -- the same three cases `checklist.is_saved`
 *  covers on the server. */
const YES_HINT: Record<string, string> = {
  form: "Fill the form and save it, then set it to YES.",
  template:
    "Open it, choose what it includes and save, then set it to YES.",
  app: "Open the records, tick what goes into the handover and save, then set it to YES.",
};

/** The handover answer for one document: the current value with an edit icon, changed from a small
 *  dropdown. YES is the one that costs something -- it puts the document in the binder -- so it is
 *  refused until the document has been saved, and the refusal says what to do. */
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
      <DropdownMenuContent align="center" className="min-w-[10rem]">
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
                  ? "Handed over"
                  : `Save ${meta.title} first`
                : s === "NO"
                  ? "Not handed over"
                  : "Not applicable"}
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
  // ... and the row whose YES is still owed: they went on to open it, so the moment that save lands
  // the answer they asked for is applied with it, in the SAME write (owner 2026-09-24).
  const [pendingYes, setPendingYes] = React.useState<string | null>(null);
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

  const saveSelected = async (row: HodRow, selected: string[]) => {
    const form_data = { ...(row.form_data || {}), selected };
    const patchBody = withPendingYes(row, form_data);
    await patch(row, patchBody);
    setOpenRow(null); // the review is done -- close it, like Download selected does
    toast({
      title: patchBody.status === "YES" ? "Saved and marked YES" : "Selection saved",
      description:
        patchBody.status === "YES"
          ? `${selected.length} record${selected.length === 1 ? "" : "s"} go into the handover binder.`
          : `${selected.length} record${selected.length === 1 ? "" : "s"} go into the handover. You can answer YES now.`,
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

  /** The patch a save should carry: the form data, plus the YES that was waiting on it. The status
   *  rides the SAME write, so the server guard judges YES against the form data being saved -- never
   *  against what was on the row a moment ago. */
  const withPendingYes = (
    row: HodRow,
    form_data: Record<string, unknown>,
  ): HodRowPatch => {
    const owed = pendingYes === row.name;
    if (owed) setPendingYes(null);
    return owed && isSaved({ form_data })
      ? { form_data, status: "YES" }
      : { form_data };
  };

  /** The handover answer. NO and NA go straight through; YES is refused until the document has been
   *  saved -- the server refuses it too (`checklist.can_be_yes`), this is the message that explains it. */
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
              <th className="w-24 px-2 py-2 text-center">Enable / Disable</th>
              <th className="w-40 px-2 py-2 text-center">Checklist Status</th>
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
                      busy={
                        rowBusy ||
                        (meta.kind === "app" && building && !contentBusy)
                      }
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

      {openRowData && openMeta && openMeta.key === "material_tds" && (
        <MaterialTdsDialog
          open={!!openRow}
          onOpenChange={(o) => {
            if (!o) {
              setOpenRow(null);
              setPendingYes(null);
            }
          }}
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
          onOpenChange={(o) => {
            if (!o) {
              setOpenRow(null);
              setPendingYes(null);
            }
          }}
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
            const patchBody = withPendingYes(openRowData, formData);
            await updateRow(openRowData.name, patchBody);
            if (patchBody.status === "YES")
              toast({
                title: "Saved and marked YES",
                description: `${openMeta.title} goes into the handover binder.`,
                variant: "success",
              });
          }}
          onDownloadSelected={(selected) =>
            downloadSelected(openRowData, openMeta, selected)
          }
          onSaveSelected={(selected) => saveSelected(openRowData, selected)}
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
                  <b>{yesBlocked?.meta.title}</b> has not been saved yet, so it
                  cannot be marked YES.
                </p>
                <p>{yesBlocked ? YES_HINT[yesBlocked.meta.kind] : ""}</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Close</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const name = yesBlocked?.row.name ?? null;
                setYesBlocked(null);
                setPendingYes(name); // applied the moment that save lands
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
