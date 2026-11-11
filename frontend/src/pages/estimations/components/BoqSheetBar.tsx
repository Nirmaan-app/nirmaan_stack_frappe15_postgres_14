import React from "react";

import type { EstimateBoqSummary } from "@/utils/estimations/estimateTypes";

interface BoqSheetBarProps {
  boqs: EstimateBoqSummary[];
  boq: EstimateBoqSummary;
  sheetName: string | null;
  onBoq: (boq: string) => void;
  /** `null` = "All sheets", offered only when `allowAll`. */
  onSheet: (sheetName: string | null) => void;
  allowAll?: boolean;
  showCounts?: boolean;
}

/** The BOQ picker (when the project has more than one Selected BOQ) and the sheet strip with "estimated/line items". */
export const BoqSheetBar: React.FC<BoqSheetBarProps> = ({ boqs, boq, sheetName, onBoq, onSheet, allowAll, showCounts = true }) => {
  const chip = (active: boolean) =>
    `px-2.5 py-1 text-xs sm:text-sm rounded whitespace-nowrap transition-colors ${
      active ? "bg-white text-foreground shadow-sm font-semibold" : "text-muted-foreground hover:text-foreground"
    }`;
  return (
    <div className="flex flex-col gap-2">
      {boqs.length > 1 && (
        <label className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-xs font-semibold text-muted-foreground">BOQ</span>
          <select
            className="rounded border bg-background px-2 py-1 text-sm" value={boq.name}
            onChange={(e) => onBoq(e.target.value)}
          >
            {boqs.map((b) => <option key={b.name} value={b.name}>{b.boq_name} · {b.name}</option>)}
          </select>
        </label>
      )}
      <div className="overflow-x-auto">
        <div className="flex w-max gap-1 rounded-md bg-muted p-1" role="tablist" aria-label="Sheets">
          {allowAll && (
            <button type="button" role="tab" aria-selected={sheetName == null} className={chip(sheetName == null)} onClick={() => onSheet(null)}>
              All sheets
            </button>
          )}
          {boq.sheets.map((s) => (
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
