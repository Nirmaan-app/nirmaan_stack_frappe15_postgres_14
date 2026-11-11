import React from "react";

import { Button } from "@/components/ui/button";
import type { EstimateEntry, EstimateItemRow } from "@/utils/estimations/estimateTypes";

const qtyFormat = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 });

/** A quantity for display; "—" when the BOQ gives none (38% of lines have no qty). */
export const formatQty = (value: number | null | undefined): string =>
  value == null || value === 0 ? "—" : qtyFormat.format(value);

/** Normal (from the Items list) or Custom (typed by hand; not in the Items list). */
export const ItemTypeBadge: React.FC<{ type: EstimateItemRow["item_type"] }> = ({ type }) =>
  type === "Normal" ? (
    <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[11px] font-semibold text-sky-700">Normal</span>
  ) : (
    <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700" title="Not in Items list">
      Custom · not in Items list
    </span>
  );

interface MaterialsCellProps {
  entry?: EstimateEntry;
  expanded: boolean;
  canEdit: boolean;
  onToggle: () => void;
  onEdit: () => void;
}

/** The Materials cell of a line item: "▸ 3 items" to expand, Edit, or "+ Add" on a line with none. */
export const MaterialsCell: React.FC<MaterialsCellProps> = ({ entry, expanded, canEdit, onToggle, onEdit }) => {
  const count = entry?.items.length ?? 0;
  if (!count) {
    return canEdit ? (
      <Button variant="outline" size="sm" className="h-7 border-dashed px-2 text-xs" onClick={onEdit}>+ Add</Button>
    ) : (
      <span className="text-xs text-muted-foreground">—</span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <Button
        variant={expanded ? "default" : "outline"} size="sm" className="h-7 px-2 font-mono text-xs"
        aria-expanded={expanded} onClick={onToggle}
      >
        {expanded ? "▾" : "▸"} {count} item{count > 1 ? "s" : ""}
      </Button>
      {canEdit && (
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onEdit}>Edit</Button>
      )}
    </span>
  );
};

interface ExpandedMaterialsProps {
  entry: EstimateEntry;
  lineQty: number | null;
  lineUnit: string | null;
  canEdit: boolean;
  onEdit: () => void;
  /** Shown in BOQ View only: jump to the same line in Line Item View. */
  onOpenInLineView?: () => void;
}

/** A line's materials, drawn under the line when it is expanded. */
export const ExpandedMaterials: React.FC<ExpandedMaterialsProps> = ({
  entry, lineQty, lineUnit, canEdit, onEdit, onOpenInLineView,
}) => (
  <div className="sticky left-0 flex max-w-[760px] flex-col gap-2 py-2 pl-8 pr-3">
    <table className="w-full rounded border bg-background text-xs">
      <thead className="bg-muted/50 text-left text-muted-foreground">
        <tr>
          <th className="px-2 py-1.5">Type</th><th className="px-2 py-1.5">Item</th><th className="px-2 py-1.5">Make</th>
          <th className="px-2 py-1.5">Category</th><th className="px-2 py-1.5">Unit</th>
          <th className="px-2 py-1.5 text-right">Qty</th>
        </tr>
      </thead>
      <tbody>
        {entry.items.map((item, i) => (
          <tr key={item.name ?? i} className="border-t">
            <td className="px-2 py-1.5"><ItemTypeBadge type={item.item_type} /></td>
            <td className="px-2 py-1.5">{item.item_name}</td>
            <td className="px-2 py-1.5">{item.make || "—"}</td>
            <td className="px-2 py-1.5">{item.category || "—"}</td>
            <td className="px-2 py-1.5">{item.unit || "—"}</td>
            <td className="px-2 py-1.5 text-right tabular-nums">{formatQty(item.quantity)}</td>
          </tr>
        ))}
      </tbody>
    </table>
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      <span>BOQ qty <b className="text-foreground">{formatQty(lineQty)} {lineUnit || ""}</b> · {entry.items.length} material{entry.items.length > 1 ? "s" : ""}</span>
      {canEdit && <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onEdit}>Edit material estimate</Button>}
      {onOpenInLineView && (
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onOpenInLineView}>Open in Line Item View</Button>
      )}
    </div>
  </div>
);
