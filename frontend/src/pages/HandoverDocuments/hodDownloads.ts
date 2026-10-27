// PDF downloads for the Handover Documents tab: Frappe's own print-to-PDF endpoint, or ours where a
// PDF needs work after the render (`api/hod/document_pdf.py`); the merged binder is a background job
// (see useHodBinder).

import { useCallback, useState } from "react";

import { toast } from "@/components/ui/use-toast";
import { getFrappeError } from "@/utils/frappeErrors";

import { HOD_PRINT_CHECKLIST } from "./hodApi";

const DOWNLOAD_PDF_ENDPOINT =
  "/api/method/frappe.utils.print_format.download_pdf";

/** One handover document as a PDF — served by OUR endpoint, not Frappe's `download_pdf`.
 *  The O&M Manual's page box has to be stamped on AFTER the render (see `api/hod/page_frame.py`), and
 *  `download_pdf` gives nowhere to do that. Same print format, same row; a document needing no box comes
 *  back exactly as it did before. */
export const hodDocumentPdfUrl = (rowName: string): string =>
  `/api/method/nirmaan_stack.api.hod.document_pdf.document_pdf?${new URLSearchParams({
    name: rowName,
  })}`;

/** The checklist is printed off the PROJECT; `hod_system` picks the system (read by the format). */
export const hodChecklistPdfUrl = (
  projectId: string,
  hodSystem: string,
): string =>
  `${DOWNLOAD_PDF_ENDPOINT}?${new URLSearchParams({
    doctype: "Projects",
    name: projectId,
    format: HOD_PRINT_CHECKLIST,
    no_letterhead: "1",
    hod_system: hodSystem,
  })}`;

/** A filled Commission Report task as PDF — the Commission screens' own URL (the format reads `task_row`). */
export const commissionReportPdfUrl = (
  parent: string,
  taskRow: string,
  printFormat: string,
): string =>
  `${DOWNLOAD_PDF_ENDPOINT}?${new URLSearchParams({
    doctype: "Project Commission Report",
    name: parent,
    format: printFormat,
    task_row: taskRow,
    letterhead: "No Letterhead",
  })}`;

/** One snag batch printed with the Snag List's own format — served by OUR endpoint, not Frappe's
 *  `download_pdf`, which turns the photo jump links (thumbnail → photo → back to its row) into links to
 *  the website. The WHOLE list, open snags included (owner 2026-09-25) — what the binder prints too, so
 *  the preview and the binder show the same list. */
export const snagBatchPdfUrl = (projectId: string, batch: string): string =>
  `/api/method/nirmaan_stack.api.hod.document_pdf.snag_batch_pdf?${new URLSearchParams({
    project: projectId,
    batch,
  })}`;

export const hodPdfFilename = (...parts: string[]): string =>
  `${parts
    .filter(Boolean)
    .join("_")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")}.pdf`;

/**
 * Frappe answers a failed print with a JSON body, not a PDF. Without this check a server-side error
 * downloads as a .pdf nobody can open and the real message never reaches the user.
 */
async function assertPdfResponse(response: Response): Promise<void> {
  if (response.ok && !response.headers.get("content-type")?.includes("json"))
    return;
  let message = `PDF generation failed (${response.status}).`;
  try {
    message = getFrappeError(await response.json());
  } catch {
    // Body was not JSON after all — keep the status-code message.
  }
  throw new Error(message);
}

export function saveUrlAs(url: string, filename: string): void {
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/** Fetch a print URL as a PDF and save it. `busyKey` lets one hook serve every row's button. */
export function usePdfDownload() {
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const download = useCallback(
    async (key: string, url: string, filename: string) => {
      setBusyKey(key);
      try {
        const response = await fetch(url);
        await assertPdfResponse(response);
        const blobUrl = window.URL.createObjectURL(await response.blob());
        saveUrlAs(blobUrl, filename);
        window.URL.revokeObjectURL(blobUrl);
      } catch (error) {
        toast({
          title: "Download failed",
          description:
            error instanceof Error
              ? error.message
              : "Could not generate the PDF.",
          variant: "destructive",
        });
      } finally {
        setBusyKey(null);
      }
    },
    [],
  );

  return { busyKey, download };
}
