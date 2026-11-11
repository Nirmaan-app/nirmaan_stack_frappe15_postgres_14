import React, { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { canEditEstimates } from "@/constants/roles";
import { useUserData } from "@/hooks/useUserData";
import { projectAllowsEstimateEdits } from "@/utils/estimations/estimateRules";
import {
  EST_BOQ_PARAM, EST_ROW_PARAM, EST_SHEET_PARAM, EST_TAB_PARAM, EST_TABS, type EstTab, toEstTab,
} from "@/utils/estimations/estTabs";
import { urlStateManager } from "@/utils/urlStateManager";

import { BoqViewPanel } from "./components/BoqViewPanel";
import { EstimateItemsPanel } from "./components/EstimateItemsPanel";
import { LineItemViewPanel } from "./components/LineItemViewPanel";
import { MaterialEstimateDialog } from "./components/MaterialEstimateDialog";
import type { EditTarget, PanelProps } from "./components/panelTypes";
import { useEstimatesOverview } from "./hooks/useEstimatesData";
import { useUrlParamState } from "./hooks/useUrlParam";

/** Props of the project page's Estimates tab. */
interface EstimatesProjectTabProps {
  /** The project whose Selected BOQs the tab reads. */
  projectId: string;
  /** The project's status: estimates are read-only on Completed and Handover projects (decision I). */
  projectStatus?: string | null;
}

/**
 * The project page's Estimates tab (`?page=estimates`, Won projects only): BOQ View, Line Item View and Estimate
 * Items over the project's Selected BOQs. It reads the BOQ module and never changes it; a line's materials are
 * saved as a BOQ Line Estimate that references the line item.
 */
const EstimatesProjectTab: React.FC<EstimatesProjectTabProps> = ({ projectId, projectStatus }) => {
  const { role, user_id } = useUserData();
  const [tabParam, setTabParam] = useUrlParamState(EST_TAB_PARAM);
  const [boqParam, setBoqParam] = useUrlParamState(EST_BOQ_PARAM);
  const [sheetParam, setSheetParam] = useUrlParamState(EST_SHEET_PARAM);
  const [rowParam, setRowParam] = useUrlParamState(EST_ROW_PARAM);
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const { overview, isLoading, error, mutate } = useEstimatesOverview(projectId);

  const tab = toEstTab(tabParam);
  const roleCanEdit = canEditEstimates(role, user_id);
  const projectOpen = projectAllowsEstimateEdits(projectStatus);
  const canEdit = roleCanEdit && projectOpen;
  const boqs = overview?.boqs ?? [];
  const boq = boqs.find((b) => b.name === boqParam) ?? null;

  const onBoq = useCallback((name: string | null) => { setBoqParam(name); setSheetParam(null); setRowParam(null); }, [setBoqParam, setSheetParam, setRowParam]);
  const onSheet = useCallback((name: string | null) => { setSheetParam(name); setRowParam(null); }, [setSheetParam, setRowParam]);
  const onFocusRow = useCallback((row: number | null) => setRowParam(row == null ? null : String(row)), [setRowParam]);
  const onOpenLine = useCallback((sheetName: string, excelRow: number | null) => {
    if (!boq && boqs[0]) setBoqParam(boqs[0].name);
    setSheetParam(sheetName);
    setRowParam(excelRow == null ? null : String(excelRow));
    setTabParam("line-item-view");
  }, [boq, boqs, setBoqParam, setSheetParam, setRowParam, setTabParam]);
  const onCountsChanged = useCallback(() => { void mutate(); }, [mutate]);
  /** Opens the form; after a save the line is expanded and scrolled to, so the user sees what was saved. */
  const onEdit = useCallback((target: EditTarget) => setEditing({
    ...target,
    afterSave: () => { target.afterSave(); onFocusRow(target.excelRow); },
  }), [onFocusRow]);

  const panelProps: PanelProps = {
    boqs, boq, sheetName: sheetParam, focusRow: rowParam, canEdit,
    onBoq, onSheet, onFocusRow, onEdit, onOpenLine, onCountsChanged,
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 scrollbar-thin">
        <div className="flex gap-1.5 sm:flex-wrap pb-1 sm:pb-0" role="tablist" aria-label="Estimates">
          {EST_TABS.map((option) => (
            <button
              key={option.value} type="button" role="tab" aria-selected={tab === option.value}
              onClick={() => setTabParam(option.value as EstTab)}
              className={`px-2.5 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm rounded transition-colors whitespace-nowrap ${
                tab === option.value ? "bg-sky-500 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {roleCanEdit && !projectOpen && (
        <p className="rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground">
          Material estimates are read-only on a {projectStatus} project.
        </p>
      )}

      <div role="tabpanel">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading the project's BOQs…</p>
        ) : error ? (
          <p className="text-sm text-red-600">The BOQs could not be loaded. Reload the page to try again.</p>
        ) : !boqs.length ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-10 text-center text-sm text-muted-foreground">
              No Selected BOQ on this project. Select one in the BoQ tab to add material estimates.
              <Button size="sm" variant="outline" onClick={() => urlStateManager.updateParam("page", "boq")}>Open the BoQ tab</Button>
            </CardContent>
          </Card>
        ) : tab === "boq-view" ? (
          <BoqViewPanel {...panelProps} />
        ) : tab === "line-item-view" ? (
          <LineItemViewPanel {...panelProps} />
        ) : (
          <EstimateItemsPanel {...panelProps} />
        )}
      </div>

      {editing && <MaterialEstimateDialog target={editing} onClose={() => setEditing(null)} />}
    </div>
  );
};

export default EstimatesProjectTab;
