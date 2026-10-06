// The Actions cell of one handover document: Edit, Preview, Download and a ⋯ menu holding the upload
// (owner 2026-09-24; the ⋯ menu added 2026-10-06).
//
//   Edit     -> opens the document: the form, the From Nirmaan records, or a library text's part picks --
//               and, on every one, its uploaded file. Every row has it since 2026-10-06 (a library text,
//               O&M Manual / Do's & Don'ts, went without it from 2026-09-24); a library text's TEXT is
//               still the library's, edited in Packages Settings.
//   Preview  -> the "HOD Document" print of this row, on screen. Every one of the 16 has one: a From
//               Nirmaan document prints the page that LISTS the records it hands over.
//               Building the REAL merged records here instead was tried on 2026-09-25 and reverted the
//               same day: `enqueue_binder` refuses a document that is not answered YES, and Preview is
//               what you look at BEFORE answering, so it threw on every unanswered row.
//   Download -> the same document as a file. For a From Nirmaan document that means the records
//               themselves, built on the server (with no selection saved yet, Edit opens first).
//
//   ⋯        -> Upload ("Replace" once a file is there) and Remove upload, on EVERY document (owner
//               2026-10-06): the project's own file -- the signed copy, say -- REPLACES what Nirmaan
//               generates in Preview, Download and the binder. Only for users who can edit.
//
// The checklist answer (YES / NO / NA) is NOT here -- it is the Checklist Status column.

import {
  Download,
  Eye,
  FileEdit,
  Loader2,
  MoreHorizontal,
  Replace,
  Trash2,
  Upload,
} from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ReportPreviewDialog } from "@/pages/CommissionReport/components/ReportPreviewDialog";

import { HOD_UPLOAD_ACCEPT } from "./hodApi";
import { hodDocumentPdfUrl } from "./hodDownloads";
import { uploadedFile } from "./hodRules";
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
  /** Upload the project's own file in place of what Nirmaan generates (any document). */
  onUpload: (file: File) => void;
  /** Back to what Nirmaan generates. */
  onRemoveUpload: () => void;
}

export const HodActionCell: React.FC<HodActionCellProps> = ({
  row,
  meta,
  canEdit,
  busy,
  working,
  onOpen,
  onDownload,
  onUpload,
  onRemoveUpload,
}) => {
  const [preview, setPreview] = React.useState(false);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const uploaded = uploadedFile(row);

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
      {canEdit && (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild disabled={busy}>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-gray-500"
                disabled={busy}
                title={`More for ${meta.title}`}
                aria-label={`More for ${meta.title}`}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem
                className="gap-2 text-sm"
                onClick={() => fileInput.current?.click()}
              >
                {uploaded ? (
                  <Replace className="h-4 w-4" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                {uploaded ? "Replace" : "Upload"}
              </DropdownMenuItem>
              {uploaded && (
                <DropdownMenuItem
                  className="gap-2 text-sm text-red-600 focus:text-red-600"
                  onClick={onRemoveUpload}
                >
                  <Trash2 className="h-4 w-4" /> Remove upload
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <input
            ref={fileInput}
            type="file"
            accept={HOD_UPLOAD_ACCEPT}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) onUpload(file);
            }}
          />
        </>
      )}

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
