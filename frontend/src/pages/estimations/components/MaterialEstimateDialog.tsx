import React, { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/use-toast";
import { getFrappeErrorText } from "@/utils/frappeErrors";
import { duplicateProblem, itemRowProblem } from "@/utils/estimations/estimateRules";
import type { EstimateItemRow } from "@/utils/estimations/estimateTypes";

import { useEstimateWrites, useItemsCatalog } from "../hooks/useEstimatesData";
import { CustomItemPicker, MatchPicker, NormalItemPicker, rowFromItem } from "./ItemPickers";
import { formatQty, ItemTypeBadge } from "./MaterialsParts";
import type { EditTarget } from "./panelTypes";

type Panel = { kind: "normal"; presetItem?: string; presetQty?: string } | { kind: "custom" } | { kind: "match"; index: number } | null;

interface MaterialEstimateDialogProps {
  target: EditTarget;
  onClose: () => void;
}

/**
 * The Material estimate form for one BOQ line item. Rows keep their saved `name`, so the server keeps the item
 * name and unit copied when each was added. Saving sends the whole list; an empty list deletes the estimate.
 * The server re-checks every rule and refuses a save someone else overtook.
 */
export const MaterialEstimateDialog: React.FC<MaterialEstimateDialogProps> = ({ target, onClose }) => {
  const catalog = useItemsCatalog(true);
  const { saveEstimate, saving } = useEstimateWrites();
  // The line's own rows, then any rows carried from an older estimate ("Add to a line"): those come in as new rows
  // (no `name`), so the server copies a Normal item's name and unit afresh and checks every rule on Save.
  const [rows, setRowsState] = useState<EstimateItemRow[]>(() => [
    ...(target.entry?.items ?? []).map((r) => ({ ...r })),
    ...(target.carried?.rows ?? []).map(({ name: _name, procurement_package: _pkg, ...r }) => ({ ...r })),
  ]);
  const [panel, setPanel] = useState<Panel>(null);
  const [error, setError] = useState<string | null>(null);
  /** Every change to the list clears the last Save error: it described rows the user has since changed. */
  const setRows: typeof setRowsState = (next) => { setRowsState(next); setError(null); };

  /** Adds a row unless it breaks a rule; returns the problem for the picker to show. */
  const addRow = (row: EstimateItemRow): string | null => {
    const next = [...rows, row];
    const problem = itemRowProblem(row) ?? duplicateProblem(next);
    if (problem) return problem;
    setRows(next);
    setPanel(null);
    return null;
  };
  const update = (index: number, patch: Partial<EstimateItemRow>) =>
    setRows((list) => list.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const match = (index: number, itemId: string): string | null => {
    const picked = rowFromItem(catalog, itemId, rows[index].quantity, null);
    const next = rows.map((r, i) => (i === index ? { ...picked, name: r.name, comment: r.comment } : r));
    const problem = duplicateProblem(next);
    if (problem) return problem;
    setRows(next);
    setPanel(null);
    toast({ title: `"${rows[index].item_name}" is now ${picked.item_name}` });
    return null;
  };

  const save = async () => {
    const problem = rows.map(itemRowProblem).find(Boolean) ?? duplicateProblem(rows);
    if (problem) return setError(problem);
    setError(null);
    try {
      await saveEstimate({ boq_node: target.node, items: JSON.stringify(rows), expected_modified: target.entry?.modified ?? "" });
      toast({ title: rows.length ? `Saved ${rows.length} material${rows.length === 1 ? "" : "s"} on row ${target.excelRow ?? ""}` : "Material estimate removed" });
      target.afterSave();
      onClose();
    } catch (e) {
      setError(getFrappeErrorText(e));
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Material estimate · {target.sheetName} · row {target.excelRow ?? "—"}{target.slNo ? ` (${target.slNo})` : ""}</DialogTitle>
          <DialogDescription>{target.description} · BOQ qty <b>{formatQty(target.qty)} {target.unit ?? ""}</b></DialogDescription>
        </DialogHeader>
        {target.carried && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status">
            {target.carried.rows.length} material{target.carried.rows.length === 1 ? "" : "s"} copied from the older version of
            row {target.carried.fromRow ?? "—"}. Check the quantities, then Save. The older estimate is removed after the save.
          </p>
        )}

        {rows.length ? (
          <div className="overflow-x-auto rounded border">
            <table className="w-full text-xs">
              <thead className="bg-muted/60 text-left text-muted-foreground">
                <tr><th className="px-2 py-1.5">Type</th><th className="px-2 py-1.5">Item</th><th className="px-2 py-1.5">Make</th>
                  <th className="px-2 py-1.5">Unit</th><th className="px-2 py-1.5 text-right">Qty</th><th /></tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const makes = r.category ? catalog.makesByCategory[r.category] ?? [] : [];
                  const options = r.make && !makes.includes(r.make) ? [r.make, ...makes] : makes;
                  return (
                    <tr key={r.name ?? `new-${i}`} className="border-t">
                      <td className="px-2 py-1.5"><ItemTypeBadge type={r.item_type} /></td>
                      <td className="px-2 py-1.5">{r.item_name}{r.item_id && <span className="block font-mono text-[10px] text-muted-foreground">{r.item_id}</span>}</td>
                      <td className="px-2 py-1.5">
                        {r.item_type === "Normal" ? (
                          <select className="rounded border bg-background px-1 py-0.5 text-xs" value={r.make ?? ""} aria-label={`Make for ${r.item_name}`}
                            onChange={(e) => update(i, { make: e.target.value || null })}>
                            <option value="">No make</option>
                            {options.map((m) => <option key={m} value={m}>{m}</option>)}
                          </select>
                        ) : "—"}
                      </td>
                      <td className="px-2 py-1.5">{r.unit || "—"}</td>
                      <td className="px-2 py-1.5 text-right">
                        <Input type="number" min={0} step="any" className="ml-auto h-7 w-24 text-right text-xs" aria-label={`Quantity for ${r.item_name}`}
                          value={Number.isFinite(r.quantity) ? r.quantity : ""} onChange={(e) => update(i, { quantity: Number(e.target.value) })} />
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right">
                        {r.item_type === "Custom" && <Button size="sm" variant="outline" className="mr-1 h-6 text-[11px]" onClick={() => setPanel({ kind: "match", index: i })}>Match</Button>}
                        <Button size="sm" variant="ghost" className="h-6 text-[11px] text-red-600" onClick={() => setRows((l) => l.filter((_, k) => k !== i))}>Remove</Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No materials yet. Add an item from the Items list, or a custom item.</p>
        )}

        {catalog.isLoading && panel && <p className="text-xs text-muted-foreground">Loading the Items list…</p>}
        {panel?.kind === "normal" && (
          <NormalItemPicker catalog={catalog} presetItem={panel.presetItem} presetQty={panel.presetQty} onAdd={addRow} onCancel={() => setPanel(null)} />
        )}
        {panel?.kind === "custom" && (
          <CustomItemPicker catalog={catalog} onAdd={addRow} onCancel={() => setPanel(null)}
            onUseExisting={(itemId, qty) => setPanel({ kind: "normal", presetItem: itemId, presetQty: qty })} />
        )}
        {panel?.kind === "match" && rows[panel.index] && (
          <MatchPicker catalog={catalog} row={rows[panel.index]} onPick={(id) => match(panel.index, id)} onCancel={() => setPanel(null)} />
        )}

        {error && <p className="text-sm font-semibold text-red-600" role="alert">{error}</p>}
        <DialogFooter className="flex flex-wrap justify-between gap-2 sm:justify-between">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPanel({ kind: "normal" })}>+ Add item</Button>
            <Button variant="outline" size="sm" onClick={() => setPanel({ kind: "custom" })}>+ Add custom item</Button>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save"}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
