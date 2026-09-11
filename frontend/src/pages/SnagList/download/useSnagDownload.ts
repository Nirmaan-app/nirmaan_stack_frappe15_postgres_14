// frontend/src/pages/SnagList/download/useSnagDownload.ts
//
// The Download button's whole job: current view -> URL -> blob -> saved file.
// No dialog. The tab's own facets and search box ARE the picker, so a second
// selection screen would only be a chance to disagree with what is on screen.

import { useCallback, useState } from "react";

import { toast } from "@/components/ui/use-toast";

import { filenameFromResponse } from "../import/templateDownload";

import {
  buildSnagDownloadAllUrl,
  buildSnagDownloadUrl,
  buildSnagPdfFilename,
  SnagDownloadState,
} from "./snagDownloadParams";

/**
 * Frappe answers a failed print with a JSON body, not a PDF. Without this check a
 * server-side error downloads as a .pdf the user cannot open, and the real
 * message never reaches them.
 */
async function assertPdfResponse(response: Response): Promise<void> {
  if (response.ok && !response.headers.get("content-type")?.includes("json")) {
    return;
  }

  let message = `PDF generation failed (${response.status}).`;
  try {
    const payload = await response.json();
    const serverMessages: string[] = JSON.parse(payload?._server_messages || "[]");
    const first = serverMessages.length ? JSON.parse(serverMessages[0])?.message : null;
    message = first || payload?.exc_type || payload?.message || message;
  } catch {
    // Body was not JSON after all — keep the status-code message.
  }
  throw new Error(message);
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

export interface UseSnagDownloadResult {
  isDownloading: boolean;
  download: () => Promise<void>;
}

/**
 * `state` is read at CLICK time, so the caller may hand over a fresh object every
 * render without re-arming anything.
 */
export function useSnagDownload(
  state: SnagDownloadState & { projectLabel?: string }
): UseSnagDownloadResult {
  const [isDownloading, setIsDownloading] = useState(false);

  const { projectId, columnFilters, searchTerm, selectedSearchField, batch, projectLabel } =
    state;

  const download = useCallback(async () => {
    if (!projectId) return;

    setIsDownloading(true);
    try {
      toast({
        title: "Generating PDF...",
        description: "Please wait while we generate the snag list.",
      });

      const response = await fetch(
        buildSnagDownloadUrl({
          projectId,
          columnFilters,
          searchTerm,
          selectedSearchField,
          batch,
        })
      );
      await assertPdfResponse(response);

      saveBlob(
        await response.blob(),
        buildSnagPdfFilename(projectLabel || projectId, new Date())
      );

      toast({
        title: "Success",
        description: "Snag list downloaded successfully.",
        variant: "success",
      });
    } catch (error) {
      console.error("Snag list download error:", error);
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to download the snag list.",
        variant: "destructive",
      });
    } finally {
      setIsDownloading(false);
    }
  }, [projectId, columnFilters, searchTerm, selectedSearchField, batch, projectLabel]);

  return { isDownloading, download };
}

/**
 * "Download All" — every batch's report merged into ONE PDF, server-side.
 *
 * Deliberately its own hook rather than a flag on `useSnagDownload`: the two produce
 * different documents from different endpoints, and the button that fires this one is
 * shown under a different condition (more than one batch). Sharing the fetch/blob
 * plumbing while keeping the two callers apart is what stops a later "just pass a
 * boolean" from making one control quietly do the other's job.
 *
 * The saved file is named by the SERVER (via Content-Disposition), because it is the
 * side that knows how many batches went in — the local name is only a fallback.
 */
export function useSnagDownloadAll(
  state: SnagDownloadState & { projectLabel?: string }
): UseSnagDownloadResult {
  const [isDownloading, setIsDownloading] = useState(false);

  const { projectId, columnFilters, searchTerm, selectedSearchField, projectLabel } = state;

  const download = useCallback(async () => {
    if (!projectId) return;

    setIsDownloading(true);
    try {
      toast({
        title: "Generating PDF...",
        description: "Building one report per batch and merging them.",
      });

      const response = await fetch(
        buildSnagDownloadAllUrl({
          projectId,
          columnFilters,
          searchTerm,
          selectedSearchField,
        })
      );
      await assertPdfResponse(response);

      saveBlob(
        await response.blob(),
        filenameFromResponse(
          response,
          buildSnagPdfFilename(`ALL_${projectLabel || projectId}`, new Date())
        )
      );

      toast({
        title: "Success",
        description: "Every batch was downloaded as one PDF.",
        variant: "success",
      });
    } catch (error) {
      console.error("Snag list download-all error:", error);
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to download the snag lists.",
        variant: "destructive",
      });
    } finally {
      setIsDownloading(false);
    }
  }, [projectId, columnFilters, searchTerm, selectedSearchField, projectLabel]);

  return { isDownloading, download };
}
