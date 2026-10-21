import type { ReactNode } from "react";
import { Loader2, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/utils/FormatDate";
import { originBadge } from "./boqOriginBadge";
import { selectionActionLabel, type BoqSelectionTarget } from "./boqSelection";

export interface BoqListRow {
  name: string;
  boq_name: string;
  version: number;
  wizard_state: string;
  /** Draft / Selected (/ Approved / Superseded, unused) -- ADR-0037. Decides the Won page's table. */
  status: string;
  uploaded_at: string;
  creation: string;
  // Deliberately widened to a plain string, NOT the "upload" | "template" union in boqTypes.ts:
  // live data already violates that union (see boqOriginBadge.ts).
  origin?: string | null;
}

const WIZARD_STATE_LABELS: Record<string, string> = {
  "": "Not started",
  "In progress": "In progress",
  "Configured": "Configured",
  "Parsed": "Parsed",
};

interface BoqListTableProps {
  rows: BoqListRow[];
  /** Draw the Action column's pencil (opens the wizard hub). */
  canEdit: boolean;
  /** Draw the checkbox column -- an Admin on the Won page only (ADR-0037 D7). */
  checkable: boolean;
  /** Names checked in THIS table. */
  checked: ReadonlySet<string>;
  onCheckedChange: (next: Set<string>) => void;
  /** The row resolving its landing sheet, if any (spinner beside its name). */
  openingBoq: string | null;
  onOpenView: (boqName: string) => void;
  onEdit: (boqName: string) => void;
  /** One full-width row shown when `rows` is empty. */
  emptyMessage?: ReactNode;
  /** Tint the whole table light yellow -- the Won page's Other BoQs (owner 2026-10-21). */
  tinted?: boolean;
}

/**
 * One table of a project's BoQs. The project BoQs tab renders one on a pre-Won stub and two on a
 * Won project -- Selected BoQs and Other BoQs (ADR-0037 D5). The columns are the same either way;
 * the Status column is the wizard progress, not the BoQ status (D5).
 */
export function BoqListTable({
  rows,
  canEdit,
  checkable,
  checked,
  onCheckedChange,
  openingBoq,
  onOpenView,
  onEdit,
  emptyMessage,
  tinted = false,
}: BoqListTableProps) {
  const checkedCount = rows.filter((row) => checked.has(row.name)).length;
  const allChecked = rows.length > 0 && checkedCount === rows.length;
  const columnCount = 5 + (canEdit ? 1 : 0) + (checkable ? 1 : 0);

  const toggleRow = (name: string, on: boolean) => {
    const next = new Set(checked);
    if (on) next.add(name);
    else next.delete(name);
    onCheckedChange(next);
  };

  return (
    <div
      className={`rounded-md border overflow-x-auto ${
        tinted ? "border-amber-200 bg-amber-50/70 dark:border-amber-900/60 dark:bg-amber-950/20" : ""
      }`}
    >
      <Table>
        <TableHeader className={tinted ? "bg-amber-100/60 dark:bg-amber-900/30" : "bg-background"}>
          <TableRow>
            {checkable && (
              <TableHead className="w-10">
                <Checkbox
                  aria-label="Check every BoQ in this table"
                  disabled={rows.length === 0}
                  checked={allChecked ? true : checkedCount > 0 ? "indeterminate" : false}
                  onCheckedChange={(value) =>
                    onCheckedChange(value === true ? new Set(rows.map((row) => row.name)) : new Set())
                  }
                />
              </TableHead>
            )}
            <TableHead>BoQ Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Version</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Uploaded</TableHead>
            {canEdit && <TableHead className="text-right">Action</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && emptyMessage && (
            <TableRow>
              <TableCell colSpan={columnCount} className="py-6 text-center text-sm text-muted-foreground">
                {emptyMessage}
              </TableCell>
            </TableRow>
          )}
          {rows.map((row) => {
            const origin = originBadge(row.origin);
            return (
              /* The row IS the primary action (open the read-only viewer), so it needs its own
                 keyboard path -- the pencil beside it is a <Button> and therefore focusable, and a
                 design where only the SECONDARY destination is reachable by keyboard is worse than
                 one where neither is.
                 ⚠️ tabIndex + onKeyDown ONLY -- NO role override. A `role="link"`/`"button"` on a
                 <tr> replaces its implicit `row` role, which detaches the <td>s from the table
                 structure for assistive tech: it would trade a keyboard gap for a semantics bug.
                 The row keeps its row role and its cells keep their headers; Enter/Space activate
                 it, and the focus ring says it is reachable. */
              <TableRow
                key={row.name}
                tabIndex={0}
                className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                onClick={() => onOpenView(row.name)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" && e.key !== " ") return;
                  if (e.target !== e.currentTarget) return; // a key on the checkbox or pencil
                  e.preventDefault(); // Space would scroll the page
                  onOpenView(row.name);
                }}
              >
                {checkable && (
                  // The cell swallows the click so checking a box never opens the viewer.
                  <TableCell className="py-2 px-3 w-10" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      aria-label={`Check ${row.boq_name || row.name}`}
                      checked={checked.has(row.name)}
                      onCheckedChange={(value) => toggleRow(row.name, value === true)}
                    />
                  </TableCell>
                )}
                <TableCell className="py-2 px-3 font-medium">
                  <span className="inline-flex items-center gap-2">
                    {row.boq_name || row.name}
                    {openingBoq === row.name && (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    )}
                  </span>
                </TableCell>
                <TableCell className="py-2 px-3">
                  <Badge variant={origin.variant} className="whitespace-nowrap font-medium">
                    {origin.label}
                  </Badge>
                </TableCell>
                <TableCell className="py-2 px-3 text-sm text-muted-foreground">
                  v{row.version}
                </TableCell>
                <TableCell className="py-2 px-3">
                  <Badge variant="outline">
                    {WIZARD_STATE_LABELS[row.wizard_state ?? ""] ?? row.wizard_state}
                  </Badge>
                </TableCell>
                <TableCell className="py-2 px-3 text-sm text-muted-foreground">
                  {formatDate(row.uploaded_at || row.creation)}
                </TableCell>
                {canEdit && (
                  <TableCell className="py-2 px-3 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label="Edit BoQ"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEdit(row.name);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

interface BoqSelectionBarProps {
  target: BoqSelectionTarget;
  checkedCount: number;
  onAction: () => void;
  onClear: () => void;
}

/** The bar under a table while an Admin has boxes checked in it: one action, and Clear (D7). */
export function BoqSelectionBar({ target, checkedCount, onAction, onClear }: BoqSelectionBarProps) {
  if (checkedCount === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/40 px-3 py-2 text-sm">
      <span className="text-muted-foreground">{checkedCount} checked</span>
      <Button size="sm" onClick={onAction}>
        {selectionActionLabel(target)}
      </Button>
      <Button size="sm" variant="ghost" onClick={onClear}>
        Clear
      </Button>
    </div>
  );
}
