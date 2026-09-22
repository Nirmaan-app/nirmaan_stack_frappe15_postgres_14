// The Actions cell of one handover document, in the Commission Report's style (owner 2026-09-22): one primary
// action picked by the row's STATUS, a helper line, and a ⋮ menu for the rest. The status itself is never set
// by hand -- the server derives it from what these actions do:
//
//   Pending      -> documents with something to fill: "Fill Form"
//                   everything else (library text, From Nirmaan): "Download" + "Upload Signed"
//   Form Filled  -> "Download" + "Upload Signed"            (the form was saved)
//   Completed    -> "View Signed"                            (the signed copy is uploaded)

import {
  Download,
  Eye,
  FileText,
  FileEdit,
  Loader2,
  MoreVertical,
  Replace as ReplaceIcon,
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
import { cn } from "@/lib/utils";
import { ReportPreviewDialog } from "@/pages/CommissionReport/components/ReportPreviewDialog";

import { hodDocumentPdfUrl } from "./hodDownloads";
import type { HodDocumentMeta, HodRow } from "./types";

export interface HodActionCellProps {
  row: HodRow;
  meta: HodDocumentMeta;
  canEdit: boolean;
  /** Something is running for this row (a save, an upload, a download). */
  busy: boolean;
  /** Open the row's dialog: the form, the library text, or the From Nirmaan records. */
  onOpen: () => void;
  /** Download the document (From Nirmaan documents: the reports themselves, built on the server). */
  onDownload: () => void;
  onUpload: (file: File) => void;
  onRemoveUpload: () => void;
}

export const HodActionCell: React.FC<HodActionCellProps> = ({
  row,
  meta,
  canEdit,
  busy,
  onOpen,
  onDownload,
  onUpload,
  onRemoveUpload,
}) => {
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [preview, setPreview] = React.useState<{
    url: string;
    direct: boolean;
    title: string;
  } | null>(null);
  const fromApp = meta.kind === "app";
  const status = row.status;
  const pickFile = () => fileRef.current?.click();

  if (row.disabled) {
    return (
      <span className="block text-center text-[11px] text-gray-400">
        Switched off
      </span>
    );
  }

  const btn = (
    Icon: React.ElementType,
    label: string,
    onClick: () => void,
    color?: string,
  ) => (
    <Button
      size="sm"
      variant={color ? "default" : "outline"}
      className={cn(
        "h-7 gap-1 px-2.5",
        color && `border-0 text-white ${color}`,
      )}
      onClick={onClick}
      disabled={busy}
      title={label}
    >
      {busy ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Icon className="h-3 w-3" />
      )}
      <span className="text-[11px] font-medium">{label}</span>
    </Button>
  );

  // From Nirmaan documents open the picker first (tick which reports / batches / drawings).
  const picks = fromApp;
  const downloadBtn = btn(
    Download,
    picks ? "Select & Download" : "Download",
    onDownload,
  );
  const uploadBtn = btn(
    Upload,
    "Upload Signed",
    pickFile,
    "bg-green-600 hover:bg-green-700",
  );

  // ---- the ⋮ menu
  type Item = {
    icon: React.ElementType;
    label: string;
    onClick: () => void;
    danger?: boolean;
  };
  const more: Item[] = [];
  if (meta.fill && status !== "Pending") {
    more.push({
      icon: FileEdit,
      label: canEdit && status !== "Completed" ? "Edit form" : "View form",
      onClick: onOpen,
    });
  }
  if (!meta.fill) {
    more.push({
      icon: Eye,
      label: fromApp ? "View records" : "View document",
      onClick: onOpen,
    });
  }
  if (!fromApp) {
    more.push({
      icon: FileText,
      label: "Preview PDF",
      onClick: () =>
        setPreview({
          url: hodDocumentPdfUrl(row.name),
          direct: false,
          title: meta.title,
        }),
    });
  }
  if (status === "Completed") {
    more.push({
      icon: Download,
      label: fromApp ? "Download the reports" : "Download generated PDF",
      onClick: onDownload,
    });
    if (canEdit) {
      more.push({
        icon: ReplaceIcon,
        label: "Replace signed copy",
        onClick: pickFile,
      });
      more.push({
        icon: Trash2,
        label: "Remove signed copy",
        onClick: onRemoveUpload,
        danger: true,
      });
    }
  } else if (canEdit && meta.fill && status === "Pending") {
    more.push({ icon: Upload, label: "Upload signed copy", onClick: pickFile });
  }

  const moreMenu = more.length > 0 && (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7 border-gray-300 text-slate-600"
          title="More actions"
          disabled={busy}
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {more.map((it) => (
          <DropdownMenuItem
            key={it.label}
            onClick={it.onClick}
            className={cn("gap-2 text-xs", it.danger && "text-red-600")}
          >
            <it.icon className="h-3.5 w-3.5" /> {it.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  // ---- the primary action by status
  let primary: React.ReactNode;
  let helper: string | undefined;
  if (status === "Completed") {
    primary = btn(
      Eye,
      "View Signed",
      () =>
        row.attachment &&
        setPreview({
          url: row.attachment,
          direct: true,
          title: `${meta.title} — signed copy`,
        }),
    );
  } else if (!canEdit) {
    primary = meta.fill ? btn(Eye, "View", onOpen) : downloadBtn;
  } else if (meta.fill && status === "Pending") {
    primary = btn(
      FileText,
      "Fill Form",
      onOpen,
      "bg-blue-600 hover:bg-blue-700",
    );
  } else {
    primary = (
      <div className="flex flex-col gap-1">
        {downloadBtn}
        {uploadBtn}
      </div>
    );
    helper = "Download → sign → upload signed copy";
  }

  return (
    <div className="flex w-full flex-col items-center gap-0.5">
      <div className="flex w-full items-center gap-1">
        <div className="flex flex-1 items-center justify-center gap-1">
          {primary}
        </div>
        {moreMenu}
      </div>
      {helper && (
        <span className="text-center text-[10px] leading-tight text-gray-400">
          {helper}
        </span>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onUpload(file);
        }}
      />
      {preview && (
        <ReportPreviewDialog
          open
          onOpenChange={(o) => !o && setPreview(null)}
          pdfUrl={preview.url}
          directSrc={preview.direct}
          title={preview.title}
          fileName={`${meta.title}.pdf`}
          canDownload
        />
      )}
    </div>
  );
};
