import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Info } from "lucide-react";
import { ColumnUnit, COLUMN_GROUPS, NUMERIC_COLUMNS } from "./wipColumns";

/**
 * "How these columns are calculated" — the help dialog behind the ⓘ in the toolbar.
 *
 * It renders ENTIRELY from `NUMERIC_COLUMNS` + `COLUMN_GROUPS`, the same two arrays
 * that drive the table header, the body cells and the sorting. That is deliberate:
 * a help text maintained separately from the column it describes goes stale the first
 * time a rule changes and nothing fails. Adding or re-scoping a column updates the
 * table and this dialog in one edit.
 *
 * The unit chip is the load-bearing element. A `documents` column sitting beside a
 * `POs` column is exactly what reads as a subtraction and is not one — every question
 * this dialog exists to answer traces back to that.
 */

/** Chip colours per unit. Semantic, and deliberately NOT the page's red/sky accents —
 *  these classify a column, they do not flag a state. */
const UNIT_CLASS: Record<ColumnUnit, string> = {
  days: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  reports: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  documents: "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  POs: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
};

/** The first COLUMN_GROUPS entry is "Project" (3 non-numeric columns), so the numeric
 *  groups start at index 1. Walking the spans keeps the dialog's grouping identical to
 *  the table header's without a second hand-maintained list. */
function groupedColumns() {
  const out: { label: string; lifetime: boolean; columns: typeof NUMERIC_COLUMNS }[] = [];
  let cursor = 0;
  COLUMN_GROUPS.slice(1).forEach((g) => {
    const columns = NUMERIC_COLUMNS.slice(cursor, cursor + g.span);
    cursor += g.span;
    out.push({ label: g.label, lifetime: columns.every((c) => c.lifetime), columns });
  });
  return out;
}

export function WipFormulaDialog() {
  const groups = groupedColumns();

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="px-2.5"
          aria-label="How these columns are calculated"
          title="How these columns are calculated"
        >
          <Info className="h-4 w-4" />
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>How these columns are calculated</DialogTitle>
          <DialogDescription>
            Every figure in the table, with its source, its filters and the rule behind it.
          </DialogDescription>
        </DialogHeader>

        {/* The two things people get wrong, stated before any column detail. */}
        <div className="rounded-md border border-l-[3px] border-l-blue-600 bg-muted/50 p-3 text-sm space-y-1.5">
          <p>
            <span className="font-semibold">Mind the units.</span>{" "}
            <span className="italic">Total</span> columns count <span className="font-semibold">documents</span>.{" "}
            <span className="italic">Missing</span> columns count{" "}
            <span className="font-semibold">purchase orders</span>. A row is not meant to add up across.
          </p>
          <p>
            <span className="font-semibold">Scope.</span> DPR and Inventory follow the selected month.
            Delivery Notes and Delivery Challans are <span className="font-semibold">lifetime</span> —
            unaffected by the month picker.
          </p>
          <p>
            <span className="font-semibold">Billable.</span> A Non-Billable PO can never receive a challan,
            so it can never be compliant — <span className="font-semibold">Missing DN</span>,{" "}
            <span className="font-semibold">Missing DC</span> and <span className="font-semibold">Total DC</span>{" "}
            therefore count Billable POs only. <span className="font-semibold">Disp PO</span> and{" "}
            <span className="font-semibold">Total DN</span> count both; hover either cell for its split. That
            makes Disp PO a larger denominator than the two Missing columns are measured against.
          </p>
        </div>

        <div className="space-y-6 pt-1">
          {groups.map((group) => (
            <section key={group.label}>
              <h3 className="flex items-center gap-2 border-b pb-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                {group.label}
                {group.lifetime && (
                  <span className="rounded border px-1 py-0 text-[10px] font-normal normal-case tracking-normal">
                    lifetime
                  </span>
                )}
              </h3>

              <dl className="divide-y">
                {group.columns.map((col) => (
                  <div key={col.key} className="grid grid-cols-1 gap-1 py-2.5 sm:grid-cols-[10rem_1fr] sm:gap-4">
                    <dt>
                      <div className={cn("text-sm font-semibold", col.danger && "text-destructive")}>
                        {col.label}
                      </div>
                      <span
                        className={cn(
                          "mt-1 inline-block rounded px-1.5 py-0 font-mono text-[10px] uppercase tracking-wide",
                          UNIT_CLASS[col.unit]
                        )}
                      >
                        {col.unit}
                      </span>
                    </dt>

                    <dd className="space-y-1.5 text-sm text-muted-foreground">
                      <p>
                        <span className="font-medium text-foreground">{col.formula}</span>
                      </p>

                      <p className="text-xs">
                        <span className="uppercase tracking-wide text-muted-foreground/70">Source</span>{" "}
                        <span className="font-mono">{col.source}</span>
                      </p>

                      {col.conditions.length > 0 && (
                        <div className="text-xs">
                          <span className="uppercase tracking-wide text-muted-foreground/70">Conditions</span>
                          <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
                            {col.conditions.map((c) => (
                              <li key={c}>{c}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {col.note && <p className="text-xs italic">{col.note}</p>}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>

        {/* The question this dialog is most often opened to answer: why one column counts
            Non-Billable POs and the next one does not. */}
        <div className="rounded-md border bg-muted/50 p-3">
          <h4 className="mb-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Which columns include Non-Billable POs
          </h4>
          <table className="w-full text-xs">
            <tbody>
              <tr className="border-b">
                <td className="py-1 font-medium">Disp PO</td>
                <td className="py-1">both — hover for the split</td>
              </tr>
              <tr className="border-b">
                <td className="py-1 font-medium">Total DN</td>
                <td className="py-1">both — hover for the split (returns still excluded)</td>
              </tr>
              <tr className="border-b">
                <td className="py-1 font-medium">Total DC</td>
                <td className="py-1">Billable only</td>
              </tr>
              <tr className="border-b">
                <td className="py-1 font-medium">Missing DN</td>
                <td className="py-1">Billable only</td>
              </tr>
              <tr>
                <td className="py-1 font-medium">Missing DC</td>
                <td className="py-1">Billable only</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted-foreground">
            So Total DN can exceed Disp PO (one PO carries several notes), and Total DC can read lower
            than the DC count on the project&rsquo;s DC &amp; MIR tab, which is not Billable-filtered.
          </p>
        </div>

      </DialogContent>
    </Dialog>
  );
}

export default WipFormulaDialog;
