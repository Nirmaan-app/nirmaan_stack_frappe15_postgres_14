import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import formatToIndianRupee from "@/utils/FormatPrice";
import { tokenSearch, type TokenSearchConfig } from "@/utils/tokenSearch";
import { cn } from "@/lib/utils";
import { pickedTotals, type TransferStockRow } from "@/utils/itmTransfer";

// Same weighting as the Inventory page so multi-word queries rank alike.
const STOCK_SEARCH_CONFIG: TokenSearchConfig = {
  searchFields: ["item_name", "category", "make", "unit"],
  fieldWeights: { item_name: 2.5, category: 1.0, make: 1.0, unit: 1.0 },
  minTokenMatches: 1,
};

const HEAD = "h-9 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";

interface TransferStockTableProps {
  /** The chosen source's rows only. */
  rows: TransferStockRow[];
  /** Row key → quantity. A key present means the row is ticked. */
  picks: Record<string, number>;
  onPicksChange: (next: Record<string, number>) => void;
  emptyText: string;
}

/**
 * The New Transfer page's items: tick items of one source, enter quantities, and see each
 * line's estimated value (quantity × estimated rate) with a running total, the way a
 * financial form shows line amounts.
 */
export function TransferStockTable({ rows, picks, onPicksChange, emptyText }: TransferStockTableProps) {
  const [search, setSearch] = useState("");
  // What the user typed per row, so a just-ticked row shows an empty box (not "0")
  // and a partial entry such as "0." survives re-render. A draft is shown only while
  // it still parses to the row's quantity, so a cleared or re-ticked row starts empty.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const visible = useMemo(
    () => (search.trim() ? tokenSearch(rows, search, STOCK_SEARCH_CONFIG) : rows),
    [rows, search]
  );
  const totals = useMemo(() => pickedTotals(rows, picks), [rows, picks]);

  const toggle = (key: string) => {
    const next = { ...picks };
    if (key in next) delete next[key];
    else next[key] = 0;
    onPicksChange(next);
  };

  const setQty = (key: string, raw: string) => {
    const n = Number(raw);
    setDrafts((d) => ({ ...d, [key]: raw }));
    onPicksChange({ ...picks, [key]: raw === "" || !Number.isFinite(n) ? 0 : n });
  };

  const shownQty = (key: string, qty: number) => {
    const draft = drafts[key];
    const draftQty = draft === undefined || draft === "" ? 0 : Number(draft);
    if (draft !== undefined && draftQty === qty) return draft;
    return qty > 0 ? String(qty) : "";
  };

  if (!rows.length) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{emptyText}</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search item, make or category..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {visible.length} of {rows.length} items
        </span>
      </div>

      <div className="rounded-lg border overflow-x-auto">
        <Table className="min-w-[860px]">
          <TableHeader className="bg-muted/50">
            <TableRow className="hover:bg-transparent">
              <TableHead className={cn(HEAD, "w-10")} />
              <TableHead className={cn(HEAD, "min-w-[260px]")}>Item</TableHead>
              <TableHead className={cn(HEAD, "text-right w-[120px]")}>Available</TableHead>
              <TableHead className={cn(HEAD, "text-right w-[170px]")}>Transfer Qty</TableHead>
              <TableHead className={cn(HEAD, "text-right w-[120px]")}>Est. Rate</TableHead>
              <TableHead className={cn(HEAD, "text-right w-[140px]")}>Est. Value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                  No items match "{search}".
                </TableCell>
              </TableRow>
            ) : (
              visible.map((row) => {
                const picked = row.key in picks;
                const qty = picks[row.key] ?? 0;
                const badQty = picked && (!(qty > 0) || qty > row.available_quantity);
                const lineValue = picked && qty > 0 ? qty * (row.estimated_rate || 0) : null;
                return (
                  <TableRow
                    key={row.key}
                    data-state={picked ? "selected" : undefined}
                    className={cn(picked && "bg-primary/5 hover:bg-primary/5")}
                  >
                    <TableCell className="py-2.5">
                      <Checkbox
                        checked={picked}
                        onCheckedChange={() => toggle(row.key)}
                        aria-label={`Select ${row.item_name}`}
                      />
                    </TableCell>
                    <TableCell className="py-2.5">
                      <div className="font-medium leading-tight">{row.item_name}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {row.make || "No make"} · {row.category}
                      </div>
                    </TableCell>
                    <TableCell className="py-2.5 text-right tabular-nums">
                      {row.available_quantity}
                      <span className="ml-1 text-xs text-muted-foreground">{row.unit}</span>
                    </TableCell>
                    <TableCell className="py-2.5">
                      {picked ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <Input
                            type="number"
                            min={0}
                            max={row.available_quantity}
                            step="any"
                            placeholder="Qty"
                            aria-label={`Quantity of ${row.item_name}`}
                            value={shownQty(row.key, qty)}
                            onChange={(e) => setQty(row.key, e.target.value)}
                            className={cn(
                              "h-8 w-24 text-right tabular-nums",
                              badQty && "border-destructive focus-visible:ring-destructive"
                            )}
                          />
                          <span className="w-10 text-left text-xs text-muted-foreground">{row.unit}</span>
                        </div>
                      ) : (
                        <div className="pr-12 text-right text-muted-foreground">—</div>
                      )}
                    </TableCell>
                    <TableCell className="py-2.5 text-right tabular-nums text-muted-foreground">
                      {formatToIndianRupee(row.estimated_rate)}
                    </TableCell>
                    <TableCell className="py-2.5 text-right tabular-nums font-medium">
                      {lineValue !== null ? formatToIndianRupee(lineValue) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
          {totals.items > 0 && (
            <TableFooter className="bg-muted/40">
              <TableRow className="hover:bg-transparent">
                <TableCell />
                <TableCell colSpan={4} className="py-3 text-sm font-medium">
                  {totals.items} item{totals.items === 1 ? "" : "s"} selected
                </TableCell>
                <TableCell className="py-3 text-right text-sm font-semibold tabular-nums">
                  {formatToIndianRupee(totals.value)}
                </TableCell>
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>
    </div>
  );
}
