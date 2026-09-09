// frontend/src/pages/SnagList/import/templateDownload.ts
//
// The blank workbook the wizard hands out: S.No | Area | Category | Description |
// Status | Remarks over 50 ruled rows. Backend owner of the SHAPE is
// `api/snags/import_template.py` -- the columns, the row count and the styling all
// live there, never here, so what the template offers cannot go out of step with
// what the parser reads back.
//
// It is fetched (not linked) for the reason `useSnagDownload` fetches its PDF:
// Frappe answers a refused request with a JSON body, and a plain <a download>
// would save that body as an .xlsx the user cannot open, with the real message
// -- "you may not import a snag list" -- never reaching them.

import { useCallback, useState } from "react";

import { toast } from "@/components/ui/use-toast";
import { getFrappeError } from "@/utils/frappeErrors";

export const SNAG_TEMPLATE_ENDPOINT =
  "/api/method/nirmaan_stack.api.snags.import_template.download_snag_template";

/** Fallback only -- the response's own Content-Disposition names the file. */
export const SNAG_TEMPLATE_FILENAME = "Snag List Template.xlsx";

function saveBlob(blob: Blob, filename: string): void {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

export interface UseSnagTemplateDownloadResult {
  isDownloading: boolean;
  download: () => Promise<void>;
}

export function useSnagTemplateDownload(): UseSnagTemplateDownloadResult {
  const [isDownloading, setIsDownloading] = useState(false);

  const download = useCallback(async () => {
    setIsDownloading(true);
    try {
      const response = await fetch(SNAG_TEMPLATE_ENDPOINT, {
        method: "GET",
        headers: { Accept: "application/octet-stream" },
      });

      if (!response.ok || response.headers.get("content-type")?.includes("json")) {
        let message = `Could not build the template (${response.status}).`;
        try {
          message = getFrappeError(await response.json());
        } catch {
          // Body was not JSON after all -- keep the status-code message.
        }
        throw new Error(message);
      }

      saveBlob(await response.blob(), SNAG_TEMPLATE_FILENAME);
    } catch (error) {
      toast({
        title: "Download failed",
        description: error instanceof Error ? error.message : "Could not download the template.",
        variant: "destructive",
      });
    } finally {
      setIsDownloading(false);
    }
  }, []);

  return { isDownloading, download };
}
