// Handover PDFs built on the server's `long` queue (`api/hod/binder.py`): the whole BINDER of a system, or the
// CONTENT of one document (the actual Commission reports / TDS sheets / snag list, not the list page).
// A build is a background operation (ADR 0047, #1663): this tab follows its own builds' status records through
// the shared hook, the binder and one document's content each on its own (#1671, so a binder waiting in the queue
// never holds back a document's download). A build waiting in the queue shows as waiting, it gives up only at its
// time limit counted from when it starts running, and a reload or a tab change picks it up again. The finished PDF is collected by
// operation id, and only by the user who started it.
//
// A build always SAVES its PDF. Showing it in the preview dialog instead was tried on 2026-09-25 and
// REVERTED the same day: `start_binder` refuses a document that is not Done (`build_plan`), and
// Preview is exactly what you want BEFORE answering, so it threw on every unanswered row.

import { useCallback } from "react";

import { toast } from "@/components/ui/use-toast";
import { collectResultFile, useBackgroundOperation } from "@/hooks/useBackgroundOperation";
import type { OpView } from "@/utils/backgroundOps/operationFollower";
import { parseResultFile } from "@/utils/backgroundOps/operationFollower";
import { binderBuildOf, type HodBuilds, type HodJob } from "@/utils/hodBinderBuild";
import { saveBlobAs } from "@/utils/saveUrlAs";

import { HOD_METHODS } from "./hodApi";

export type { BinderProgress, HodBuilds, HodJob } from "@/utils/hodBinderBuild";

const failedParts = (result: unknown): string[] =>
  typeof result === "object" && result !== null && "failed" in result && Array.isArray(result.failed)
    ? result.failed.map(String)
    : [];

async function savePdf(result: unknown, _context: unknown, opId: string) {
  try {
    saveBlobAs(await collectResultFile(opId), parseResultFile(result)?.filename ?? "Handover.pdf");
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

function onFailed(ended: Extract<OpView, { phase: "failed" | "lost" }>) {
  toast({
    title: ended.phase === "lost" ? "Download stopped" : "Download failed",
    description: ended.error,
    variant: "destructive",
  });
}

export function useHodBinder() {
  const binderOp = useBackgroundOperation({ storageKey: "hod_binder", onFinished: savePdf, onFailed });
  const documentOp = useBackgroundOperation({ storageKey: "hod_document", onFinished: savePdf, onFailed });
  const binder = binderBuildOf(binderOp.view, binderOp.context);
  const builds: HodBuilds = {
    binder: binder?.job ?? null,
    document: binderBuildOf(documentOp.view, documentOp.context)?.job ?? null,
  };
  const startBinder = binderOp.start;
  const startDocument = documentOp.start;
  const binderBusy = builds.binder !== null;
  const documentBusy = builds.document !== null;

  /** Build the binder of `hodSystem`, or — with `document` — that document's content. */
  const build = useCallback(
    async (project: string, hodSystem: string, title: string, document: string | null = null) => {
      const [busy, start] = document ? [documentBusy, startDocument] : [binderBusy, startBinder];
      if (busy) return;
      const context: HodJob = { hodSystem, document, title };
      await start(HOD_METHODS.startBinder, { project, hod_system: hodSystem, document }, context);
    },
    [binderBusy, documentBusy, startBinder, startDocument],
  );

  return { build, builds, binderProgress: binder?.progress ?? null };
}
