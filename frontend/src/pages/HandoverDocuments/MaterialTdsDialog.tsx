// 4. Material Data Sheet — the project's OWN "Confirm TDS Export" dialog, opened from the handover
// checklist (owner 2026-09-24: "we already have that dialog, we only need to pass our packages and
// the source keywords"). HOD builds no picker of its own for TDS any more.
//
// What HOD adds to it:
//   * WHICH items — the server decides (`get_from_app_sources`): the system's Work Package, narrowed
//     by `HOD System.source_keywords` where one package holds several systems, so GSS does not see
//     VESDA's or WLD & RRS's data sheets. The full rows come from the TDS tab's own list and are cut
//     down to the names the server returned, so there is only ONE rule about what belongs to a system.
//   * The ticks are saved on the handover row (`form_data.selected`) when the export runs, so the
//     binder and the printed list carry exactly what was exported, in the dialog's print order.
//   * Both Approved statuses start ticked (`PDF_DEFAULT_STATUSES.handover`), so saved ticks on
//     Admin-approved rows stay visible, and Pending too when a saved tick is on a Pending row
//     (`pdfSeedStatuses`); a saved tick on a row the client rejected since is dropped.
//   * The dialog reads its props when it mounts; this component renders it only while open, so each
//     open starts afresh.
// Everything else — the stakeholder cards, the ordered checklists, the search, the PDF itself — is the
// TDS tab's, unchanged.

import { Loader2 } from "lucide-react";
import * as React from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/use-toast";
import { toTdsRepositoryData } from "@/pages/projects/data/tds/tdsSettings";
import {
  useTdsHistoryItems,
  useTdsSettings,
} from "@/pages/projects/data/tds/useTdsQueries";
import {
  TdsExportDialog,
  TdsPdfReadyDialog,
  type TdsExportItem,
  type TdsExportOptions,
} from "@/pages/projects/TDSRepository/components";
import { getFrappeError } from "@/utils/frappeErrors";
import { PDF_DEFAULT_STATUSES } from "@/utils/tdsRequestRules";

import { useFromAppSources } from "./hodApi";
import { asStringList } from "./hodRules";
import { useHodTdsExport } from "./useHodTdsExport";
import type { HodRow, HodTdsItem } from "./types";

interface MaterialTdsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName: string;
  hodSystem: string;
  displayName: string;
  row: HodRow;
  /** False in a read-only tab: the dialog still exports, it just does not save the ticks. */
  canEdit: boolean;
  /** Store the ticked data sheets on the row. `markDone` is TRUE for the Mark-as-Done button -- the
   *  review the document is made Done on -- and FALSE for the save that rides an export, which must
   *  not change the status (owner 2026-09-28). */
  onSaveSelected: (selected: string[], markDone?: boolean) => Promise<void>;
}

/** A small dialog of its own for the two states the export dialog cannot show (it needs its data up
 *  front): still loading, and a project whose TDS Repository was never set up. */
const Notice: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: React.ReactNode;
}> = ({ open, onOpenChange, title, children }) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      <div className="py-2 text-sm text-gray-600">{children}</div>
    </DialogContent>
  </Dialog>
);

export const MaterialTdsDialog: React.FC<MaterialTdsDialogProps> = ({
  open,
  onOpenChange,
  projectId,
  projectName,
  hodSystem,
  displayName,
  row,
  canEdit,
  onSaveSelected,
}) => {
  // The system's own items, by the server's rule (package + source keywords).
  const { sources, isLoading: sourcesLoading } = useFromAppSources(
    projectId,
    hodSystem,
    "material_tds",
    open,
  );
  const { data: historyData, isLoading: historyLoading } =
    useTdsHistoryItems(projectId);
  const { data: settings, isLoading: settingsLoading } =
    useTdsSettings(projectId);

  const { exportTds, isExporting, preview, closePreview } = useHodTdsExport(
    projectId,
    projectName,
  );

  // What was ticked last time. Nothing saved = nothing ticked, as everywhere in HOD since 2026-09-25.
  const seeded = React.useMemo(
    () => asStringList(row.form_data?.selected) ?? [],
    [row.form_data],
  );

  const mine = React.useMemo(() => {
    const names = new Set(
      ((sources?.items ?? []) as HodTdsItem[]).map((i) => i.name),
    );
    return (historyData ?? []).filter((item) => names.has(item.name));
  }, [sources, historyData]);

  /** The ticks decide what the handover BINDER carries, so they are stored on the row. */
  const saveSelection = async (selectedItems: TdsExportItem[], announce: boolean) => {
    try {
      await onSaveSelected(selectedItems.map((i) => String(i.name)), announce);
      // `announce` marks the Mark-as-Done button (not the save that rides an export): the review is
      // done, so it makes the document Done and the dialog closes behind it.
      if (announce) {
        onOpenChange(false);
        toast({
          title: selectedItems.length ? "Marked as Done" : "Selection saved",
          description: selectedItems.length
            ? `${selectedItems.length} data sheet${selectedItems.length === 1 ? "" : "s"} go into the handover binder.`
            : "Tick the data sheets that go into the handover, then Mark as Done again.",
          variant: "success",
        });
      }
      return true;
    } catch (error) {
      toast({
        title: "Could not save the selection",
        description: getFrappeError(error),
        variant: "destructive",
      });
      return false;
    }
  };

  const handleExport = async (
    selectedItems: TdsExportItem[],
    { previewOnly }: TdsExportOptions,
  ) => {
    // A failure to store the ticks must not stop the download the user asked for.
    if (canEdit) await saveSelection(selectedItems, false);
    await exportTds(
      toTdsRepositoryData(settings![0]),
      selectedItems,
      `${hodSystem}_Material_Data_Sheet`,
      { previewOnly },
    );
  };

  if (!open) return null;

  if (sourcesLoading || historyLoading || settingsLoading) {
    return (
      <Notice open onOpenChange={onOpenChange} title="4. Material Data Sheet">
        <span className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading the {displayName}{" "}
          data sheets…
        </span>
      </Notice>
    );
  }

  if (!settings?.length) {
    return (
      <Notice open onOpenChange={onOpenChange} title="4. Material Data Sheet">
        This project's TDS Repository has not been set up yet, so a data sheet
        pack cannot be exported. Set it up on the project's TDS tab first.
      </Notice>
    );
  }

  return (
    <>
      <TdsExportDialog
        isOpen={open}
        onClose={() => onOpenChange(false)}
        onExport={handleExport}
        settings={toTdsRepositoryData(settings[0])}
        historyData={mine}
        isExporting={isExporting}
        defaultStatuses={PDF_DEFAULT_STATUSES.handover}
        onSaveSelection={
          canEdit ? (items) => saveSelection(items, true).then(() => undefined) : undefined
        }
        // Nothing ticked until someone ticks it — the ticks are what a build merges (owner 2026-09-25).
        initialSelectedIds={seeded}
      />
      {/* Only a preview-only export lands here, so the preview never offers a download. */}
      <TdsPdfReadyDialog
        isOpen={!!preview}
        onClose={closePreview}
        onDownload={closePreview}
        blobUrl={preview?.blobUrl ?? null}
        filename={preview?.filename ?? ""}
        sizeBytes={preview?.sizeBytes ?? 0}
        canDownload={false}
      />
    </>
  );
};
