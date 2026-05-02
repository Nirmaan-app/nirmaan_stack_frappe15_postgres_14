import { useMemo, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { useFrappeGetCall, useFrappeGetDocList } from "frappe-react-sdk";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Search,
  Download,
  ArrowUp,
  ArrowDown,
  ChevronsUpDown,
  ChevronRight,
  ChevronDown,
  Info,
  ListX,
} from "lucide-react";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import ProjectSelect from "@/components/custom-select/project-select";
import { SimpleFacetedFilter } from "@/pages/projects/components/SimpleFacetedFilter";
import { useDCMIRReportsData } from "../hooks/useDCMIRReportsData";
import { exportToCsv } from "@/utils/exportToCsv";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import type { ColumnDef } from "@tanstack/react-table";
import type { Projects } from "@/types/NirmaanStack/Projects";

interface ITMDNDCQuantityReportProps {
  /** When embedded inside a project page, parent passes the project id directly.
   *  When used standalone (Reports hub), this is undefined and the wrapper shows
   *  a project selector. */
  projectId?: string;
  projectName?: string;
}

interface ITMItem {
  item_id: string;
  item_name: string;
  category?: string;
  unit: string;
  make?: string;
  transfer_quantity: number;
  received_quantity: number;
}

interface ProjectITM {
  name: string;
  source_project: string;
  target_project: string;
  status: string;
  items?: ITMItem[];
}

type ReconcileStatus = "matched" | "mismatch" | "no_dc_update" | "pending_dn";

// Mirror PO row classes — left-border accent on parent rows + lighter tint on item rows.
function getReconcileRowClasses(status: ReconcileStatus): string {
  switch (status) {
    case "matched":
      return "bg-green-50 border-l-4 border-l-green-500";
    case "mismatch":
      return "bg-amber-50 border-l-4 border-l-amber-500";
    case "no_dc_update":
      return "bg-red-50 border-l-4 border-l-red-500";
    case "pending_dn":
      return "bg-blue-50 border-l-4 border-l-blue-500";
  }
}

function getItemRowClasses(status: ReconcileStatus): string {
  switch (status) {
    case "matched":
      return "bg-green-50/50";
    case "mismatch":
      return "bg-amber-50/50";
    case "no_dc_update":
      return "bg-red-50/50";
    case "pending_dn":
      return "bg-blue-50/50";
  }
}

function getStatusBadge(status: ReconcileStatus) {
  switch (status) {
    case "matched":
      return (
        <Badge className="bg-green-100 text-green-700 border-green-300" variant="outline">
          Matched
        </Badge>
      );
    case "mismatch":
      return (
        <Badge className="bg-amber-100 text-amber-700 border-amber-300" variant="outline">
          Mismatch
        </Badge>
      );
    case "no_dc_update":
      return (
        <Badge className="bg-red-100 text-red-700 border-red-300" variant="outline">
          No DC Update
        </Badge>
      );
    case "pending_dn":
      return (
        <Badge className="bg-blue-100 text-blue-700 border-blue-300" variant="outline">
          Pending DN
        </Badge>
      );
  }
}

function getStatusLabel(status: ReconcileStatus): string {
  switch (status) {
    case "matched":
      return "Matched";
    case "mismatch":
      return "Mismatch";
    case "no_dc_update":
      return "No DC Update";
    case "pending_dn":
      return "Pending DN";
  }
}

interface ItemReconcile {
  itemId: string;
  itemName: string;
  category: string;
  unit: string;
  make?: string;
  transferQty: number;
  dnQty: number;
  dcQty: number;
  difference: number;
  status: ReconcileStatus;
}

interface ITMRow {
  itmName: string;
  sourceProject: string;
  sourceProjectName: string;
  itmStatus: string;
  totalTransferQty: number;
  totalDNQty: number;
  totalDCQty: number;
  totalDifference: number;
  itemsTotal: number;
  itemsMatched: number;
  reconcileStatus: ReconcileStatus;
  items: ItemReconcile[];
}

const reconcileStatus = (dnQty: number, dcQty: number): ReconcileStatus => {
  if (dnQty === 0 && dcQty > 0) return "pending_dn";
  if (dcQty >= dnQty) return "matched";
  if (dnQty > 0 && dcQty === 0) return "no_dc_update";
  return "mismatch";
};

const rollupStatus = (items: ItemReconcile[]): ReconcileStatus => {
  if (items.some((i) => i.status === "mismatch")) return "mismatch";
  if (items.some((i) => i.status === "no_dc_update")) return "no_dc_update";
  if (items.some((i) => i.status === "pending_dn")) return "pending_dn";
  return "matched";
};

// NOTE: Status filter options are derived dynamically from the data inside the
// component (same pattern as PO `DNDCQuantityReport`) — only statuses that
// actually appear in the current ITM rows show up in the funnel popover. So if
// no ITM has any "Pending DN" item, that option won't appear at all.
const STATUS_LABELS: Record<ReconcileStatus, string> = {
  matched: "Matched",
  mismatch: "Mismatch",
  no_dc_update: "No DC Update",
  pending_dn: "Pending DN",
};

type SortKey = "totalTransferQty" | "totalDNQty" | "totalDCQty" | "totalDifference";

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
  const alignmentClass = className?.includes("text-center")
    ? "justify-center"
    : className?.includes("text-right")
      ? "justify-end"
      : "justify-start";
  return (
    <TableHead className={className}>
      <div className={`flex items-center gap-1 ${alignmentClass}`}>
        <span>{children}</span>
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
      </div>
    </TableHead>
  );
}

type FlatRow =
  | { type: "itm"; data: ITMRow }
  | { type: "item"; data: ITMRow; itemIndex: number };

interface ITMDNDCQuantityReportContentProps {
  projectId: string;
  projectName?: string;
}

const ITMDNDCQuantityReportContent: React.FC<ITMDNDCQuantityReportContentProps> = ({
  projectId,
  projectName,
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<Set<string>>(
    new Set(["mismatch", "no_dc_update", "pending_dn"])
  );
  const [sourceProjectFilter, setSourceProjectFilter] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [expandedITMs, setExpandedITMs] = useState<Set<string>>(new Set());

  const handleSetSort = useCallback((key: SortKey, direction: "asc" | "desc") => {
    setSortKey(key);
    setSortDirection(direction);
  }, []);
  const handleClearSort = useCallback(() => setSortKey(null), []);
  const sortProps = (key: SortKey) => ({
    sortableKey: key,
    currentSortKey: sortKey,
    currentSortDirection: sortDirection,
    onSetSort: handleSetSort,
    onClearSort: handleClearSort,
  });

  const {
    data: itmResp,
    isLoading: itmLoading,
    error: itmError,
  } = useFrappeGetCall<{
    message: { data: ProjectITM[] };
  }>(
    "nirmaan_stack.api.internal_transfers.project_transfers.get_project_itms",
    projectId ? { project_id: projectId } : undefined,
    projectId ? undefined : null
  );

  const {
    reportData: allDeliveryDocs,
    isLoading: docsLoading,
    error: docsError,
  } = useDCMIRReportsData();

  const { data: projects } = useFrappeGetDocList<Projects>(
    "Projects",
    { fields: ["name", "project_name"], limit: 0 },
    ["Projects", "all_minimal"]
  );
  const projectNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    (projects || []).forEach((p) => {
      if (p.name && p.project_name) map[p.name] = p.project_name;
    });
    return map;
  }, [projects]);

  const itmRows = useMemo<ITMRow[]>(() => {
    const rawITMs = itmResp?.message?.data || [];
    const itms = rawITMs.filter(
      (itm) =>
        itm.target_project === projectId &&
        (itm.status === "Partially Delivered" || itm.status === "Delivered")
    );

    const itmDocs = (allDeliveryDocs || []).filter(
      (d) =>
        d.parent_doctype === "Internal Transfer Memo" &&
        d.project === projectId &&
        d.type === "Delivery Challan"
    );

    if (itms.length === 0 && itmDocs.length === 0) return [];

    interface DcAccum {
      qty: number;
      itemName: string;
      category: string;
      unit: string;
    }
    const dcByItm = new Map<string, Map<string, DcAccum>>();
    for (const dc of itmDocs) {
      const itmKey = dc.parent_docname || "";
      if (!dcByItm.has(itmKey)) dcByItm.set(itmKey, new Map());
      const m = dcByItm.get(itmKey)!;
      for (const item of dc.items || []) {
        const category = item.category || "";
        const k = `${category}___${item.item_id}`;
        const existing = m.get(k);
        const addQty = Number(item.quantity) || 0;
        if (existing) {
          existing.qty += addQty;
        } else {
          m.set(k, {
            qty: addQty,
            itemName: item.item_name,
            category,
            unit: item.unit,
          });
        }
      }
    }

    const grouped: ITMRow[] = [];
    for (const itm of itms) {
      const dcMap = dcByItm.get(itm.name) || new Map<string, DcAccum>();
      const processedKeys = new Set<string>();
      const sourceProject = itm.source_project || "";
      const sourceProjectName = projectNameMap[sourceProject] || sourceProject;

      interface ItmAccum {
        itemName: string;
        category: string;
        unit: string;
        makes: Set<string>;
        transferQty: number;
        dnQty: number;
      }
      const itmItems = new Map<string, ItmAccum>();
      for (const item of itm.items || []) {
        const category = item.category || "";
        const k = `${category}___${item.item_id}`;
        const existing = itmItems.get(k);
        const tq = Number(item.transfer_quantity) || 0;
        const dn = Number(item.received_quantity) || 0;
        if (existing) {
          existing.transferQty += tq;
          existing.dnQty += dn;
          if (item.make) existing.makes.add(item.make);
        } else {
          itmItems.set(k, {
            itemName: item.item_name,
            category,
            unit: item.unit,
            makes: new Set(item.make ? [item.make] : []),
            transferQty: tq,
            dnQty: dn,
          });
        }
      }

      const items: ItemReconcile[] = [];
      for (const [key, agg] of itmItems) {
        const dc = dcMap.get(key);
        const dcQty = dc?.qty || 0;
        processedKeys.add(key);
        const make = agg.makes.size === 1 ? Array.from(agg.makes)[0] : undefined;
        items.push({
          itemId: key.split("___")[1],
          itemName: agg.itemName,
          category: agg.category,
          unit: agg.unit,
          make,
          transferQty: agg.transferQty,
          dnQty: agg.dnQty,
          dcQty,
          difference: agg.dnQty - dcQty,
          status: reconcileStatus(agg.dnQty, dcQty),
        });
      }

      // Orphan DC items (DCs whose category___item_id isn't on the parent ITM).
      // Mirror PO behavior at useDNDCQuantityData.ts:265-284 — categorize as "matched".
      for (const [key, dc] of dcMap) {
        if (processedKeys.has(key)) continue;
        items.push({
          itemId: key.split("___")[1],
          itemName: dc.itemName,
          category: dc.category,
          unit: dc.unit,
          transferQty: 0,
          dnQty: 0,
          dcQty: dc.qty,
          difference: -dc.qty,
          status: "matched",
        });
      }

      // Activity filter (mirror PO useDNDCQuantityData.ts:286-291).
      const activeItems = items.filter((i) => !(i.dnQty === 0 && i.dcQty === 0));
      if (activeItems.length === 0) continue;

      const itemsMatched = activeItems.filter((i) => i.status === "matched").length;
      const totalTransferQty = activeItems.reduce((s, i) => s + i.transferQty, 0);
      const totalDNQty = activeItems.reduce((s, i) => s + i.dnQty, 0);
      const totalDCQty = activeItems.reduce((s, i) => s + i.dcQty, 0);
      const totalDifference = totalDNQty - totalDCQty;

      grouped.push({
        itmName: itm.name,
        sourceProject,
        sourceProjectName,
        itmStatus: itm.status,
        totalTransferQty,
        totalDNQty,
        totalDCQty,
        totalDifference,
        itemsTotal: activeItems.length,
        itemsMatched,
        reconcileStatus: rollupStatus(activeItems),
        items: activeItems,
      });
    }

    return grouped;
  }, [itmResp, allDeliveryDocs, projectId, projectNameMap]);

  const summary = useMemo(() => {
    const counts: Record<ReconcileStatus, number> = {
      matched: 0,
      mismatch: 0,
      no_dc_update: 0,
      pending_dn: 0,
    };
    for (const r of itmRows) counts[r.reconcileStatus]++;
    return counts;
  }, [itmRows]);

  // Derive status options from actual ITM-level rollup statuses (mirror PO
  // `statusOptions` derivation in DNDCQuantityReport.tsx:371). Only statuses
  // present in the current data appear in the filter popover.
  const statusFacetOptions = useMemo(() => {
    const unique = new Set<ReconcileStatus>(itmRows.map((r) => r.reconcileStatus));
    return Array.from(unique)
      .sort()
      .map((s) => ({ label: STATUS_LABELS[s], value: s }));
  }, [itmRows]);

  const sourceProjectFacetOptions = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of itmRows) {
      const val = r.sourceProjectName || r.sourceProject;
      if (val) counts[val] = (counts[val] || 0) + 1;
    }
    return Object.entries(counts)
      .map(([val, count]) => ({ label: `${val} (${count})`, value: val }))
      .sort((a, b) => a.value.localeCompare(b.value));
  }, [itmRows]);

  const filteredITMs = useMemo(() => {
    let result = itmRows;
    const trimmed = searchTerm.trim().toLowerCase();
    if (trimmed) {
      result = result.filter(
        (r) =>
          r.itmName.toLowerCase().includes(trimmed) ||
          (r.sourceProjectName || "").toLowerCase().includes(trimmed) ||
          r.items.some(
            (it) =>
              it.itemName.toLowerCase().includes(trimmed) ||
              (it.category || "").toLowerCase().includes(trimmed)
          )
      );
    }
    if (statusFilter.size > 0) {
      result = result.filter((r) => statusFilter.has(r.reconcileStatus));
    }
    if (sourceProjectFilter.size > 0) {
      result = result.filter((r) =>
        sourceProjectFilter.has(r.sourceProjectName || r.sourceProject)
      );
    }
    if (sortKey) {
      result = [...result].sort((a, b) => {
        const diff = a[sortKey] - b[sortKey];
        return sortDirection === "asc" ? diff : -diff;
      });
    }
    return result;
  }, [itmRows, searchTerm, statusFilter, sourceProjectFilter, sortKey, sortDirection]);

  const flatRows = useMemo<FlatRow[]>(() => {
    const out: FlatRow[] = [];
    for (const itm of filteredITMs) {
      out.push({ type: "itm", data: itm });
      if (expandedITMs.has(itm.itmName)) {
        for (let i = 0; i < itm.items.length; i++) {
          out.push({ type: "item", data: itm, itemIndex: i });
        }
      }
    }
    return out;
  }, [filteredITMs, expandedITMs]);

  const toggleExpand = useCallback((itmName: string) => {
    setExpandedITMs((prev) => {
      const next = new Set(prev);
      if (next.has(itmName)) next.delete(itmName);
      else next.add(itmName);
      return next;
    });
  }, []);

  const handleExport = useCallback(() => {
    if (filteredITMs.length === 0) {
      toast({
        title: "No Data",
        description: "No data to export based on current filters.",
        variant: "default",
      });
      return;
    }

    const headers = [
      "ITM Number",
      "Source Project",
      "Category",
      "Item Name",
      "Unit",
      "Transfer Qty",
      "DN Qty",
      "DC Qty",
      "Difference",
      "Reconcile Status",
    ];

    const rows: Record<string, string>[] = [];
    for (const itm of filteredITMs) {
      for (const item of itm.items) {
        rows.push({
          "ITM Number": itm.itmName,
          "Source Project": itm.sourceProjectName || itm.sourceProject || "",
          Category: item.category,
          "Item Name": item.itemName || "N/A",
          Unit: item.unit || "-",
          "Transfer Qty": item.transferQty.toFixed(2),
          "DN Qty": item.dnQty.toFixed(2),
          "DC Qty": item.dcQty.toFixed(2),
          Difference: item.difference.toFixed(2),
          "Reconcile Status": getStatusLabel(item.status),
        });
      }
    }

    const safeName = (projectName || projectId).replace(/\s+/g, "_");
    exportToCsv(
      `itm_dndc_quantity_report_${safeName}`,
      rows,
      headers.map((h) => ({ header: h, accessorKey: h }))
    );
    toast({
      title: "Export Successful",
      description: `${rows.length} items across ${filteredITMs.length} ITMs exported.`,
    });
  }, [filteredITMs, projectId, projectName]);

  const isLoading = itmLoading || docsLoading;
  const error = itmError || docsError;

  if (isLoading) return <LoadingFallback />;

  if (error) return <AlertDestructive error={error as Error} />;

  if (itmRows.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-12">
        No incoming Transfer Memos in delivered state for this project.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Info banner — same wording style as PO */}
      <Alert variant="default" className="border-blue-200 bg-blue-50">
        <Info className="h-4 w-4 text-blue-600" />
        <AlertDescription className="text-sm text-blue-800">
          Compares Delivery Note (DN) vs Delivery Challan (DC) quantities for incoming
          Transfer Memos in this project. Flags mismatches where DN exceeds DC, items
          with no DC update, and items with DCs but no DN yet (Pending DN).
        </AlertDescription>
      </Alert>

      {/* Summary cards — ITM-level counts */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="border-green-200 bg-green-50">
          <CardContent className="p-3 flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            <div>
              <div className="text-lg font-semibold text-green-700">{summary.matched}</div>
              <div className="text-xs text-green-600">Fully Matched</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="p-3 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            <div>
              <div className="text-lg font-semibold text-amber-700">{summary.mismatch}</div>
              <div className="text-xs text-amber-600">Quantity Mismatch</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-3 flex items-center gap-2">
            <XCircle className="h-5 w-5 text-red-600" />
            <div>
              <div className="text-lg font-semibold text-red-700">{summary.no_dc_update}</div>
              <div className="text-xs text-red-600">No DC Update</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="p-3 flex items-center gap-2">
            <Clock className="h-5 w-5 text-blue-600" />
            <div>
              <div className="text-lg font-semibold text-blue-700">{summary.pending_dn}</div>
              <div className="text-xs text-blue-600">Pending DN</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search + export */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search ITM, source project, item, or category..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-8"
          />
        </div>
        <Button variant="outline" size="sm" onClick={handleExport} className="ml-auto">
          <Download className="h-4 w-4 mr-1" />
          Export CSV
        </Button>
      </div>

      {/* Expandable parent table */}
      <div className="rounded-md border overflow-x-auto max-h-[65vh] overflow-y-auto">
        <Table>
          <TableHeader className="bg-background sticky top-0 z-[40]">
            <TableRow>
              <TableHead className="w-[40px]"></TableHead>
              <TableHead className="min-w-[160px]">ITM Number</TableHead>
              <TableHead className="min-w-[160px]">
                <div className="flex items-center gap-1">
                  <SimpleFacetedFilter
                    title="Source Project"
                    options={sourceProjectFacetOptions}
                    selectedValues={sourceProjectFilter}
                    onSelectedValuesChange={setSourceProjectFilter}
                  />
                  <span>Source Project</span>
                </div>
              </TableHead>
              <TableHead className="min-w-[140px]">Category</TableHead>
              <TableHead className="text-center min-w-[100px]">Items</TableHead>
              <SortableHeader {...sortProps("totalTransferQty")} className="text-right min-w-[110px]">
                Transfer Qty
              </SortableHeader>
              <SortableHeader {...sortProps("totalDNQty")} className="text-right min-w-[100px]">
                DN Qty
              </SortableHeader>
              <SortableHeader {...sortProps("totalDCQty")} className="text-right min-w-[100px]">
                DC Qty
              </SortableHeader>
              <SortableHeader {...sortProps("totalDifference")} className="text-right min-w-[110px]">
                Difference
              </SortableHeader>
              <TableHead className="text-center min-w-[140px]">
                <div className="flex items-center gap-1 justify-center">
                  <SimpleFacetedFilter
                    title="Status"
                    options={statusFacetOptions}
                    selectedValues={statusFilter}
                    onSelectedValuesChange={setStatusFilter}
                  />
                  <span>Status</span>
                </div>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {flatRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="h-24 text-center text-muted-foreground">
                  <div className="flex items-center justify-center gap-2">
                    <ListX className="h-4 w-4" />
                    <span>No results match your filters.</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              flatRows.map((row, idx) => {
                if (row.type === "itm") {
                  const itm = row.data;
                  const isExpanded = expandedITMs.has(itm.itmName);
                  return (
                    <TableRow
                      key={`itm-${itm.itmName}`}
                      className={cn(
                        "cursor-pointer hover:opacity-80",
                        getReconcileRowClasses(itm.reconcileStatus)
                      )}
                      onClick={() => toggleExpand(itm.itmName)}
                    >
                      <TableCell className="py-2 px-2">
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </TableCell>
                      <TableCell className="py-2 px-3 font-medium">
                        <Link
                          to={`/internal-transfer-memos/${itm.itmName}`}
                          className="text-blue-600 hover:underline text-xs font-mono"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {itm.itmName}
                        </Link>
                      </TableCell>
                      <TableCell className="py-2 px-3 text-sm text-muted-foreground">
                        {itm.sourceProjectName || itm.sourceProject || "—"}
                      </TableCell>
                      <TableCell className="py-2 px-3"></TableCell>
                      <TableCell className="text-center py-2 px-3 text-sm">
                        <span className="font-mono">
                          {itm.itemsMatched}/{itm.itemsTotal}
                        </span>
                      </TableCell>
                      <TableCell className="text-right py-2 px-3 font-mono text-sm">
                        {itm.totalTransferQty.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right py-2 px-3 font-mono text-sm">
                        {itm.totalDNQty.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right py-2 px-3 font-mono text-sm">
                        {itm.totalDCQty.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right py-2 px-3 font-mono text-sm font-semibold">
                        {itm.totalDifference !== 0 ? (
                          <span
                            className={
                              itm.totalDifference > 0
                                ? "text-amber-700"
                                : "text-green-700"
                            }
                          >
                            {itm.totalDifference > 0 ? "+" : ""}
                            {itm.totalDifference.toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-green-700">0.00</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center py-2 px-3">
                        {getStatusBadge(itm.reconcileStatus)}
                      </TableCell>
                    </TableRow>
                  );
                }

                const itm = row.data;
                const item = itm.items[row.itemIndex];
                return (
                  <TableRow
                    key={`item-${itm.itmName}-${item.itemId}-${row.itemIndex}-${idx}`}
                    className={getItemRowClasses(item.status)}
                  >
                    <TableCell className="py-1.5 px-2"></TableCell>
                    <TableCell className="py-1.5 px-3"></TableCell>
                    <TableCell className="py-1.5 px-3"></TableCell>
                    <TableCell className="py-1.5 px-3 text-xs text-muted-foreground">
                      {item.category || "—"}
                    </TableCell>
                    <TableCell className="py-1.5 px-3 text-xs">
                      <span className="font-medium">{item.itemName || "N/A"}</span>
                      <span className="text-muted-foreground ml-2">
                        ({item.unit || "-"})
                      </span>
                      {item.make && (
                        <span className="text-muted-foreground ml-2">· {item.make}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right py-1.5 px-3 font-mono text-xs">
                      {item.transferQty.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right py-1.5 px-3 font-mono text-xs">
                      {item.dnQty.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right py-1.5 px-3 font-mono text-xs">
                      {item.dcQty.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right py-1.5 px-3 font-mono text-xs font-semibold">
                      {item.difference !== 0 ? (
                        <span className={item.difference > 0 ? "text-amber-700" : "text-green-700"}>
                          {item.difference > 0 ? "+" : ""}
                          {item.difference.toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-green-700">0.00</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center py-1.5 px-3">
                      {getStatusBadge(item.status)}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

/**
 * Public wrapper — handles standalone (Reports hub) and embedded (project page) modes.
 * - Embedded: parent passes `projectId`; we render the content directly.
 * - Standalone: no `projectId` prop; we show a project selector and render content
 *   once a project is chosen. Mirrors the PO `DNDCQuantityReport` standalone pattern.
 */
export const ITMDNDCQuantityReport: React.FC<ITMDNDCQuantityReportProps> = ({
  projectId: propProjectId,
  projectName: propProjectName,
}) => {
  const [selectedProject, setSelectedProject] = useState<{
    value: string;
    label: string;
  } | null>(null);

  const effectiveProjectId = propProjectId ?? selectedProject?.value ?? null;
  const effectiveProjectName = propProjectName ?? selectedProject?.label ?? "";

  if (effectiveProjectId) {
    return (
      <div className="flex flex-col gap-4">
        {!propProjectId && (
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700 whitespace-nowrap">
              Select Project:
            </span>
            <div className="w-full max-w-md">
              <ProjectSelect
                onChange={(option) => setSelectedProject(option)}
                universal={false}
              />
            </div>
          </div>
        )}
        <ITMDNDCQuantityReportContent
          projectId={effectiveProjectId}
          projectName={effectiveProjectName}
        />
      </div>
    );
  }

  // Standalone, no project selected yet — show the selector + empty state.
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-gray-700 whitespace-nowrap">
          Select Project:
        </span>
        <div className="w-full max-w-md">
          <ProjectSelect
            onChange={(option) => setSelectedProject(option)}
            universal={false}
          />
        </div>
      </div>
      <div className="text-center text-muted-foreground py-12">
        Select a project above to view its ITM DN &gt; DC reconciliation.
      </div>
    </div>
  );
};

export default ITMDNDCQuantityReport;
