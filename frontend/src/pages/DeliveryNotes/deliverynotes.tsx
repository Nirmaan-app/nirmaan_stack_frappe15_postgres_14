import { useState, useContext, useMemo, useCallback, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useFrappeGetCall, useFrappeGetDocList } from "frappe-react-sdk";
import { UserContext } from "@/utils/auth/UserProvider";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { useProjectDeliveryNotes } from "./hooks/useProjectDeliveryNotes";
import { DNDetailDialog } from "./components/DNDetailDialog";
import { useDownloadDN } from "./hooks/useDownloadDN";
import { DeliveryNote } from "@/types/NirmaanStack/DeliveryNotes";
import { cn } from "@/lib/utils";
import type { ITMListRow } from "@/pages/InternalTransferMemos/config/itmList.config";
import type { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers";

// UI Components
import ProjectSelect from "@/components/custom-select/project-select";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  FilePlus2,
  ListVideo,
  ClipboardList,
  Search,
  ChevronRight,
  Download,
  Filter,
  FilterX,
} from "lucide-react";
import { encodeFrappeId } from "./constants";

// --- Types ---

interface POWithItems {
  name: string;
  project: string;
  vendor_name: string;
  dispatch_date: string;
  status: string;
  creation: string;
  items?: { item_name: string; item_id: string; parent: string; is_dispatched?: number }[];
}

// Discriminated union for the merged CREATE-view table.
type CreateRow =
  | { type: "po"; data: POWithItems; creation: string }
  | { type: "itm"; data: ITMListRow; creation: string };

type CreateTypeFilter = "all" | "po" | "itm";

interface POBasic {
  name: string;
  project: string;
  vendor_name: string;
  dispatch_date: string;
  status: string;
}

// --- Helper Components ---

function DashboardCard({
  title,
  icon,
  onClick,
  className,
}: {
  title: string;
  icon: React.ReactNode;
  onClick: () => void;
  className?: string;
}) {
  return (
    <Button
      variant="ghost"
      className={`h-[150px] w-full min-w-[250px] p-0 rounded-lg shadow-md hover:shadow-lg transition-shadow ${className}`}
      onClick={onClick}
    >
      <div className="flex h-full w-full flex-col justify-between p-6 text-white">
        <p className="text-xl font-semibold text-left">{title}</p>
        <div className="self-end">{icon}</div>
      </div>
    </Button>
  );
}

function DNDownloadButton({
  poId,
  deliveryDate,
  noteNo,
}: {
  poId: string;
  deliveryDate: string;
  noteNo: string | number;
}) {
  const { downloadDN } = useDownloadDN(poId);
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7"
      onClick={() => downloadDN(deliveryDate, noteNo)}
    >
      <Download className="h-3.5 w-3.5" />
    </Button>
  );
}

function SearchInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (val: string) => void;
}) {
  return (
    <div className="relative mb-4">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <Input
        placeholder="Search PO / ITM, vendor, source project, or item..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pl-9"
      />
    </div>
  );
}

// --- Main Component ---

const DeliveryNotes: React.FC = () => {
  const navigate = useNavigate();
  const { setSelectedProject, selectedProject } = useContext(UserContext);

  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDN, setSelectedDN] = useState<DeliveryNote | null>(null);
  const [dnDialogOpen, setDnDialogOpen] = useState(false);
  const [viewExistingType, setViewExistingType] = useState<'po' | 'itm'>('po');

  // Type filter for the unified CREATE-view table: All / PO / ITM.
  // URL-persisted so a refresh keeps the user's last choice.
  const createTypeFilter: CreateTypeFilter = useMemo(() => {
    const raw = searchParams.get("type");
    if (raw === "po" || raw === "itm") return raw;
    return "all";
  }, [searchParams]);

  const setCreateTypeFilter = useCallback(
    (next: CreateTypeFilter) => {
      const params = new URLSearchParams(searchParams);
      if (next === "all") {
        params.delete("type");
      } else {
        params.set("type", next);
      }
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  // Funnel-popover toggle handler — maps two checkboxes onto the
  // three-state `createTypeFilter`. Unchecking one type narrows to the
  // other; re-checking a hidden type bounces back to "all".
  const handleCreateTypeToggle = useCallback(
    (which: "po" | "itm", checked: boolean) => {
      const other = which === "po" ? "itm" : "po";
      if (checked) {
        if (createTypeFilter === other) {
          setCreateTypeFilter("all");
        }
      } else {
        setCreateTypeFilter(other);
      }
    },
    [createTypeFilter, setCreateTypeFilter]
  );

  const { data: usersList } = useFrappeGetDocList<NirmaanUsers>(
    "Nirmaan Users",
    { fields: ["name", "full_name", "email"] as ("name" | "full_name" | "email")[], limit: 0 }
  );

  const userNameMap = useMemo(() => {
    const map = new Map<string, string>();
    usersList?.forEach((u) => {
      map.set(u.name, u.full_name);
      if (u.email) map.set(u.email, u.full_name);
    });
    return map;
  }, [usersList]);

  const resolveUserName = useCallback((email: string | undefined | null) => {
    if (!email) return null;
    return userNameMap.get(email) ?? (email === "Administrator" ? "Admin" : email.split("@")[0]);
  }, [userNameMap]);

  const activeView = useMemo(() => {
    const view = searchParams.get("view");
    if (view === "create") return "CREATE";
    if (view === "view_existing") return "VIEW_EXISTING";
    return "DASHBOARD";
  }, [searchParams]);

  // Reset search when view changes
  useEffect(() => {
    setSearchQuery("");
  }, [activeView]);

  // --- CREATE view data ---
  const shouldFetchCreate = activeView === "CREATE" && !!selectedProject;
  const { data: createPOsResult, isLoading: createLoading } = useFrappeGetCall<{
    message: POWithItems[];
  }>(
    "nirmaan_stack.api.delivery_notes.get_project_pos.get_project_pos_with_items",
    shouldFetchCreate
      ? {
          project_id: selectedProject,
          statuses: JSON.stringify(["Partially Dispatched", "Dispatched", "Partially Delivered"]),
        }
      : undefined,
    shouldFetchCreate ? undefined : null
  );

  const createPOs: POWithItems[] = useMemo(
    () => createPOsResult?.message || [],
    [createPOsResult]
  );

  // --- CREATE view ITM data ---
  // Use custom API (get_itms_list) instead of useFrappeGetDocList to bypass
  // per-doc User Permission filtering — Project Managers need to see ITMs
  // for projects they may not have User Permissions for.
  const shouldFetchITMs = activeView === "CREATE" && !!selectedProject;
  const { data: itmResult, isLoading: itmLoading } = useFrappeGetCall<{
    message: { data: ITMListRow[] };
  }>(
    "nirmaan_stack.api.internal_transfers.get_itms_list.get_itms_list",
    shouldFetchITMs
      ? {
          filters: JSON.stringify([
            ["target_project", "=", selectedProject],
            ["status", "in", ["Dispatched", "Partially Delivered"]],
          ]),
          order_by: "creation desc",
          limit_page_length: 100,
        }
      : undefined,
    shouldFetchITMs ? undefined : null
  );

  const itmList = useMemo(() => itmResult?.message?.data || [], [itmResult]);

  // Merge PO + ITM rows into a single list and sort by `creation desc`
  // (the same per-list order both APIs already use, applied globally).
  const mergedCreateRows: CreateRow[] = useMemo(() => {
    const rows: CreateRow[] = [
      ...createPOs.map<CreateRow>((po) => ({
        type: "po",
        data: po,
        creation: po.creation,
      })),
      ...itmList.map<CreateRow>((itm) => ({
        type: "itm",
        data: itm,
        creation: itm.creation,
      })),
    ];
    rows.sort((a, b) => (a.creation < b.creation ? 1 : a.creation > b.creation ? -1 : 0));
    return rows;
  }, [createPOs, itmList]);

  const filteredCreateRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return mergedCreateRows.filter((row) => {
      if (createTypeFilter === "po" && row.type !== "po") return false;
      if (createTypeFilter === "itm" && row.type !== "itm") return false;
      if (!q) return true;
      if (row.type === "po") {
        const po = row.data;
        if (po.name.toLowerCase().includes(q)) return true;
        if (po.vendor_name?.toLowerCase().includes(q)) return true;
        if (po.items?.some((item) => item.item_name.toLowerCase().includes(q))) return true;
        return false;
      }
      const itm = row.data;
      if (itm.name.toLowerCase().includes(q)) return true;
      if (itm.source_project_name?.toLowerCase().includes(q)) return true;
      if (itm.source_project?.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [mergedCreateRows, searchQuery, createTypeFilter]);

  const createCounts = useMemo(
    () => ({
      po: mergedCreateRows.filter((r) => r.type === "po").length,
      itm: mergedCreateRows.filter((r) => r.type === "itm").length,
      all: mergedCreateRows.length,
    }),
    [mergedCreateRows]
  );

  // --- VIEW_EXISTING data ---
  const { data: viewExistingPOs, isLoading: viewExistingLoading } =
    useFrappeGetDocList<POBasic>("Procurement Orders", {
      fields: ["name", "project", "vendor_name", "dispatch_date", "status"],
      filters: [
        ["project", "=", selectedProject || ""],
        ["status", "in", ["Partially Dispatched", "Dispatched", "Partially Delivered", "Delivered"]],
      ],
      orderBy: { field: "creation", order: "desc" },
      limit: 1000,
    }, activeView === "VIEW_EXISTING" && !!selectedProject ? undefined : null);

  const {
    dnsByPO,
    dnsByITM,
    isLoading: dnsLoading,
  } = useProjectDeliveryNotes(
    ["CREATE", "VIEW_EXISTING"].includes(activeView) ? selectedProject : null
  );

  const enrichedViewPOs = useMemo(() => {
    if (!viewExistingPOs) return [];
    return viewExistingPOs
      .map((po) => ({
        ...po,
        dns: dnsByPO[po.name] || [],
      }))
      .filter((po) => po.dns.length > 0);
  }, [viewExistingPOs, dnsByPO]);

  const filteredViewPOs = useMemo(() => {
    if (!searchQuery.trim()) return enrichedViewPOs;
    const q = searchQuery.toLowerCase();
    return enrichedViewPOs.filter((po) => {
      if (po.name.toLowerCase().includes(q)) return true;
      if (po.vendor_name?.toLowerCase().includes(q)) return true;
      if (
        po.dns.some((dn) =>
          dn.items?.some((item) => item.item_name.toLowerCase().includes(q))
        )
      )
        return true;
      return false;
    });
  }, [enrichedViewPOs, searchQuery]);

  // Fetch ITM statuses for the View Existing accordion header badge.
  // Uses `get_itms_list` (not useFrappeGetDocList) to bypass per-doc User
  // Permission filtering — same reasoning as the CREATE-view ITM picker.
  const shouldFetchViewITMs = activeView === "VIEW_EXISTING" && !!selectedProject;
  const { data: viewExistingITMsResult } = useFrappeGetCall<{
    message: { data: ITMListRow[] };
  }>(
    "nirmaan_stack.api.internal_transfers.get_itms_list.get_itms_list",
    shouldFetchViewITMs
      ? {
          filters: JSON.stringify([
            ["target_project", "=", selectedProject],
            ["status", "in", ["Dispatched", "Partially Delivered", "Delivered"]],
          ]),
          order_by: "creation desc",
          limit_page_length: 10000,
        }
      : undefined,
    shouldFetchViewITMs ? undefined : null
  );

  const itmStatusByName = useMemo(() => {
    const map: Record<string, string> = {};
    (viewExistingITMsResult?.message?.data || []).forEach((itm) => {
      map[itm.name] = itm.status;
    });
    return map;
  }, [viewExistingITMsResult]);

  // --- CREATE view: pre-fetch eligible project IDs so the project picker
  // can hide projects that have nothing to act on. Two minimal fetches (PO
  // + ITM) that pull only the project-link field — payloads stay tiny.
  const shouldFetchEligibleProjects = activeView === "CREATE";

  const { data: eligiblePOProjectsRaw, isLoading: eligiblePOLoading } =
    useFrappeGetDocList<{ name: string; project: string }>(
      "Procurement Orders",
      {
        fields: ["project"],
        filters: [
          ["status", "in", ["Partially Dispatched", "Dispatched", "Partially Delivered"]],
        ],
        limit: 0,
      },
      shouldFetchEligibleProjects ? undefined : null
    );

  // ITM side uses the custom endpoint (bypasses User Permissions) so PMs
  // don't lose target projects they can legitimately receive into.
  const { data: eligibleITMResult, isLoading: eligibleITMLoading } =
    useFrappeGetCall<{ message: { data: ITMListRow[] } }>(
      "nirmaan_stack.api.internal_transfers.get_itms_list.get_itms_list",
      shouldFetchEligibleProjects
        ? {
            filters: JSON.stringify([
              ["status", "in", ["Dispatched", "Partially Delivered"]],
            ]),
            limit_page_length: 10000,
          }
        : undefined,
      shouldFetchEligibleProjects ? undefined : null
    );

  // Build the allow-set lazily. Returns `undefined` while either fetch is
  // still loading so `ProjectSelect` doesn't briefly render an empty list
  // — once both finish, the populated Set takes over.
  const eligibleProjectCounts = useMemo<
    Record<string, { po: number; itm: number }> | undefined
  >(() => {
    if (!shouldFetchEligibleProjects) return undefined;
    if (eligiblePOLoading || eligibleITMLoading) return undefined;
    const counts: Record<string, { po: number; itm: number }> = {};
    (eligiblePOProjectsRaw || []).forEach((row) => {
      if (!row.project) return;
      if (!counts[row.project]) counts[row.project] = { po: 0, itm: 0 };
      counts[row.project].po += 1;
    });
    (eligibleITMResult?.message?.data || []).forEach((itm) => {
      if (!itm.target_project) return;
      if (!counts[itm.target_project]) counts[itm.target_project] = { po: 0, itm: 0 };
      counts[itm.target_project].itm += 1;
    });
    return counts;
  }, [
    shouldFetchEligibleProjects,
    eligiblePOLoading,
    eligibleITMLoading,
    eligiblePOProjectsRaw,
    eligibleITMResult,
  ]);

  // Enriched ITM list for View Existing (ITMs with at least one DN)
  const enrichedViewITMs = useMemo(() => {
    return Object.entries(dnsByITM).map(([itmName, dns]) => ({
      name: itmName,
      dns,
      source_project: dns[0]?.project || "",
      status: itmStatusByName[itmName] || "",
    }));
  }, [dnsByITM, itmStatusByName]);

  // --- Handlers ---

  const handleProjectChange = useCallback(
    (selectedItem: any) => {
      const projectValue = selectedItem ? selectedItem.value : null;
      setSelectedProject(projectValue);
      setSearchQuery("");
      if (projectValue) {
        sessionStorage.setItem(
          "selectedProject",
          JSON.stringify(projectValue)
        );
      } else {
        sessionStorage.removeItem("selectedProject");
      }
    },
    [setSelectedProject]
  );

  const navigateToView = useCallback(
    (view: "create" | "view_existing") => {
      setSearchParams({ view });
      setSelectedProject(null);
      setSearchQuery("");
      sessionStorage.removeItem("selectedProject");
    },
    [setSearchParams, setSelectedProject]
  );

  // --- Render ---

  return (
    <div className="flex-1 space-y-4">
      {/* Dashboard */}
      {activeView === "DASHBOARD" && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <DashboardCard
            title="Create New DN"
            icon={<FilePlus2 className="h-10 w-10" />}
            onClick={() => navigateToView("create")}
            className="bg-blue-500 hover:bg-blue-600"
          />
          <DashboardCard
            title="View Existing DN"
            icon={<ListVideo className="h-10 w-10" />}
            onClick={() => navigateToView("view_existing")}
            className="bg-green-500 hover:bg-green-600"
          />
          {/* <DashboardCard
            title="Pending DN"
            icon={<ClipboardList className="h-10 w-10" />}
            onClick={() => navigate("/reports")}
            className="bg-orange-500 hover:bg-orange-600"
          /> */}
        </div>
      )}

      {/* CREATE View */}
      {activeView === "CREATE" && (
        <Card>
          <CardHeader>
            <CardTitle>Create New Delivery Note</CardTitle>
            <p className="text-sm text-muted-foreground pt-1">
              Select a project to see POs and ITMs ready for a new delivery update.
            </p>
          </CardHeader>
          <CardContent>
            <div className="mb-4">
              <ProjectSelect
                onChange={handleProjectChange}
                eligibleProjects={eligibleProjectCounts}
              />
            </div>
            {selectedProject && (
              <div className="space-y-4">
                {/* Search bar + result count chip — type filter moved into
                    the funnel popover on the "Type" column header below. */}
                <div className="flex items-start gap-3">
                  <div className="flex-1">
                    <SearchInput value={searchQuery} onChange={setSearchQuery} />
                  </div>
                  {!createLoading && !itmLoading && filteredCreateRows.length > 0 && (
                    <Badge variant="outline" className="mt-2 text-xs border-red-300 text-red-600 whitespace-nowrap">
                      {filteredCreateRows.length} results
                    </Badge>
                  )}
                </div>

                {(createLoading || itmLoading) && (
                  <p className="text-center py-4 text-muted-foreground">Loading...</p>
                )}

                {!createLoading && !itmLoading && filteredCreateRows.length === 0 && (
                  <p className="text-center text-muted-foreground py-4">
                    No eligible Purchase Orders or ITMs found.
                  </p>
                )}

                {!createLoading && !itmLoading && filteredCreateRows.length > 0 && (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>ID</TableHead>
                        <TableHead>
                          <div className="inline-flex items-center gap-1">
                            <span>Type</span>
                            <Popover>
                              <PopoverTrigger asChild>
                                <div
                                  className={cn(
                                    "cursor-pointer hover:bg-gray-100 px-1 py-1 rounded-md",
                                    createTypeFilter !== "all" && "bg-gray-200"
                                  )}
                                  aria-label="Filter by type"
                                >
                                  {createTypeFilter !== "all" ? (
                                    <FilterX className="text-primary h-4 w-4 animate-bounce" />
                                  ) : (
                                    <Filter className="text-primary h-4 w-4" />
                                  )}
                                </div>
                              </PopoverTrigger>
                              <PopoverContent className="w-44 p-2" align="start">
                                <div className="text-xs font-semibold mb-2 text-muted-foreground px-1">
                                  Filter by type
                                </div>
                                <div className="flex flex-col gap-1">
                                  <label className="flex items-center gap-2 px-1 py-1 text-sm cursor-pointer hover:bg-accent rounded">
                                    <Checkbox
                                      checked={createTypeFilter !== "itm"}
                                      onCheckedChange={(v) => handleCreateTypeToggle("po", !!v)}
                                    />
                                    <span>PO</span>
                                    <span className="ml-auto text-xs text-muted-foreground">
                                      {createCounts.po}
                                    </span>
                                  </label>
                                  <label className="flex items-center gap-2 px-1 py-1 text-sm cursor-pointer hover:bg-accent rounded">
                                    <Checkbox
                                      checked={createTypeFilter !== "po"}
                                      onCheckedChange={(v) => handleCreateTypeToggle("itm", !!v)}
                                    />
                                    <span>ITM</span>
                                    <span className="ml-auto text-xs text-muted-foreground">
                                      {createCounts.itm}
                                    </span>
                                  </label>
                                </div>
                              </PopoverContent>
                            </Popover>
                          </div>
                        </TableHead>
                        <TableHead>Vendor / Source</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-center">DNs</TableHead>
                        <TableHead className="w-[40px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredCreateRows.map((row) => {
                        if (row.type === "po") {
                          const po = row.data;
                          const dnCount = dnsByPO[po.name]?.length || 0;
                          const href = `/prs&milestones/delivery-notes/${encodeFrappeId(po.name)}?mode=create`;
                          return (
                            <TableRow key={`po:${po.name}`}>
                              <TableCell>
                                <Link
                                  className="underline text-blue-600 hover:text-blue-800"
                                  to={href}
                                >
                                  {`PO-${po.name.split("/")[1]}`}
                                </Link>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className="bg-sky-50 border-sky-300 text-sky-700">
                                  PO
                                </Badge>
                              </TableCell>
                              <TableCell>{po.vendor_name || "N/A"}</TableCell>
                              <TableCell>{formatDate(po.dispatch_date)}</TableCell>
                              <TableCell>
                                <Badge
                                  variant={
                                    ["Dispatched", "Partially Dispatched"].includes(po.status) ? "orange" : "green"
                                  }
                                >
                                  {po.status}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-center">
                                {dnCount > 0 && (
                                  <Badge variant="secondary">{dnCount}</Badge>
                                )}
                              </TableCell>
                              <TableCell>
                                <Link to={href}>
                                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                </Link>
                              </TableCell>
                            </TableRow>
                          );
                        }
                        const itm = row.data;
                        const dnCount = dnsByITM[itm.name]?.length || 0;
                        const href = `/prs&milestones/delivery-notes/itm/${encodeFrappeId(itm.name)}?mode=create`;
                        const sourceLabel = itm.source_type === "Warehouse"
                          ? "Warehouse"
                          : itm.source_project_name || itm.source_project || "--";
                        return (
                          <TableRow key={`itm:${itm.name}`}>
                            <TableCell>
                              <Link
                                className="underline text-blue-600 hover:text-blue-800"
                                to={href}
                              >
                                {itm.name}
                              </Link>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="bg-purple-50 border-purple-300 text-purple-700">
                                ITM
                              </Badge>
                            </TableCell>
                            <TableCell
                              title={
                                itm.source_type === "Warehouse"
                                  ? "Warehouse"
                                  : itm.source_project ?? undefined
                              }
                            >
                              {sourceLabel}
                            </TableCell>
                            <TableCell>{formatDate(itm.creation)}</TableCell>
                            <TableCell>
                              <Badge variant={itm.status === "Dispatched" ? "orange" : "green"}>
                                {itm.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-center">
                              {dnCount > 0 && (
                                <Badge variant="secondary">{dnCount}</Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              <Link to={href}>
                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              </Link>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* VIEW_EXISTING View */}
      {activeView === "VIEW_EXISTING" && (
        <Card>
          <CardHeader>
            <CardTitle>View Existing Delivery Notes</CardTitle>
            <p className="text-sm text-muted-foreground pt-1">
              Select a project to see its delivery history.
            </p>
          </CardHeader>
          <CardContent>
            <div className="mb-4">
              <ProjectSelect onChange={handleProjectChange} />
            </div>
            {selectedProject && (
              <>
                {/* Tab toggle */}
                <div className="flex gap-1.5 mb-3">
                  <button
                    onClick={() => setViewExistingType('po')}
                    className={cn(
                      "px-3 py-1.5 text-sm rounded",
                      viewExistingType === 'po'
                        ? "bg-sky-500 text-white"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    )}
                  >
                    Purchase Orders
                  </button>
                  <button
                    onClick={() => setViewExistingType('itm')}
                    className={cn(
                      "px-3 py-1.5 text-sm rounded",
                      viewExistingType === 'itm'
                        ? "bg-sky-500 text-white"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    )}
                  >
                    Transfer Memos
                  </button>
                </div>

                <SearchInput value={searchQuery} onChange={setSearchQuery} />

                {(viewExistingLoading || dnsLoading) && (
                  <p className="text-center py-4 text-muted-foreground">
                    Loading...
                  </p>
                )}

                {/* PO Tab */}
                {viewExistingType === 'po' && !viewExistingLoading && !dnsLoading && filteredViewPOs.length === 0 && (
                  <p className="text-center text-muted-foreground py-4">
                    No PO delivery notes found for this project.
                  </p>
                )}

                {viewExistingType === 'po' && !viewExistingLoading && !dnsLoading && filteredViewPOs.length > 0 && (
                    <>
                      {/* Desktop Accordion */}
                      <div className="hidden md:block">
                        <Accordion
                          type="single"
                          collapsible
                          className="space-y-2"
                        >
                          {filteredViewPOs.map((po) => {
                            const dns = po.dns;
                            const latestDate =
                              dns.length > 0
                                ? dns.reduce(
                                    (latest, dn) =>
                                      dn.delivery_date > latest
                                        ? dn.delivery_date
                                        : latest,
                                    dns[0].delivery_date
                                  )
                                : null;

                            return (
                              <AccordionItem
                                key={po.name}
                                value={po.name}
                                className="border rounded-lg"
                              >
                                <AccordionTrigger className="px-4 py-3 hover:no-underline">
                                  <div className="flex items-center gap-4 w-full text-left text-sm">
                                    <Link
                                      to={`/prs&milestones/delivery-notes/${encodeFrappeId(po.name)}?mode=view`}
                                      className="font-medium text-primary hover:underline"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      PO-{po.name.split("/")[1]}
                                    </Link>
                                    <span className="text-muted-foreground truncate max-w-[150px]">
                                      {po.vendor_name}
                                    </span>
                                    <span className="text-muted-foreground text-xs hidden sm:inline">
                                      {latestDate
                                        ? formatDate(latestDate)
                                        : "\u2014"}
                                    </span>
                                    <Badge
                                      variant={
                                        po.status === "Delivered"
                                          ? "green"
                                          : "orange"
                                      }
                                      className="ml-auto mr-2"
                                    >
                                      {po.status}
                                    </Badge>
                                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                                      {dns.length} DN
                                      {dns.length !== 1 ? "s" : ""}
                                    </span>
                                  </div>
                                </AccordionTrigger>
                                <AccordionContent className="px-4 pb-3">
                                  {dns.length === 0 ? (
                                    <p className="text-sm text-muted-foreground py-2">
                                      No delivery notes found.
                                    </p>
                                  ) : (
                                    <div className="border rounded-md overflow-hidden">
                                      <Table>
                                        <TableHeader>
                                          <TableRow className="bg-muted/30">
                                            <TableHead className="text-xs">
                                              DN Number
                                            </TableHead>
                                            <TableHead className="text-xs text-center">
                                              Items
                                            </TableHead>
                                            <TableHead className="text-xs">
                                              Date
                                            </TableHead>
                                            <TableHead className="text-xs hidden sm:table-cell">
                                              Created By
                                            </TableHead>
                                            <TableHead className="text-xs w-[40px]"></TableHead>
                                          </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                          {dns.map((dn) => (
                                            <TableRow key={dn.name} className={dn.is_return === 1 ? "bg-red-100/80" : ""}>
                                              <TableCell>
                                                <button
                                                  className={`text-sm font-medium hover:underline ${dn.is_return === 1 ? "text-red-600" : "text-primary"}`}
                                                  onClick={() => {
                                                    setSelectedDN(dn);
                                                    setDnDialogOpen(true);
                                                  }}
                                                >
                                                  {dn.is_return === 1 ? dn.name.replace(/^DN-/, "RN-") : dn.name}
                                                </button>
                                              </TableCell>
                                              <TableCell className="text-center text-sm">
                                                {dn.items?.length || 0}
                                              </TableCell>
                                              <TableCell className="text-sm">
                                                {formatDate(dn.delivery_date)}
                                              </TableCell>
                                              <TableCell className="text-sm text-muted-foreground hidden sm:table-cell">
                                                {dn.updated_by_user || "\u2014"}
                                              </TableCell>
                                              <TableCell>
                                                <DNDownloadButton
                                                  poId={po.name}
                                                  deliveryDate={dn.delivery_date}
                                                  noteNo={dn.note_no}
                                                />
                                              </TableCell>
                                            </TableRow>
                                          ))}
                                        </TableBody>
                                      </Table>
                                    </div>
                                  )}
                                </AccordionContent>
                              </AccordionItem>
                            );
                          })}

                        </Accordion>
                      </div>

                      {/* Mobile Cards */}
                      <div className="md:hidden space-y-3">
                        {filteredViewPOs.map((po) => {
                          const dns = po.dns;
                          return (
                            <div
                              key={po.name}
                              className="border rounded-lg p-4"
                            >
                              <div className="flex items-start justify-between mb-2">
                                <Link
                                  to={`/prs&milestones/delivery-notes/${encodeFrappeId(po.name)}?mode=view`}
                                  className="font-semibold text-blue-600 text-lg hover:underline"
                                >
                                  PO-{po.name.split("/")[1]}
                                </Link>
                                <Badge
                                  variant={
                                    po.status === "Delivered"
                                      ? "green"
                                      : "orange"
                                  }
                                >
                                  {po.status}
                                </Badge>
                              </div>
                              <div className="space-y-1.5 text-sm mb-3">
                                <div className="flex items-start">
                                  <span className="text-gray-500 min-w-[80px]">
                                    Vendor:
                                  </span>
                                  <span className="font-medium text-gray-900 flex-1">
                                    {po.vendor_name || "N/A"}
                                  </span>
                                </div>
                                <div className="flex items-center">
                                  <span className="text-gray-500 min-w-[80px]">
                                    DNs:
                                  </span>
                                  <span className="text-gray-900">
                                    {dns.length} delivery note
                                    {dns.length !== 1 ? "s" : ""}
                                  </span>
                                </div>
                              </div>
                              {dns.length > 0 && (
                                <div className="space-y-2 border-t pt-2">
                                  {dns.map((dn) => (
                                    <div
                                      key={dn.name}
                                      className={`flex items-center justify-between text-sm ${dn.is_return === 1 ? "bg-red-100/80 -mx-2 px-2 py-1 rounded" : ""}`}
                                    >
                                      <button
                                        className={`hover:underline font-medium ${dn.is_return === 1 ? "text-red-600" : "text-primary"}`}
                                        onClick={() => {
                                          setSelectedDN(dn);
                                          setDnDialogOpen(true);
                                        }}
                                      >
                                        {dn.is_return === 1 ? dn.name.replace(/^DN-/, "RN-") : dn.name}
                                      </button>
                                      <div className="flex items-center gap-2">
                                        <span className="text-muted-foreground text-xs">
                                          {formatDate(dn.delivery_date)}
                                        </span>
                                        <DNDownloadButton
                                          poId={po.name}
                                          deliveryDate={dn.delivery_date}
                                          noteNo={dn.note_no}
                                        />
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </>
                )}

                {/* ITM Tab */}
                {viewExistingType === 'itm' && !dnsLoading && enrichedViewITMs.length === 0 && (
                  <p className="text-center text-muted-foreground py-4">
                    No transfer delivery notes found for this project.
                  </p>
                )}

                {viewExistingType === 'itm' && !dnsLoading && enrichedViewITMs.length > 0 && (
                  <Accordion type="single" collapsible className="space-y-2">
                    {enrichedViewITMs.map((itm) => {
                      const dns = itm.dns;
                      const latestDate =
                        dns.length > 0
                          ? dns.reduce(
                              (latest, dn) =>
                                dn.delivery_date > latest
                                  ? dn.delivery_date
                                  : latest,
                              dns[0].delivery_date
                            )
                          : null;

                      return (
                        <AccordionItem
                          key={itm.name}
                          value={itm.name}
                          className="border rounded-lg"
                        >
                          <AccordionTrigger className="px-4 py-3 hover:no-underline">
                            <div className="flex items-center gap-4 w-full text-left text-sm">
                              <Link
                                to={`/prs&milestones/delivery-notes/itm/${encodeFrappeId(itm.name)}?mode=view`}
                                className="font-medium text-primary hover:underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {itm.name}
                              </Link>
                              <span className="text-muted-foreground text-xs hidden sm:inline">
                                {latestDate ? formatDate(latestDate) : "\u2014"}
                              </span>
                              {itm.status && (
                                <Badge
                                  variant={
                                    itm.status === "Delivered" ? "green" : "orange"
                                  }
                                  className="ml-auto mr-2"
                                >
                                  {itm.status}
                                </Badge>
                              )}
                              <span
                                className={cn(
                                  "text-xs text-muted-foreground whitespace-nowrap",
                                  !itm.status && "ml-auto mr-2"
                                )}
                              >
                                {dns.length} DN{dns.length !== 1 ? "s" : ""}
                              </span>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent className="px-4 pb-3">
                            <div className="border rounded-md overflow-hidden">
                              <Table>
                                <TableHeader>
                                  <TableRow className="bg-muted/30">
                                    <TableHead className="text-xs">DN Number</TableHead>
                                    <TableHead className="text-xs text-center">Items</TableHead>
                                    <TableHead className="text-xs">Date</TableHead>
                                    <TableHead className="text-xs hidden sm:table-cell">Created By</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {dns.map((dn) => (
                                    <TableRow key={dn.name}>
                                      <TableCell>
                                        <button
                                          className="text-sm font-medium text-primary hover:underline"
                                          onClick={() => {
                                            setSelectedDN(dn);
                                            setDnDialogOpen(true);
                                          }}
                                        >
                                          {dn.name}
                                        </button>
                                      </TableCell>
                                      <TableCell className="text-center text-sm">
                                        {dn.items?.length || 0}
                                      </TableCell>
                                      <TableCell className="text-sm">
                                        {formatDate(dn.delivery_date)}
                                      </TableCell>
                                      <TableCell className="text-sm text-muted-foreground hidden sm:table-cell">
                                        {resolveUserName(dn.updated_by_user || dn.owner) || "\u2014"}
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      );
                    })}
                  </Accordion>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* DN Detail Dialog */}
      <DNDetailDialog
        dn={selectedDN}
        open={dnDialogOpen}
        onOpenChange={setDnDialogOpen}
      />
    </div>
  );
};

export default DeliveryNotes;
