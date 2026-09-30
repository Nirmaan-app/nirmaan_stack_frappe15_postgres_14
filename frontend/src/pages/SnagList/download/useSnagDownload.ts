// frontend/src/pages/SnagList/download/useSnagDownload.ts
//
// The Download button's whole job: current view -> URL -> blob -> saved file.
// The tab's own facets and search box ARE the picker; the button's small dialog
// (`components/SnagDownloadDialog`) adds what the toolbar has no equivalent for --
// the report type (Full report / Summary only) and "Include Not Applicable", a box
// that can only NARROW the list's Status filter, never widen it.
//
// "Download All" has its own dialog (`components/SnagDownloadAllDialog`): report type
// plus the same N/A box, resolved by the same `resolveDownloadAllStatuses`.

import { useCallback, useState } from "react";

import { toast } from "@/components/ui/use-toast";

import { filenameFromResponse } from "../import/templateDownload";

import {
  buildSnagDownloadAllUrl,
  buildSnagDownloadUrl,
  buildSnagPdfFilename,
  buildSnagSummaryPdfFilename,
  listStatusFilter,
  resolveDownloadAllStatuses,
  SnagDownloadAllOptions,
  SnagDownloadOptions,
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
  /**
   * Resolves `true` when the file was saved, `false` on any failure (already toasted).
   * The dialog closes on `true` only. Never rejects.
   */
  download: (options: SnagDownloadOptions) => Promise<boolean>;
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

  const download = useCallback(async (options: SnagDownloadOptions): Promise<boolean> => {
    if (!projectId) return false;

    // Backstop for the dialog's disabled Download: an EMPTY statuses list would reach
    // the Jinja as "unfiltered" and print every status -- the opposite of what was asked.
    if (
      resolveDownloadAllStatuses(listStatusFilter(columnFilters), options.includeNotApplicable)
        .empty
    ) {
      toast({ title: "No snags to download", variant: "destructive" });
      return false;
    }

    const isSummary = options.mode === "summary";

    setIsDownloading(true);
    try {
      toast({
        title: "Generating PDF...",
        description: isSummary
          ? "Please wait while we generate the snag summary."
          : "Please wait while we generate the snag list.",
      });

      const response = await fetch(
        buildSnagDownloadUrl(
          {
            projectId,
            columnFilters,
            searchTerm,
            selectedSearchField,
            batch,
          },
          options
        )
      );
      await assertPdfResponse(response);

      const label = projectLabel || projectId;
      saveBlob(
        await response.blob(),
        isSummary
          ? buildSnagSummaryPdfFilename(label, new Date())
          : buildSnagPdfFilename(label, new Date())
      );

      toast({
        title: "Success",
        description: isSummary
          ? "Snag summary downloaded successfully."
          : "Snag list downloaded successfully.",
        variant: "success",
      });
      return true;
    } catch (error) {
      console.error("Snag list download error:", error);
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to download the snag list.",
        variant: "destructive",
      });
      return false;
    } finally {
      setIsDownloading(false);
    }
  }, [projectId, columnFilters, searchTerm, selectedSearchField, batch, projectLabel]);

  return { isDownloading, download };
}

export interface UseSnagDownloadAllResult {
  isDownloading: boolean;
  /**
   * Resolves `true` when the file was saved, `false` on any failure (already toasted).
   * The dialog closes on `true` only, so a failed download leaves the user's choices
   * on screen to retry. Never rejects.
   */
  download: (options: SnagDownloadAllOptions) => Promise<boolean>;
}

/**
 * "Download All" — a master summary, then (in `full` mode) every batch's report,
 * merged into ONE PDF, server-side.
 *
 * The options come from `SnagDownloadAllDialog` at CLICK time (report type + the
 * "Include Not Applicable" box) — they are arguments to `download`, not hook state,
 * so the dialog owns its own choices and this hook stays a fetch/save pipe.
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
): UseSnagDownloadAllResult {
  const [isDownloading, setIsDownloading] = useState(false);

  const { projectId, columnFilters, searchTerm, selectedSearchField, projectLabel } = state;

  const download = useCallback(
    async (options: SnagDownloadAllOptions): Promise<boolean> => {
      if (!projectId) return false;
      const isSummary = options.mode === "summary";

      // Backstop for the dialog's disabled Download: an EMPTY statuses list would
      // reach the Jinja as "unfiltered" and print every status — the opposite of
      // what was asked. Refused here too, so no future caller can send it.
      if (
        resolveDownloadAllStatuses(listStatusFilter(columnFilters), options.includeNotApplicable)
          .empty
      ) {
        toast({ title: "No snags to download", variant: "destructive" });
        return false;
      }

      setIsDownloading(true);
      try {
        toast({
          title: "Generating PDF...",
          description: isSummary
            ? "Building the master summary."
            : "Building the master summary and one report per batch, then merging them.",
        });

        const response = await fetch(
          buildSnagDownloadAllUrl(
            {
              projectId,
              columnFilters,
              searchTerm,
              selectedSearchField,
            },
            options
          )
        );
        await assertPdfResponse(response);

        // Local names are FALLBACKS — the server's Content-Disposition wins. The full
        // file keeps its pre-dialog name; the summary mirrors `_summary_filename`.
        const label = projectLabel || projectId;
        const fallbackName = isSummary
          ? buildSnagSummaryPdfFilename(label, new Date())
          : buildSnagPdfFilename(`ALL_${label}`, new Date());
        saveBlob(await response.blob(), filenameFromResponse(response, fallbackName));

        toast({
          title: "Success",
          description: isSummary
            ? "The snag summary was downloaded."
            : "Every batch was downloaded as one PDF.",
          variant: "success",
        });
        return true;
      } catch (error) {
        console.error("Snag list download-all error:", error);
        toast({
          title: "Error",
          description:
            error instanceof Error ? error.message : "Failed to download the snag lists.",
          variant: "destructive",
        });
        return false;
      } finally {
        setIsDownloading(false);
      }
    },
    [projectId, columnFilters, searchTerm, selectedSearchField, projectLabel]
  );

  return { isDownloading, download };
}
