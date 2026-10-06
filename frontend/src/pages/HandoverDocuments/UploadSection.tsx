// The uploaded file of one handover document, shown at the top of its dialog: the file, and Upload /
// Replace / Remove. Every document may carry one (owner 2026-10-06); it replaces what Nirmaan generates
// in Preview, Download and the binder. The same actions sit in the row's ⋯ menu.

import { FileText, Loader2, Replace, Trash2, Upload } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import SITEURL from "@/constants/siteURL";

import { HOD_UPLOAD_ACCEPT } from "./hodApi";
import type { HodUpload } from "./types";

/** The uploaded file of a handover document: what is handed over instead of what Nirmaan generates. */
export const UploadSection: React.FC<{
  upload: HodUpload | null;
  editable: boolean;
  busy: boolean;
  onUpload: (file: File) => void;
  onRemove: () => void;
}> = ({ upload, editable, busy, onUpload, onRemove }) => {
  const input = React.useRef<HTMLInputElement>(null);
  const href = upload
    ? upload.url.startsWith("http")
      ? upload.url
      : SITEURL + upload.url
    : "";
  return (
    <div className="space-y-2 rounded-md border bg-gray-50/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900">Uploaded file</p>
          <p className="text-xs text-gray-500">
            {upload
              ? "Preview, Download and the binder hand over this file instead of what Nirmaan generates."
              : "Nothing uploaded — Nirmaan generates this document. An uploaded PDF or picture (the signed copy, say) replaces it."}
          </p>
        </div>
        {editable && (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              {busy ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : upload ? (
                <Replace className="mr-1 h-3.5 w-3.5" />
              ) : (
                <Upload className="mr-1 h-3.5 w-3.5" />
              )}
              {upload ? "Replace" : "Upload"}
            </Button>
            {upload && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-red-600 hover:text-red-700"
                disabled={busy}
                onClick={onRemove}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                Remove
              </Button>
            )}
            <input
              ref={input}
              type="file"
              accept={HOD_UPLOAD_ACCEPT}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) onUpload(file);
              }}
            />
          </div>
        )}
      </div>
      {upload && (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex max-w-full items-center gap-1.5 text-sm text-blue-700 hover:underline"
        >
          <FileText className="h-4 w-4 shrink-0" />
          <span className="truncate">{upload.file_name}</span>
        </a>
      )}
    </div>
  );
};
