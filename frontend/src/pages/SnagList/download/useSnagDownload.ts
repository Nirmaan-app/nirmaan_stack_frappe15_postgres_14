// frontend/src/pages/SnagList/download/useSnagDownload.ts
//
// The Download button's whole job: current view -> params -> a background job -> saved file.
// The tab's own facets and search box ARE the picker; the button's small dialog
// (`components/SnagDownloadDialog`) adds what the toolbar has no equivalent for --
// the report type (Full report / Summary only) and "Include Not Applicable", a box
// that can only NARROW the list's Status filter, never widen it.
//
// "Download All" has its own dialog (`components/SnagDownloadAllDialog`): report type
// plus the same N/A box, resolved by the same `resolveDownloadAllStatuses`.
//
// BOTH ARE BUILT IN A BACKGROUND JOB (`SNAG_PDF_ENDPOINTS`): a big project's PDF outlasted
// the web request. The job is queued, its status asked every few seconds (shown in the
// "Generating PDF..." toast), and the finished file collected once it is ready.

import { useCallback, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";

import { toast } from "@/components/ui/use-toast";
import { getFrappeError } from "@/utils/frappeErrors";

import { filenameFromResponse } from "../import/templateDownload";

import { SNAG_PDF_ENDPOINTS } from "./snagDownloadConstants";
import {
  buildSnagDownloadAllParams,
  buildSnagDownloadParams,
  buildSnagPdfFilename,
  buildSnagSummaryPdfFilename,
  listStatusFilter,
  resolveDownloadAllStatuses,
  SnagDownloadAllOptions,
  SnagDownloadOptions,
  SnagDownloadState,
} from "./snagDownloadParams";

/** How often the job's status is asked. */
const POLL_MS = 2000;
/** Longer than the server's job timeout (25 min) plus a wait in the queue. */
const GIVE_UP_MS = 35 * 60 * 1000;

/** `get_snag_pdf_status`'s answer. `done` / `total` count renders. */
interface SnagPdfStatus {
  state: "queued" | "running" | "ready" | "failed";
  done: number;
  total: number;
  message?: string | null;
}

/**
 * Frappe answers a failed request with a JSON body, not the file. Without this check a
 * server-side error downloads as a .pdf the user cannot open, and the real message
 * never reaches them.
 */
async function assertPdfResponse(response: Response): Promise<void> {
  if (response.ok && !response.headers.get("content-type")?.includes("json")) {
    return;
  }
  throw new Error(await serverMessage(response, `PDF download failed (${response.status}).`));
}

/** The message in a Frappe error body, or `fallback`. */
async function serverMessage(response: Response, fallback: string): Promise<string> {
  try {
    return getFrappeError(await response.json()) || fallback;
  } catch {
    return fallback; // Body was not JSON after all.
  }
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** What the "Generating PDF..." toast says while the job runs. */
function progressText(status: SnagPdfStatus): string {
  if (status.state === "queued") return "Waiting for the server to start on it...";
  if (status.total > 1) return `Built ${status.done} of ${status.total} sections...`;
  return "Building the PDF...";
}

/**
 * Queue a Snag List PDF, wait for it, and return the finished file's response.
 * Throws an Error carrying the server's own message on any failure.
 */
function useSnagPdfJob() {
  const { call: enqueue } = useFrappePostCall<{ message: { request_id: string } }>(
    SNAG_PDF_ENDPOINTS.enqueue
  );

  return useCallback(
    async (
      params: Record<string, string>,
      onProgress: (status: SnagPdfStatus) => void
    ): Promise<Response> => {
      let requestId: string;
      try {
        requestId = (await enqueue(params)).message.request_id;
      } catch (e) {
        throw new Error(getFrappeError(e));
      }
      const query = `request_id=${encodeURIComponent(requestId)}`;

      const giveUpAt = Date.now() + GIVE_UP_MS;
      for (;;) {
        await sleep(POLL_MS);
        const response = await fetch(`/api/method/${SNAG_PDF_ENDPOINTS.status}?${query}`);
        if (!response.ok) {
          throw new Error(await serverMessage(response, "Lost track of the PDF. Try again."));
        }
        const status: SnagPdfStatus = (await response.json()).message;
        if (status.state === "failed") {
          throw new Error(status.message || "The PDF could not be generated.");
        }
        if (status.state === "ready") break;
        onProgress(status);
        if (Date.now() > giveUpAt) {
          throw new Error("The PDF is taking too long. Please try again later.");
        }
      }

      const file = await fetch(`/api/method/${SNAG_PDF_ENDPOINTS.fetch}?${query}`);
      await assertPdfResponse(file);
      return file;
    },
    [enqueue]
  );
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
  const runJob = useSnagPdfJob();

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
      const pending = toast({
        title: "Generating PDF...",
        // Stays up until the result toast replaces it: a job can take minutes, and the
        // default 5 s would hide the progress below.
        duration: Infinity,
        description: isSummary
          ? "Please wait while we generate the snag summary."
          : "Please wait while we generate the snag list.",
      });

      const response = await runJob(
        buildSnagDownloadParams(
          { projectId, columnFilters, searchTerm, selectedSearchField, batch },
          options
        ),
        (status) =>
          pending.update({ id: pending.id, title: "Generating PDF...", description: progressText(status) })
      );

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
  }, [projectId, columnFilters, searchTerm, selectedSearchField, batch, projectLabel, runJob]);

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
 * different documents (`SNAG_PDF_KIND`), and the button that fires this one is shown
 * under a different condition (more than one batch). Sharing the job/blob plumbing
 * while keeping the two callers apart is what stops a later "just pass a boolean" from
 * making one control quietly do the other's job.
 *
 * The saved file is named by the SERVER (via Content-Disposition), because it is the
 * side that knows how many batches went in — the local name is only a fallback.
 */
export function useSnagDownloadAll(
  state: SnagDownloadState & { projectLabel?: string }
): UseSnagDownloadAllResult {
  const [isDownloading, setIsDownloading] = useState(false);
  const runJob = useSnagPdfJob();

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
        const pending = toast({
          title: "Generating PDF...",
          duration: Infinity, // until the result replaces it -- see `useSnagDownload`
          description: isSummary
            ? "Building the master summary."
            : "Building the master summary and one report per batch, then merging them.",
        });

        const response = await runJob(
          buildSnagDownloadAllParams(
            { projectId, columnFilters, searchTerm, selectedSearchField },
            options
          ),
          (status) =>
            pending.update({ id: pending.id, title: "Generating PDF...", description: progressText(status) })
        );

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
    [projectId, columnFilters, searchTerm, selectedSearchField, projectLabel, runJob]
  );

  return { isDownloading, download };
}
