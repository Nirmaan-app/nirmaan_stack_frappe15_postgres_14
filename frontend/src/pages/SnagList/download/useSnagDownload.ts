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
// BOTH ARE BUILT IN A BACKGROUND OPERATION (`SNAG_PDF_START`, ADR 0047): a big project's PDF outlasted
// the web request. The shared `useBackgroundOperation` hook follows its status record (shown in the
// "Generating PDF..." toast, queued apart from building), and the finished file is collected by operation
// id, which only the user who started it may do. A reload picks the download up again and saves its file.

import { useCallback, useEffect, useRef } from "react";

import { toast } from "@/components/ui/use-toast";
import { collectResultFile, useBackgroundOperation } from "@/hooks/useBackgroundOperation";
import { parseResultFile } from "@/utils/backgroundOps/operationFollower";

import { SNAG_PDF_START } from "./snagDownloadConstants";
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
import { snagPdfContextOf, snagPdfProgressText, type SnagPdfContext } from "./snagPdfOperation";

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

/** What one of the two downloads does with its finished operation. */
interface SnagPdfFlow {
  /** The saved file's name: `serverName` is what the server named it (`snag_pdf_op`), when it said. */
  filename: (context: SnagPdfContext, serverName: string | null) => string;
  successText: (context: SnagPdfContext) => string;
  /** Logged with a failure, so the two downloads stay told apart in the console. */
  logLabel: string;
  failureText: string;
}

/**
 * Start a Snag List PDF, follow it through the shared hook, and save its file. `run` resolves `true` once the
 * file is saved and `false` on any failure (already toasted); it never rejects.
 */
function useSnagPdfOperation(storageKey: string, flow: SnagPdfFlow) {
  const pendingRef = useRef<((saved: boolean) => void) | null>(null);
  const toastRef = useRef<ReturnType<typeof toast> | null>(null);
  const flowRef = useRef(flow);
  flowRef.current = flow;

  const settle = (saved: boolean) => {
    toastRef.current = null;
    pendingRef.current?.(saved);
    pendingRef.current = null;
  };
  const fail = (message: string, error?: unknown) => {
    console.error(flowRef.current.logLabel, error ?? message);
    // The result toast replaces the "Generating PDF..." one (one toast at a time).
    toast({ title: "Error", description: message, variant: "destructive" });
    settle(false);
  };

  const op = useBackgroundOperation({
    storageKey,
    onFinished: async (result, rawContext, opId) => {
      const context = snagPdfContextOf(rawContext) ?? { label: "Snag_List", isSummary: false };
      try {
        const blob = await collectResultFile(opId);
        saveBlob(blob, flowRef.current.filename(context, parseResultFile(result)?.filename ?? null));
      } catch (error) {
        fail(error instanceof Error ? error.message : flowRef.current.failureText, error);
        return;
      }
      toast({ title: "Success", description: flowRef.current.successText(context), variant: "success" });
      settle(true);
    },
    onFailed: (ended) => fail(ended.error),
  });

  const { view, start } = op;
  const isDownloading = view.phase === "starting" || view.phase === "queued" || view.phase === "running";

  // The toast says where the operation stands; a reload that picked one up shows it again.
  useEffect(() => {
    if (view.phase !== "queued" && view.phase !== "running") return;
    const description = snagPdfProgressText(view);
    if (toastRef.current) {
      toastRef.current.update({ id: toastRef.current.id, title: "Generating PDF...", description });
    } else {
      // Stays up until the result toast replaces it: an operation can take minutes.
      toastRef.current = toast({ title: "Generating PDF...", duration: Infinity, description });
    }
  }, [view]);

  const run = useCallback(
    (params: Record<string, string>, context: SnagPdfContext, startText: string): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        pendingRef.current = resolve;
        toastRef.current = toast({ title: "Generating PDF...", duration: Infinity, description: startText });
        void start(SNAG_PDF_START, params, context);
      }),
    [start]
  );

  return { isDownloading, run };
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
  const { isDownloading, run } = useSnagPdfOperation(`snag_pdf:tab:${state.projectId ?? ""}`, {
    filename: ({ label, isSummary }) =>
      isSummary ? buildSnagSummaryPdfFilename(label, new Date()) : buildSnagPdfFilename(label, new Date()),
    successText: ({ isSummary }) =>
      isSummary ? "Snag summary downloaded successfully." : "Snag list downloaded successfully.",
    logLabel: "Snag list download error:",
    failureText: "Failed to download the snag list.",
  });

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
    return run(
      buildSnagDownloadParams(
        { projectId, columnFilters, searchTerm, selectedSearchField, batch },
        options
      ),
      { label: projectLabel || projectId, isSummary },
      isSummary
        ? "Please wait while we generate the snag summary."
        : "Please wait while we generate the snag list."
    );
  }, [projectId, columnFilters, searchTerm, selectedSearchField, batch, projectLabel, run]);

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
 * under a different condition (more than one batch). Each follows its own operation. Sharing the
 * operation/blob plumbing
 * while keeping the two callers apart is what stops a later "just pass a boolean" from
 * making one control quietly do the other's job.
 *
 * The saved file is named by the SERVER (the operation's finished file), because it is the
 * side that knows how many batches went in — the local name is only a fallback.
 */
export function useSnagDownloadAll(
  state: SnagDownloadState & { projectLabel?: string }
): UseSnagDownloadAllResult {
  // Local names are FALLBACKS -- the server's name wins. The full file keeps its pre-dialog name; the summary
  // mirrors `_summary_filename`.
  const { isDownloading, run } = useSnagPdfOperation(`snag_pdf:all:${state.projectId ?? ""}`, {
    filename: ({ label, isSummary }, serverName) =>
      serverName ??
      (isSummary
        ? buildSnagSummaryPdfFilename(label, new Date())
        : buildSnagPdfFilename(`ALL_${label}`, new Date())),
    successText: ({ isSummary }) =>
      isSummary ? "The snag summary was downloaded." : "Every batch was downloaded as one PDF.",
    logLabel: "Snag list download-all error:",
    failureText: "Failed to download the snag lists.",
  });

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

      return run(
        buildSnagDownloadAllParams(
          { projectId, columnFilters, searchTerm, selectedSearchField },
          options
        ),
        { label: projectLabel || projectId, isSummary },
        isSummary
          ? "Building the master summary."
          : "Building the master summary and one report per batch, then merging them."
      );
    },
    [projectId, columnFilters, searchTerm, selectedSearchField, projectLabel, run]
  );

  return { isDownloading, download };
}
