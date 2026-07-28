// RM-2 Tab 1 -- DATA VIEWER. The full item master for the discipline, with
// DYNAMIC columns (kind, brand, one per attribute definition, the rate fields
// present in the data, unit, source). Kind filter + a CASE-SENSITIVE text search
// across all displayed cell values (so "106.04" finds the cleaned lug rows and
// "Aluminium" finds nothing -- the data is canonical UPPERCASE). No virtualization
// by design -- this is an admin table, not the editor.

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { RateCategoryConfig, RateMasterItem } from "./rateMasterTypes";

interface Props {
  items: RateMasterItem[];
  config: RateCategoryConfig;
  disciplineLabel: string;
  categoryLabel: string;
}

type KindFilter = "all" | string;

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

export function RateMasterDataViewer({ items, config, disciplineLabel, categoryLabel }: Props) {
  const [kind, setKind] = useState<KindFilter>("all");
  const [search, setSearch] = useState("");

  // Attribute columns = every definition EXCEPT brand (brand is its own named column).
  const attrCols = useMemo(
    () => config.attribute_definitions.filter((d) => d.id !== "brand"),
    [config]
  );

  // Rate columns = union of rate keys across items, in first-seen order.
  const rateCols = useMemo(() => {
    const seen: string[] = [];
    for (const it of items) {
      for (const k of Object.keys(it.rates || {})) if (!seen.includes(k)) seen.push(k);
    }
    return seen;
  }, [items]);

  const kinds = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) set.add(it.kind);
    return Array.from(set).sort();
  }, [items]);

  const batchId = items[0]?.import_batch ?? "(none)";

  // Precompute a per-row searchable string over EVERY displayed cell.
  const rows = useMemo(() => {
    return items.map((it) => {
      const cells: string[] = [
        cellText(it.kind),
        cellText(it.brand),
        ...attrCols.map((d) => cellText(it.attributes?.[d.id])),
        ...rateCols.map((k) => cellText(it.rates?.[k])),
        cellText(it.unit),
        cellText(it.source_sheet),
        cellText(it.source_row),
      ];
      return { it, cells, haystack: cells.join("  ") };
    });
  }, [items, attrCols, rateCols]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (kind !== "all" && r.it.kind !== kind) return false;
      if (search && !r.haystack.includes(search)) return false; // CASE-SENSITIVE
      return true;
    });
  }, [rows, kind, search]);

  return (
    <div className="space-y-3">
      {/* header line: batch id + item count */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{disciplineLabel} / {categoryLabel}</span>
        <Badge variant="secondary">batch {batchId}</Badge>
        <Badge variant="outline">{items.length} items</Badge>
        <span className="text-muted-foreground">showing {filtered.length}</span>
      </div>

      {/* controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button size="sm" variant={kind === "all" ? "default" : "outline"} onClick={() => setKind("all")}>all</Button>
          {kinds.map((k) => (
            <Button key={k} size="sm" variant={kind === k ? "default" : "outline"} onClick={() => setKind(k)}>{k}</Button>
          ))}
        </div>
        <Input
          className="h-8 w-64"
          placeholder="Search cell values (case-sensitive)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* table */}
      <div className="overflow-x-auto rounded border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>kind</TableHead>
              <TableHead>brand</TableHead>
              {attrCols.map((d) => (
                <TableHead key={d.id}>{d.label}</TableHead>
              ))}
              {rateCols.map((k) => (
                <TableHead key={k} className="text-right">{k}</TableHead>
              ))}
              <TableHead>unit</TableHead>
              <TableHead>source sheet</TableHead>
              <TableHead className="text-right">row</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r, i) => (
              <TableRow key={r.it.name ?? i}>
                <TableCell>{r.it.kind}</TableCell>
                <TableCell>{r.it.brand}</TableCell>
                {attrCols.map((d) => (
                  <TableCell key={d.id}>{cellText(r.it.attributes?.[d.id])}</TableCell>
                ))}
                {rateCols.map((k) => (
                  <TableCell key={k} className="text-right tabular-nums">
                    {r.it.rates?.[k] === undefined ? "" : r.it.rates[k]}
                  </TableCell>
                ))}
                <TableCell>{r.it.unit}</TableCell>
                <TableCell>{r.it.source_sheet}</TableCell>
                <TableCell className="text-right tabular-nums">{r.it.source_row}</TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={2 + attrCols.length + rateCols.length + 3} className="text-center text-muted-foreground">
                  No rows match.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
