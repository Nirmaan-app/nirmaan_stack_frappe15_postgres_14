// The TDS report as the handover takes it: the SAME server operation the TDS Repository tab runs
// (`api/tds/tds_report.start_tds_export`), so a data sheet pack downloaded from Handover Documents is the same
// document, with the same cover page, as one downloaded from the TDS tab.
//
// A background operation (ADR 0047, #1663): this tab follows its own export's status record through the shared
// hook, so two exports never swap PDFs, a dropped socket still ends in the PDF, and a reload picks it up again.
// The finished PDF is collected by operation id, and only by the user who started it.
//
// It is a separate hook from the TDS tab's own handler on purpose: that one also drives the tab's
// progress dialog. A non-Admin who ticked Pending gets the PDF as a preview (`preview`), never a download
// (`isPdfPreviewOnly`, the same rule as the TDS tab).

import { useCallback, useState } from "react";

import { toast } from "@/components/ui/use-toast";
import { collectResultFile, useBackgroundOperation } from "@/hooks/useBackgroundOperation";
import { toExportSettingsPayload } from "@/pages/projects/data/tds/tdsSettings";
import type { TDSRepositoryData } from "@/pages/projects/TDSRepository/components/SetupTDSRepositoryDialog";
import { parseResultFile } from "@/utils/backgroundOps/operationFollower";
import { formatDate } from "@/utils/FormatDate";

import { saveUrlAs } from "./hodDownloads";

const START_METHOD = "nirmaan_stack.api.tds.tds_report.start_tds_export";

/** A generated PDF held in memory for the in-app preview, never saved. */
export interface HodTdsPreview {
  blobUrl: string;
  filename: string;
  sizeBytes: number;
}

/** What `exportTds` gives the operation, kept across a reload. */
interface ExportContext {
  previewOnly: boolean;
  fallbackName: string;
}

const parseContext = (context: unknown): ExportContext => {
  const value = typeof context === "object" && context !== null ? (context as Record<string, unknown>) : {};
  return {
    previewOnly: value.previewOnly === true,
    fallbackName: typeof value.fallbackName === "string" ? value.fallbackName : "TDS_Report.pdf",
  };
};

const failedItems = (result: unknown): string[] =>
  typeof result === "object" && result !== null && "failed_items" in result && Array.isArray(result.failed_items)
    ? result.failed_items.map(String)
    : [];

export function useHodTdsExport(projectId: string, projectName: string) {
  const [isDelivering, setIsDelivering] = useState(false);
  const [preview, setPreview] = useState<HodTdsPreview | null>(null);

  const deliver = useCallback(async (result: unknown, context: unknown, opId: string) => {
    const { previewOnly, fallbackName } = parseContext(context);
    const name = parseResultFile(result)?.filename || fallbackName;
    setIsDelivering(true);
    try {
      const blob = await collectResultFile(opId);
      const blobUrl = window.URL.createObjectURL(blob);
      if (previewOnly) {
        setPreview((prev) => {
          if (prev) window.URL.revokeObjectURL(prev.blobUrl);
          return { blobUrl, filename: name, sizeBytes: blob.size };
        });
      } else {
        saveUrlAs(blobUrl, name);
        window.URL.revokeObjectURL(blobUrl);
      }
      const failed = failedItems(result);
      toast(
        failed.length
          ? {
              title: previewOnly ? "Ready with gaps" : "Downloaded with gaps",
              description: `Could not include: ${failed.slice(0, 4).join(", ")}${failed.length > 4 ? ` and ${failed.length - 4} more` : ""}.`,
              variant: "destructive",
            }
          : {
              title: "Ready",
              description: previewOnly ? "Your PDF preview is open." : "Your PDF is downloading.",
              variant: "success",
            },
      );
    } catch (error) {
      toast({
        title: "Download failed",
        description: error instanceof Error ? error.message : "Could not download the report.",
        variant: "destructive",
      });
    } finally {
      setIsDelivering(false);
    }
  }, []);

  const op = useBackgroundOperation({
    storageKey: `hod_tds_export:${projectId}`,
    onFinished: deliver,
    onFailed: (ended) =>
      toast({
        title: ended.phase === "lost" ? "Export stopped" : "Export failed",
        description: ended.error,
        variant: "destructive",
      }),
  });
  const isExporting = isDelivering || ["starting", "queued", "running"].includes(op.view.phase);
  const { start } = op;

  const closePreview = useCallback(() => {
    setPreview((prev) => {
      if (prev) window.URL.revokeObjectURL(prev.blobUrl);
      return null;
    });
  }, []);

  const exportTds = useCallback(
    async (
      settings: TDSRepositoryData,
      items: unknown[],
      label: string,
      { previewOnly }: { previewOnly: boolean },
    ) => {
      if (isExporting) return;
      const context: ExportContext = {
        previewOnly,
        fallbackName: `${(projectName || projectId).replace(/[^a-zA-Z0-9-_]/g, "_")}_${label}_${formatDate(new Date())}.pdf`,
      };
      await start(
        START_METHOD,
        {
          settings_json: JSON.stringify(toExportSettingsPayload(settings)),
          items_json: JSON.stringify(items),
          project_name: projectName,
        },
        context,
      );
    },
    [isExporting, projectId, projectName, start],
  );

  return { exportTds, isExporting, preview, closePreview };
}
