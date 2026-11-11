import React, { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { gridRows, isLineItem } from "@/utils/estimations/estimateRules";
import type { EstimateEntry, SheetRow } from "@/utils/estimations/estimateTypes";

import { useEstimates, useRefreshEstimates, useSheetRows } from "../hooks/useEstimatesData";
import { useFocusedLines } from "../hooks/useFocusedLines";
import { BoqSheetBar } from "./BoqSheetBar";
import { EstimateSheetGrid } from "./EstimateSheetGrid";
import { OlderVersionNotice } from "./OlderVersionNotice";
import type { EditTarget, PanelProps } from "./panelTypes";

/** BOQ View: the project's Selected BOQs; open one to see a sheet's grid with the Materials column after Row type. */
export const BoqViewPanel: React.FC<PanelProps> = (props) => {
  const { boqs, boq } = props;
  if (!boq) {
    return (
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
            <tr><th className="px-3 py-2">BOQ</th><th className="px-3 py-2 text-right">Sheets</th>
              <th className="px-3 py-2 text-right">Line items</th><th className="px-3 py-2">With materials</th><th /></tr>
          </thead>
          <tbody>
            {boqs.map((b) => {
              const lines = b.sheets.reduce((n, s) => n + s.line_items, 0);
              const done = b.sheets.reduce((n, s) => n + s.estimated, 0);
              return (
                <tr key={b.name} className="border-t">
                  <td className="px-3 py-2"><div className="font-semibold">{b.boq_name}</div><div className="font-mono text-xs text-muted-foreground">{b.name}</div></td>
                  <td className="px-3 py-2 text-right tabular-nums">{b.sheets.length}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{lines}</td>
                  <td className="px-3 py-2 font-mono text-xs">{done}/{lines}</td>
                  <td className="px-3 py-2 text-right"><Button size="sm" onClick={() => props.onBoq(b.name)}>Open</Button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }
  return <BoqSheetView {...props} boq={boq} />;
};

const BoqSheetView: React.FC<PanelProps & { boq: NonNullable<PanelProps["boq"]> }> = ({
  boqs, boq, sheetName, focusRow, canEdit, onBoq, onSheet, onFocusRow, onEdit, onOpenLine, onCountsChanged,
}) => {
  const sheet = boq.sheets.find((s) => s.sheet_name === sheetName) ?? boq.sheets[0] ?? null;
  const activeSheet = sheet?.sheet_name ?? null;
  const { rows, isLoading } = useSheetRows(boq.name, activeSheet);
  const { estimates } = useEstimates(boq.name, activeSheet);
  const refreshEstimates = useRefreshEstimates();
  const [search, setSearch] = useState("");
  const [show, setShow] = useState({ showNotes: true, showSubtotals: true, showSpacers: false });
  const { expanded, highlight, toggle, expandMany, collapseAll } = useFocusedLines(rows, focusRow, onFocusRow);

  const byNode = useMemo(() => new Map<string, EstimateEntry>(estimates.current.map((e) => [e.boq_node, e])), [estimates]);
  const visible = useMemo(() => gridRows(rows, { ...show, search }), [rows, show, search]);
  const refresh = () => { void refreshEstimates(boq.name); onCountsChanged(); };

  const edit = (row: SheetRow, extra?: Pick<EditTarget, "carried" | "afterSave">) => onEdit({
    boq: boq.name, node: row.name, sheetName: activeSheet ?? "", excelRow: row.source_row_number, slNo: row.sl_no_value,
    description: row.description, unit: row.unit, qty: row.qty_total, entry: byNode.get(row.name), afterSave: refresh,
    ...extra,
  });
  const currentLines = rows.filter(isLineItem);

  if (!sheet) return <p className="text-sm text-muted-foreground">This BOQ has no committed data sheet yet.</p>;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => onBoq(null)}>← All BOQs</Button>
        <span className="font-semibold">{boq.boq_name}</span><span className="font-mono text-xs text-muted-foreground">{boq.name}</span>
      </div>
      <BoqSheetBar boqs={boqs} boq={boq} sheetName={activeSheet} onBoq={onBoq} onSheet={onSheet} />
      <OlderVersionNotice key={`${boq.name}|${sheet.sheet_name}`} boq={boq.name} sheetName={sheet.sheet_name} older={estimates.older} canEdit={canEdit} onDone={refresh}
        lines={currentLines} onAddTo={(line, carried, afterSave) => edit(line, { carried, afterSave: () => { afterSave(); refresh(); } })} />
      <div className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-xs">
        <Button variant="outline" size="sm" className="h-7 text-xs"
          onClick={() => expandMany(rows.filter((r) => isLineItem(r) && byNode.get(r.name)?.items.length).map((r) => r.name))}>
          ▾ Expand all materials
        </Button>
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={collapseAll}>▸ Collapse all</Button>
        <Input className="h-7 w-48 text-xs" placeholder="Search description…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search description" />
        <span className="text-muted-foreground">Show:</span>
        {([["showNotes", "Notes"], ["showSubtotals", "Subtotals"], ["showSpacers", "Spacers"]] as const).map(([key, label]) => (
          <label key={key} className="inline-flex items-center gap-1">
            <input type="checkbox" checked={show[key]} onChange={(e) => setShow((s) => ({ ...s, [key]: e.target.checked }))} />{label}
          </label>
        ))}
      </div>
      {isLoading ? <p className="text-sm text-muted-foreground">Loading the sheet…</p> : (
        <EstimateSheetGrid
          rows={visible} estimates={byNode} expanded={expanded} highlight={highlight} canEdit={canEdit}
          onToggle={(node) => toggle(node, rows.find((r) => r.name === node)?.source_row_number ?? null)}
          onEdit={edit} onOpenInLineView={(row) => onOpenLine(activeSheet ?? "", row.source_row_number)}
        />
      )}
    </div>
  );
};
