// The TDS report as the handover takes it: the SAME server job the TDS Repository tab runs
// (`api/tds/tds_report.export_tds_report` -> `tds_export_*` events -> a one-time token), so a data
// sheet pack downloaded from Handover Documents is the same document, with the same cover page, as
// one downloaded from the TDS tab.
//
// It is a separate hook from the TDS tab's own handler on purpose: that one also drives the tab's
// progress dialog. Same shape as `useHodBinder`. A non-Admin who ticked Pending gets the PDF as a
// preview (`preview`), never a download (`isPdfPreviewOnly`, the same rule as the TDS tab).

import { FrappeConfig, FrappeContext } from "frappe-react-sdk";
import { useCallback, useContext, useEffect, useRef, useState } from "react";

import { toast } from "@/components/ui/use-toast";
import { toExportSettingsPayload } from "@/pages/projects/data/tds/tdsSettings";
import type { TDSRepositoryData } from "@/pages/projects/TDSRepository/components/SetupTDSRepositoryDialog";
import { formatDate } from "@/utils/FormatDate";

import { saveUrlAs } from "./hodDownloads";

const EV_READY = "tds_export_ready";
const EV_FAILED = "tds_export_failed";

const ENQUEUE = "/api/method/nirmaan_stack.api.tds.tds_report.export_tds_report";
const FETCH_TEMP =
  "/api/method/nirmaan_stack.api.pdf_helper.bulk_download.fetch_temp_file";

const csrf = () => (window as any).csrf_token || "";

/** A generated PDF held in memory for the in-app preview, never saved. */
export interface HodTdsPreview {
  blobUrl: string;
  filename: string;
  sizeBytes: number;
}

export function useHodTdsExport(projectId: string, projectName: string) {
  const { socket } = useContext(FrappeContext) as FrappeConfig;
  const [isExporting, setIsExporting] = useState(false);
  const [preview, setPreview] = useState<HodTdsPreview | null>(null);
  // The listeners are bound for one run only; the ref lets the cleanup reach them from anywhere.
  const cleanupRef = useRef<(() => void) | null>(null);

  const finish = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    setIsExporting(false);
  }, []);

  useEffect(() => () => cleanupRef.current?.(), []);

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
      if (!socket) {
        toast({
          title: "Connection not ready",
          description: "Live connection unavailable. Please retry in a moment.",
          variant: "destructive",
        });
        return;
      }

      const fallbackName = `${(projectName || projectId).replace(/[^a-zA-Z0-9-_]/g, "_")}_${label}_${formatDate(new Date())}.pdf`;

      const onReady = async ({ token, filename, failed_items }: any) => {
        try {
          const name = filename || fallbackName;
          const response = await fetch(
            `${FETCH_TEMP}?token=${encodeURIComponent(token)}&filename=${encodeURIComponent(name)}`,
            { headers: { "X-Frappe-CSRF-Token": csrf() } },
          );
          if (!response.ok) throw new Error("Could not fetch the generated PDF.");
          const blob = await response.blob();
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
          const failed: string[] = failed_items ?? [];
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
        } catch (error: any) {
          toast({
            title: "Download failed",
            description: error?.message || "Could not download the report.",
            variant: "destructive",
          });
        } finally {
          finish();
        }
      };

      const onFailed = ({ message }: any) => {
        toast({
          title: "Export failed",
          description: message || "The PDF could not be built. Please try again.",
          variant: "destructive",
        });
        finish();
      };

      setIsExporting(true);
      socket.on(EV_READY, onReady);
      socket.on(EV_FAILED, onFailed);
      cleanupRef.current = () => {
        socket.off(EV_READY, onReady);
        socket.off(EV_FAILED, onFailed);
      };

      try {
        const response = await fetch(ENQUEUE, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Frappe-CSRF-Token": csrf(),
          },
          body: JSON.stringify({
            settings_json: JSON.stringify(toExportSettingsPayload(settings)),
            items_json: JSON.stringify(items),
            project_name: projectName,
          }),
        });
        if (!response.ok) throw new Error("Could not start the export.");
        toast({
          title: "Export queued",
          description: previewOnly
            ? "The preview opens on its own when it is ready."
            : "The PDF downloads on its own when it is ready.",
        });
      } catch (error: any) {
        toast({
          title: "Could not start the download",
          description: error?.message || "Please try again.",
          variant: "destructive",
        });
        finish();
      }
    },
    [socket, isExporting, projectId, projectName, finish],
  );

  return { exportTds, isExporting, preview, closePreview };
}
