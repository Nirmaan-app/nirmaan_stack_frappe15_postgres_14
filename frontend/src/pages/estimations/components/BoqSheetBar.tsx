import React from "react";

import { EST_ALL_BOQS } from "@/utils/estimations/estTabs";
import type { EstimateBoqSummary } from "@/utils/estimations/estimateTypes";

interface BoqSheetBarProps {
  boqs: EstimateBoqSummary[];
  /** The open BOQ; `null` only with `allowAllBoqs`, meaning "All BOQs". */
  boq: EstimateBoqSummary | null;
  sheetName: string | null;
  onBoq: (boq: string) => void;
  /** `null` = "All sheets", offered only when `allowAll`. */
  onSheet: (sheetName: string | null) => void;
  allowAll?: boolean;
  /** Offer "All BOQs" first in the BOQ picker (Estimate Items, owner 17 Nov); the sheet strip is then just "All sheets". */
  allowAllBoqs?: boolean;
  showCounts?: boolean;
}

/** The BOQ picker (when the project has more than one Selected BOQ) and the sheet strip with "estimated/line items". */
export const BoqSheetBar: React.FC<BoqSheetBarProps> = ({
  boqs, boq, sheetName, onBoq, onSheet, allowAll, allowAllBoqs, showCounts = true,
}) => {
  const chip = (active: boolean) =>
    `px-2.5 py-1 text-xs sm:text-sm rounded whitespace-nowrap transition-colors ${
      active ? "bg-white text-foreground shadow-sm font-semibold" : "text-muted-foreground hover:text-foreground"
    }`;
  const allSheets = allowAll && (
    <button type="button" role="tab" aria-selected={!boq || sheetName == null} className={chip(!boq || sheetName == null)} onClick={() => onSheet(null)}>
      All sheets
    </button>
  );
  return (
    <div className="flex flex-col gap-2">
      {boqs.length > 1 && (
        <label className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-xs font-semibold text-muted-foreground">BOQ</span>
          <select
            className="rounded border bg-background px-2 py-1 text-sm" value={boq?.name ?? EST_ALL_BOQS}
            onChange={(e) => onBoq(e.target.value)}
          >
            {allowAllBoqs && <option value={EST_ALL_BOQS}>All BOQs ({boqs.length})</option>}
            {boqs.map((b) => <option key={b.name} value={b.name}>{b.boq_name} · {b.name}</option>)}
          </select>
          {allowAllBoqs && !boq && <span className="text-xs text-muted-foreground">Every BOQ and every sheet of the project</span>}
        </label>
      )}
      <div className="overflow-x-auto">
        <div className="flex w-max gap-1 rounded-md bg-muted p-1" role="tablist" aria-label="Sheets">
          {allSheets}
          {boq?.sheets.map((s) => (
            <button
              key={s.name} type="button" role="tab" aria-selected={sheetName === s.sheet_name}
              className={chip(sheetName === s.sheet_name)} onClick={() => onSheet(s.sheet_name)}
            >
              {s.sheet_name}
              {showCounts && <span className="ml-1.5 font-mono text-[11px] text-amber-700">{s.estimated}/{s.line_items}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
