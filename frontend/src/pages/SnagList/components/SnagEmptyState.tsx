import * as React from "react";
import { ClipboardList, Download, FileUp, Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useSnagTemplateDownload } from "../import/templateDownload";

export interface SnagEmptyStateProps {
  /** Withheld when the actor may not import — the panel then just explains. */
  onImport?: () => void;
  /** Withheld when the actor may not add a manual snag. */
  onAddManual?: () => void;
}

/**
 * Shown when the project has no snags AND no batches. Primary action is the
 * import dialog — a snag list normally arrives as the consultant's workbook.
 */
export const SnagEmptyState: React.FC<SnagEmptyStateProps> = ({
  onImport,
  onAddManual,
}) => {
  const { isDownloading: templateDownloading, download: downloadTemplate } =
    useSnagTemplateDownload();

  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50/60 px-6 py-14 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-white shadow-sm">
        <ClipboardList className="h-7 w-7 text-gray-400" />
      </div>
      <h3 className="text-base font-semibold text-gray-900">
        No snags on this project yet
      </h3>
      <p className="mt-1 max-w-md text-sm text-gray-500">
        {onImport
          ? "Import the consultant's snag workbook to start tracking defects to closure. You pick the sheets and confirm the columns before anything is saved."
          : "Nothing has been imported for this project yet. Ask an Admin, Project Lead or PMO to import the snag list."}
      </p>
      {(onImport || onAddManual) && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {onImport && (
            <Button onClick={onImport}>
              <FileUp className="mr-2 h-4 w-4" />
              Import snag list
            </Button>
          )}
          {onAddManual && (
            <Button variant="outline" onClick={onAddManual}>
              <Plus className="mr-2 h-4 w-4" />
              Add a snag manually
            </Button>
          )}
          {/* The template is what a consultant fills in, so it belongs beside the
              action that brings one back -- shown to importers only. */}
          {onImport && (
            <Button
              variant="outline"
              disabled={templateDownloading}
              onClick={() => void downloadTemplate()}
            >
              {templateDownloading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              Download template
            </Button>
          )}
        </div>
      )}
    </div>
  );
};
