import { Fragment, useCallback, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FileText } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SimpleFacetedFilter } from "@/pages/projects/components/SimpleFacetedFilter";
import formatToIndianRupee from "@/utils/FormatPrice";
import { cn } from "@/lib/utils";
import type {
  InventoryPickerItem,
  InventoryPickerSource,
  ItemSelection,
  SelectionState,
} from "../types";

interface InventoryPickerTableProps {
  data: InventoryPickerItem[];
  targetProject: string | null;
  selection: SelectionState;
  onSelectionChange: (next: SelectionState) => void;
}

// =============================================================================
// PO refs renderer — popover-style tooltip, no navigation (picker is cross-project)
// =============================================================================
function POListCell({ refs }: { refs: string[] }) {
  if (!refs.length) return <span className="text-muted-foreground text-xs">—</span>;
  if (refs.length === 1) {
    return <span className="text-xs">{refs[0]}</span>;
  }
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-auto py-0.5 px-1.5 text-xs gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            <FileText className="h-3 w-3" />
            {refs.length} POs
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left" className="flex flex-col gap-0.5 p-2 max-w-xs">
          {refs.map((po) => (
            <span key={po} className="text-xs">
              {po}
            </span>
          ))}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// =============================================================================
// Quantity input — appears inline when the sub-row is checked
// =============================================================================
interface QtyInputProps {
  value: number;
  max: number;
  onChange: (n: number) => void;
}

function TransferQtyInput({ value, max, onChange }: QtyInputProps) {
  const overMax = value > max;
  return (
    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      <span className="text-sm text-blue-600 whitespace-nowrap">
        Transfer Qty:
      </span>
      <Input
        type="number"
        min={0}
        max={max}
        step="any"
        value={Number.isFinite(value) ? value : ""}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") {
            onChange(0);
            return;
          }
          const n = Number(raw);
          onChange(Number.isFinite(n) ? n : 0);
        }}
        className={cn(
          "h-7 w-20 text-xs tabular-nums",
          overMax && "border-destructive focus-visible:ring-destructive"
        )}
      />
    </div>
  );
}

// =============================================================================
// Main table
// =============================================================================
export function InventoryPickerTable({
  data,
  targetProject,
  selection,
  onSelectionChange,
}: InventoryPickerTableProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Filter state (column funnels)
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set());
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [selectedUnits, setSelectedUnits] = useState<Set<string>>(new Set());

  // =============================================================================
  // Filter option lists — derived, NOT kept in state
  // =============================================================================
  const projectOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of data) {
      for (const s of item.sources) {
        if (!map.has(s.source_project)) map.set(s.source_project, s.source_project_name);
      }
    }
    return Array.from(map.entries())
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([value, label]) => ({ label, value }));
  }, [data]);

  const categoryOptions = useMemo(() => {
    const cats = new Set(data.map((i) => i.category).filter(Boolean));
    return Array.from(cats).sort().map((c) => ({ label: c, value: c }));
  }, [data]);

  const unitOptions = useMemo(() => {
    const units = new Set(data.map((i) => i.unit).filter(Boolean));
    return Array.from(units).sort().map((u) => ({ label: u, value: u }));
  }, [data]);

  // =============================================================================
  // Filtered data + recomputed parent metrics (from surviving sources only)
  // =============================================================================
  const filteredData = useMemo(() => {
    const out: InventoryPickerItem[] = [];
    for (const item of data) {
      if (selectedCategories.size && !selectedCategories.has(item.category)) continue;
      if (selectedUnits.size && !selectedUnits.has(item.unit)) continue;

      const sources = selectedProjects.size
        ? item.sources.filter((s) => selectedProjects.has(s.source_project))
        : item.sources;

      if (!sources.length) continue;

      const total_remaining_qty = sources.reduce(
        (acc, s) => acc + (s.available_quantity ?? 0),
        0
      );
      const total_estimated_cost = sources.reduce(
        (acc, s) => acc + (s.estimated_cost ?? 0),
        0
      );

      out.push({
        ...item,
        sources,
        projects_count: sources.length,
        pos_count: sources.reduce((acc, s) => acc + (s.po_refs?.length ?? 0), 0),
        total_remaining_qty,
        total_estimated_cost,
      });
    }
    return out;
  }, [data, selectedProjects, selectedCategories, selectedUnits]);

  const toggleExpand = useCallback((itemId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }, []);

  // Selection sub-key composes item_id + make so a project that ever holds
  // the same item in two makes (forward-compat) keeps them as separate picks.
  const selectionKey = (itemId: string, make: string | null | undefined) =>
    `${itemId}|${make ?? ""}`;

  const isSelected = useCallback(
    (source: string, itemId: string, make: string | null | undefined) => {
      return Boolean(selection[source]?.[selectionKey(itemId, make)]);
    },
    [selection]
  );

  const toggleRow = useCallback(
    (
      item: InventoryPickerItem,
      source: InventoryPickerSource,
      checked: boolean
    ) => {
      const next: SelectionState = { ...selection };
      const subKey = selectionKey(item.item_id, source.make);
      if (checked) {
        const entry: ItemSelection = {
          qty: 0,
          estimated_rate: source.estimated_rate,
          available_quantity: source.available_quantity,
          item_id: item.item_id,
          item_name: item.item_name,
          unit: item.unit,
          category: item.category,
          make: source.make ?? null,
          source_project_name: source.source_project_name,
        };
        next[source.source_project] = {
          ...(next[source.source_project] ?? {}),
          [subKey]: entry,
        };
      } else {
        if (next[source.source_project]) {
          const { [subKey]: _removed, ...rest } = next[source.source_project];
          if (Object.keys(rest).length === 0) {
            delete next[source.source_project];
          } else {
            next[source.source_project] = rest;
          }
        }
      }
      onSelectionChange(next);
    },
    [selection, onSelectionChange]
  );

  const updateQty = useCallback(
    (source: string, itemId: string, make: string | null | undefined, qty: number) => {
      const subKey = selectionKey(itemId, make);
      const cur = selection[source]?.[subKey];
      if (!cur) return;
      const next: SelectionState = {
        ...selection,
        [source]: {
          ...selection[source],
          [subKey]: { ...cur, qty },
        },
      };
      onSelectionChange(next);
    },
    [selection, onSelectionChange]
  );

  if (!filteredData.length) {
    return (
      <div className="rounded-md border p-8 text-center text-sm text-muted-foreground">
        No inventory items available.
      </div>
    );
  }

  return (
    <div className="rounded-md border overflow-auto max-h-[60vh]">
      <Table>
        <TableHeader className="sticky top-0 bg-background z-10">
          <TableRow>
            <TableHead className="w-10" />
            <TableHead className="w-10" />
            <TableHead>Item Name</TableHead>
            <TableHead>Make</TableHead>
            <TableHead className="text-right">
              <div className="flex items-center gap-1 justify-end">
                <SimpleFacetedFilter
                  title="Project"
                  options={projectOptions}
                  selectedValues={selectedProjects}
                  onSelectedValuesChange={setSelectedProjects}
                />
                <span>Projects</span>
              </div>
            </TableHead>
            <TableHead className="text-right">POs</TableHead>
            <TableHead>
              <div className="flex items-center gap-1">
                <SimpleFacetedFilter
                  title="Category"
                  options={categoryOptions}
                  selectedValues={selectedCategories}
                  onSelectedValuesChange={setSelectedCategories}
                />
                <span>Category</span>
              </div>
            </TableHead>
            <TableHead className="text-muted-foreground">Billing Cat.</TableHead>
            <TableHead>
              <div className="flex items-center gap-1">
                <SimpleFacetedFilter
                  title="Unit"
                  options={unitOptions}
                  selectedValues={selectedUnits}
                  onSelectedValuesChange={setSelectedUnits}
                />
                <span>Unit</span>
              </div>
            </TableHead>
            <TableHead className="text-right">Remaining Qty</TableHead>
            <TableHead className="text-right">Est. Cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredData.map((item) => {
            const isExpanded = expanded.has(item.item_id);
            // Distinct non-empty makes across this item's sources — drives
            // the parent row's Make badge: shows the make if all sources
            // share one, "{n} makes" if mixed, or "—" if none.
            const distinctMakes = Array.from(
              new Set(item.sources.map((s) => s.make ?? "").filter(Boolean))
            );
            return (
              <Fragment key={`row-${item.item_id}`}>
                {/* Parent row */}
                <TableRow
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => toggleExpand(item.item_id)}
                >
                  <TableCell className="w-10">
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </TableCell>
                  <TableCell className="w-10" />
                  <TableCell className="font-medium max-w-[280px] truncate">
                    {item.item_name}
                  </TableCell>
                  <TableCell className="text-xs">
                    {distinctMakes.length === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : distinctMakes.length === 1 ? (
                      <span>{distinctMakes[0]}</span>
                    ) : (
                      <Badge variant="secondary" className="text-xs">
                        {distinctMakes.length} makes
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant="secondary" className="text-xs">
                      {item.projects_count}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant="secondary" className="text-xs">
                      {item.pos_count}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {item.category}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">—</TableCell>
                  <TableCell className="text-xs">{item.unit}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {item.total_remaining_qty.toLocaleString("en-IN")}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatToIndianRupee(item.total_estimated_cost)}
                  </TableCell>
                </TableRow>

                {/* Sub-rows */}
                {isExpanded &&
                  item.sources.map((src) => {
                    const selected = isSelected(
                      src.source_project,
                      item.item_id,
                      src.make
                    );
                    const isSameAsTarget = targetProject === src.source_project;
                    const entry =
                      selection[src.source_project]?.[
                        selectionKey(item.item_id, src.make)
                      ];
                    return (
                      <TableRow
                        key={`sub-${item.item_id}-${src.source_project}-${src.make ?? ""}`}
                        className={cn(
                          "bg-muted/30",
                          isSameAsTarget && "opacity-60"
                        )}
                      >
                        <TableCell />
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          {isSameAsTarget ? (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span>
                                    <Checkbox disabled />
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent side="right">
                                  Cannot transfer to same project
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          ) : (
                            <Checkbox
                              checked={selected}
                              onCheckedChange={(v) =>
                                toggleRow(item, src, Boolean(v))
                              }
                              aria-label={`Select ${item.item_name}${src.make ? ` (${src.make})` : ""} from ${src.source_project_name}`}
                            />
                          )}
                        </TableCell>
                        <TableCell className="pl-2">
                          <span className="text-blue-600 text-sm">
                            {src.source_project_name}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs">
                          {src.make ? (
                            src.make
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell />
                        <TableCell>
                          <POListCell refs={src.po_refs ?? []} />
                        </TableCell>
                        <TableCell />
                        <TableCell className="text-xs text-muted-foreground">—</TableCell>
                        <TableCell />
                        <TableCell className="text-right tabular-nums text-sm">
                          <div className="flex items-center justify-end gap-3">
                            {selected && entry && (
                              <TransferQtyInput
                                value={entry.qty}
                                max={src.available_quantity}
                                onChange={(n) =>
                                  updateQty(
                                    src.source_project,
                                    item.item_id,
                                    src.make,
                                    n
                                  )
                                }
                              />
                            )}
                            <span>{src.available_quantity.toLocaleString("en-IN")}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm">
                          {formatToIndianRupee(src.estimated_cost)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
