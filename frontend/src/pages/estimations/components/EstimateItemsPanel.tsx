import React, { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { materialTotals } from "@/utils/estimations/estimateRules";

import { useEstimates } from "../hooks/useEstimatesData";
import { BoqSheetBar } from "./BoqSheetBar";
import { formatQty, ItemTypeBadge } from "./MaterialsParts";
import type { PanelProps } from "./panelTypes";

type Mode = "line" | "totals";
type TypeFilter = "all" | "Normal" | "Custom";

const Seg = <T extends string>({ value, options, onChange }: { value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void }) => (
  <div className="inline-flex overflow-hidden rounded-md border text-xs">
    {options.map(([v, label]) => (
      <button key={v} type="button" onClick={() => onChange(v)}
        className={`px-2.5 py-1 ${value === v ? "bg-sky-600 text-white" : "bg-background text-muted-foreground"}`}>{label}</button>
    ))}
  </div>
);

/** Estimate Items: every material of a Selected BOQ, by line item or added up as material totals (read-only). */
export const EstimateItemsPanel: React.FC<PanelProps> = ({ boqs, boq: chosen, sheetName, onBoq, onSheet, onOpenLine }) => {
  const boq = chosen ?? boqs[0];
  const { estimates, isLoading } = useEstimates(boq?.name ?? null);
  const [mode, setMode] = useState<Mode>("line");
  const [type, setType] = useState<TypeFilter>("all");

  const entries = useMemo(
    () => estimates.current.filter((e) => sheetName == null || e.line.sheet_name === sheetName),
    [estimates, sheetName],
  );
  const totals = useMemo(() => materialTotals(entries, type), [entries, type]);
  // Estimates a re-commit left on an older version are not counted here until they are re-attached; say so, so
  // they never look lost.
  // Backups (copied by Re-attach) are counted through their copies; the rest are not counted until someone acts.
  const { olderCount, backupCount } = useMemo(() => {
    // An estimate whose line and sheet were both deleted has no sheet name; the server lists it on every sheet.
    const here = estimates.older.filter((e) => sheetName == null || e.line.sheet_name == null || e.line.sheet_name === sheetName);
    const backups = here.filter((e) => e.state === "copied").length;
    return { olderCount: here.length - backups, backupCount: backups };
  }, [estimates, sheetName]);
  if (!boq) return null;

  return (
    <div className="flex flex-col gap-3">
      <BoqSheetBar boqs={boqs} boq={boq} sheetName={sheetName} onBoq={onBoq} onSheet={onSheet} allowAll showCounts={false} />
      <div className="flex flex-wrap gap-2">
        <Seg value={mode} onChange={setMode} options={[["line", "By line item"], ["totals", "Material totals"]] as const} />
        <Seg value={type} onChange={setType} options={[["all", "All"], ["Normal", "Normal"], ["Custom", "Custom"]] as const} />
      </div>
      {olderCount > 0 && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status">
          <b>{olderCount} material estimate{olderCount === 1 ? " is" : "s are"} on an older version</b> of {sheetName == null ? "this BOQ's sheets" : "this sheet"} and
          {olderCount === 1 ? " is" : " are"} not counted here yet. Re-attach, add to a line or remove {olderCount === 1 ? "it" : "them"} in BOQ View or Line Item View.
        </p>
      )}
      {backupCount > 0 && (
        <p className="text-xs text-muted-foreground" role="status">
          {backupCount} older backup{backupCount === 1 ? " is" : "s are"} kept after Re-attach; {backupCount === 1 ? "its copy is" : "their copies are"} counted here.
          Undo or remove {backupCount === 1 ? "it" : "them"} in BOQ View or Line Item View.
        </p>
      )}
      {isLoading ? <p className="text-sm text-muted-foreground">Loading materials…</p> : mode === "line" ? (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[640px] text-xs">
            <thead className="bg-muted/60 text-left text-muted-foreground">
              <tr><th className="px-2 py-2">Type</th><th className="px-2 py-2">Item</th><th className="px-2 py-2">Make</th>
                <th className="px-2 py-2">Category</th><th className="px-2 py-2">Unit</th><th className="px-2 py-2 text-right">Qty</th></tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const items = e.items.filter((i) => type === "all" || i.item_type === type);
                if (!items.length) return null;
                return (
                  <React.Fragment key={e.name}>
                    <tr className="bg-muted/50"><td colSpan={6} className="px-2 py-1.5 font-semibold">
                      <span className="mr-2 font-mono text-amber-700">{sheetName == null ? `${e.line.sheet_name} · ` : ""}row {e.line.excel_row ?? "—"}{e.line.sl_no ? ` (${e.line.sl_no})` : ""}</span>
                      {e.line.description} <span className="font-normal text-muted-foreground">· BOQ {formatQty(e.line.qty)} {e.line.unit ?? ""}</span>
                      <Button variant="outline" size="sm" className="ml-2 h-6 text-[11px]" onClick={() => onOpenLine(e.line.sheet_name ?? "", e.line.excel_row)}>Open line</Button>
                    </td></tr>
                    {items.map((i, k) => (
                      <tr key={i.name ?? k} className="border-t">
                        <td className="px-2 py-1.5"><ItemTypeBadge type={i.item_type} /></td><td className="px-2 py-1.5">{i.item_name}</td>
                        <td className="px-2 py-1.5">{i.make || "—"}</td><td className="px-2 py-1.5">{i.category || "—"}</td>
                        <td className="px-2 py-1.5">{i.unit || "—"}</td><td className="px-2 py-1.5 text-right tabular-nums">{formatQty(i.quantity)}</td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
              {!entries.length && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">No materials yet. Add them from BOQ View or Line Item View.</td></tr>}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[640px] text-xs">
            <thead className="bg-muted/60 text-left text-muted-foreground">
              <tr><th className="px-2 py-2">Type</th><th className="px-2 py-2">Item</th><th className="px-2 py-2">Make</th><th className="px-2 py-2">Category</th>
                <th className="px-2 py-2">Unit</th><th className="px-2 py-2 text-right">Total qty</th><th className="px-2 py-2 text-right">Used in lines</th></tr>
            </thead>
            <tbody>
              {totals.map((t) => (
                <tr key={t.key} className="border-t">
                  <td className="px-2 py-1.5"><ItemTypeBadge type={t.item_type} /></td><td className="px-2 py-1.5">{t.item_name}</td>
                  <td className="px-2 py-1.5">{t.make || "—"}</td><td className="px-2 py-1.5">{t.category || "—"}</td><td className="px-2 py-1.5">{t.unit || "—"}</td>
                  <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{formatQty(t.quantity)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{t.lines}</td>
                </tr>
              ))}
              {!totals.length && <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">No materials yet.</td></tr>}
            </tbody>
          </table>
          <p className="px-3 py-2 text-[11px] text-muted-foreground">Same item + make + unit is added up across lines. Custom items group by name + unit. Different units are never added together.</p>
        </div>
      )}
    </div>
  );
};
