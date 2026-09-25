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
//     binder and the printed list carry exactly what was exported.
// Everything else — the stakeholder cards, the package chips, the search, the PDF itself — is the
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
import { TdsExportDialog } from "@/pages/projects/TDSRepository/components";
import { getFrappeError } from "@/utils/frappeErrors";

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
  onSaveSelected: (selected: string[]) => Promise<void>;
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

  const { exportTds, isExporting } = useHodTdsExport(projectId, projectName);

  // What was ticked last time. Nothing saved = nothing ticked (`startEmpty` below), as everywhere in HOD
  // since 2026-09-25.
  const seeded = React.useMemo(
    () => asStringList(row.form_data?.selected) ?? undefined,
    [row.form_data],
  );

  const mine = React.useMemo(() => {
    const names = new Set(
      ((sources?.items ?? []) as HodTdsItem[]).map((i) => i.name),
    );
    return (historyData ?? []).filter((item: any) => names.has(item.name));
  }, [sources, historyData]);

  /** The ticks decide what the handover BINDER carries, so they are stored on the row. */
  const saveSelection = async (selectedItems: any[], announce: boolean) => {
    try {
      await onSaveSelected(selectedItems.map((i) => String(i.name)));
      // `announce` marks the Save selection button (not the save that rides an export): the review is
      // done, so the dialog closes behind it.
      if (announce) {
        onOpenChange(false);
        toast({
          title: "Selection saved",
          description: `${selectedItems.length} data sheet${selectedItems.length === 1 ? "" : "s"} go into the handover binder. You can answer YES now.`,
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

  const handleExport = async (selectedItems: any[]) => {
    // A failure to store the ticks must not stop the download the user asked for.
    if (canEdit) await saveSelection(selectedItems, false);
    await exportTds(
      toTdsRepositoryData(settings![0]),
      selectedItems,
      `${hodSystem}_Material_Data_Sheet`,
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
    <TdsExportDialog
      isOpen={open}
      onClose={() => onOpenChange(false)}
      onExport={handleExport}
      settings={toTdsRepositoryData(settings[0])}
      historyData={mine as any}
      isExporting={isExporting}
      onSaveSelection={
        canEdit ? (items) => saveSelection(items, true).then(() => undefined) : undefined
      }
      initialSelectedIds={seeded}
      // Nothing ticked until someone ticks it — the ticks are what a build merges (owner 2026-09-25).
      startEmpty
    />
  );
};
