// RM-2 Tab 1 -- DATA VIEWER. The full item master for the discipline, with
// DYNAMIC columns (kind, brand, one per attribute definition, the rate fields
// present in the data, unit, source). Kind filter + a CASE-SENSITIVE text search
// across all displayed cell values (so "106.04" finds the cleaned lug rows and
// "Aluminium" finds nothing -- the data is canonical UPPERCASE). No virtualization
// by design -- this is an admin table, not the editor.

import { useMemo, useState } from "react";
import { Pencil, Trash2, Check, X, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { RateCategoryConfig, RateMasterItem } from "./rateMasterTypes";
import { parseFiniteInput } from "./rateMasterEdit";

interface Props {
  items: RateMasterItem[];
  config: RateCategoryConfig;
  disciplineLabel: string;
  categoryLabel: string;
  // RM-4a: admin-only editing (owner option (a)). When !isAdmin the actions column + Add control are
  // HIDDEN and the table renders exactly as the RM-2 read-only viewer.
  isAdmin?: boolean;
  onSaveItem?: (
    name: string,
    patch: { rates_patch?: Record<string, number | null>; attributes_patch?: Record<string, string | number> },
  ) => Promise<void>;
  onCreateItem?: (payload: {
    kind: string; brand?: string; unit?: string;
    attributes: Record<string, string | number>; rates: Record<string, number | null>;
  }) => Promise<void>;
  onDeactivateItem?: (name: string) => Promise<void>;
}

type KindFilter = "all" | string;

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

export function RateMasterDataViewer({
  items, config, disciplineLabel, categoryLabel, isAdmin, onSaveItem, onCreateItem, onDeactivateItem,
}: Props) {
  const [kind, setKind] = useState<KindFilter>("all");
  const [search, setSearch] = useState("");
  const canEdit = !!isAdmin && !!onSaveItem;
  // RM-4a edit state: the row being inline-edited + its draft attr/rate values (strings, per input).
  const [editingRow, setEditingRow] = useState<string | null>(null);
  const [draftAttrs, setDraftAttrs] = useState<Record<string, string>>({});
  const [draftRates, setDraftRates] = useState<Record<string, string>>({});
  const [rowSaving, setRowSaving] = useState(false);
  const [rowErr, setRowErr] = useState<string | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState<{ name: string; label: string } | null>(null);
  const [addOpen, setAddOpen] = useState(false);

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

  // RM-4a edit handlers -----------------------------------------------------------------------------
  const beginEdit = (it: RateMasterItem) => {
    setRowErr(null);
    const a: Record<string, string> = {};
    for (const d of attrCols) a[d.id] = cellText(it.attributes?.[d.id]);
    const rr: Record<string, string> = {};
    for (const k of rateCols) rr[k] = cellText(it.rates?.[k]);
    setDraftAttrs(a);
    setDraftRates(rr);
    setEditingRow(it.name ?? null);
  };
  const cancelEdit = () => {
    setEditingRow(null);
    setRowErr(null);
  };
  const saveEdit = async (it: RateMasterItem) => {
    if (!onSaveItem || !it.name) return;
    // Only the CHANGED cells go in the patch. Rates are numeric-or-null; a blank rate cell => null.
    const rates_patch: Record<string, number | null> = {};
    for (const k of rateCols) {
      const raw = draftRates[k] ?? "";
      const orig = cellText(it.rates?.[k]);
      if (raw === orig) continue;
      if (raw.trim() === "") {
        rates_patch[k] = null;
      } else {
        const n = parseFiniteInput(raw);
        if (n === null) {
          setRowErr(`Rate '${k}' must be a number.`);
          return;
        }
        rates_patch[k] = n;
      }
    }
    const attributes_patch: Record<string, string | number> = {};
    for (const d of attrCols) {
      const raw = draftAttrs[d.id] ?? "";
      const orig = cellText(it.attributes?.[d.id]);
      if (raw === orig) continue;
      // number-typed attributes are stored numeric; keep choice/text as-is (server canonicalises).
      attributes_patch[d.id] = d.type === "number" && raw.trim() !== "" ? Number(raw) : raw;
    }
    if (Object.keys(rates_patch).length === 0 && Object.keys(attributes_patch).length === 0) {
      cancelEdit();
      return;
    }
    setRowSaving(true);
    setRowErr(null);
    try {
      await onSaveItem(it.name, {
        rates_patch: Object.keys(rates_patch).length ? rates_patch : undefined,
        attributes_patch: Object.keys(attributes_patch).length ? attributes_patch : undefined,
      });
      setEditingRow(null);
    } catch (e) {
      setRowErr((e as { message?: string })?.message ?? "Save failed");
    } finally {
      setRowSaving(false);
    }
  };
  const doDeactivate = async () => {
    if (!onDeactivateItem || !confirmDeactivate) return;
    try {
      await onDeactivateItem(confirmDeactivate.name);
    } finally {
      setConfirmDeactivate(null);
    }
  };

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
        {/* RM-4a: admin-only Add control (HIDDEN for non-admins). */}
        {isAdmin && onCreateItem && (
          <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Add row
          </Button>
        )}
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
              {canEdit && <TableHead className="text-right">actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r, i) => {
              const editing = canEdit && editingRow === r.it.name;
              return (
              <TableRow key={r.it.name ?? i}>
                <TableCell>{r.it.kind}</TableCell>
                <TableCell>{r.it.brand}</TableCell>
                {attrCols.map((d) => (
                  <TableCell key={d.id}>
                    {editing ? (
                      <Input
                        className="h-7 w-28 text-xs"
                        value={draftAttrs[d.id] ?? ""}
                        disabled={rowSaving}
                        onChange={(e) => setDraftAttrs((p) => ({ ...p, [d.id]: e.target.value }))}
                        aria-label={`${d.label} value`}
                      />
                    ) : (
                      cellText(r.it.attributes?.[d.id])
                    )}
                  </TableCell>
                ))}
                {rateCols.map((k) => (
                  <TableCell key={k} className="text-right tabular-nums">
                    {editing ? (
                      <Input
                        className="h-7 w-24 text-right text-xs"
                        inputMode="decimal"
                        value={draftRates[k] ?? ""}
                        disabled={rowSaving}
                        onChange={(e) => setDraftRates((p) => ({ ...p, [k]: e.target.value }))}
                        aria-label={`${k} value`}
                      />
                    ) : r.it.rates?.[k] === undefined ? (
                      ""
                    ) : (
                      r.it.rates[k]
                    )}
                  </TableCell>
                ))}
                <TableCell>{r.it.unit}</TableCell>
                <TableCell>{r.it.source_sheet}</TableCell>
                <TableCell className="text-right tabular-nums">{r.it.source_row}</TableCell>
                {canEdit && (
                  <TableCell className="text-right">
                    {editing ? (
                      <div className="flex items-center justify-end gap-1">
                        {rowErr && <span className="text-[10px] text-destructive">{rowErr}</span>}
                        <Button size="icon" variant="ghost" className="h-7 w-7" disabled={rowSaving} aria-label="Save row" onClick={() => void saveEdit(r.it)}>
                          <Check className="h-4 w-4 text-emerald-600" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" disabled={rowSaving} aria-label="Cancel edit" onClick={cancelEdit}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-end gap-1">
                        <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Edit row" onClick={() => beginEdit(r.it)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        {onDeactivateItem && (
                          <Button
                            size="icon" variant="ghost" className="h-7 w-7 text-destructive" aria-label="Deactivate row"
                            onClick={() => setConfirmDeactivate({ name: r.it.name ?? "", label: `${r.it.kind} ${cellText(r.it.attributes?.material)}` })}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    )}
                  </TableCell>
                )}
              </TableRow>
              );
            })}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={2 + attrCols.length + rateCols.length + 3 + (canEdit ? 1 : 0)} className="text-center text-muted-foreground">
                  No rows match.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* RM-4a: deactivate confirm (freeze-and-supersede -- the row is retained inactive, never deleted). */}
      <AlertDialog open={!!confirmDeactivate} onOpenChange={(o) => !o && setConfirmDeactivate(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate this rate row?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDeactivate?.label} will drop from the active list (it is retained inactive, never
              deleted). New suggestions stop using it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void doDeactivate()}>Deactivate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* RM-4a: add a manual item (built from the attribute definitions + known rate keys). */}
      {isAdmin && onCreateItem && (
        <AddItemDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          config={config}
          rateCols={rateCols}
          kinds={kinds}
          onCreate={onCreateItem}
        />
      )}
    </div>
  );
}

// RM-4a: the Add-item form -- selects/inputs built from the attribute definitions + the known rate
// keys. Attribute choices come from each definition's stored values; numbers + rates are free inputs.
// Manual provenance ("Manual entry", batch manual-...) is stamped server-side.
function AddItemDialog({
  open, onOpenChange, config, rateCols, kinds, onCreate,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  config: RateCategoryConfig;
  rateCols: string[];
  kinds: string[];
  onCreate: (payload: {
    kind: string; brand?: string; unit?: string;
    attributes: Record<string, string | number>; rates: Record<string, number | null>;
  }) => Promise<void>;
}) {
  const attrDefs = useMemo(() => config.attribute_definitions.filter((d) => d.id !== "brand"), [config]);
  const brandDef = useMemo(() => config.attribute_definitions.find((d) => d.id === "brand"), [config]);
  const [kind, setKind] = useState(kinds[0] ?? "cable");
  const [brand, setBrand] = useState(String(brandDef?.values?.[0] ?? ""));
  const [unit, setUnit] = useState("");
  const [attrs, setAttrs] = useState<Record<string, string>>({});
  const [rates, setRates] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    const attributes: Record<string, string | number> = {};
    for (const d of attrDefs) {
      const raw = attrs[d.id];
      if (raw === undefined || raw === "") continue;
      attributes[d.id] = d.type === "number" ? Number(raw) : raw;
    }
    const rateOut: Record<string, number | null> = {};
    for (const k of rateCols) {
      const raw = rates[k];
      if (raw === undefined || raw.trim() === "") continue;
      const n = parseFiniteInput(raw);
      if (n === null) {
        setErr(`Rate '${k}' must be a number.`);
        return;
      }
      rateOut[k] = n;
    }
    setSaving(true);
    setErr(null);
    try {
      await onCreate({ kind, brand: brand || undefined, unit: unit || undefined, attributes, rates: rateOut });
      onOpenChange(false);
      setAttrs({});
      setRates({});
    } catch (e) {
      setErr((e as { message?: string })?.message ?? "Create failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add rate master item</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">kind</span>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(kinds.length ? kinds : ["cable", "termination"]).map((k) => (
                  <SelectItem key={k} value={k}>{k}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">brand</span>
            <Input className="h-8" value={brand} onChange={(e) => setBrand(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">unit</span>
            <Input className="h-8" value={unit} onChange={(e) => setUnit(e.target.value)} />
          </label>
          {attrDefs.map((d) => (
            <label key={d.id} className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{d.label}</span>
              {d.type === "choice" && d.values?.length ? (
                <Select value={attrs[d.id] ?? ""} onValueChange={(v) => setAttrs((p) => ({ ...p, [d.id]: v }))}>
                  <SelectTrigger className="h-8"><SelectValue placeholder={`Select ${d.label}`} /></SelectTrigger>
                  <SelectContent>
                    {d.values.map((v) => (
                      <SelectItem key={String(v)} value={String(v)}>{String(v)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  className="h-8"
                  inputMode={d.type === "number" ? "decimal" : "text"}
                  value={attrs[d.id] ?? ""}
                  onChange={(e) => setAttrs((p) => ({ ...p, [d.id]: e.target.value }))}
                />
              )}
            </label>
          ))}
          {rateCols.map((k) => (
            <label key={k} className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{k}</span>
              <Input
                className="h-8"
                inputMode="decimal"
                value={rates[k] ?? ""}
                onChange={(e) => setRates((p) => ({ ...p, [k]: e.target.value }))}
              />
            </label>
          ))}
        </div>
        {err && <p className="text-xs text-destructive">{err}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={saving || !kind}>Add item</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
