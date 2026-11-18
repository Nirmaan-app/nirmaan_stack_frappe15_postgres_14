// Handover PDFs built on the server's `long` queue (`api/hod/binder.py`): the whole BINDER of a system, or the
// CONTENT of one document (the actual Commission reports / TDS sheets / snag list, not the list page).
// A build is a background operation (ADR 0047, #1663): this tab follows its own build's status record through
// the shared hook, so a build waiting in the queue shows as waiting, it gives up only at its time limit counted
// from when it starts running, and a reload or a tab change picks it up again. The finished PDF is collected by
// operation id, and only by the user who started it.
//
// A build always SAVES its PDF. Showing it in the preview dialog instead was tried on 2026-09-25 and
// REVERTED the same day: `start_binder` refuses a document that is not Done (`build_plan`), and
// Preview is exactly what you want BEFORE answering, so it threw on every unanswered row.

import { useCallback } from "react";

import { toast } from "@/components/ui/use-toast";
import { collectResultFile, useBackgroundOperation } from "@/hooks/useBackgroundOperation";
import { parseResultFile } from "@/utils/backgroundOps/operationFollower";
import { binderBuildOf, type HodJob } from "@/utils/hodBinderBuild";

import { HOD_METHODS } from "./hodApi";
import { saveUrlAs } from "./hodDownloads";

export type { BinderProgress, HodJob } from "@/utils/hodBinderBuild";

const failedParts = (result: unknown): string[] =>
  typeof result === "object" && result !== null && "failed" in result && Array.isArray(result.failed)
    ? result.failed.map(String)
    : [];

async function savePdf(result: unknown, _context: unknown, opId: string) {
  try {
    const blob = await collectResultFile(opId);
    const blobUrl = window.URL.createObjectURL(blob);
    saveUrlAs(blobUrl, parseResultFile(result)?.filename ?? "Handover.pdf");
    window.URL.revokeObjectURL(blobUrl);
  } catch (error) {
    toast({
      title: "Download failed",
      description: error instanceof Error ? error.message : "Could not download the PDF.",
      variant: "destructive",
    });
    return;
  }
  const failed = failedParts(result);
  toast(
    failed.length
      ? {
          title: "Downloaded with gaps",
          description: `Could not include: ${failed.slice(0, 4).join(", ")}${failed.length > 4 ? ` and ${failed.length - 4} more` : ""}.`,
          variant: "destructive",
        }
      : { title: "Ready", description: "Your PDF is downloading.", variant: "success" },
  );
}

export function useHodBinder() {
  const op = useBackgroundOperation({
    storageKey: "hod_binder",
    onFinished: savePdf,
    onFailed: (ended) =>
      toast({
        title: ended.phase === "lost" ? "Download stopped" : "Download failed",
        description: ended.error,
        variant: "destructive",
      }),
  });
  const building = binderBuildOf(op.view, op.context);
  const job = building?.job ?? null;
  const { start } = op;

  /** Build the binder of `hodSystem`, or — with `document` — that document's content. */
  const build = useCallback(
    async (project: string, hodSystem: string, title: string, document: string | null = null) => {
      if (job) return;
      const context: HodJob = { hodSystem, document, title };
      await start(HOD_METHODS.startBinder, { project, hod_system: hodSystem, document }, context);
    },
    [job, start],
  );

  return { build, job, progress: building?.progress ?? null };
}
