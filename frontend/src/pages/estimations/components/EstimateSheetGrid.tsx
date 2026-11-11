import React, { Fragment } from "react";

import { type GridRow, isLineItem, rowTypeLabel } from "@/utils/estimations/estimateRules";
import type { EstimateEntry } from "@/utils/estimations/estimateTypes";

import { ExpandedMaterials, formatQty, MaterialsCell } from "./MaterialsParts";

const moneyFormat = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
const money = (v: number | null | undefined) => (v == null || v === 0 ? "" : moneyFormat.format(v));

const TYPE_STYLE: Record<string, string> = {
  Item: "bg-sky-50 text-sky-700",
  Preamble: "bg-muted text-muted-foreground border",
  Note: "bg-amber-50 text-amber-800",
  Subtotal: "bg-muted text-muted-foreground",
  Spacer: "bg-muted text-muted-foreground",
};

interface EstimateSheetGridProps {
  rows: GridRow[];
  estimates: Map<string, EstimateEntry>;
  expanded: Set<string>;
  highlight: string | null;
  canEdit: boolean;
  onToggle: (node: string) => void;
  onEdit: (row: GridRow) => void;
  onOpenInLineView: (row: GridRow) => void;
}

/**
 * The BOQ View sheet grid (decision K): its own read-only table over the rows the BOQ sheet viewer reads, in the
 * same order, with one new column, Materials, right after Row type. Expanding a line draws its materials below it.
 * The shared Pricing grid is not used or changed.
 */
export const EstimateSheetGrid: React.FC<EstimateSheetGridProps> = ({
  rows, estimates, expanded, highlight, canEdit, onToggle, onEdit, onOpenInLineView,
}) => (
  <div className="overflow-x-auto rounded-md border">
    <table className="w-full min-w-[1040px] text-xs">
      <thead className="bg-muted/60 text-left text-muted-foreground">
        <tr>
          <th className="px-2 py-2">Excel</th><th className="px-2 py-2">Sl.No</th><th className="px-2 py-2">Parent</th>
          <th className="px-2 py-2">Row type</th>
          <th className="min-w-[150px] border-x-2 border-amber-400 bg-amber-50 px-2 py-2 text-amber-800">Materials</th>
          <th className="px-2 py-2">Description</th><th className="px-2 py-2">Unit</th>
          <th className="px-2 py-2 text-right">Qty</th><th className="px-2 py-2 text-right">Rate (Supply)</th>
          <th className="px-2 py-2 text-right">Rate (Install)</th><th className="px-2 py-2 text-right">Amount</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const label = rowTypeLabel(row.classification);
          const item = isLineItem(row);
          const entry = estimates.get(row.name);
          const open = item && expanded.has(row.name) && !!entry?.items.length;
          return (
            <Fragment key={row.name}>
              <tr id={`est-row-${row.name}`} className={`border-t align-top ${highlight === row.name ? "bg-yellow-50" : ""}`}>
                <td className="px-2 py-1.5 tabular-nums">{row.source_row_number ?? ""}</td>
                <td className="px-2 py-1.5">{row.sl_no_value ?? ""}</td>
                <td className="px-2 py-1.5 text-sky-700">{row.parentExcelRow != null ? `↑ ${row.parentExcelRow}` : ""}</td>
                <td className="px-2 py-1.5">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${TYPE_STYLE[label] ?? ""}`}>{label}</span>
                </td>
                <td className="border-x-2 border-amber-400 px-2 py-1.5">
                  {item && (
                    <MaterialsCell
                      entry={entry} expanded={open} canEdit={canEdit}
                      onToggle={() => onToggle(row.name)} onEdit={() => onEdit(row)}
                    />
                  )}
                </td>
                <td className={`max-w-[320px] whitespace-pre-wrap px-2 py-1.5 ${label === "Note" ? "italic text-muted-foreground" : ""} ${label === "Preamble" ? "font-semibold" : ""}`}>
                  {row.description}
                </td>
                <td className="px-2 py-1.5">{row.unit ?? ""}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{item ? formatQty(row.qty_total) : ""}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{money(row.rate_supply)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{money(row.rate_install)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{money(row.amount_total)}</td>
              </tr>
              {open && entry && (
                <tr className="bg-muted/30">
                  <td colSpan={11} className="p-0">
                    <ExpandedMaterials
                      entry={entry} lineQty={row.qty_total} lineUnit={row.unit} canEdit={canEdit}
                      onEdit={() => onEdit(row)} onOpenInLineView={() => onOpenInLineView(row)}
                    />
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
        {!rows.length && (
          <tr><td colSpan={11} className="px-3 py-6 text-center text-muted-foreground">No rows match. Clear the search or show more row types.</td></tr>
        )}
      </tbody>
    </table>
  </div>
);
