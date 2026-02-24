import { useState, useMemo, useCallback, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Link } from "react-router-dom";
import {
  ChevronRight,
  ChevronDown,
  Search,
  Download,
  Info,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  ListX,
} from "lucide-react";
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
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import ProjectSelect from "@/components/custom-select/project-select";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { SimpleFacetedFilter } from "@/pages/projects/components/SimpleFacetedFilter";
import { exportToCsv } from "@/utils/exportToCsv";
import { toast } from "@/components/ui/use-toast";
import { useProjectAssignees } from "@/hooks/useProjectAssignees";
import type { ProjectAssignee } from "@/hooks/useProjectAssignees";
import {
  useDNDCQuantityData,
  DNDCPORow,
  ReconcileStatus,
} from "../hooks/useDNDCQuantityData";

// =================================================================================
// 1. HELPERS
// =================================================================================

function getReconcileRowClasses(status: ReconcileStatus): string {
  switch (status) {
    case "matched":
      return "bg-green-50 border-l-4 border-l-green-500";
    case "mismatch":
      return "bg-amber-50 border-l-4 border-l-amber-500";
    case "no_dc_update":
      return "bg-red-50 border-l-4 border-l-red-500";
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
  }
}

function getStatusBadge(status: ReconcileStatus) {
  switch (status) {
    case "matched":
      return (
        <Badge
          className="bg-green-100 text-green-700 border-green-300"
          variant="outline"
        >
          Matched
        </Badge>
      );
    case "mismatch":
      return (
        <Badge
          className="bg-amber-100 text-amber-700 border-amber-300"
          variant="outline"
        >
          Mismatch
        </Badge>
      );
    case "no_dc_update":
      return (
        <Badge
          className="bg-red-100 text-red-700 border-red-300"
          variant="outline"
        >
          No DC Update
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
  }
}

// =================================================================================
// 2. PROJECT TEAM STRIP
// =================================================================================

const ROLE_CONFIG: Record<
  string,
  { label: string; color: string; bg: string; ring: string }
> = {
  "Nirmaan Project Manager Profile": {
    label: "PM",
    color: "text-violet-700",
    bg: "bg-violet-100",
    ring: "ring-violet-200",
  },
  "Nirmaan Procurement Executive Profile": {
    label: "Proc",
    color: "text-sky-700",
    bg: "bg-sky-100",
    ring: "ring-sky-200",
  },
  "Nirmaan Project Lead Profile": {
    label: "Lead",
    color: "text-emerald-700",
    bg: "bg-emerald-100",
    ring: "ring-emerald-200",
  },
};

const RELEVANT_ROLES = Object.keys(ROLE_CONFIG);

function ProjectTeamStrip({
  projectId,
  assignmentsLookup,
}: {
  projectId: string;
  assignmentsLookup: Record<string, ProjectAssignee[]>;
}) {
  const assignees = assignmentsLookup[projectId] || [];
  const relevant = assignees.filter((a) => RELEVANT_ROLES.includes(a.role));

  if (relevant.length === 0) return null;

  // Group by role, preserving the config order
  const grouped = RELEVANT_ROLES.reduce(
    (acc, role) => {
      const users = relevant.filter((a) => a.role === role);
      if (users.length > 0) acc.push({ role, users });
      return acc;
    },
    [] as { role: string; users: ProjectAssignee[] }[]
  );

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-md border border-gray-200 bg-gray-50/80">
      <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider shrink-0">
        Team
      </span>
      <div className="h-4 w-px bg-gray-200 shrink-0" />
      <div className="flex items-center gap-4 flex-wrap">
        {grouped.map(({ role, users }) => {
          const cfg = ROLE_CONFIG[role];
          return (
            <div key={role} className="flex items-center gap-1.5">
              <span
                className={`text-[10px] font-semibold uppercase tracking-wider ${cfg.color} opacity-70`}
              >
                {cfg.label}
              </span>
              <div className="flex items-center gap-1">
                {users.map((user) => (
                  <div
                    key={user.email}
                    className={`inline-flex items-center gap-1.5 pl-0.5 pr-2 py-0.5 rounded-full ring-1 ${cfg.ring} ${cfg.bg}`}
                  >
                    <div
                      className={`h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold ${cfg.color} bg-white/80 ring-1 ${cfg.ring}`}
                    >
                      {user.name.charAt(0).toUpperCase()}
                    </div>
                    <span
                      className={`text-xs font-medium ${cfg.color} leading-none`}
                    >
                      {user.name}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// =================================================================================
// 3. SORTABLE HEADER (same pattern as POWiseMaterialTable)
// =================================================================================

type SortKey =
  | "totalOrderedQty"
  | "totalDNQty"
  | "totalDCQty"
  | "totalDifference";

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
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
            >
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

// =================================================================================
// 3. FLAT ROW TYPE
// =================================================================================

type FlatRow =
  | { type: "po"; data: DNDCPORow }
  | { type: "item"; data: DNDCPORow; itemIndex: number };

// =================================================================================
// 4. CONTENT COMPONENT
// =================================================================================

function DNDCQuantityReportContent({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const { poRows, isLoading, error, summary } =
    useDNDCQuantityData(projectId);
  const parentRef = useRef<HTMLDivElement>(null);
  const [expandedPOs, setExpandedPOs] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");

  // --- Faceted filters ---
  const [vendorFilter, setVendorFilter] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());

  // --- Sort state ---
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const handleSetSort = useCallback(
    (key: SortKey, direction: "asc" | "desc") => {
      setSortKey(key);
      setSortDirection(direction);
    },
    []
  );
  const handleClearSort = useCallback(() => setSortKey(null), []);

  const sortProps = (key: SortKey) => ({
    sortableKey: key,
    currentSortKey: sortKey,
    currentSortDirection: sortDirection,
    onSetSort: handleSetSort,
    onClearSort: handleClearSort,
  });

  // --- Derived filter options from data ---
  const vendorOptions = useMemo(() => {
    if (!poRows) return [];
    const unique = new Set(poRows.map((po) => po.vendorName).filter(Boolean));
    return Array.from(unique)
      .sort()
      .map((v) => ({ label: v, value: v }));
  }, [poRows]);

  const statusOptions = useMemo(() => {
    if (!poRows) return [];
    const unique = new Set(poRows.map((po) => po.reconcileStatus));
    return Array.from(unique)
      .sort()
      .map((s) => ({ label: getStatusLabel(s), value: s }));
  }, [poRows]);

  // --- Search, Filter & Sort Pipeline ---
  const filteredPOs = useMemo(() => {
    if (!poRows) return [];
    let result = poRows;

    // Text search
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      result = result.filter(
        (po) =>
          po.poNumber.toLowerCase().includes(lower) ||
          po.vendorName.toLowerCase().includes(lower)
      );
    }

    // Vendor faceted filter
    if (vendorFilter.size > 0) {
      result = result.filter((po) => vendorFilter.has(po.vendorName));
    }

    // Status faceted filter
    if (statusFilter.size > 0) {
      result = result.filter((po) =>
        statusFilter.has(po.reconcileStatus)
      );
    }

    // Sort
    if (sortKey) {
      result = [...result].sort((a, b) => {
        const diff = a[sortKey] - b[sortKey];
        return sortDirection === "asc" ? diff : -diff;
      });
    }

    return result;
  }, [poRows, searchTerm, vendorFilter, statusFilter, sortKey, sortDirection]);

  // --- Flat rows for virtualization ---
  const flatRows = useMemo(() => {
    const rows: FlatRow[] = [];
    for (const po of filteredPOs) {
      rows.push({ type: "po", data: po });
      if (expandedPOs.has(po.poNumber)) {
        for (let i = 0; i < po.items.length; i++) {
          rows.push({ type: "item", data: po, itemIndex: i });
        }
      }
    }
    return rows;
  }, [filteredPOs, expandedPOs]);

  // --- Virtualizer ---
  const rowVirtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,
    overscan: 10,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
  const paddingBottom =
    virtualRows.length > 0
      ? rowVirtualizer.getTotalSize() -
        virtualRows[virtualRows.length - 1].end
      : 0;

  // --- Toggle expand ---
  const toggleExpand = useCallback((poNumber: string) => {
    setExpandedPOs((prev) => {
      const newSet = new Set(prev);
      newSet.has(poNumber) ? newSet.delete(poNumber) : newSet.add(poNumber);
      return newSet;
    });
  }, []);

  // --- CSV Export (flat: one row per item, same pattern as POWiseMaterialTable) ---
  const handleExport = useCallback(() => {
    if (filteredPOs.length === 0) {
      toast({
        title: "No Data",
        description: "No data to export based on current filters.",
        variant: "default",
      });
      return;
    }

    const headers = [
      "PO Number",
      "Vendor",
      "Category",
      "Item Name",
      "Unit",
      "Ordered Qty",
      "DN Qty",
      "DC Qty",
      "Difference",
      "Reconcile Status",
    ];

    const rows: Record<string, string>[] = [];
    for (const po of filteredPOs) {
      for (const item of po.items) {
        rows.push({
          "PO Number": po.poNumber,
          Vendor: po.vendorName,
          Category: item.category,
          "Item Name": item.itemName || "N/A",
          Unit: item.unit || "-",
          "Ordered Qty": item.orderedQty.toFixed(2),
          "DN Qty": item.dnQty.toFixed(2),
          "DC Qty": item.dcQty.toFixed(2),
          Difference: item.difference.toFixed(2),
          "Reconcile Status": getStatusLabel(item.status),
        });
      }
    }

    exportToCsv(
      `dndc_quantity_report_${projectName.replace(/\s+/g, "_")}`,
      rows,
      headers.map((h) => ({ header: h, accessorKey: h }))
    );
    toast({
      title: "Export Successful",
      description: `${rows.length} items across ${filteredPOs.length} POs exported.`,
    });
  }, [filteredPOs, projectName]);

  // --- Loading / Error states ---
  if (isLoading) {
    return <LoadingFallback />;
  }

  if (error) {
    return <AlertDestructive error={error} />;
  }

  if (poRows && poRows.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-12">
        No POs with status &quot;Delivered&quot; or &quot;Partially
        Delivered&quot; found for this project.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-3 gap-3">
          <Card className="border-green-200 bg-green-50">
            <CardContent className="p-3 flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              <div>
                <div className="text-lg font-semibold text-green-700">
                  {summary.matchedPOs}
                </div>
                <div className="text-xs text-green-600">Fully Matched</div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="p-3 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              <div>
                <div className="text-lg font-semibold text-amber-700">
                  {summary.mismatchPOs}
                </div>
                <div className="text-xs text-amber-600">Quantity Mismatch</div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-red-200 bg-red-50">
            <CardContent className="p-3 flex items-center gap-2">
              <XCircle className="h-5 w-5 text-red-600" />
              <div>
                <div className="text-lg font-semibold text-red-700">
                  {summary.noDCUpdatePOs}
                </div>
                <div className="text-xs text-red-600">No DC Update</div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Search bar + export */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search PO number or vendor..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-8"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleExport}
          className="ml-auto"
        >
          <Download className="h-4 w-4 mr-1" />
          Export CSV
        </Button>
      </div>

      {/* Virtualized expandable table */}
      <div
        ref={parentRef}
        className="rounded-md border overflow-x-auto max-h-[65vh] overflow-y-auto"
      >
        <Table>
          <TableHeader className="bg-background sticky top-0 z-[40]">
            <TableRow>
              <TableHead className="w-[40px]"></TableHead>
              <TableHead className="min-w-[160px]">PO Number</TableHead>
              <TableHead className="min-w-[150px]">
                <div className="flex items-center gap-1">
                  <SimpleFacetedFilter
                    title="Vendor"
                    options={vendorOptions}
                    selectedValues={vendorFilter}
                    onSelectedValuesChange={setVendorFilter}
                  />
                  <span>Vendor</span>
                </div>
              </TableHead>
              <TableHead className="text-center min-w-[100px]">
                Items
              </TableHead>
              <SortableHeader
                {...sortProps("totalOrderedQty")}
                className="text-right min-w-[100px]"
              >
                Ordered Qty
              </SortableHeader>
              <SortableHeader
                {...sortProps("totalDNQty")}
                className="text-right min-w-[100px]"
              >
                DN Qty
              </SortableHeader>
              <SortableHeader
                {...sortProps("totalDCQty")}
                className="text-right min-w-[100px]"
              >
                DC Qty
              </SortableHeader>
              <SortableHeader
                {...sortProps("totalDifference")}
                className="text-right min-w-[100px]"
              >
                Difference
              </SortableHeader>
              <TableHead className="text-center min-w-[120px]">
                <div className="flex items-center gap-1 justify-center">
                  <SimpleFacetedFilter
                    title="Status"
                    options={statusOptions}
                    selectedValues={statusFilter}
                    onSelectedValuesChange={setStatusFilter}
                  />
                  <span>Status</span>
                </div>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paddingTop > 0 && (
              <TableRow>
                <td colSpan={9} style={{ height: `${paddingTop}px` }} />
              </TableRow>
            )}

            {virtualRows.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="h-24 text-center text-muted-foreground"
                >
                  {poRows && poRows.length === 0
                    ? "No POs with 'Delivered' or 'Partially Delivered' status found."
                    : "No results match your filters."}
                </TableCell>
              </TableRow>
            )}

            {virtualRows.map((virtualRow) => {
              const row = flatRows[virtualRow.index];

              if (row.type === "po") {
                const po = row.data;
                const isExpanded = expandedPOs.has(po.poNumber);
                return (
                  <TableRow
                    key={`po-${po.poNumber}`}
                    className={`cursor-pointer hover:opacity-80 ${getReconcileRowClasses(po.reconcileStatus)}`}
                    onClick={() => toggleExpand(po.poNumber)}
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
                        to={`/project-payments/${po.poNumber.replace(/\//g, "&=")}`}
                        className="text-blue-600 hover:underline text-xs font-mono"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {po.poNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="py-2 px-3 text-sm text-muted-foreground">
                      {po.vendorName}
                    </TableCell>
                    <TableCell className="text-center py-2 px-3 text-sm">
                      <span className="font-mono">
                        {po.itemsMatched}/{po.itemsTotal}
                      </span>
                    </TableCell>
                    <TableCell className="text-right py-2 px-3 font-mono text-sm">
                      {po.totalOrderedQty.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right py-2 px-3 font-mono text-sm">
                      {po.totalDNQty.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right py-2 px-3 font-mono text-sm">
                      {po.totalDCQty.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right py-2 px-3 font-mono text-sm font-semibold">
                      {po.totalDifference !== 0 ? (
                        <span
                          className={
                            po.totalDifference > 0
                              ? "text-amber-700"
                              : "text-red-700"
                          }
                        >
                          {po.totalDifference > 0 ? "+" : ""}
                          {po.totalDifference.toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-green-700">0.00</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center py-2 px-3">
                      {getStatusBadge(po.reconcileStatus)}
                    </TableCell>
                  </TableRow>
                );
              }

              // Item row
              const po = row.data;
              const item = po.items[row.itemIndex];
              return (
                <TableRow
                  key={`item-${po.poNumber}-${row.itemIndex}`}
                  className={getItemRowClasses(item.status)}
                >
                  <TableCell className="py-1.5 px-2"></TableCell>
                  <TableCell
                    className="py-1.5 px-3 text-xs pl-8"
                    colSpan={2}
                  >
                    <span className="text-muted-foreground">
                      {item.category} /{" "}
                    </span>
                    <span className="font-medium">
                      {item.itemName || "N/A"}
                    </span>
                    <span className="text-muted-foreground ml-2">
                      ({item.unit || "-"})
                    </span>
                  </TableCell>
                  <TableCell className="text-center py-1.5 px-3 text-xs text-muted-foreground">
                    -
                  </TableCell>
                  <TableCell className="text-right py-1.5 px-3 font-mono text-xs">
                    {item.orderedQty.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right py-1.5 px-3 font-mono text-xs">
                    {item.dnQty.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right py-1.5 px-3 font-mono text-xs">
                    {item.dcQty.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right py-1.5 px-3 font-mono text-xs font-semibold">
                    {item.difference !== 0 ? (
                      <span
                        className={
                          item.difference > 0
                            ? "text-amber-700"
                            : "text-red-700"
                        }
                      >
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
            })}

            {paddingBottom > 0 && (
              <TableRow>
                <td colSpan={9} style={{ height: `${paddingBottom}px` }} />
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// =================================================================================
// 5. MAIN EXPORTED COMPONENT
// =================================================================================

export default function DNDCQuantityReport() {
  const [selectedProject, setSelectedProject] = useState<{
    value: string;
    label: string;
  } | null>(null);

  const { assignmentsLookup } = useProjectAssignees();

  return (
    <div className="flex flex-col gap-4">
      {/* Project selector */}
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

      {/* Info alert */}
      <Alert variant="default" className="border-blue-200 bg-blue-50">
        <Info className="h-4 w-4 text-blue-600" />
        <AlertDescription className="text-sm text-blue-800">
          Compares Delivery Note (DN) quantities against Delivery Challan (DC)
          quantities for POs with status &quot;Delivered&quot; or &quot;Partially
          Delivered&quot;. Helps identify POs where DC documentation hasn&apos;t
          caught up with delivery records.
        </AlertDescription>
      </Alert>

      {/* Project team strip */}
      {selectedProject && (
        <ProjectTeamStrip
          projectId={selectedProject.value}
          assignmentsLookup={assignmentsLookup}
        />
      )}

      {selectedProject ? (
        <DNDCQuantityReportContent
          key={selectedProject.value}
          projectId={selectedProject.value}
          projectName={selectedProject.label}
        />
      ) : (
        <div className="text-center text-muted-foreground py-12">
          Please select a project to view the DN vs DC reconciliation report.
        </div>
      )}
    </div>
  );
}
