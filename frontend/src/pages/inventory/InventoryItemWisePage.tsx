import { useState, useMemo, useCallback, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Link, useNavigate } from "react-router-dom";
import {
  ChevronRight,
  ChevronDown,
  Search,
  Download,
  ArrowDown,
  ArrowUp,
  ArrowLeftRight,
  ChevronsUpDown,
  ListX,
  Warehouse,
  FileText,
  Package,
  FolderKanban,
} from "lucide-react";
import { useUserData } from "@/hooks/useUserData";
import { ITM_CREATE_ROLES } from "@/constants/itm";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { SimpleFacetedFilter } from "@/pages/projects/components/SimpleFacetedFilter";
import formatToIndianRupee from "@/utils/FormatPrice";
import { tokenSearch, type TokenSearchConfig } from "@/utils/tokenSearch";
import { unparse } from "papaparse";
import { formatDate as formatDateFns } from "date-fns";
import { useInventoryItemWise } from "./hooks/useInventoryItemWise";
import type {
  AggregatedItemRow,
  AggregatedProjectRow,
  ItemInProjectDetail,
} from "./inventory.types";

// =============================================================================
// VIEW MODE
// =============================================================================

type ViewMode = "item" | "project";

// =============================================================================
// SEARCH CONFIGS — same token-scoring algorithm as the FuzzySearchSelect
// dropdown so multi-word queries like "tile 600 mm" rank "600x600mm Vitrified
// Tile" highest.
// =============================================================================

const ITEM_SEARCH_CONFIG: TokenSearchConfig = {
  searchFields: ["item_name", "category", "unit"],
  fieldWeights: { item_name: 2.5, category: 1.0, unit: 1.0 },
  minTokenMatches: 1,
};

const PROJECT_SEARCH_CONFIG: TokenSearchConfig = {
  searchFields: ["project_name"],
  fieldWeights: { project_name: 2.0 },
  minTokenMatches: 1,
};

// =============================================================================
// SORT
// =============================================================================

// Some sort keys overlap (totalRemainingQty / totalEstimatedCost / poCount work
// in both modes). Mode-specific: item_name + projectCount for item-wise,
// project_name + itemCount for project-wise.
type SortKey =
  | "item_name"
  | "project_name"
  | "totalRemainingQty"
  | "totalEstimatedCost"
  | "projectCount"
  | "itemCount"
  | "poCount";

interface SortableHeaderProps {
  sortableKey: SortKey;
  children: React.ReactNode;
  className?: string;
  currentSortKey: SortKey | null;
  currentSortDirection: "asc" | "desc";
  onSetSort: (key: SortKey, direction: "asc" | "desc") => void;
  onClearSort: () => void;
}

function SortableHeader({
  sortableKey,
  children,
  className,
  currentSortKey,
  currentSortDirection,
  onSetSort,
  onClearSort,
}: SortableHeaderProps) {
  const isSorted = currentSortKey === sortableKey;
  const isRightAligned = className?.includes("text-right");
  // Put the sort chevron on the opposite side from the label, so the label
  // sits flush with the data column edge (left for left-aligned, right for
  // right-aligned). Otherwise the chevron pushes the label inward and it
  // visually drifts away from the data below.
  const sortControl = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
          {isSorted ? (
            currentSortDirection === "asc" ? (
              <ArrowUp className="h-3.5 w-3.5" />
            ) : (
              <ArrowDown className="h-3.5 w-3.5" />
            )
          ) : (
            <ChevronsUpDown className="h-3.5 w-3.5" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onSetSort(sortableKey, "asc")}>
          <ArrowUp className="mr-2 h-3.5 w-3.5 text-muted-foreground/70" />
          Asc
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onSetSort(sortableKey, "desc")}>
          <ArrowDown className="mr-2 h-3.5 w-3.5 text-muted-foreground/70" />
          Desc
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onClearSort} disabled={!isSorted}>
          <ListX className="mr-2 h-3.5 w-3.5 text-muted-foreground/70" />
          Clear
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  return (
    <TableHead className={className}>
      <div className={`flex items-center gap-1 ${isRightAligned ? "justify-end" : "justify-start"}`}>
        {isRightAligned && sortControl}
        <span className="whitespace-nowrap">{children}</span>
        {!isRightAligned && sortControl}
      </div>
    </TableHead>
  );
}

// =============================================================================
// FLAT ROW TYPE (for virtualization)
// =============================================================================

type FlatRow =
  | { type: "item-parent"; data: AggregatedItemRow }
  | {
      type: "item-project-child";
      data: {
        project: string;
        project_name: string;
        make: string | null;
        remaining_quantity: number;
        estimated_cost: number;
        po_numbers: string[];
      };
    }
  | { type: "project-parent"; data: AggregatedProjectRow }
  | { type: "project-item-child"; data: ItemInProjectDetail & { project: string } };

// =============================================================================
// PROJECT-WISE AGGREGATION
// =============================================================================

function aggregateByProject(items: AggregatedItemRow[]): AggregatedProjectRow[] {
  const projMap = new Map<string, AggregatedProjectRow>();
  for (const item of items) {
    for (const p of item.projects) {
      let proj = projMap.get(p.project);
      if (!proj) {
        proj = {
          project: p.project,
          project_name: p.project_name,
          itemCount: 0,
          totalRemainingQty: 0,
          totalEstimatedCost: 0,
          distinctMakes: [],
          distinctCategories: [],
          allPONumbers: [],
          items: [],
        };
        projMap.set(p.project, proj);
      }
      proj.items.push({
        item_id: item.item_id,
        item_name: item.item_name,
        unit: item.unit,
        category: item.category,
        billingCategory: item.billingCategory,
        make: p.make,
        remaining_quantity: p.remaining_quantity,
        max_rate: p.max_rate,
        tax: p.tax,
        estimated_cost: p.estimated_cost,
        po_numbers: p.po_numbers,
      });
      proj.itemCount += 1;
      proj.totalRemainingQty += p.remaining_quantity;
      proj.totalEstimatedCost += p.estimated_cost;
    }
  }
  for (const proj of projMap.values()) {
    const makeSet = new Set<string>();
    const catSet = new Set<string>();
    const poSet = new Set<string>();
    for (const it of proj.items) {
      if (it.make) makeSet.add(it.make);
      if (it.category) catSet.add(it.category);
      for (const po of it.po_numbers) poSet.add(po);
    }
    proj.distinctMakes = Array.from(makeSet).sort();
    proj.distinctCategories = Array.from(catSet).sort();
    proj.allPONumbers = Array.from(poSet);
  }
  return Array.from(projMap.values()).sort((a, b) =>
    a.project_name.localeCompare(b.project_name)
  );
}

// =============================================================================
// CSV EXPORT
// =============================================================================

function downloadCsv(rows: (string | number)[][], headers: string[], filenamePrefix: string) {
  const csvString = unparse([headers, ...rows], { skipEmptyLines: true });
  const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const timestamp = formatDateFns(new Date(), "yyyyMMdd_HHmmss");
  link.href = url;
  link.setAttribute("download", `${filenamePrefix}_${timestamp}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function exportItemWiseCsv(items: AggregatedItemRow[]) {
  if (!items.length) return;
  const headers = [
    "Item Name",
    "Make",
    "Category",
    "Billing Category",
    "Unit",
    "Total Remaining Qty",
    "Total Estimated Cost",
    "Project Count",
  ];
  const rows = items.map((item) => [
    item.item_name,
    item.distinctMakes.join(", "),
    item.category,
    item.billingCategory,
    item.unit,
    item.totalRemainingQty,
    Math.ceil(item.totalEstimatedCost),
    item.projectCount,
  ]);
  downloadCsv(rows, headers, "Inventory_Item_Wise");
}

function exportProjectWiseCsv(projects: AggregatedProjectRow[]) {
  if (!projects.length) return;
  const headers = [
    "Project Name",
    "Items Count",
    "Distinct Makes",
    "Distinct Categories",
    "Total Remaining Qty",
    "Total Estimated Cost",
    "PO Count",
  ];
  const rows = projects.map((p) => [
    p.project_name,
    p.itemCount,
    p.distinctMakes.join(", "),
    p.distinctCategories.join(", "),
    p.totalRemainingQty,
    Math.ceil(p.totalEstimatedCost),
    p.allPONumbers.length,
  ]);
  downloadCsv(rows, headers, "Inventory_Project_Wise");
}

// =============================================================================
// PO NUMBERS RENDERER
// =============================================================================

function renderInventoryPONumbers(poNumbers: string[], project: string) {
  if (!poNumbers.length) return <span className="text-muted-foreground">—</span>;

  const poLink = (po: string) => (
    <Link
      key={po}
      to={`/projects/${project}/po/${po.replace(/\//g, "&=")}`}
      className="text-blue-600 hover:underline text-xs whitespace-nowrap"
      onClick={(e) => e.stopPropagation()}
    >
      {po}
    </Link>
  );

  if (poNumbers.length === 1) {
    // Single-PO case: render on a single line. The POs column is wide enough
    // for standard 18-char refs (e.g. "PO/030/00088/25-26") to fit fully;
    // the `truncate` is just a safety net for rare extra-long refs and the
    // `title` exposes the full text on hover.
    const po = poNumbers[0];
    return (
      <Link
        to={`/projects/${project}/po/${po.replace(/\//g, "&=")}`}
        title={po}
        className="text-blue-600 hover:underline text-xs whitespace-nowrap truncate inline-block max-w-full"
        onClick={(e) => e.stopPropagation()}
      >
        {po}
      </Link>
    );
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
            {poNumbers.length} POs
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left" className="flex flex-col gap-1 p-2">
          {poNumbers.map((po) => poLink(po))}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function InventoryItemWisePage() {
  const { data: items, isLoading, error } = useInventoryItemWise();
  const navigate = useNavigate();
  const { role } = useUserData();
  const canCreateITM = ITM_CREATE_ROLES.includes(role);

  // View mode
  const [viewMode, setViewMode] = useState<ViewMode>("item");

  // Search
  const [search, setSearch] = useState("");

  // Faceted filters
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(
    new Set()
  );
  const [selectedUnits, setSelectedUnits] = useState<Set<string>>(new Set());
  const [selectedBillingCategories, setSelectedBillingCategories] = useState<Set<string>>(new Set());
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set());
  const [selectedMakes, setSelectedMakes] = useState<Set<string>>(new Set());

  // Sort
  const [sortKey, setSortKey] = useState<SortKey | null>("totalEstimatedCost");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Expand — keyed by item_id in item mode, project_id in project mode.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpand = useCallback((rowKey: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });
  }, []);

  // Toggle view mode — reset cross-mode state to avoid stale expand/sort/search.
  const handleSetViewMode = useCallback((mode: ViewMode) => {
    setViewMode((prev) => {
      if (prev === mode) return prev;
      setExpanded(new Set());
      setSortKey("totalEstimatedCost");
      setSortDir("desc");
      setSearch("");
      return mode;
    });
  }, []);

  // Project-wise aggregation
  const aggregatedByProject = useMemo(
    () => aggregateByProject(items),
    [items]
  );

  // Filter options (shared facets — derived from items either way)
  const categoryOptions = useMemo(() => {
    const cats = new Set(items.map((i) => i.category).filter(Boolean));
    return Array.from(cats)
      .sort()
      .map((c) => ({ label: c, value: c }));
  }, [items]);

  const billingCategoryOptions = useMemo(() => {
    const values = new Set(items.map((i) => i.billingCategory).filter(Boolean));
    return Array.from(values)
      .sort()
      .map((bc) => ({ label: bc, value: bc }));
  }, [items]);

  const projectOptions = useMemo(() => {
    const projs = new Map<string, string>();
    for (const item of items) {
      for (const p of item.projects) {
        if (!projs.has(p.project)) projs.set(p.project, p.project_name);
      }
    }
    return Array.from(projs.entries())
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([value, label]) => ({ label, value }));
  }, [items]);

  const unitOptions = useMemo(() => {
    const units = new Set(items.map((i) => i.unit).filter(Boolean));
    return Array.from(units)
      .sort()
      .map((u) => ({ label: u, value: u }));
  }, [items]);

  const makeOptions = useMemo(() => {
    const makes = new Set<string>();
    for (const i of items) {
      for (const p of i.projects) {
        makes.add(p.make ?? "");
      }
    }
    return Array.from(makes)
      .sort((a, b) => {
        if (a === "") return -1;
        if (b === "") return 1;
        return a.localeCompare(b);
      })
      .map((m) => ({ label: m === "" ? "—" : m, value: m }));
  }, [items]);

  // Filtered + sorted items (item-wise mode)
  const filteredItems = useMemo(() => {
    let result: AggregatedItemRow[] = items;

    if (search.trim()) {
      result = tokenSearch(result, search, ITEM_SEARCH_CONFIG);
    }
    if (selectedCategories.size > 0) {
      result = result.filter((item) => selectedCategories.has(item.category));
    }
    if (selectedBillingCategories.size > 0) {
      result = result.filter((item) => selectedBillingCategories.has(item.billingCategory));
    }
    if (selectedUnits.size > 0) {
      result = result.filter((item) => selectedUnits.has(item.unit));
    }
    if (selectedMakes.size > 0) {
      result = result.filter((item) =>
        item.projects.some((p) => selectedMakes.has(p.make ?? ""))
      );
    }
    if (selectedProjects.size > 0) {
      result = result.filter((item) =>
        item.projects.some((p) => selectedProjects.has(p.project))
      );
    }

    if (sortKey) {
      result = [...result].sort((a, b) => {
        let cmp = 0;
        if (sortKey === "item_name") {
          cmp = a.item_name.localeCompare(b.item_name);
        } else if (sortKey === "poCount") {
          cmp = a.allPONumbers.length - b.allPONumbers.length;
        } else if (
          sortKey === "totalRemainingQty" ||
          sortKey === "totalEstimatedCost" ||
          sortKey === "projectCount"
        ) {
          cmp = a[sortKey] - b[sortKey];
        }
        return sortDir === "asc" ? cmp : -cmp;
      });
    }

    return result;
  }, [
    items,
    search,
    selectedCategories,
    selectedBillingCategories,
    selectedUnits,
    selectedMakes,
    selectedProjects,
    sortKey,
    sortDir,
  ]);

  // Filtered + sorted projects (project-wise mode)
  const filteredProjects = useMemo(() => {
    let result: AggregatedProjectRow[] = aggregatedByProject;

    if (search.trim()) {
      result = tokenSearch(result, search, PROJECT_SEARCH_CONFIG);
    }
    if (selectedCategories.size > 0) {
      result = result.filter((p) =>
        p.items.some((i) => selectedCategories.has(i.category))
      );
    }
    if (selectedBillingCategories.size > 0) {
      result = result.filter((p) =>
        p.items.some((i) => selectedBillingCategories.has(i.billingCategory))
      );
    }
    if (selectedUnits.size > 0) {
      result = result.filter((p) =>
        p.items.some((i) => selectedUnits.has(i.unit))
      );
    }
    if (selectedMakes.size > 0) {
      result = result.filter((p) =>
        p.items.some((i) => selectedMakes.has(i.make ?? ""))
      );
    }
    if (selectedProjects.size > 0) {
      result = result.filter((p) => selectedProjects.has(p.project));
    }

    if (sortKey) {
      result = [...result].sort((a, b) => {
        let cmp = 0;
        if (sortKey === "project_name") {
          cmp = a.project_name.localeCompare(b.project_name);
        } else if (sortKey === "poCount") {
          cmp = a.allPONumbers.length - b.allPONumbers.length;
        } else if (
          sortKey === "itemCount" ||
          sortKey === "totalRemainingQty" ||
          sortKey === "totalEstimatedCost"
        ) {
          cmp = (a as AggregatedProjectRow)[sortKey] - (b as AggregatedProjectRow)[sortKey];
        }
        return sortDir === "asc" ? cmp : -cmp;
      });
    }

    return result;
  }, [
    aggregatedByProject,
    search,
    selectedCategories,
    selectedBillingCategories,
    selectedUnits,
    selectedMakes,
    selectedProjects,
    sortKey,
    sortDir,
  ]);

  // Flatten for virtualization — different shapes per mode
  const flatRows = useMemo<FlatRow[]>(() => {
    const rows: FlatRow[] = [];
    if (viewMode === "item") {
      for (const item of filteredItems) {
        rows.push({ type: "item-parent", data: item });
        if (expanded.has(item.item_id)) {
          for (const proj of item.projects) {
            rows.push({
              type: "item-project-child",
              data: {
                project: proj.project,
                project_name: proj.project_name,
                make: proj.make,
                remaining_quantity: proj.remaining_quantity,
                estimated_cost: proj.estimated_cost,
                po_numbers: proj.po_numbers,
              },
            });
          }
        }
      }
    } else {
      for (const proj of filteredProjects) {
        rows.push({ type: "project-parent", data: proj });
        if (expanded.has(proj.project)) {
          for (const it of proj.items) {
            rows.push({
              type: "project-item-child",
              data: { ...it, project: proj.project },
            });
          }
        }
      }
    }
    return rows;
  }, [viewMode, filteredItems, filteredProjects, expanded]);

  // Virtualizer
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => {
      const t = flatRows[index].type;
      return t === "item-parent" || t === "project-parent" ? 48 : 40;
    },
    overscan: 20,
  });

  const handleSetSort = useCallback(
    (key: SortKey, dir: "asc" | "desc") => {
      setSortKey(key);
      setSortDir(dir);
    },
    []
  );

  const handleClearSort = useCallback(() => {
    setSortKey(null);
    setSortDir("asc");
  }, []);

  const handleExport = useCallback(() => {
    if (viewMode === "item") exportItemWiseCsv(filteredItems);
    else exportProjectWiseCsv(filteredProjects);
  }, [viewMode, filteredItems, filteredProjects]);

  // Summary stats
  const totalParents = viewMode === "item" ? filteredItems.length : filteredProjects.length;
  const totalQty = useMemo(() => {
    if (viewMode === "item") {
      return filteredItems.reduce((s, i) => s + i.totalRemainingQty, 0);
    }
    return filteredProjects.reduce((s, p) => s + p.totalRemainingQty, 0);
  }, [viewMode, filteredItems, filteredProjects]);
  const totalCost = useMemo(() => {
    if (viewMode === "item") {
      return filteredItems.reduce((s, i) => s + i.totalEstimatedCost, 0);
    }
    return filteredProjects.reduce((s, p) => s + p.totalEstimatedCost, 0);
  }, [viewMode, filteredItems, filteredProjects]);

  // Sort key for the count column (col 4) varies per mode.
  const countSortKey: SortKey = viewMode === "item" ? "projectCount" : "itemCount";
  const isCountSorted = sortKey === countSortKey;

  if (isLoading) return <LoadingFallback />;
  if (error) return <AlertDestructive error={error} />;

  return (
    <div className="flex-1 space-y-4 px-4 pt-1">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Warehouse className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-bold tracking-tight">
            Inventory — {viewMode === "item" ? "Item-Wise" : "Project-Wise"} Summary
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {canCreateITM && (
            <Button
              size="sm"
              onClick={() => navigate("/internal-transfer-memos/create")}
            >
              <ArrowLeftRight className="mr-2 h-4 w-4" />
              Create Internal Transfer Memo
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={viewMode === "item" ? !filteredItems.length : !filteredProjects.length}
          >
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border bg-card p-3">
          <p className="text-xs text-muted-foreground">
            {viewMode === "item" ? "Unique Items" : "Active Projects"}
          </p>
          <p className="text-2xl font-bold">{totalParents.toLocaleString("en-IN")}</p>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <p className="text-xs text-muted-foreground">Total Remaining Qty</p>
          <p className="text-2xl font-bold">{totalQty.toLocaleString("en-IN")}</p>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <p className="text-xs text-muted-foreground">Total Estimated Cost</p>
          <p className="text-2xl font-bold">
            {formatToIndianRupee(totalCost)}
          </p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* View mode toggle */}
        <div className="inline-flex items-center rounded-md border bg-muted/30 p-0.5">
          <Button
            type="button"
            variant={viewMode === "item" ? "default" : "ghost"}
            size="sm"
            className="h-7 px-3 text-xs"
            onClick={() => handleSetViewMode("item")}
          >
            <Package className="mr-1.5 h-3.5 w-3.5" />
            Item-wise
          </Button>
          <Button
            type="button"
            variant={viewMode === "project" ? "default" : "ghost"}
            size="sm"
            className="h-7 px-3 text-xs"
            onClick={() => handleSetViewMode("project")}
          >
            <FolderKanban className="mr-1.5 h-3.5 w-3.5" />
            Project-wise
          </Button>
        </div>

        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={viewMode === "item" ? "Search item name..." : "Search project name..."}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <span className="ml-auto text-sm text-muted-foreground">
          {totalParents}{" "}
          {viewMode === "item"
            ? `item${totalParents !== 1 ? "s" : ""}`
            : `project${totalParents !== 1 ? "s" : ""}`}
        </span>
      </div>

      {/* Table */}
      <div
        ref={parentRef}
        className="rounded-md border overflow-auto"
        style={{ height: "calc(100vh - 320px)" }}
      >
        <Table className="table-fixed min-w-[1250px] [&_th]:px-2 [&_td]:px-2">
          <colgroup>
            <col style={{ width: "36px" }} />
            <col style={{ width: "220px" }} />
            <col style={{ width: "100px" }} />
            <col style={{ width: "140px" }} />
            <col style={{ width: "140px" }} />
            <col style={{ width: "140px" }} />
            <col style={{ width: "130px" }} />
            <col style={{ width: "80px" }} />
            <col style={{ width: "145px" }} />
            <col style={{ width: "120px" }} />
          </colgroup>
          <TableHeader className="sticky top-0 bg-background z-10">
            <TableRow>
              <TableHead className="w-8" />
              {viewMode === "item" ? (
                <SortableHeader
                  sortableKey="item_name"
                  currentSortKey={sortKey}
                  currentSortDirection={sortDir}
                  onSetSort={handleSetSort}
                  onClearSort={handleClearSort}
                >
                  Item Name
                </SortableHeader>
              ) : (
                <SortableHeader
                  sortableKey="project_name"
                  currentSortKey={sortKey}
                  currentSortDirection={sortDir}
                  onSetSort={handleSetSort}
                  onClearSort={handleClearSort}
                >
                  Project Name
                </SortableHeader>
              )}
              <TableHead className="!pl-5">
                <div className="flex items-center gap-1">
                  <span className="whitespace-nowrap">Make</span>
                  <SimpleFacetedFilter
                    title="Make"
                    options={makeOptions}
                    selectedValues={selectedMakes}
                    onSelectedValuesChange={setSelectedMakes}
                  />
                </div>
              </TableHead>
              <TableHead className="text-right">
                <div className="flex items-center gap-1 justify-end">
                  {/* Order: [sort] [label] [funnel] — funnel sits on the right
                      of the label, matching the Make/Category/Billing/Unit
                      columns. */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                        {isCountSorted ? (
                          sortDir === "asc" ? (
                            <ArrowUp className="h-3.5 w-3.5" />
                          ) : (
                            <ArrowDown className="h-3.5 w-3.5" />
                          )
                        ) : (
                          <ChevronsUpDown className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleSetSort(countSortKey, "asc")}>
                        <ArrowUp className="mr-2 h-3.5 w-3.5 text-muted-foreground/70" />
                        Asc
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleSetSort(countSortKey, "desc")}>
                        <ArrowDown className="mr-2 h-3.5 w-3.5 text-muted-foreground/70" />
                        Desc
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={handleClearSort} disabled={!isCountSorted}>
                        <ListX className="mr-2 h-3.5 w-3.5 text-muted-foreground/70" />
                        Clear
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <span className="whitespace-nowrap">{viewMode === "item" ? "Projects" : "Items"}</span>
                  {viewMode === "item" && (
                    <SimpleFacetedFilter
                      title="Project"
                      options={projectOptions}
                      selectedValues={selectedProjects}
                      onSelectedValuesChange={setSelectedProjects}
                    />
                  )}
                </div>
              </TableHead>
              <SortableHeader
                sortableKey="poCount"
                className="text-right"
                currentSortKey={sortKey}
                currentSortDirection={sortDir}
                onSetSort={handleSetSort}
                onClearSort={handleClearSort}
              >
                POs
              </SortableHeader>
              <TableHead>
                <div className="flex items-center gap-1">
                  <span className="whitespace-nowrap">Category</span>
                  <SimpleFacetedFilter
                    title="Category"
                    options={categoryOptions}
                    selectedValues={selectedCategories}
                    onSelectedValuesChange={setSelectedCategories}
                  />
                </div>
              </TableHead>
              <TableHead>
                <div className="flex items-center gap-1">
                  <span className="whitespace-nowrap">Billing Cat.</span>
                  <SimpleFacetedFilter
                    title="Billing Cat."
                    options={billingCategoryOptions}
                    selectedValues={selectedBillingCategories}
                    onSelectedValuesChange={setSelectedBillingCategories}
                  />
                </div>
              </TableHead>
              <TableHead>
                <div className="flex items-center gap-1">
                  <span className="whitespace-nowrap">Unit</span>
                  <SimpleFacetedFilter
                    title="Unit"
                    options={unitOptions}
                    selectedValues={selectedUnits}
                    onSelectedValuesChange={setSelectedUnits}
                  />
                </div>
              </TableHead>
              <SortableHeader
                sortableKey="totalRemainingQty"
                className="text-right"
                currentSortKey={sortKey}
                currentSortDirection={sortDir}
                onSetSort={handleSetSort}
                onClearSort={handleClearSort}
              >
                Remaining Qty
              </SortableHeader>
              <SortableHeader
                sortableKey="totalEstimatedCost"
                className="text-right"
                currentSortKey={sortKey}
                currentSortDirection={sortDir}
                onSetSort={handleSetSort}
                onClearSort={handleClearSort}
              >
                Est. Cost
              </SortableHeader>
            </TableRow>
          </TableHeader>
          <TableBody>
            {virtualizer.getVirtualItems().length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                  {viewMode === "item"
                    ? "No inventory items found."
                    : "No projects with inventory found."}
                </TableCell>
              </TableRow>
            ) : (
              <>
                {/* spacer top */}
                {virtualizer.getVirtualItems()[0]?.start > 0 && (
                  <tr>
                    <td
                      colSpan={10}
                      style={{
                        height: virtualizer.getVirtualItems()[0].start,
                      }}
                    />
                  </tr>
                )}
                {virtualizer.getVirtualItems().map((vRow) => {
                  const row = flatRows[vRow.index];

                  if (row.type === "item-parent") {
                    const item = row.data;
                    const isExpanded = expanded.has(item.item_id);
                    return (
                      <TableRow
                        key={`item-${item.item_id}`}
                        data-index={vRow.index}
                        ref={virtualizer.measureElement}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => toggleExpand(item.item_id)}
                      >
                        <TableCell className="w-8">
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </TableCell>
                        <TableCell className="font-medium truncate" title={item.item_name}>
                          {item.item_name}
                        </TableCell>
                        <TableCell className="text-xs truncate !pl-5">
                          {item.distinctMakes.length === 0 ? (
                            <span className="text-muted-foreground">—</span>
                          ) : item.distinctMakes.length === 1 ? (
                            <span title={item.distinctMakes[0]}>
                              {item.distinctMakes[0]}
                            </span>
                          ) : (
                            <Badge variant="secondary" className="text-xs">
                              {item.distinctMakes.length} makes
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant="secondary" className="text-xs">
                            {item.projectCount}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant="secondary" className="text-xs">
                            {item.allPONumbers.length}
                          </Badge>
                        </TableCell>
                        <TableCell className="truncate" title={item.category}>
                          <Badge variant="outline" className="text-xs whitespace-nowrap max-w-full truncate">
                            {item.category}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{item.billingCategory}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{item.unit}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {item.totalRemainingQty.toLocaleString("en-IN")}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {formatToIndianRupee(item.totalEstimatedCost)}
                        </TableCell>
                      </TableRow>
                    );
                  }

                  if (row.type === "item-project-child") {
                    const proj = row.data;
                    return (
                      <TableRow
                        key={`itemproj-${proj.project}-${vRow.index}`}
                        data-index={vRow.index}
                        ref={virtualizer.measureElement}
                        className="bg-muted/30"
                      >
                        <TableCell className="w-8" />
                        <TableCell className="pl-8 truncate" title={proj.project_name}>
                          <Link
                            to={`/projects/${proj.project}`}
                            className="text-blue-600 hover:underline text-sm"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {proj.project_name}
                          </Link>
                        </TableCell>
                        <TableCell className="text-xs truncate !pl-5" title={proj.make ?? undefined}>
                          {proj.make ? (
                            proj.make
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell />
                        <TableCell>
                          {renderInventoryPONumbers(proj.po_numbers, proj.project)}
                        </TableCell>
                        <TableCell />
                        <TableCell />
                        <TableCell />
                        <TableCell className="text-right tabular-nums text-sm">
                          {proj.remaining_quantity.toLocaleString("en-IN")}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm">
                          {formatToIndianRupee(proj.estimated_cost)}
                        </TableCell>
                      </TableRow>
                    );
                  }

                  if (row.type === "project-parent") {
                    const proj = row.data;
                    const isExpanded = expanded.has(proj.project);
                    return (
                      <TableRow
                        key={`proj-${proj.project}`}
                        data-index={vRow.index}
                        ref={virtualizer.measureElement}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => toggleExpand(proj.project)}
                      >
                        <TableCell className="w-8">
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </TableCell>
                        <TableCell className="font-medium truncate" title={proj.project_name}>
                          <Link
                            to={`/projects/${proj.project}`}
                            className="text-blue-600 hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {proj.project_name}
                          </Link>
                        </TableCell>
                        <TableCell className="text-xs truncate !pl-5">
                          {proj.distinctMakes.length === 0 ? (
                            <span className="text-muted-foreground">—</span>
                          ) : proj.distinctMakes.length === 1 ? (
                            <span>{proj.distinctMakes[0]}</span>
                          ) : (
                            <Badge variant="secondary" className="text-xs">
                              {proj.distinctMakes.length} makes
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant="secondary" className="text-xs">
                            {proj.itemCount}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant="secondary" className="text-xs">
                            {proj.allPONumbers.length}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          {proj.distinctCategories.length === 0 ? (
                            <span className="text-muted-foreground">—</span>
                          ) : proj.distinctCategories.length === 1 ? (
                            <Badge variant="outline" className="text-xs">
                              {proj.distinctCategories[0]}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs whitespace-nowrap">
                              {proj.distinctCategories.length} cats
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">—</TableCell>
                        <TableCell className="text-xs text-muted-foreground">—</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {proj.totalRemainingQty.toLocaleString("en-IN")}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {formatToIndianRupee(proj.totalEstimatedCost)}
                        </TableCell>
                      </TableRow>
                    );
                  }

                  // project-item-child
                  const it = row.data;
                  return (
                    <TableRow
                      key={`projitem-${it.project}-${it.item_id}-${vRow.index}`}
                      data-index={vRow.index}
                      ref={virtualizer.measureElement}
                      className="bg-muted/30"
                    >
                      <TableCell className="w-8" />
                      <TableCell className="pl-8 text-sm truncate" title={it.item_name}>
                        {it.item_name}
                      </TableCell>
                      <TableCell className="text-xs truncate !pl-5" title={it.make ?? undefined}>
                        {it.make ? (
                          it.make
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell />
                      <TableCell>
                        {renderInventoryPONumbers(it.po_numbers, it.project)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {it.category}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{it.billingCategory}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{it.unit}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm">
                        {it.remaining_quantity.toLocaleString("en-IN")}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm">
                        {formatToIndianRupee(it.estimated_cost)}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {/* spacer bottom */}
                {virtualizer.getVirtualItems().length > 0 && (
                  <tr>
                    <td
                      colSpan={10}
                      style={{
                        height:
                          virtualizer.getTotalSize() -
                          (virtualizer.getVirtualItems().at(-1)?.end ?? 0),
                      }}
                    />
                  </tr>
                )}
              </>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
