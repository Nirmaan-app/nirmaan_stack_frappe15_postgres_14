import React, { Fragment, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { lineGroups } from "@/utils/estimations/estimateRules";
import type { EstimateEntry, SheetRow } from "@/utils/estimations/estimateTypes";

import { useEstimates, useRefreshEstimates, useSheetRows } from "../hooks/useEstimatesData";
import { useFocusedLines } from "../hooks/useFocusedLines";
import { BoqSheetBar } from "./BoqSheetBar";
import { ExpandedMaterials, formatQty, MaterialsCell } from "./MaterialsParts";
import { OlderVersionNotice } from "./OlderVersionNotice";
import type { EditTarget, PanelProps } from "./panelTypes";

type Filter = "all" | "not" | "done";

/** Line Item View: only the line items of a sheet, under their headings, with ▸ to show each line's materials. */
export const LineItemViewPanel: React.FC<PanelProps> = ({
  boqs, boq: chosen, sheetName, focusRow, canEdit, onBoq, onSheet, onFocusRow, onEdit, onCountsChanged,
}) => {
  const boq = chosen ?? boqs[0];
  const sheet = boq?.sheets.find((s) => s.sheet_name === sheetName) ?? boq?.sheets[0] ?? null;
  const activeSheet = sheet?.sheet_name ?? null;
  const { rows, isLoading } = useSheetRows(boq?.name ?? null, activeSheet);
  const { estimates } = useEstimates(boq?.name ?? null, activeSheet);
  const refreshEstimates = useRefreshEstimates();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const { expanded, highlight, toggle, expandMany, collapseAll } = useFocusedLines(rows, focusRow, onFocusRow);

  const byNode = useMemo(() => new Map<string, EstimateEntry>(estimates.current.map((e) => [e.boq_node, e])), [estimates]);
  const groups = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return lineGroups(rows, (r) => {
      const has = !!byNode.get(r.name)?.items.length;
      if (filter === "not" && has) return false;
      if (filter === "done" && !has) return false;
      return !needle || (r.description || "").toLowerCase().includes(needle);
    });
  }, [rows, byNode, filter, search]);

  if (!boq || !sheet) return <p className="text-sm text-muted-foreground">This BOQ has no committed data sheet yet.</p>;
  const refresh = () => { void refreshEstimates(boq.name); onCountsChanged(); };
  const edit = (r: SheetRow, extra?: Pick<EditTarget, "carried">) => onEdit({
    boq: boq.name, node: r.name, sheetName: sheet.sheet_name, excelRow: r.source_row_number, slNo: r.sl_no_value,
    description: r.description, unit: r.unit, qty: r.qty_total, entry: byNode.get(r.name), afterSave: refresh,
    ...extra,
  });
  const currentLines = rows.filter((r) => r.classification === "line_item");

  return (
    <div className="flex flex-col gap-3">
      <BoqSheetBar boqs={boqs} boq={boq} sheetName={sheet.sheet_name} onBoq={onBoq} onSheet={onSheet} />
      <OlderVersionNotice key={`${boq.name}|${sheet.sheet_name}`} boq={boq.name} sheetName={sheet.sheet_name} older={estimates.older} canEdit={canEdit} onDone={refresh}
        lines={currentLines} onAddTo={(line, carried) => edit(line, { carried })} />
      <div className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-xs">
        <Button variant="outline" size="sm" className="h-7 text-xs"
          onClick={() => expandMany(rows.filter((r) => r.classification === "line_item").map((r) => r.name))}>▾ Expand all</Button>
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={collapseAll}>▸ Collapse all</Button>
        <Input className="h-7 w-48 text-xs" placeholder="Search line items…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search line items" />
        <div className="inline-flex overflow-hidden rounded-md border">
          {([["all", "All"], ["not", "Not estimated"], ["done", "Estimated"]] as const).map(([v, label]) => (
            <button key={v} type="button" onClick={() => setFilter(v)}
              className={`px-2.5 py-1 ${filter === v ? "bg-sky-600 text-white" : "bg-background text-muted-foreground"}`}>{label}</button>
          ))}
        </div>
      </div>
      {isLoading ? <p className="text-sm text-muted-foreground">Loading the sheet…</p> : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[680px] text-xs">
            <thead className="bg-muted/60 text-left text-muted-foreground">
              <tr><th className="w-8" /><th className="px-2 py-2">Sl.No</th><th className="px-2 py-2">Description</th>
                <th className="px-2 py-2">Unit</th><th className="px-2 py-2 text-right">BOQ qty</th><th className="px-2 py-2">Estimate Items</th></tr>
            </thead>
            <tbody>
              {groups.map((g, gi) => (
                <Fragment key={g.heading?.name ?? `top-${gi}`}>
                  {g.heading && (
                    <tr className="bg-muted/50"><td colSpan={6} className="px-2 py-1.5 font-semibold uppercase tracking-wide text-muted-foreground">
                      {g.heading.sl_no_value ? `${g.heading.sl_no_value} · ` : ""}{g.heading.description}</td></tr>
                  )}
                  {g.lines.map((r) => {
                    const entry = byNode.get(r.name);
                    const open = expanded.has(r.name);
                    return (
                      <Fragment key={r.name}>
                        <tr id={`est-row-${r.name}`} className={`border-t align-top ${highlight === r.name ? "bg-yellow-50" : ""}`}>
                          <td className="px-1 py-1.5 text-center">
                            <button type="button" aria-expanded={open} aria-label={`${open ? "Hide" : "Show"} materials for row ${r.source_row_number ?? ""}`}
                              className="h-6 w-6 rounded border text-[11px]" onClick={() => toggle(r.name, r.source_row_number)}>{open ? "▾" : "▸"}</button>
                          </td>
                          <td className="px-2 py-1.5 font-mono">{r.sl_no_value ?? ""} <span className="text-[10px] text-muted-foreground">row {r.source_row_number}</span></td>
                          <td className="max-w-[420px] whitespace-pre-wrap px-2 py-1.5">{r.description}</td>
                          <td className="px-2 py-1.5">{r.unit ?? "—"}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{formatQty(r.qty_total)}</td>
                          <td className="px-2 py-1.5">
                            <MaterialsCell entry={entry} expanded={open && !!entry?.items.length} canEdit={canEdit}
                              onToggle={() => toggle(r.name, r.source_row_number)} onEdit={() => edit(r)} />
                          </td>
                        </tr>
                        {open && (
                          <tr className="bg-muted/30"><td colSpan={6} className="p-0">
                            {entry?.items.length ? (
                              <ExpandedMaterials entry={entry} lineQty={r.qty_total} lineUnit={r.unit} canEdit={canEdit} onEdit={() => edit(r)} />
                            ) : (
                              <p className="py-2 pl-8 text-xs text-muted-foreground">No materials yet for this line.</p>
                            )}
                          </td></tr>
                        )}
                      </Fragment>
                    );
                  })}
                </Fragment>
              ))}
              {!groups.length && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">No line items match. Clear the search or the filter.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
