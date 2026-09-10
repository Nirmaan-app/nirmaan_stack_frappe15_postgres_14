// frontend/src/pages/SnagList/import/templateDownload.ts
//
// The blank workbook the wizard hands out: a title block (Project / Snag List Name /
// Prepared By / Date) over S.No | Area | Category | Description | Remarks and 50 ruled
// rows. Backend owner of the SHAPE is `api/snags/import_template.py` -- the columns, the
// title block, the row count and the styling all live there, never here, so what the
// template offers cannot go out of step with what the parser reads back.
//
// (This comment used to list a `Status` column. There has never been one: the import
// discards a status, so offering the column would invite a value that is then silently
// thrown away.)
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

/**
 * The file name the SERVER chose, or `fallback`.
 *
 * ⚠️ A BLOB DOWNLOAD DOES NOT HONOUR Content-Disposition. The bytes are handed to
 * `createObjectURL` and the anchor's `download` attribute names the file, so before this
 * existed the server could name its file anything it liked and every template still saved
 * as the constant above -- the "fallback only" comment described an intent the code did
 * not implement. Reading the header here is what makes the server's name (which carries
 * the project) actually reach the disk.
 */
export function filenameFromResponse(response: Response, fallback: string): string {
  const disposition = response.headers.get("content-disposition") || "";

  // RFC 5987 form first -- it is the one that survives non-ASCII project names.
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1]);
    } catch {
      // Malformed percent-encoding -- fall through to the plain form.
    }
  }

  const plain = /filename="?([^";]+)"?/i.exec(disposition);
  return plain ? plain[1].trim() : fallback;
}

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

/**
 * `projectId` only labels the template -- it fills the title block's Project line and
 * rides the file name. Omitted, the template is still valid; that line is simply blank
 * for the consultant to write.
 */
export function useSnagTemplateDownload(projectId?: string): UseSnagTemplateDownloadResult {
  const [isDownloading, setIsDownloading] = useState(false);

  const download = useCallback(async () => {
    setIsDownloading(true);
    try {
      const url = projectId
        ? `${SNAG_TEMPLATE_ENDPOINT}?project=${encodeURIComponent(projectId)}`
        : SNAG_TEMPLATE_ENDPOINT;

      const response = await fetch(url, {
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

      saveBlob(
        await response.blob(),
        filenameFromResponse(response, SNAG_TEMPLATE_FILENAME)
      );
    } catch (error) {
      toast({
        title: "Download failed",
        description: error instanceof Error ? error.message : "Could not download the template.",
        variant: "destructive",
      });
    } finally {
      setIsDownloading(false);
    }
  }, [projectId]);

  return { isDownloading, download };
}
