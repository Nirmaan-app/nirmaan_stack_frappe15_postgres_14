/**
 * TEMPORARY dev harness for Slice 1a live-cert -- REMOVE in Slice 1b.
 *
 * Mounts SheetSearchView in isolation against a real BoQ + sheet so the searchable
 * sheet-view can be exercised in the browser on real data before it becomes
 * load-bearing inside Slice 1b's restructure modal. It is NOT linked from any real
 * UI. Removing this file + its route entry in routesConfig.tsx is a named task in the
 * Slice 1b prompt.
 *
 * Route: /upload-boq/_dev-sheetview/:boqId/:sheetName
 *   e.g. /upload-boq/_dev-sheetview/BOQ-26-00145/<encodeURIComponent(sheetName)>
 * React Router v6 auto-decodes useParams, so sheetName arrives verbatim.
 */
import { useParams } from "react-router-dom";
import { SheetSearchView } from "./SheetSearchView";

const DevSheetSearchHarness = () => {
  const { boqId, sheetName } = useParams<{ boqId: string; sheetName: string }>();

  if (!boqId || !sheetName) {
    return (
      <p className="p-6 text-sm text-destructive">
        Dev harness needs both :boqId and :sheetName in the URL.
      </p>
    );
  }

  return (
    <div className="flex-1 space-y-4 max-w-5xl mx-auto pt-6 pb-10 px-4">
      <div className="rounded-md border border-amber-400 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
        TEMPORARY Slice 1a dev harness &mdash; removed in Slice 1b. BoQ{" "}
        <span className="font-mono">{boqId}</span> &middot; sheet{" "}
        <span className="font-mono">&ldquo;{sheetName}&rdquo;</span>
      </div>
      <SheetSearchView boqName={boqId} sheetName={sheetName} />
    </div>
  );
};

export default DevSheetSearchHarness;
export { DevSheetSearchHarness as Component };
