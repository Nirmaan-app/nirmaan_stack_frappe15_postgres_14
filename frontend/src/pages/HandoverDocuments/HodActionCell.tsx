// The Actions cell of one handover document: Edit, Preview, Download (owner 2026-09-24). The per-document
// upload and its ⋯ menu (2026-10-06) were removed the same day -- uploads are package-wise.
//
//   Edit     -> opens the document: the form, the From Nirmaan records, or a library text's part picks.
//               Every row has it since 2026-10-06 (a library text, O&M Manual / Do's & Don'ts, went
//               without it from 2026-09-24); a library text's TEXT is still the library's, edited in
//               Packages Settings.
//   Preview  -> the "HOD Document" print of this row, on screen. Every one of the 16 has one: a From
//               Nirmaan document prints the page that LISTS the records it hands over.
//               Building the REAL merged records here instead was tried on 2026-09-25 and reverted the
//               same day: `enqueue_binder` refuses a document that is not Done, and Preview is what
//               you look at BEFORE marking it Done, so it threw on every unfinished row.
//   Download -> the same document as a file. For a From Nirmaan document that means the records
//               themselves, built on the server (with no selection saved yet, Edit opens first).
//
// The status (Not Started / WIP / Done) is NOT here -- it is the Status column; the checklist's YES / NO
// is the Enable / Disable switch.

import { Download, Eye, FileEdit, Loader2 } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { ReportPreviewDialog } from "@/pages/CommissionReport/components/ReportPreviewDialog";

import { hodDocumentPdfUrl } from "./hodDownloads";
import type { HodDocumentMeta, HodRow } from "./types";

export interface HodActionCellProps {
  row: HodRow;
  meta: HodDocumentMeta;
  canEdit: boolean;
  /** Buttons are disabled. Wider than `working`: while ANY build runs, every From Nirmaan row is
   *  blocked, because the server takes one build at a time. */
  busy: boolean;
  /** THIS row's own work (a save, its own download). Only this spins the button — `busy` alone used to,
   *  so every From Nirmaan row's Download spun while a build ran on ONE of them. */
  working: boolean;
  /** Open the row's dialog: the form, the library text, or the From Nirmaan records. */
  onOpen: () => void;
  /** Download the document (From Nirmaan documents: the reports themselves, built on the server). */
  onDownload: () => void;
}

export const HodActionCell: React.FC<HodActionCellProps> = ({
  row,
  meta,
  canEdit,
  busy,
  working,
  onOpen,
  onDownload,
}) => {
  const [preview, setPreview] = React.useState(false);

  if (row.disabled) {
    return (
      <span className="block text-center text-[11px] text-gray-400">
        Disabled
      </span>
    );
  }

  const btn = (
    Icon: React.ElementType,
    label: string,
    onClick: () => void,
    /** Only the download runs a job, so only it shows the row's spinner. */
    spins = false,
  ) => (
    <Button
      size="sm"
      variant="outline"
      className="h-7 gap-1 px-2"
      onClick={onClick}
      disabled={busy}
      title={label}
    >
      {working && spins ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Icon className="h-3 w-3" />
      )}
      <span className="text-[11px] font-medium">{label}</span>
    </Button>
  );

  return (
    <div className="flex items-center justify-center gap-1">
      {btn(FileEdit, canEdit ? "Edit" : "View", onOpen)}
      {btn(Eye, "Preview", () => setPreview(true))}
      {btn(Download, "Download", onDownload, true)}

      {preview && (
        <ReportPreviewDialog
          open
          onOpenChange={(o) => !o && setPreview(false)}
          pdfUrl={hodDocumentPdfUrl(row.name)}
          directSrc={false}
          title={meta.title}
          fileName={`${meta.title}.pdf`}
          canDownload
        />
      )}
    </div>
  );
};
