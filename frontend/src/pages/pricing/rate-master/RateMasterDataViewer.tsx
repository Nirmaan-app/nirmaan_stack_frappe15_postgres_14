// RM-2 Tab 1 -- DATA VIEWER. The full item master for the discipline, with
// DYNAMIC columns (kind, brand, one per attribute definition, the rate fields
// present in the data, unit, source). Kind filter + a CASE-SENSITIVE text search
// across all displayed cell values (so "106.04" finds the cleaned lug rows and
// "Aluminium" finds nothing -- the data is canonical UPPERCASE). No virtualization
// by design -- this is an admin table, not the editor.

import { useEffect, useMemo, useRef, useState } from "react";
import { Pencil, Trash2, Check, X, Plus, Filter } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { RateCategoryConfig, RateMasterItem } from "./rateMasterTypes";
import { parseFiniteInput } from "./rateMasterEdit";
import { categoryItemKinds } from "./rateMasterStructure";

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

  // EA-1c change 1: SCOPE the Data tab to the selected category's items. The kinds come from the
  // config's declared item_kinds, else (legacy wiring) derived from its pipelines' match_master_row.
  // The `items` prop is discipline-wide; we show only rows whose kind belongs to this category. A
  // config with no derivable kinds (shouldn't happen for a real config) falls back to all rows.
  const categoryKinds = useMemo(() => categoryItemKinds(config), [config]);
  const scopedItems = useMemo(
    () => (categoryKinds.length ? items.filter((it) => categoryKinds.includes(it.kind)) : items),
    [items, categoryKinds]
  );
  // The kind column + chips only appear when the category spans MORE THAN ONE kind.
  const showKindCol = categoryKinds.length > 1;

  // Attribute columns = every definition EXCEPT brand (brand is its own named column).
  const attrCols = useMemo(
    () => config.attribute_definitions.filter((d) => d.id !== "brand"),
    [config]
  );

  // Rate columns = union of rate keys across THIS CATEGORY's items, in first-seen order.
  const rateCols = useMemo(() => {
    const seen: string[] = [];
    for (const it of scopedItems) {
      for (const k of Object.keys(it.rates || {})) if (!seen.includes(k)) seen.push(k);
    }
    return seen;
  }, [scopedItems]);

  // Kind filter chips = this category's kinds (present in its items), sorted.
  const kinds = useMemo(() => {
    const set = new Set<string>();
    for (const it of scopedItems) set.add(it.kind);
    return Array.from(set).sort();
  }, [scopedItems]);

  const batchId = scopedItems[0]?.import_batch ?? "(none)";

  // EA-1c change 3: the RM-3b PROXY H-SCROLLBAR -- ONE always-visible bar. The real scroller's native
  // H-bar is suppressed (boq-embed-hidehbar), a sticky bottom proxy mirrors its scrollLeft two-way, and
  // the proxy's visible width == the scroller's clientWidth (V-bar leak accounted) with a spacer ==
  // scrollWidth (full extent, live-measured via ResizeObserver). Same pattern as PricingGrid.tsx.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const proxyRef = useRef<HTMLDivElement | null>(null);
  const [hScroll, setHScroll] = useState({ clientWidth: 0, scrollWidth: 0 });

  // Reset the filter/search state when switching category (the component persists across categories).
  useEffect(() => {
    setKind("all");
    setSearch("");
    setColumnFilters({});
  }, [config.category_id]);

  // Per-column faceted filters: a unified column model (key + how to read the cell) drives BOTH the
  // distinct-value dropdowns and the row predicate, so a new attribute/rate column self-registers.
  const columns = useMemo(
    () => [
      ...(showKindCol ? [{ key: "kind", get: (it: RateMasterItem) => it.kind }] : []),
      { key: "brand", get: (it: RateMasterItem) => it.brand },
      ...attrCols.map((d) => ({ key: `attr:${d.id}`, get: (it: RateMasterItem) => it.attributes?.[d.id] })),
      ...rateCols.map((k) => ({ key: `rate:${k}`, get: (it: RateMasterItem) => it.rates?.[k] })),
      { key: "unit", get: (it: RateMasterItem) => it.unit },
      { key: "source_sheet", get: (it: RateMasterItem) => it.source_sheet },
      { key: "source_row", get: (it: RateMasterItem) => it.source_row },
    ],
    [showKindCol, attrCols, rateCols],
  );
  const distinctByColumn = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const c of columns) {
      const set = new Set<string>();
      for (const it of scopedItems) {
        const v = cellText(c.get(it));
        if (v !== "") set.add(v);
      }
      m[c.key] = Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    }
    return m;
  }, [columns, scopedItems]);
  const getForColumn = useMemo(() => {
    const m: Record<string, (it: RateMasterItem) => unknown> = {};
    for (const c of columns) m[c.key] = c.get;
    return m;
  }, [columns]);
  // Selected values per column (empty / absent => that column does not filter).
  const [columnFilters, setColumnFilters] = useState<Record<string, string[]>>({});
  const setColumnFilter = (key: string, next: string[]) =>
    setColumnFilters((p) => {
      const n = { ...p };
      if (next.length) n[key] = next;
      else delete n[key];
      return n;
    });
  const activeColumnFilterCount = Object.keys(columnFilters).length;

  // Precompute a per-row searchable string over EVERY displayed cell.
  const rows = useMemo(() => {
    return scopedItems.map((it) => {
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
  }, [scopedItems, attrCols, rateCols]);

  const filtered = useMemo(() => {
    const filterEntries = Object.entries(columnFilters);
    return rows.filter((r) => {
      if (kind !== "all" && r.it.kind !== kind) return false;
      if (search && !r.haystack.includes(search)) return false; // CASE-SENSITIVE
      // per-column facets: a row passes iff its cell value is in EVERY active column's selected set (AND
      // across columns, OR within a column). A stale filter key whose column no longer exists (e.g. the
      // kind funnel after switching to a single-kind category) is skipped, not treated as no-match.
      for (const [key, sel] of filterEntries) {
        const getter = getForColumn[key];
        if (!getter) continue;
        if (!sel.includes(cellText(getter(r.it)))) return false;
      }
      return true;
    });
  }, [rows, kind, search, columnFilters, getForColumn]);

  // Proxy scrollbar metrics: live-measure the real scroller (+ its table for content-width changes)
  // via a ResizeObserver. clientWidth (excludes the V-bar -> no end clamp) = proxy visible width;
  // scrollWidth (full extent) = spacer width. A guarded no-op keeps re-renders to genuine size changes.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const measure = () =>
      setHScroll((m) => {
        const clientWidth = scroller.clientWidth;
        const scrollWidth = scroller.scrollWidth;
        return m.clientWidth === clientWidth && m.scrollWidth === scrollWidth ? m : { clientWidth, scrollWidth };
      });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(scroller);
    const table = scroller.querySelector("table");
    if (table) ro.observe(table);
    return () => ro.disconnect();
  }, [columns.length, filtered.length]);
  // Two-way scrollLeft sync between the proxy bar and the real scroller (layout only; a latch stops the
  // ping-pong). Re-wired when the content width changes.
  useEffect(() => {
    const proxy = proxyRef.current;
    const scroller = scrollRef.current;
    if (!proxy || !scroller) return;
    let syncing = false;
    const fromProxy = () => {
      if (syncing) return;
      syncing = true;
      scroller.scrollLeft = proxy.scrollLeft;
      syncing = false;
    };
    const fromScroller = () => {
      if (syncing) return;
      syncing = true;
      proxy.scrollLeft = scroller.scrollLeft;
      syncing = false;
    };
    proxy.addEventListener("scroll", fromProxy, { passive: true });
    scroller.addEventListener("scroll", fromScroller, { passive: true });
    fromScroller(); // seed the proxy thumb to the current position
    return () => {
      proxy.removeEventListener("scroll", fromProxy);
      scroller.removeEventListener("scroll", fromScroller);
    };
  }, [hScroll.scrollWidth]);

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

  // A column header = its label + a per-column faceted filter (funnel -> search + checkbox list).
  const hdr = (colKey: string, label: string, rightAlign = false) => (
    <div className={cn("flex items-center gap-1", rightAlign && "justify-end")}>
      <span>{label}</span>
      <ColumnFilter
        label={label}
        values={distinctByColumn[colKey] ?? []}
        selected={columnFilters[colKey] ?? []}
        onChange={(next) => setColumnFilter(colKey, next)}
      />
    </div>
  );

  return (
    <div className="space-y-3">
      {/* header line: batch id + item count */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{disciplineLabel} / {categoryLabel}</span>
        <Badge variant="secondary">batch {batchId}</Badge>
        <Badge variant="outline">{scopedItems.length} items</Badge>
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
        {/* clear every per-column filter at once (shown only when some are active) */}
        {activeColumnFilterCount > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setColumnFilters({})}>
            <X className="mr-1 h-3.5 w-3.5" /> Clear filters ({activeColumnFilterCount})
          </Button>
        )}
        {/* RM-4a: admin-only Add control (HIDDEN for non-admins). */}
        {isAdmin && onCreateItem && (
          <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Add row
          </Button>
        )}
      </div>

      {/* table -- EA-1c change 3: native H-bar hidden (proxy below is the single bar).
          EA-2 rider 3: force the sticky header's top:0 with a scoped rule -- the Tailwind `top-0`
          utility is overridden to `top:auto` here (a global table reset from Ant Design), which
          silently defeated `position:sticky`. z-index is left to the cell classes (z-20 / corner
          z-30). The container is the scroller (max-h), so this pins the header under vertical scroll. */}
      <style>{".rm-data-hidehbar::-webkit-scrollbar:horizontal{display:none;height:0}.rm-data-hidehbar thead th{position:sticky;top:0;background:hsl(var(--background))}"}</style>
      <div ref={scrollRef} className="overflow-auto rounded border rm-data-hidehbar max-h-[calc(100vh-19rem)]">
        <Table>
          <TableHeader>
            <TableRow>
              {/* EA-1c change 2: actions FIRST + sticky-left (absent entirely for non-admins).
                  EA-2 rider 3: the whole header row is ALSO sticky-top; the actions CORNER cell gets
                  z-30 so it wins over both the sticky row (z-20) and the sticky body column (z-10) and
                  never ghosts. */}
              {canEdit && <TableHead className="sticky left-0 top-0 z-30 bg-background text-right">actions</TableHead>}
              {showKindCol && <TableHead className="sticky top-0 z-20 bg-background">{hdr("kind", "kind")}</TableHead>}
              <TableHead className="sticky top-0 z-20 bg-background">{hdr("brand", "brand")}</TableHead>
              {attrCols.map((d) => (
                <TableHead key={d.id} className="sticky top-0 z-20 bg-background">{hdr(`attr:${d.id}`, d.label)}</TableHead>
              ))}
              {rateCols.map((k) => (
                <TableHead key={k} className="sticky top-0 z-20 bg-background text-right">{hdr(`rate:${k}`, k, true)}</TableHead>
              ))}
              <TableHead className="sticky top-0 z-20 bg-background">{hdr("unit", "unit")}</TableHead>
              <TableHead className="sticky top-0 z-20 bg-background">{hdr("source_sheet", "source sheet")}</TableHead>
              <TableHead className="sticky top-0 z-20 bg-background text-right">{hdr("source_row", "row", true)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r, i) => {
              const editing = canEdit && editingRow === r.it.name;
              return (
              <TableRow key={r.it.name ?? i}>
                {canEdit && (
                  <TableCell className="sticky left-0 z-10 bg-background text-right">
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
                {showKindCol && <TableCell>{r.it.kind}</TableCell>}
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
              </TableRow>
              );
            })}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={(canEdit ? 1 : 0) + (showKindCol ? 1 : 0) + 1 + attrCols.length + rateCols.length + 3} className="text-center text-muted-foreground">
                  No rows match.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {/* EA-1c change 3: the single proxy H-scrollbar -- sticky at the bottom of the visible area,
          full extent (spacer == scrollWidth, visible width == clientWidth). Rendered only when the
          content actually overflows horizontally. */}
      {hScroll.scrollWidth > hScroll.clientWidth && (
        <div
          ref={proxyRef}
          // border-t only (a left/right border would shrink the content width -> proxy range != scroller range).
          className="sticky bottom-0 z-20 overflow-x-auto overflow-y-hidden border-t border-border bg-background/95"
          style={{ height: 14, width: hScroll.clientWidth || undefined }}
          aria-hidden
        >
          <div style={{ width: `${hScroll.scrollWidth}px`, height: 1 }} />
        </div>
      )}

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

      {/* RM-4a: add a manual item (built from the attribute definitions + known rate keys). EA-1c: keyed
          by category so its internal state (kind/attrs/rates) is fresh per category, and category-scoped. */}
      {isAdmin && onCreateItem && (
        <AddItemDialog
          key={config.category_id}
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
            {/* EA-1c change 4: preselected read-only text when the category has one kind; a select when several. */}
            {kinds.length <= 1 ? (
              <div className="flex h-8 items-center rounded border px-3 text-sm text-muted-foreground">{kind || "(none)"}</div>
            ) : (
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {kinds.map((k) => (
                    <SelectItem key={k} value={k}>{k}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
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

// Per-column faceted filter: a funnel button in the column header opens a popover with a type-to-search
// box + a checkbox list of that column's DISTINCT values. Multi-select (OR within the column; the table
// composes columns with AND). A count badge + Clear show when active. Values come from the live data.
function ColumnFilter({
  label,
  values,
  selected,
  onChange,
}: {
  label: string;
  values: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const shown = useMemo(
    () => (q ? values.filter((v) => v.toLowerCase().includes(q.toLowerCase())) : values),
    [values, q],
  );
  const active = selected.length > 0;
  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQ("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Filter ${label}`}
          className={cn(
            "inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-muted-foreground hover:bg-muted focus:outline-none focus:ring-1 focus:ring-ring",
            active && "text-primary",
          )}
        >
          <Filter className="h-3 w-3" />
          {active && <span className="text-[10px] font-semibold tabular-nums">{selected.length}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-2">
        <Input
          autoFocus
          className="h-7 text-xs"
          placeholder={`Search ${label}...`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="mt-2 max-h-56 space-y-0.5 overflow-y-auto">
          {shown.length === 0 && (
            <div className="px-1 py-2 text-xs text-muted-foreground">No values.</div>
          )}
          {shown.map((v) => (
            <label
              key={v}
              className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-muted"
            >
              <input type="checkbox" checked={selected.includes(v)} onChange={() => toggle(v)} />
              <span className="truncate">{v}</span>
            </label>
          ))}
        </div>
        {active && (
          <button
            type="button"
            className="mt-2 w-full rounded border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
            onClick={() => onChange([])}
          >
            Clear ({selected.length})
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
