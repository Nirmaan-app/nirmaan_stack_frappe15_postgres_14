// frontend/src/pages/ProjectDesignTracker/download/useDownloadReport.ts
//
// Owns everything the page used to hold inline: dialog open state, the seed a
// button opens the dialog with, and the fetch -> blob -> save round trip.
//
// The page imports this plus <DownloadReportDialog /> and nothing else.

import { useCallback, useState } from "react";

import { toast } from "@/components/ui/use-toast";

import { DOWNLOAD_PDF_ENDPOINT } from "./downloadConstants";
import { buildDownloadFilename, buildDownloadParams } from "./downloadSelection";
import type { DownloadOption, DownloadSeed, DownloadSelection } from "./downloadTypes";

interface UseDownloadReportArgs {
    /** `Project Design Tracker` docname. Downloads are a no-op until it resolves. */
    trackerId?: string;
    /** Used for the filename only. */
    projectName?: string;
}

/** The option lists the dialog resolved, needed to decide "is this axis fully selected". */
export interface DownloadAvailability {
    phases: DownloadOption[];
    zones: DownloadOption[];
    categories: DownloadOption[];
}

export interface UseDownloadReportResult {
    isOpen: boolean;
    setIsOpen: (open: boolean) => void;
    seed: DownloadSeed;
    isDownloading: boolean;
    /** What the Download buttons call -- opens the dialog pre-filled. */
    openDownloadDialog: (seed?: DownloadSeed) => void;
    /** What the dialog's Download button calls. */
    runDownload: (
        selection: DownloadSelection,
        available: DownloadAvailability,
    ) => Promise<void>;
}

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
        // Body was not JSON after all -- keep the status-code message.
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

export function useDownloadReport({
    trackerId,
    projectName,
}: UseDownloadReportArgs): UseDownloadReportResult {
    const [isOpen, setIsOpen] = useState(false);
    const [seed, setSeed] = useState<DownloadSeed>({});
    const [isDownloading, setIsDownloading] = useState(false);

    const openDownloadDialog = useCallback((nextSeed: DownloadSeed = {}) => {
        setSeed(nextSeed);
        setIsOpen(true);
    }, []);

    const runDownload = useCallback(
        async (selection: DownloadSelection, available: DownloadAvailability) => {
            if (!trackerId) return;

            setIsDownloading(true);
            try {
                toast({
                    title: "Generating PDF...",
                    description: "Please wait while we generate your report.",
                });

                const params = buildDownloadParams(trackerId, selection, available);
                const response = await fetch(
                    `${DOWNLOAD_PDF_ENDPOINT}?${params.toString()}`,
                );
                await assertPdfResponse(response);

                saveBlob(
                    await response.blob(),
                    buildDownloadFilename(
                        projectName || "Project",
                        selection,
                        available,
                        new Date(),
                    ),
                );

                toast({
                    title: "Success",
                    description: "Report downloaded successfully.",
                    variant: "success",
                });
                setIsOpen(false);
            } catch (error) {
                console.error("Design Tracker download error:", error);
                toast({
                    title: "Error",
                    description:
                        error instanceof Error ? error.message : "Failed to download PDF.",
                    variant: "destructive",
                });
            } finally {
                setIsDownloading(false);
            }
        },
        [trackerId, projectName],
    );

    return {
        isOpen,
        setIsOpen,
        seed,
        isDownloading,
        openDownloadDialog,
        runDownload,
    };
}
