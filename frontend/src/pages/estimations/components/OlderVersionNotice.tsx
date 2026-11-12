import React, { useState } from "react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { getFrappeErrorText } from "@/utils/frappeErrors";
import type { EstimateEntry, OlderState, SheetRow } from "@/utils/estimations/estimateTypes";

import { useEstimateWrites } from "../hooks/useEstimatesData";
import { formatQty } from "./MaterialsParts";
import type { CarriedRows } from "./panelTypes";

interface OlderVersionNoticeProps {
  boq: string;
  sheetName: string;
  older: EstimateEntry[];
  canEdit: boolean;
  onDone: () => void;
  /** The sheet's current line items, offered by "Add to a line". */
  lines: SheetRow[];
  /** Opens the material form for `line` with the older estimate's rows added (`carried.onKept` removes the older one). */
  onAddTo: (line: SheetRow, carried: CarriedRows) => void;
}

const lineLabel = (r: SheetRow) => {
  const text = (r.description || "—").replace(/\s+/g, " ");
  return `Row ${r.source_row_number ?? "—"}${r.sl_no_value ? ` (${r.sl_no_value})` : ""} · ${text.length > 70 ? `${text.slice(0, 70)}…` : text}`;
};

/** "GI Sheet - 24G ×10, Sealant ×2.5" -- what an older estimate holds. */
const itemsSummary = (e: EstimateEntry) =>
  e.items.map((i) => `${i.item_name} ×${formatQty(i.quantity)}${i.unit ? ` ${i.unit}` : ""}`).join(", ");

const STATE_TEXT: Record<OlderState, string> = {
  can_copy: "Unchanged on the new version but not copied there yet (it normally is, right after a commit). Re-attach copies it now.",
  changed: "This line changed on the new version, so it cannot be copied. Add its materials to a line, or remove it.",
  line_missing: "Its line item no longer exists in the BOQ (it was deleted). Add its materials to a line, or remove it.",
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Estimates on an older version of this sheet that still need a person (owner, 12 Nov). After every commit the
 * estimates are copied to the new version by a job, and each older version keeps its own as history; history is not
 * listed (the server leaves it out). What each listed one can do comes from the server (`state`, same in every view):
 *  - can_copy: its line is unchanged but it was not copied yet (a BOQ not Selected at commit time, a copy a rule
 *    refused): Re-attach copies it;
 *  - changed: its line changed: Add to a line (form opens on a chosen line with its materials; the older estimate is
 *    settled after a save that keeps materials) or Remove (settled: kept in its version's history, no longer listed);
 *  - line_missing: its line item was deleted from the BOQ tables; the same two choices as changed.
 * Every delete asks first.
 */
export const OlderVersionNotice: React.FC<OlderVersionNoticeProps> = ({ boq, sheetName, older, canEdit, onDone, lines, onAddTo }) => {
  const { reattachEstimates, settleOlder, olderBusy } = useEstimateWrites();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<string | null>(null);
  const [chosenLine, setChosenLine] = useState("");
  if (!older.length) return null;

  const of = (s: OlderState) => older.filter((e) => e.state === s);
  const canCopy = of("can_copy");
  const changed = [...of("changed"), ...of("line_missing")];
  const args = { boq, sheet_name: sheetName };

  const act = async (work: () => Promise<string | { title: string; description: string }>) => {
    try {
      const done = await work();
      toast(typeof done === "string" ? { title: done } : done);
    } catch (err) {
      toast({ title: "That did not work", description: getFrappeErrorText(err), variant: "destructive" });
    }
    setConfirming(null);
    onDone();
  };
  const reattach = () => act(async () => {
    const r = (await reattachEstimates(args)).message;
    const title = `Copied ${plural(r.copied, "estimate", "estimates")} to the new version.`;
    const failed = r.failed ?? [];
    if (!failed.length) return title;
    // Each copy is saved on its own: a refused one does not stop the rest, and stays here to fix, add or remove.
    return {
      title: `${title} ${plural(failed.length, "could not be copied", "could not be copied")}.`,
      description: failed.map((f) => `Row ${f.excel_row ?? "—"}: ${f.reason}`).join(" · "),
    };
  });
  const remove = (names: string[]) => act(async () => {
    const r = (await settleOlder({ ...args, estimates: JSON.stringify(names) })).message;
    return `Removed from the new version: ${plural(r.settled, "older estimate", "older estimates")}. It stays in the older version's history.`;
  });

  const openForm = (e: EstimateEntry) => {
    const line = lines.find((r) => r.name === chosenLine);
    if (!line) return;
    setChoosing(null);
    setChosenLine("");
    // The older estimate is settled only after a save that keeps materials on the line; a cancelled form, or a save
    // with every row removed, leaves it listed.
    onAddTo(line, {
      rows: e.items, fromRow: e.line.excel_row,
      onKept: () => {
        void settleOlder({ ...args, estimates: JSON.stringify([e.name]) })
          .catch((err) => toast({ title: "The materials were saved, but the older estimate is still listed", description: getFrappeErrorText(err), variant: "destructive" }))
          .finally(onDone);
      },
    });
  };

  const confirmButton = (key: string, label: string, onYes: () => void) => confirming === key ? (
    <span className="flex items-center gap-1">
      <span>{label}</span>
      <Button size="sm" variant="destructive" className="h-6 text-[11px]" disabled={olderBusy} onClick={onYes}>Yes, remove</Button>
      <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => setConfirming(null)}>No</Button>
    </span>
  ) : null;

  const summary = [
    canCopy.length ? plural(canCopy.length, "not copied yet", "not copied yet") : "",
    changed.length ? plural(changed.length, "changed line needs a decision", "changed lines need a decision") : "",
  ].filter(Boolean).join(" · ");

  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <div className="flex flex-col gap-2">
        <span>
          <b>{plural(older.length, "material estimate", "material estimates")} from an older version of this sheet
          {older.length === 1 ? " is" : " are"} not on the new version yet.</b> Only the new version is counted.
          {summary && <span className="text-amber-800"> ({summary})</span>}
        </span>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            {canCopy.length > 0 && (
              <Button size="sm" variant="outline" disabled={olderBusy} onClick={reattach}>Re-attach ({canCopy.length})</Button>
            )}
          </div>
        )}
      </div>
      <ul className="mt-2 flex flex-col gap-2 text-xs">
        {older.slice(0, 30).map((e) => (
          <li key={e.name} className="flex flex-wrap items-start gap-x-2 gap-y-1 border-t border-amber-200 pt-2">
            <span className="font-mono">Row {e.line.excel_row ?? "—"}</span>
            <span className="min-w-0 flex-1">
              {e.line.description || "—"}
              {e.items.length > 0 && <span className="block text-amber-800/80">{itemsSummary(e)}</span>}
              {e.state && <span className="block italic">{STATE_TEXT[e.state]}</span>}
            </span>
            {canEdit && (confirmButton(`one:${e.name}`, "Not carry it to the new version? It stays in the older version's history.", () => remove([e.name])) ?? (choosing === e.name ? (
              <span className="flex flex-wrap items-center gap-1">
                <select className="h-6 max-w-[22rem] rounded border bg-background px-1 text-[11px]" value={chosenLine}
                  aria-label={`Line to add row ${e.line.excel_row ?? ""}'s materials to`} onChange={(ev) => setChosenLine(ev.target.value)}>
                  <option value="">Choose a current line…</option>
                  {lines.map((r) => <option key={r.name} value={r.name}>{lineLabel(r)}</option>)}
                </select>
                <Button size="sm" className="h-6 text-[11px]" disabled={!chosenLine} onClick={() => openForm(e)}>Open form</Button>
                <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => { setChoosing(null); setChosenLine(""); }}>Cancel</Button>
              </span>
            ) : (
              <span className="flex items-center gap-1">
                {(e.state === "changed" || e.state === "line_missing") && e.items.length > 0 && lines.length > 0 && (
                  <Button size="sm" variant="outline" className="h-6 text-[11px]" onClick={() => { setConfirming(null); setChoosing(e.name); }}>Add to a line…</Button>
                )}
                <Button size="sm" variant="outline" className="h-6 text-[11px]" onClick={() => { setChoosing(null); setConfirming(`one:${e.name}`); }}>
                  Remove
                </Button>
              </span>
            )))}
          </li>
        ))}
        {older.length > 30 && <li>…and {older.length - 30} more</li>}
      </ul>
    </div>
  );
};
