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
  can_copy: "Unchanged on the new version: Re-attach copies it there.",
  copied: "Copied to the new version. This older one is kept as a backup.",
  line_has_other: "The new version's line already has different materials, so this older one is not a backup. Add its materials to a line, or remove it.",
  changed: "This line changed on the new version, so it cannot be copied. Add its materials to a line, or remove it.",
  line_missing: "Its line item no longer exists in the BOQ (it was deleted). Add its materials to a line, or remove it.",
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Decision M, as revised by the owner on 11 Nov: estimates a re-commit left on an older version of this sheet. The
 * BOQ commit is unchanged. What each one can do comes from the server (`state`, the same in every view):
 *  - can_copy: Re-attach COPIES it onto its unchanged line of the new version and keeps it as a backup;
 *  - copied: Undo (deletes the copy, keeps the backup) or Remove old (deletes the backup, keeps the copy);
 *  - line_has_other: the line holds different materials (a copy edited since, or typed by hand -- nothing tells
 *    them apart), so it is never a backup: like changed, Add to a line or Remove; Undo and Remove all old skip it;
 *  - changed: Add to a line (form opens on a chosen line with its materials; the backup goes after Save) or Remove;
 *  - line_missing: its line item was deleted from the BOQ tables; the same two choices as changed.
 * Global buttons do the same for every row they apply to. Every delete asks first.
 */
export const OlderVersionNotice: React.FC<OlderVersionNoticeProps> = ({ boq, sheetName, older, canEdit, onDone, lines, onAddTo }) => {
  const { reattachEstimates, undoReattach, removeOlder, olderBusy } = useEstimateWrites();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<string | null>(null);
  const [chosenLine, setChosenLine] = useState("");
  if (!older.length) return null;

  const of = (s: OlderState) => older.filter((e) => e.state === s);
  const canCopy = of("can_copy");
  const copied = of("copied");
  // A backup is only an older estimate whose materials are exactly on its new line: removing it loses nothing.
  const backups = copied;
  const changed = [...of("changed"), ...of("line_has_other"), ...of("line_missing")];
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
    const title = `Copied ${plural(r.copied, "estimate", "estimates")} to the new version. The older ones are kept as backups.`;
    const failed = r.failed ?? [];
    if (!failed.length) return title;
    // Each copy is saved on its own: a refused one does not stop the rest, and stays here to fix, add or remove.
    return {
      title: `${title} ${plural(failed.length, "could not be copied", "could not be copied")}.`,
      description: failed.map((f) => `Row ${f.excel_row ?? "—"}: ${f.reason}`).join(" · "),
    };
  });
  const undo = (names?: string[]) => act(async () => {
    const r = (await undoReattach({ ...args, estimates: JSON.stringify(names ?? []) })).message;
    return `Undone: removed ${plural(r.undone, "copy", "copies")} from the new version` +
      (r.skipped.length ? `; ${r.skipped.length} kept because the new line has different materials.` : ".");
  });
  const remove = (names?: string[]) => act(async () => {
    const r = (await removeOlder({ ...args, estimates: JSON.stringify(names ?? []) })).message;
    return `Removed ${plural(r.removed, "older estimate", "older estimates")}.`;
  });

  const openForm = (e: EstimateEntry) => {
    const line = lines.find((r) => r.name === chosenLine);
    if (!line) return;
    setChoosing(null);
    setChosenLine("");
    // The older estimate is removed only after a save that keeps materials on the line; a cancelled form, or a save
    // with every row removed, leaves it listed.
    onAddTo(line, {
      rows: e.items, fromRow: e.line.excel_row,
      onKept: () => {
        void removeOlder({ ...args, estimates: JSON.stringify([e.name]) })
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
    canCopy.length ? plural(canCopy.length, "can be copied", "can be copied") : "",
    backups.length ? plural(backups.length, "is copied and kept as a backup", "are copied and kept as backups") : "",
    changed.length ? plural(changed.length, "changed line needs a decision", "changed lines need a decision") : "",
  ].filter(Boolean).join(" · ");

  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <div className="flex flex-col gap-2">
        <span>
          <b>{plural(older.length, "material estimate is", "material estimates are")} on an older version of this sheet</b>, because it was
          committed again. Only the new version is counted. {summary && <span className="text-amber-800">({summary})</span>}
        </span>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            {canCopy.length > 0 && (
              <Button size="sm" variant="outline" disabled={olderBusy} onClick={reattach}>Re-attach ({canCopy.length})</Button>
            )}
            {copied.length > 0 && (
              <Button size="sm" variant="outline" disabled={olderBusy} onClick={() => undo()}>Undo all ({copied.length})</Button>
            )}
            {backups.length > 0 && (confirmButton("all", `Delete ${plural(backups.length, "backup", "backups")}? The copies on the new version stay.`, () => remove())
              ?? <Button size="sm" variant="outline" disabled={olderBusy} onClick={() => setConfirming("all")}>Remove all old ({backups.length})</Button>)}
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
            {canEdit && (confirmButton(`one:${e.name}`, "Delete this older estimate?", () => remove([e.name])) ?? (choosing === e.name ? (
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
                {e.state === "copied" && (
                  <Button size="sm" variant="outline" className="h-6 text-[11px]" disabled={olderBusy} onClick={() => undo([e.name])}>Undo</Button>
                )}
                {(e.state === "changed" || e.state === "line_has_other" || e.state === "line_missing") && e.items.length > 0 && lines.length > 0 && (
                  <Button size="sm" variant="outline" className="h-6 text-[11px]" onClick={() => { setConfirming(null); setChoosing(e.name); }}>Add to a line…</Button>
                )}
                <Button size="sm" variant="outline" className="h-6 text-[11px]" onClick={() => { setChoosing(null); setConfirming(`one:${e.name}`); }}>
                  {e.state === "copied" ? "Remove old" : "Remove"}
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
