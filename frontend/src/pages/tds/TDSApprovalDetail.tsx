import React, { useMemo, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, CheckCircle2, XCircle, FileText, Pencil, MessageSquare, Clock, User, Layers, Search, Filter, FilterX, Check, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandSeparator,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { useCEOHoldGuard } from "@/hooks/useCEOHoldGuard";
import { CEOHoldBanner } from "@/components/ui/ceo-hold-banner";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger
} from "@/components/ui/tooltip";
import { useFrappeGetDocList, useFrappeGetDoc, useFrappeUpdateDoc, useFrappeDeleteDoc, useFrappeCreateDoc, useFrappeFileUpload, useFrappePostCall } from "frappe-react-sdk";
import { useUserData } from "@/hooks/useUserData";
import {
    useReactTable,
    getCoreRowModel,
    getSortedRowModel,
    ColumnDef,
} from "@tanstack/react-table";
import { RejectTDSModal } from "./components/RejectTDSModal";
import { ProjectEditTDSItemModal } from "./components/ProjectEditTDSItemModal";
import { EditRequestItemModal } from "./components/EditRequestItemModal";
import { toast } from "@/components/ui/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface TDSItem {
    name: string;
    tds_request_id: string;
    tdsi_project_id: string;
    tdsi_project_name: string;
    tds_work_package: string;
    tds_category: string;
    tds_item_name: string;
    tds_description: string;
    tds_make: string;
    tds_attachment?: string;
    tds_status: string;
    tds_rejection_reason?: string;
    tds_item_id: string;
    owner: string;
    creation: string;
    tds_boq_line_item?: string;
}

// Format date as "27 Nov, 2025"
const formatDateClean = (dateStr: string) => {
    if (!dateStr) return "--";
    return format(new Date(dateStr), "dd MMM, yyyy");
};

// Enhanced Status Badge
const StatusBadge = ({ status }: { status: string }) => {
    let variant: "default" | "secondary" | "destructive" | "outline" = "outline";
    let className = "font-medium border-0";
    let label = status;

    if (status === "Pending") {
        className += " bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20";
    } else if (status === "Approved") {
        className += " bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20";
    } else if (status === "Rejected") {
        className += " bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/20";
    } else if (status === "PA") {
        className += " bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-600/20";
    } else if (status === "PR") {
        className += " bg-orange-50 text-orange-700 ring-1 ring-inset ring-orange-600/20";
    } else if (status === "AR") {
        className += " bg-purple-50 text-purple-700 ring-1 ring-inset ring-purple-600/20";
    } else if (status === "PAR") {
        className += " bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-600/20";
    } else {
        className += " bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-400/20";
    }

    return <Badge variant={variant} className={className}>{label}</Badge>;
};

// Make Pill Component
const MakePill = ({ make }: { make: string }) => (
    <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200 whitespace-normal break-words max-w-full">
        {make}
    </span>
);

// Unified Item Status used by the Pending Review table column. Each request
// row maps to exactly one of these; derivation order is fixed.
type ItemStatusKind = "Custom Item" | "New Item" | "Verified" | "Not Verified";

const ITEM_STATUS_KINDS: ItemStatusKind[] = ["Custom Item", "New Item", "Verified", "Not Verified"];

const ITEM_STATUS_STYLES: Record<ItemStatusKind, { badge: string; text: string }> = {
    "Custom Item":  { badge: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20",   text: "text-amber-800" },
    "New Item":     { badge: "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-600/20",         text: "text-sky-800" },
    "Verified":     { badge: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20", text: "text-emerald-800" },
    "Not Verified": { badge: "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/20",      text: "text-rose-800" },
};

const getItemStatusKind = (
    item: { tds_status?: string; tds_item_id?: string; tds_work_package?: string; tds_category?: string; tds_item_name?: string; tds_make?: string },
    repoStatusByKey: Map<string, string>
): ItemStatusKind => {
    if (item.tds_status === "New" && !item.tds_item_id) return "Custom Item";
    if (item.tds_status === "New") return "New Item";
    const key = `${item.tds_work_package}|${item.tds_category}|${(item.tds_item_name || "").trim().toLowerCase()}|${(item.tds_make || "").trim().toLowerCase()}`;
    return repoStatusByKey.get(key) === "Verified" ? "Verified" : "Not Verified";
};

const ItemStatusBadge: React.FC<{ kind: ItemStatusKind }> = ({ kind }) => (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-tight ${ITEM_STATUS_STYLES[kind].badge}`}>
        {kind}
    </span>
);



// Section Table Component
const ItemsTable = ({
    data,
    columns,
    showHeader = true,
    emptyMessage = "No items",
    // Optional props for mobile selection
    onSelectionChange,
    rowSelection,
    enableSelection = false,
    // When set, caps table height at this value (any CSS length — e.g. "55vh", "500px")
    // and makes the body scrollable with a sticky header row.
    scrollMaxHeight,
}: {
    data: TDSItem[];
    columns: ColumnDef<TDSItem>[];
    showHeader?: boolean;
    emptyMessage?: string;
    onSelectionChange?: (id: string, val: boolean) => void;
    rowSelection?: Record<string, boolean>;
    enableSelection?: boolean;
    scrollMaxHeight?: string;
}) => {
    const table = useReactTable({
        data,
        columns,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getRowId: (row) => row.name,
    });

    const scrollable = !!scrollMaxHeight;
    const desktopWrapperCls = scrollable
        ? "hidden md:block w-full overflow-auto"
        : "hidden md:block w-full overflow-x-auto";
    const scrollStyle = scrollable ? { maxHeight: scrollMaxHeight } : undefined;
    const thStickyCls = scrollable ? " sticky top-0 z-10 bg-slate-50" : "";

    return (
        <div className="w-full">
            {/* Desktop Table View */}
            <div className={desktopWrapperCls} style={scrollStyle}>
                <table className="w-full whitespace-nowrap">
                    {showHeader && (
                        <thead className="bg-slate-50/50 border-b border-gray-200">
                            <tr>
                                {table.getHeaderGroups()[0]?.headers.map(header => (
                                    <th
                                        key={header.id}
                                        className={"px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider" + thStickyCls}
                                        style={{ width: header.column.getSize() }}
                                    >
                                        {header.isPlaceholder ? null : (
                                            typeof header.column.columnDef.header === 'function'
                                                ? header.column.columnDef.header(header.getContext())
                                                : header.column.columnDef.header
                                        )}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                    )}
                    <tbody>
                        {table.getRowModel().rows.length === 0 ? (
                            <tr>
                                <td colSpan={columns.length} className="text-center py-8 text-gray-400 text-sm">
                                    {emptyMessage}
                                </td>
                            </tr>
                        ) : (
                            table.getRowModel().rows.map(row => (
                                <tr key={row.id} className="border-b border-gray-100 hover:bg-slate-50/50 transition-colors">
                                    {row.getVisibleCells().map(cell => (
                                        <td key={cell.id} className="px-4 py-3 text-sm text-slate-700">
                                            {typeof cell.column.columnDef.cell === 'function'
                                                ? cell.column.columnDef.cell(cell.getContext())
                                                : cell.getValue() as string
                                            }
                                        </td>
                                    ))}
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Mobile Card View ("Credit Card" Style) */}
            <div
                className={"md:hidden flex flex-col gap-3 p-4 bg-slate-50/30" + (scrollable ? " overflow-y-auto" : "")}
                style={scrollStyle}
            >
                {table.getRowModel().rows.length === 0 ? (
                    <div className="text-center py-8 text-gray-400 text-sm">{emptyMessage}</div>
                ) : (
                    table.getRowModel().rows.map(row => {
                        const item = row.original;
                        const isSelected = rowSelection ? rowSelection[row.id] : false;

                        return (
                            <div
                                key={row.id}
                                className={`bg-white rounded-lg border p-3 shadow-sm transition-all ${isSelected ? 'border-emerald-500 ring-1 ring-emerald-500/20' : 'border-slate-200'}`}
                            >
                                <div className="flex items-start justify-between gap-3 mb-2">
                                    <div className="flex items-center gap-3">
                                        {enableSelection && onSelectionChange && (
                                            <Checkbox
                                                checked={isSelected}
                                                onCheckedChange={(val) => onSelectionChange(row.id, !!val)}
                                                className="mt-0.5 rounded-sm border-slate-300 data-[state=checked]:bg-emerald-600"
                                            />
                                        )}
                                        <div>
                                            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                                                {item.tds_work_package}
                                            </div>
                                            <div className="font-medium text-slate-900 line-clamp-1">
                                                {item.tds_item_name}
                                            </div>
                                        </div>
                                    </div>
                                    <MakePill make={item.tds_make} />
                                </div>

                                <div className="grid grid-cols-2 gap-2 text-xs text-slate-600 mb-2">
                                    <div>
                                        <span className="text-slate-400 mr-1">Cat:</span>
                                        {item.tds_category}
                                    </div>
                                    {item.tds_attachment && (
                                        <div className="flex justify-end">
                                            <a
                                                href={item.tds_attachment}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="flex items-center gap-1 text-blue-600 hover:underline"
                                            >
                                                <FileText className="h-3 w-3" /> View Doc
                                            </a>
                                        </div>
                                    )}
                                </div>

                                {item.tds_description && (
                                    <div className="text-xs text-slate-500 bg-slate-50 p-2 rounded border border-slate-100 line-clamp-2">
                                        {item.tds_description}
                                    </div>
                                )}

                                {item.tds_status === "Rejected" && item.tds_rejection_reason && (
                                    <div className="mt-2 text-xs text-rose-600 bg-rose-50 p-2 rounded border border-rose-100 flex items-start gap-1.5">
                                        <MessageSquare className="h-3 w-3 mt-0.5 shrink-0" />
                                        <span>{item.tds_rejection_reason}</span>
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
};

// Lightweight faceted filter (value/onChange based, not bound to a TanStack Column)
type FacetOption = { label: string; value: string };

// Shared popover body reused by the mobile filter button (SimpleFacetFilter)
// and the desktop column-header funnel (FilterableHeader)
const FacetList = ({
    title,
    options,
    selected,
    onChange,
}: {
    title: string;
    options: FacetOption[];
    selected: string[];
    onChange: (next: string[]) => void;
}) => {
    const selectedSet = new Set(selected);
    const hasSelection = selected.length > 0;
    return (
        <Command>
            <CommandInput placeholder={`Search ${title.toLowerCase()}...`} />
            <CommandList>
                <CommandEmpty>No results.</CommandEmpty>
                <CommandGroup>
                    {options.map(opt => {
                        const isSelected = selectedSet.has(opt.value);
                        return (
                            <CommandItem
                                key={opt.value}
                                onSelect={() => {
                                    if (isSelected) {
                                        onChange(selected.filter(v => v !== opt.value));
                                    } else {
                                        onChange([...selected, opt.value]);
                                    }
                                }}
                            >
                                <div
                                    className={cn(
                                        "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-slate-300",
                                        isSelected
                                            ? "bg-emerald-600 border-emerald-600 text-white"
                                            : "opacity-70"
                                    )}
                                >
                                    {isSelected && <Check className="h-3 w-3" />}
                                </div>
                                <span className="truncate">{opt.label}</span>
                            </CommandItem>
                        );
                    })}
                </CommandGroup>
                {hasSelection && (
                    <>
                        <CommandSeparator />
                        <CommandGroup>
                            <CommandItem
                                onSelect={() => onChange([])}
                                className="justify-center text-center text-slate-600"
                            >
                                Clear
                            </CommandItem>
                        </CommandGroup>
                    </>
                )}
            </CommandList>
        </Command>
    );
};

const SimpleFacetFilter = ({
    title,
    options,
    selected,
    onChange,
}: {
    title: string;
    options: FacetOption[];
    selected: string[];
    onChange: (next: string[]) => void;
}) => {
    const hasSelection = selected.length > 0;
    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                        "h-9 border-dashed text-slate-600",
                        hasSelection && "border-solid border-red-500 bg-red-50 text-red-700 hover:bg-red-50 hover:text-red-800"
                    )}
                >
                    {hasSelection ? (
                        <FilterX className="h-3.5 w-3.5 mr-2 text-red-500" />
                    ) : (
                        <Filter className="h-3.5 w-3.5 mr-2 text-slate-400" />
                    )}
                    {title}
                    {hasSelection && (
                        <span className="ml-2 rounded-sm bg-red-100 px-1.5 text-xs font-medium text-red-700">
                            {selected.length}
                        </span>
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[240px] p-0" align="start">
                <FacetList title={title} options={options} selected={selected} onChange={onChange} />
            </PopoverContent>
        </Popover>
    );
};

// Compact facet filter that renders inside a column header — title + funnel icon
const FilterableHeader = ({
    title,
    options,
    selected,
    onChange,
}: {
    title: string;
    options: FacetOption[];
    selected: string[];
    onChange: (next: string[]) => void;
}) => {
    const hasSelection = selected.length > 0;
    return (
        <div className="flex items-center gap-1">
            <span>{title}</span>
            <Popover>
                <PopoverTrigger asChild>
                    <button
                        type="button"
                        className={cn(
                            "p-0.5 rounded hover:bg-slate-200/70 transition-colors",
                            hasSelection && "bg-red-50"
                        )}
                        aria-label={`Filter ${title}`}
                    >
                        {hasSelection ? (
                            <FilterX className="h-3.5 w-3.5 text-red-500" />
                        ) : (
                            <Filter className="h-3.5 w-3.5 text-slate-400" />
                        )}
                    </button>
                </PopoverTrigger>
                <PopoverContent className="w-[240px] p-0" align="start">
                    <FacetList title={title} options={options} selected={selected} onChange={onChange} />
                </PopoverContent>
            </Popover>
            {hasSelection && (
                <span className="rounded-sm bg-red-100 px-1 text-[10px] font-semibold text-red-700">
                    {selected.length}
                </span>
            )}
        </div>
    );
};

export const TDSApprovalDetail: React.FC = () => {
    const { id: requestId } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const statusFilter = searchParams.get("status"); // "Pending", "Approved", "Rejected", or "All"
    const showAllSections = statusFilter === "All";

    const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
    const [isRejectModalOpen, setIsRejectModalOpen] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<TDSItem | null>(null);
    const [processing, setProcessing] = useState(false);

    // Use custom hook for user data and role
    const { user_id, role } = useUserData();

    const ALLOWED_APPROVER_ROLES = [
        "Nirmaan Admin Profile",
        "Nirmaan Project Lead Profile",
    ];

    const canApprove = user_id === "Administrator" || (!!role && ALLOWED_APPROVER_ROLES.includes(role));

    // Fetch items for this request ID
    const { data: allItems, isLoading, mutate } = useFrappeGetDocList<TDSItem>("Project TDS Item List", {
        fields: ["*"],
        filters: [["tds_request_id", "=", requestId ?? ""]],
        limit: 0
    });

    // TDS Repository — used to detect "already exists" cases at approval time
    // so we can link a "New" project item to an existing repo entry instead of
    // failing the approval or silently creating a duplicate row.
    type RepoEntry = {
        name: string;
        tds_item_id: string;
        tds_item_name: string;
        make: string;
        work_package: string;
        category: string;
        status?: string;
    };
    const { data: repoEntries, mutate: mutateRepo } = useFrappeGetDocList<RepoEntry>("TDS Repository", {
        fields: ["name", "tds_item_id", "tds_item_name", "make", "work_package", "category", "status"],
        limit: 0,
    });

    // Lookup of TDS Repository status keyed by (wp|cat|name|make) — same shape we
    // already use for findExistingRepoEntry. Used by the Pending Review row to
    // render the master's "Verified" / "Not Verified" badge inline.
    const repoStatusByKey = useMemo(() => {
        const map = new Map<string, string>();
        if (!repoEntries) return map;
        repoEntries.forEach(r => {
            const key = `${r.work_package}|${r.category}|${(r.tds_item_name || "").trim().toLowerCase()}|${(r.make || "").trim().toLowerCase()}`;
            if (r.status) map.set(key, r.status);
        });
        return map;
    }, [repoEntries]);

    // CEO Hold guard - use project ID from first TDS item
    const projectId = allItems?.[0]?.tdsi_project_id;
    const { isCEOHold } = useCEOHoldGuard(projectId);

    // PCUS allocator — backend is the single source of truth. Calling this at
    // approval click time avoids SWR cache staleness across TDS request pages,
    // which was causing id collisions (e.g. PCUS-000001 stamped twice).
    const { call: allocatePcusIds } = useFrappePostCall(
        "nirmaan_stack.api.tds.allocate_pcus.allocate_pcus_ids"
    );

    // Filter state (shared across Pending / Approved / Rejected sections)
    const [selectedWorkPackages, setSelectedWorkPackages] = useState<string[]>([]);
    const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
    const [selectedMakes, setSelectedMakes] = useState<string[]>([]);
    const [selectedItemNames, setSelectedItemNames] = useState<string[]>([]);
    const [selectedItemStatuses, setSelectedItemStatuses] = useState<string[]>([]);
    const [searchText, setSearchText] = useState("");

    // Facet options derived from the full item set (not the filtered set),
    // so narrowing one dimension doesn't hide values in others
    const facetOptions = useMemo(() => {
        // Union sets — used by the mobile filter bar (page-level, all sections)
        const wp = new Set<string>();
        const cat = new Set<string>();
        const mk = new Set<string>();
        // Per-table sets — column-header dropdowns list only values present in
        // that section so users don't see "X" in the Approved Make dropdown if
        // no approved row has Make = X.
        const wpPending = new Set<string>(), wpApproved = new Set<string>(), wpRejected = new Set<string>();
        const catPending = new Set<string>(), catApproved = new Set<string>(), catRejected = new Set<string>();
        const mkPending = new Set<string>(), mkApproved = new Set<string>(), mkRejected = new Set<string>();
        const itemNamePending = new Set<string>(), itemNameApproved = new Set<string>(), itemNameRejected = new Set<string>();
        const presentItemStatus = new Set<ItemStatusKind>();
        (allItems || []).forEach(i => {
            if (i.tds_work_package) wp.add(i.tds_work_package);
            if (i.tds_category) cat.add(i.tds_category);
            if (i.tds_make) mk.add(i.tds_make);
            const isPending = !i.tds_status || i.tds_status === "Pending" || i.tds_status === "New";
            if (isPending) {
                if (i.tds_work_package) wpPending.add(i.tds_work_package);
                if (i.tds_category) catPending.add(i.tds_category);
                if (i.tds_make) mkPending.add(i.tds_make);
                if (i.tds_item_name) itemNamePending.add(i.tds_item_name);
                presentItemStatus.add(getItemStatusKind(i as any, repoStatusByKey));
            } else if (i.tds_status === "Approved") {
                if (i.tds_work_package) wpApproved.add(i.tds_work_package);
                if (i.tds_category) catApproved.add(i.tds_category);
                if (i.tds_make) mkApproved.add(i.tds_make);
                if (i.tds_item_name) itemNameApproved.add(i.tds_item_name);
            } else if (i.tds_status === "Rejected") {
                if (i.tds_work_package) wpRejected.add(i.tds_work_package);
                if (i.tds_category) catRejected.add(i.tds_category);
                if (i.tds_make) mkRejected.add(i.tds_make);
                if (i.tds_item_name) itemNameRejected.add(i.tds_item_name);
            }
        });
        const toOpt = (s: Set<string>) =>
            Array.from(s).sort().map(v => ({ label: v, value: v }));
        return {
            workPackage: toOpt(wp),
            category: toOpt(cat),
            make: toOpt(mk),
            workPackagePending: toOpt(wpPending),
            workPackageApproved: toOpt(wpApproved),
            workPackageRejected: toOpt(wpRejected),
            categoryPending: toOpt(catPending),
            categoryApproved: toOpt(catApproved),
            categoryRejected: toOpt(catRejected),
            makePending: toOpt(mkPending),
            makeApproved: toOpt(mkApproved),
            makeRejected: toOpt(mkRejected),
            itemNamePending: toOpt(itemNamePending),
            itemNameApproved: toOpt(itemNameApproved),
            itemNameRejected: toOpt(itemNameRejected),
            itemStatus: ITEM_STATUS_KINDS.filter(k => presentItemStatus.has(k)).map(k => ({ label: k, value: k })),
        };
    }, [allItems, repoStatusByKey]);

    // Filters shared across Pending / Approved / Rejected (WP / Category / Make / Item Name / search).
    const matchesFilters = (item: TDSItem) => {
        if (selectedWorkPackages.length && !selectedWorkPackages.includes(item.tds_work_package)) return false;
        if (selectedCategories.length && !selectedCategories.includes(item.tds_category)) return false;
        if (selectedMakes.length && !selectedMakes.includes(item.tds_make)) return false;
        if (selectedItemNames.length && !selectedItemNames.includes(item.tds_item_name)) return false;
        const q = searchText.trim().toLowerCase();
        if (q) {
            const hay = `${item.tds_item_name ?? ""} ${item.tds_description ?? ""}`.toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    };

    // Pending-only facets — Item Status column lives only on the Pending Review
    // table, so it must not be applied to Approved/Rejected in the All view.
    const matchesPendingFacets = (item: TDSItem) => {
        if (selectedItemStatuses.length && !selectedItemStatuses.includes(getItemStatusKind(item as any, repoStatusByKey))) return false;
        return true;
    };

    const hasActiveFilters =
        selectedWorkPackages.length > 0 ||
        selectedCategories.length > 0 ||
        selectedMakes.length > 0 ||
        selectedItemNames.length > 0 ||
        selectedItemStatuses.length > 0 ||
        searchText.trim().length > 0;

    const clearAllFilters = () => {
        setSelectedWorkPackages([]);
        setSelectedCategories([]);
        setSelectedMakes([]);
        setSelectedItemNames([]);
        setSelectedItemStatuses([]);
        setSearchText("");
    };

    // Unfiltered status splits — used for totals and selection math
    const allPendingItems = useMemo(() =>
        (allItems || []).filter(item =>
            !item.tds_status || item.tds_status === "Pending" || item.tds_status === "New"
        ),
        [allItems]);

    const allApprovedItems = useMemo(() =>
        (allItems || []).filter(item => item.tds_status === "Approved"),
        [allItems]);

    const allRejectedItems = useMemo(() =>
        (allItems || []).filter(item => item.tds_status === "Rejected"),
        [allItems]);

    // Filtered splits — what the UI renders
    const pendingItems = useMemo(() =>
        allPendingItems.filter(i => matchesFilters(i) && matchesPendingFacets(i)),
        [allPendingItems, selectedWorkPackages, selectedCategories, selectedMakes, selectedItemNames, selectedItemStatuses, searchText, repoStatusByKey]);

    const approvedItems = useMemo(() =>
        allApprovedItems.filter(matchesFilters),
        [allApprovedItems, selectedWorkPackages, selectedCategories, selectedMakes, selectedItemNames, searchText]);

    const rejectedItems = useMemo(() =>
        allRejectedItems.filter(matchesFilters),
        [allRejectedItems, selectedWorkPackages, selectedCategories, selectedMakes, selectedItemNames, searchText]);

    const filteredTotal = pendingItems.length + approvedItems.length + rejectedItems.length;

    // Collapse logic for the "All" view:
    //   - When multiple sections have items, all three become collapsible.
    //     Pending defaults expanded (actionable), Approved + Rejected default collapsed.
    //   - When only one section has items, collapse is disabled (no chevron, always shown).
    //   - In single-status views (?status=Pending|Approved|Rejected), collapse is disabled too.
    const [pendingExpanded, setPendingExpanded] = useState(true);
    const [approvedExpanded, setApprovedExpanded] = useState(false);
    const [rejectedExpanded, setRejectedExpanded] = useState(false);
    const autoCollapseSetOnceRef = React.useRef(false);

    const visibleSectionCount =
        (pendingItems.length > 0 ? 1 : 0) +
        (approvedItems.length > 0 ? 1 : 0) +
        (rejectedItems.length > 0 ? 1 : 0);

    const collapseEnabled = showAllSections && visibleSectionCount > 1;

    React.useEffect(() => {
        if (autoCollapseSetOnceRef.current) return;
        if (!allItems || allItems.length === 0) return;
        if (collapseEnabled) {
            // All three collapsed on entry; user opens whichever they want
            setPendingExpanded(false);
            setApprovedExpanded(false);
            setRejectedExpanded(false);
        } else {
            setPendingExpanded(true);
            setApprovedExpanded(true);
            setRejectedExpanded(true);
        }
        autoCollapseSetOnceRef.current = true;
    }, [allItems, collapseEnabled]);

    // When collapse is disabled (single-section All view, or single-status URL),
    // the section body always renders regardless of toggle state.
    const shouldShowPendingBody = !collapseEnabled || pendingExpanded;
    const shouldShowApprovedBody = !collapseEnabled || approvedExpanded;
    const shouldShowRejectedBody = !collapseEnabled || rejectedExpanded;

    // Fetch owner's full name from Nirmaan Users
    const ownerEmail = allItems?.[0]?.owner || '';
    const { data: ownerData } = useFrappeGetDoc<{ full_name: string }>(
        'Nirmaan Users',
        ownerEmail,
        ownerEmail ? undefined : null
    );

    const { updateDoc } = useFrappeUpdateDoc();
    const { deleteDoc } = useFrappeDeleteDoc();
    const { createDoc } = useFrappeCreateDoc();
    const { upload: uploadFile } = useFrappeFileUpload();

    // Derived Header Info
    const headerInfo = useMemo(() => {
        if (!allItems || allItems.length === 0) return null;
        const first = allItems[0];

        // Determine overall status based on combinations
        let overallStatus = "Pending";
        const p = pendingItems.length > 0;
        const a = approvedItems.length > 0;
        const r = rejectedItems.length > 0;

        if (p && a && r) overallStatus = "PAR";
        else if (p && a) overallStatus = "PA";
        else if (p && r) overallStatus = "PR";
        else if (a && r) overallStatus = "AR";
        else if (p) overallStatus = "Pending";
        else if (r) overallStatus = "Rejected";
        else if (a) overallStatus = "Approved";

        return {
            request_id: first.tds_request_id,
            project: first.tdsi_project_name,
            created_by: ownerData?.full_name || first.owner,
            creation: first.creation,
            count: allItems.length,
            status: overallStatus,
            pendingCount: pendingItems.length,
            approvedCount: approvedItems.length,
            rejectedCount: rejectedItems.length,
        };
    }, [allItems, pendingItems, approvedItems, rejectedItems, ownerData]);

    // Count only selection keys that still correspond to a pending item
    const pendingNameSet = useMemo(
        () => new Set(allPendingItems.map(i => i.name)),
        [allPendingItems]
    );
    const selectedCount = Object.keys(rowSelection).filter(
        k => rowSelection[k] && pendingNameSet.has(k)
    ).length;
    const hiddenSelectedCount = Object.keys(rowSelection).filter(
        k => rowSelection[k] && pendingNameSet.has(k) && !pendingItems.some(i => i.name === k)
    ).length;

    // Helper for mobile selection
    const handleMobileSelectionChange = (id: string, val: boolean) => {
        setRowSelection(prev => ({
            ...prev,
            [id]: val
        }));
    };

    // Pending items columns (with checkbox and actions)
    const pendingColumns = useMemo<ColumnDef<TDSItem>[]>(() => {
        const cols: ColumnDef<TDSItem>[] = [];

        if (canApprove) {
            cols.push({
                id: "select",
                header: () => null,
                cell: ({ row }) => (
                    <Checkbox
                        checked={rowSelection[row.id] || false}
                        onCheckedChange={(value) => {
                            setRowSelection(prev => ({
                                ...prev,
                                [row.id]: !!value
                            }));
                        }}
                        className="rounded-sm border-slate-300 data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-600"
                    />
                ),
                enableSorting: false,
                size: 40,
            });
        }

        cols.push(
            {
                accessorKey: "tds_work_package",
                header: () => (
                    <FilterableHeader
                        title="Work Package"
                        options={facetOptions.workPackagePending}
                        selected={selectedWorkPackages}
                        onChange={setSelectedWorkPackages}
                    />
                ),
                cell: ({ row }) => (
                    <span className="font-medium text-slate-700 whitespace-normal break-words">
                        {row.getValue("tds_work_package")}
                    </span>
                ),
                size: 150,
            },
            {
                accessorKey: "tds_category",
                header: () => (
                    <FilterableHeader
                        title="Category"
                        options={facetOptions.categoryPending}
                        selected={selectedCategories}
                        onChange={setSelectedCategories}
                    />
                ),
                cell: ({ row }) => <span className="whitespace-normal break-words">{row.getValue("tds_category")}</span>,
                size: 180,
            },
            {
                accessorKey: "tds_item_name",
                header: () => (
                    <FilterableHeader
                        title="Item Name"
                        options={facetOptions.itemNamePending}
                        selected={selectedItemNames}
                        onChange={setSelectedItemNames}
                    />
                ),
                cell: ({ row }) => {
                    const kind = getItemStatusKind(row.original as any, repoStatusByKey);
                    return (
                        <span className={`whitespace-normal break-words font-medium ${ITEM_STATUS_STYLES[kind].text}`}>
                            {row.getValue("tds_item_name")}
                        </span>
                    );
                },
                size: 180,
            },
            {
                id: "item_status",
                header: () => (
                    <FilterableHeader
                        title="Item Status"
                        options={facetOptions.itemStatus}
                        selected={selectedItemStatuses}
                        onChange={setSelectedItemStatuses}
                    />
                ),
                cell: ({ row }) => <ItemStatusBadge kind={getItemStatusKind(row.original as any, repoStatusByKey)} />,
                size: 130,
            },
            {
                accessorKey: "tds_description",
                header: "Description",
                cell: ({ row }) => (
                    <div
                        className="truncate max-w-[200px] text-slate-500"
                        title={row.original.tds_description}
                    >
                        {row.original.tds_description || "--"}
                    </div>
                ),
                size: 200,
            },
            {
                accessorKey: "tds_make",
                header: () => (
                    <FilterableHeader
                        title="Make"
                        options={facetOptions.makePending}
                        selected={selectedMakes}
                        onChange={setSelectedMakes}
                    />
                ),
                cell: ({ row }) => <MakePill make={row.original.tds_make} />,
                size: 100,
            },
            {
                accessorKey: "tds_boq_line_item",
                header: "BOQ Ref",
                cell: ({ row }) => {
                    const text = row.original.tds_boq_line_item;
                    if (!text) return <span className="text-gray-300">-</span>;
                    return (
                        <span
                            className="block max-w-[180px] truncate text-slate-700"
                            title={text}
                        >
                            {text}
                        </span>
                    );
                },
                size: 140,
            },
            {
                id: "doc",
                header: "Doc",
                cell: ({ row }) => (
                    row.original.tds_attachment ? (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 hover:bg-slate-100 text-slate-500"
                            onClick={() => window.open(row.original.tds_attachment, '_blank')}
                        >
                            <FileText className="h-4 w-4" />
                        </Button>
                    ) : (
                        <Button variant="ghost" size="icon" className="h-8 w-8 opacity-30 cursor-not-allowed">
                            <FileText className="h-4 w-4 text-slate-400" />
                        </Button>
                    )
                ),
                size: 60,
            }
        );

        if (canApprove) {
            cols.push({
                id: "actions",
                header: "Actions",
                cell: ({ row }) => (
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 hover:bg-slate-100"
                        onClick={() => {
                            setEditingItem(row.original);
                            setIsEditModalOpen(true);
                        }}
                    >
                        <Pencil className="h-4 w-4 text-slate-600" />
                    </Button>
                ),
                size: 60,
            });
        }

        return cols;
    }, [rowSelection, canApprove, facetOptions, selectedWorkPackages, selectedCategories, selectedMakes, selectedItemNames, selectedItemStatuses, repoStatusByKey]);

    // Read-only columns for Approved/Rejected sections
    const readOnlyColumns = useMemo<ColumnDef<TDSItem>[]>(() => [
        {
            accessorKey: "tds_work_package",
            header: () => (
                <FilterableHeader
                    title="Work Package"
                    options={facetOptions.workPackageApproved}
                    selected={selectedWorkPackages}
                    onChange={setSelectedWorkPackages}
                />
            ),
            cell: ({ row }) => <span className="font-medium text-slate-700 whitespace-normal break-words">{row.getValue("tds_work_package")}</span>,
            size: 150,
        },
        {
            accessorKey: "tds_category",
            header: () => (
                <FilterableHeader
                    title="Category"
                    options={facetOptions.categoryApproved}
                    selected={selectedCategories}
                    onChange={setSelectedCategories}
                />
            ),
            cell: ({ row }) => <span className="whitespace-normal break-words">{row.getValue("tds_category")}</span>,
            size: 180,
        },
        {
            accessorKey: "tds_item_name",
            header: () => (
                <FilterableHeader
                    title="Item Name"
                    options={facetOptions.itemNameApproved}
                    selected={selectedItemNames}
                    onChange={setSelectedItemNames}
                />
            ),
            cell: ({ row }) => <span className="whitespace-normal break-words">{row.getValue("tds_item_name")}</span>,
            size: 180,
        },
        {
            accessorKey: "tds_description",
            header: "Description",
            cell: ({ row }) => (
                <div
                    className="truncate max-w-[200px] text-slate-500"
                    title={row.original.tds_description}
                >
                    {row.original.tds_description || "--"}
                </div>
            ),
            size: 200,
        },
        {
            accessorKey: "tds_make",
            header: () => (
                <FilterableHeader
                    title="Make"
                    options={facetOptions.makeApproved}
                    selected={selectedMakes}
                    onChange={setSelectedMakes}
                />
            ),
            cell: ({ row }) => <MakePill make={row.original.tds_make} />,
            size: 100,
        },
        {
            accessorKey: "tds_boq_line_item",
            header: "BOQ Ref",
            cell: ({ row }) => {
                const text = row.original.tds_boq_line_item;

                return (
                    <div className="flex justify-start items-center">
                        {text ? (
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <div className="cursor-pointer p-1 rounded-full hover:bg-slate-100">
                                            <MessageSquare className="h-4 w-4 text-blue-500 hover:text-blue-700" />
                                        </div>
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-[400px] whitespace-normal break-words">
                                        <p>{text}</p>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        ) : (
                            <span className="text-gray-300 ml-2">-</span>
                        )}
                    </div>
                );
            },
            size: 100,
        },
        {
            id: "doc",
            header: "Doc",
            cell: ({ row }) => (
                row.original.tds_attachment ? (
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 hover:bg-slate-100 text-slate-500"
                        onClick={() => window.open(row.original.tds_attachment, '_blank')}
                    >
                        <FileText className="h-4 w-4" />
                    </Button>
                ) : (
                    <Button variant="ghost" size="icon" className="h-8 w-8 opacity-30 cursor-not-allowed">
                        <FileText className="h-4 w-4 text-slate-400" />
                    </Button>
                )
            ),
            size: 60,
        },
    ], [facetOptions, selectedWorkPackages, selectedCategories, selectedMakes, selectedItemNames]);

    // Rejected items columns (includes Reject Reason)
    const rejectedColumns = useMemo<ColumnDef<TDSItem>[]>(() => [
        {
            accessorKey: "tds_work_package",
            header: () => (
                <FilterableHeader
                    title="Work Package"
                    options={facetOptions.workPackageRejected}
                    selected={selectedWorkPackages}
                    onChange={setSelectedWorkPackages}
                />
            ),
            cell: ({ row }) => <span className="font-medium text-slate-700 whitespace-normal break-words">{row.getValue("tds_work_package")}</span>,
            size: 150,
        },
        {
            accessorKey: "tds_category",
            header: () => (
                <FilterableHeader
                    title="Category"
                    options={facetOptions.categoryRejected}
                    selected={selectedCategories}
                    onChange={setSelectedCategories}
                />
            ),
            cell: ({ row }) => <span className="whitespace-normal break-words">{row.getValue("tds_category")}</span>,
            size: 180,
        },
        {
            accessorKey: "tds_item_name",
            header: () => (
                <FilterableHeader
                    title="Item Name"
                    options={facetOptions.itemNameRejected}
                    selected={selectedItemNames}
                    onChange={setSelectedItemNames}
                />
            ),
            cell: ({ row }) => <span className="whitespace-normal break-words">{row.getValue("tds_item_name")}</span>,
            size: 180,
        },
        {
            accessorKey: "tds_description",
            header: "Description",
            cell: ({ row }) => (
                <div
                    className="truncate max-w-[150px] text-slate-500"
                    title={row.original.tds_description}
                >
                    {row.original.tds_description || "--"}
                </div>
            ),
            size: 150,
        },
        {
            accessorKey: "tds_make",
            header: () => (
                <FilterableHeader
                    title="Make"
                    options={facetOptions.makeRejected}
                    selected={selectedMakes}
                    onChange={setSelectedMakes}
                />
            ),
            cell: ({ row }) => <MakePill make={row.original.tds_make} />,
            size: 100,
        },
        {
            accessorKey: "tds_boq_line_item",
            header: "BOQ Ref",
            cell: ({ row }) => {
                const text = row.original.tds_boq_line_item;

                return (
                    <div className="flex justify-start items-center">
                        {text ? (
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <div className="cursor-pointer p-1 rounded-full hover:bg-slate-100">
                                            <MessageSquare className="h-4 w-4 text-blue-500 hover:text-blue-700" />
                                        </div>
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-[400px] whitespace-normal break-words">
                                        <p>{text}</p>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        ) : (
                            <span className="text-gray-300 ml-2">-</span>
                        )}
                    </div>
                );
            },
            size: 100,
        },
        {
            accessorKey: "tds_rejection_reason",
            header: "Reason",
            cell: ({ row }) => {
                const reason = row.original.tds_rejection_reason;
                const hasReason = !!reason && reason.trim() !== "";

                return (
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className="flex justify-start items-center cursor-help">
                                    <MessageSquare
                                        className={`h-4 w-4 ${hasReason ? "text-rose-500 hover:text-rose-700" : "text-gray-300 opacity-40"} transition-colors`}
                                    />
                                </div>
                            </TooltipTrigger>
                            <TooltipContent>
                                <p>{hasReason ? reason : "No reason provided"}</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                );
            },
            size: 60,
        },
        {
            id: "doc",
            header: "Doc",
            cell: ({ row }) => (
                row.original.tds_attachment ? (
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 hover:bg-slate-100 text-slate-500"
                        onClick={() => window.open(row.original.tds_attachment, '_blank')}
                    >
                        <FileText className="h-4 w-4" />
                    </Button>
                ) : (
                    <Button variant="ghost" size="icon" className="h-8 w-8 opacity-30 cursor-not-allowed">
                        <FileText className="h-4 w-4 text-slate-400" />
                    </Button>
                )
            ),
            size: 60,
        },
    ], [facetOptions, selectedWorkPackages, selectedCategories, selectedMakes, selectedItemNames]);

    const handleApprove = async () => {
        const selectedItems = allPendingItems.filter(item => rowSelection[item.name]);

        if (selectedItems.length === 0) {
            toast({ title: "No items selected", variant: "destructive" });
            return;
        }

        const willBeEmpty = selectedItems.length === allPendingItems.length;

        // Find a repo entry matching a New project-item by (wp, cat, name, make).
        // Case-insensitive on name + make to catch casing-only collisions.
        const findExistingRepoEntry = (doc: TDSItem): RepoEntry | undefined => {
            if (!repoEntries) return undefined;
            const name = (doc.tds_item_name || "").trim().toLowerCase();
            const make = (doc.tds_make || "").trim().toLowerCase();
            return repoEntries.find(r =>
                r.work_package === doc.tds_work_package &&
                r.category === doc.tds_category &&
                (r.tds_item_name || "").trim().toLowerCase() === name &&
                (r.make || "").trim().toLowerCase() === make
            );
        };

        setProcessing(true);
        let createdCount = 0;
        let reusedCount = 0;
        let projectOnlyCount = 0;

        // Pre-allocate PCUS ids from the backend for every project-only custom in this
        // batch. Single round-trip; backend reads the project's current max from the DB
        // so we never collide with a previously-stamped id (the cached SWR value was
        // unreliable across navigation between request pages).
        const projectOnlyDocs = selectedItems.filter(
            d => d.tds_status === "New" && !d.tds_item_id
        );
        let pcusIds: string[] = [];
        if (projectOnlyDocs.length > 0) {
            if (!projectId) {
                toast({ title: "Error", description: "Project id missing — cannot allocate PCUS ids.", variant: "destructive" });
                setProcessing(false);
                return;
            }
            const resp = await allocatePcusIds({ project_id: projectId, count: projectOnlyDocs.length });
            pcusIds = (resp?.message as string[]) || [];
            if (pcusIds.length !== projectOnlyDocs.length) {
                toast({ title: "Error", description: "Failed to allocate PCUS ids.", variant: "destructive" });
                setProcessing(false);
                return;
            }
        }
        // Map Project TDS Item List doc name → pre-allocated PCUS id, consumed inside the loop.
        const pcusByDocName = new Map<string, string>();
        projectOnlyDocs.forEach((d, i) => pcusByDocName.set(d.name, pcusIds[i]));
        try {
            // Helper: flip a TDS Repository entry to "Verified" if it isn't already.
            // Approving an item is the act of vetting it, so the master gets verified.
            const verifyRepo = async (repoName: string, currentStatus?: string) => {
                if (currentStatus === "Verified") return;
                await updateDoc("TDS Repository", repoName, { status: "Verified" });
            };

            await Promise.all(selectedItems.map(async (doc) => {
                if (doc.tds_status === "New") {
                    // Project-only custom item: brand-new request with no source id.
                    // Stays in Project TDS Item List under this project; no TDS Repository entry.
                    // Pre-allocated PCUS id (from backend) is consumed here.
                    if (!doc.tds_item_id) {
                        const pcusId = pcusByDocName.get(doc.name)!;
                        projectOnlyCount++;
                        return updateDoc("Project TDS Item List", doc.name, {
                            tds_status: "Approved",
                            tds_item_id: pcusId,
                        });
                    }

                    // Preflight: if an entry already exists in the repo, link to it instead
                    const existing = findExistingRepoEntry(doc);
                    if (existing) {
                        reusedCount++;
                        await verifyRepo(existing.name, existing.status);
                        return updateDoc("Project TDS Item List", doc.name, {
                            tds_status: "Approved",
                            tds_item_id: existing.tds_item_id,
                        });
                    }

                    // No preflight match — create a new repo entry, born "Verified" since an approver
                    // just signed off on it.
                    const repoPayload: Record<string, any> = {
                        tds_item_name: doc.tds_item_name,
                        make: doc.tds_make,
                        description: doc.tds_description,
                        work_package: doc.tds_work_package,
                        category: doc.tds_category,
                        tds_attachment: doc.tds_attachment,
                        status: "Verified",
                    };
                    if (doc.tds_item_id) {
                        repoPayload.tds_item_id = doc.tds_item_id;
                    }

                    try {
                        const repoItem = await createDoc("TDS Repository", repoPayload);
                        createdCount++;
                        return updateDoc("Project TDS Item List", doc.name, {
                            tds_status: "Approved",
                            tds_item_id: repoItem.tds_item_id,
                        });
                    } catch (createErr) {
                        // Race case: another user created the same (wp, cat, tds_item_id, make)
                        // between our preflight and this create. Refresh the repo cache and
                        // re-lookup by (wp, cat, name, make). If found, link to it.
                        const refreshed = await mutateRepo();
                        const fallbackMatch = refreshed?.find(r =>
                            r.work_package === doc.tds_work_package &&
                            r.category === doc.tds_category &&
                            (r.tds_item_name || "").trim().toLowerCase() === (doc.tds_item_name || "").trim().toLowerCase() &&
                            (r.make || "").trim().toLowerCase() === (doc.tds_make || "").trim().toLowerCase()
                        );
                        if (fallbackMatch) {
                            reusedCount++;
                            await verifyRepo(fallbackMatch.name, fallbackMatch.status);
                            return updateDoc("Project TDS Item List", doc.name, {
                                tds_status: "Approved",
                                tds_item_id: fallbackMatch.tds_item_id,
                            });
                        }
                        throw createErr;
                    }
                } else {
                    // "Pending" — already-existing item picked from the master. Find the master
                    // entry and verify it. Match by (tds_item_id Data field + wp + cat + make)
                    // since that's the uniqueness key in the TDS Repository validate hook.
                    const master = repoEntries?.find(r =>
                        r.tds_item_id === doc.tds_item_id &&
                        r.make === doc.tds_make &&
                        r.work_package === doc.tds_work_package &&
                        r.category === doc.tds_category
                    );
                    if (master) {
                        await verifyRepo(master.name, master.status);
                    }
                    return updateDoc("Project TDS Item List", doc.name, { tds_status: "Approved" });
                }
            }));

            const total = selectedItems.length;
            const parts: string[] = [];
            if (createdCount > 0) parts.push(`${createdCount} added to TDS Repository`);
            if (reusedCount > 0) parts.push(`${reusedCount} linked to existing entries`);
            if (projectOnlyCount > 0) parts.push(`${projectOnlyCount} kept as project-only custom`);
            toast({
                title: "Approved",
                description: parts.length > 0 ? `${total} items approved — ${parts.join(", ")}.` : `${total} items approved`,
                variant: "success",
            });

            if (willBeEmpty) {
                navigate("/tds-approval");
            } else {
                setRowSelection({});
                clearAllFilters();
                mutate();
                mutateRepo();
            }
        } catch (e) {
            console.error(e);
            toast({ title: "Error", description: "Failed to approve items", variant: "destructive" });
        } finally {
            setProcessing(false);
        }
    };

    const handleReject = (remarks: string) => {
        const selectedItems = allPendingItems.filter(item => rowSelection[item.name]);

        if (selectedItems.length === 0) return;

        const willBeEmpty = selectedItems.length === allPendingItems.length;

        setProcessing(true);
        Promise.all(selectedItems.map(doc =>
            updateDoc("Project TDS Item List", doc.name, {
                tds_status: "Rejected",
                tds_rejection_reason: remarks
            })
        )).then(() => {
            toast({ title: "Rejected", description: `${selectedItems.length} items rejected`, variant: "success" });

            if (willBeEmpty) {
                navigate("/tds-approval");
            } else {
                setRowSelection({});
                mutate();
                setIsRejectModalOpen(false);
            }
        }).catch((e) => {
            console.error(e);
            toast({ title: "Error", description: "Failed to reject items", variant: "destructive" });
        }).finally(() => {
            setProcessing(false);
        });
    };

    const onRejectClick = () => {
        if (selectedCount === 0) {
            toast({ title: "No items selected", variant: "destructive" });
            return;
        }
        setIsRejectModalOpen(true);
    };

    const handleEditSave = async (itemName: string, updates: any, itemsToDelete?: string[]) => {
        setProcessing(true);
        try {
            // Check if there are items to delete (resubmission logic)
            if (itemsToDelete && itemsToDelete.length > 0) {
                await Promise.all(itemsToDelete.map(name => deleteDoc("Project TDS Item List", name)));
            }

            // Handle file upload if present
            if (updates.attachmentFile) {
                const uploadedFile = await uploadFile(updates.attachmentFile, {
                    doctype: "Project TDS Item List",
                    docname: itemName,
                    fieldname: "tds_attachment",
                    isPrivate: true
                });
                updates.tds_attachment = uploadedFile.file_url;
                delete updates.attachmentFile;
            }

            await updateDoc("Project TDS Item List", itemName, updates);
            toast({ title: "Updated", description: "Item updated successfully", variant: "success" });
            setIsEditModalOpen(false);
            setEditingItem(null);
            mutate();
        } catch (e) {
            console.error(e);
            toast({ title: "Error", description: "Failed to update item", variant: "destructive" });
        } finally {
            setProcessing(false);
        }
    };

    // Select All toggles only the currently-visible pending rows,
    // preserving any selections on rows hidden by filters
    const handleSelectAll = () => {
        const allVisibleSelected = pendingItems.length > 0 &&
            pendingItems.every(item => rowSelection[item.name]);
        setRowSelection(prev => {
            const next = { ...prev };
            pendingItems.forEach(item => {
                if (allVisibleSelected) {
                    delete next[item.name];
                } else {
                    next[item.name] = true;
                }
            });
            return next;
        });
    };

    const allPendingSelected = pendingItems.length > 0 &&
        pendingItems.every(item => rowSelection[item.name]);

    return (
        <div className="flex-1 space-y-4 md:space-y-6 p-2 md:p-4 bg-slate-50/50 min-h-screen">
            {isCEOHold && <CEOHoldBanner className="mb-4" />}
            {/* Breadcrumb Header */}
            <div className="flex flex-col space-y-2">
                {/* <Button
                    variant="ghost"
                    onClick={() => navigate(-1)}
                    className="w-fit -ml-2 text-slate-500 hover:text-slate-900"
                >
                    <ArrowLeft className="h-4 w-4 mr-2" /> Back to List
                </Button>
                 */}
                {headerInfo && (
                    <Card className="border-l-4 border-l-red-500 shadow-sm border border-slate-200 bg-white">
                        <CardContent className="p-3 md:p-4">
                            <div className="flex flex-col gap-1">
                                <div className="flex items-start justify-between">
                                    <div className="space-y-1">
                                        <h1 className="text-xl font-bold text-slate-900 tracking-tight">
                                            {headerInfo.project}
                                        </h1>
                                        <div className="flex items-center flex-wrap gap-2 text-sm text-slate-600 mt-1">
                                            <span className="flex items-center gap-2 font-medium text-red-600">
                                                <FileText className="h-3.5 w-3.5" />
                                                <span className="hidden md:inline">Request ID:</span>
                                                <span>#{headerInfo.request_id}</span>
                                            </span>
                                            <span className="text-slate-300 mx-1">|</span>
                                            <span className="flex items-center gap-1.5">
                                                <User className="h-3.5 w-3.5 text-slate-400" />
                                                <span className="hidden md:inline text-slate-500">Created By:</span>
                                                <span className="font-medium text-slate-900">{headerInfo.created_by}</span>
                                            </span>
                                            <span className="text-slate-300 mx-1">|</span>
                                            <span className="flex items-center gap-1.5">
                                                <Clock className="h-3.5 w-3.5 text-slate-400" />
                                                <span className="hidden md:inline text-slate-500">Created Date:</span>
                                                <span className="font-medium text-slate-900">{formatDateClean(headerInfo.creation)}</span>
                                            </span>
                                            <span className="text-slate-300 mx-1">|</span>
                                            <span className="flex items-center gap-1.5">
                                                <Layers className="h-3.5 w-3.5 text-slate-400" />
                                                <span className="hidden md:inline text-slate-500">Total Items:</span>
                                                <span className="font-medium text-slate-900">{headerInfo.count}</span>
                                                <span className="md:hidden font-medium text-slate-900">Items</span>
                                            </span>
                                        </div>
                                    </div>
                                    <StatusBadge status={headerInfo.status} />
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                )}
            </div>

            {/* Filter bar */}
            {!isLoading && (allItems?.length ?? 0) > 0 && (
                <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                    <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-3">
                        <div className="relative flex-1 min-w-0">
                            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                            <Input
                                value={searchText}
                                onChange={e => setSearchText(e.target.value)}
                                placeholder="Search item name or description..."
                                className="pl-9 h-9"
                            />
                        </div>
                        {/* Mobile-only facet buttons (desktop uses column-header funnels) */}
                        <div className="flex flex-wrap items-center gap-2 md:hidden">
                            <SimpleFacetFilter
                                title="Work Package"
                                options={facetOptions.workPackage}
                                selected={selectedWorkPackages}
                                onChange={setSelectedWorkPackages}
                            />
                            <SimpleFacetFilter
                                title="Category"
                                options={facetOptions.category}
                                selected={selectedCategories}
                                onChange={setSelectedCategories}
                            />
                            <SimpleFacetFilter
                                title="Make"
                                options={facetOptions.make}
                                selected={selectedMakes}
                                onChange={setSelectedMakes}
                            />
                        </div>
                        {/* Clear-all button — visible whenever filters active, on all screens */}
                        {hasActiveFilters && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={clearAllFilters}
                                className="h-9 text-slate-500 hover:text-slate-900"
                            >
                                <FilterX className="h-3.5 w-3.5 mr-1.5" /> Clear all
                            </Button>
                        )}
                    </div>
                    {hasActiveFilters && (
                        <div className="text-xs text-slate-500">
                            Showing <span className="font-medium text-slate-700">{filteredTotal}</span> of{" "}
                            <span className="font-medium text-slate-700">{allItems?.length ?? 0}</span> items
                        </div>
                    )}
                </div>
            )}

            {isLoading ? (
                <div className="flex justify-center p-12 text-slate-400 animate-pulse">Loading details...</div>
            ) : hasActiveFilters && filteredTotal === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-200 bg-white p-12 text-center">
                    <FilterX className="h-6 w-6 text-slate-400" />
                    <p className="text-sm font-medium text-slate-700">No items match the current filters</p>
                    <Button variant="outline" size="sm" onClick={clearAllFilters} className="mt-1">
                        Clear all filters
                    </Button>
                </div>
            ) : (
                <div className="space-y-3">
                    {/* PENDING SECTION - Priority View */}
                    {(showAllSections || statusFilter === "Pending") && pendingItems.length > 0 && (
                        <Card className="border-amber-200/50 shadow-sm ring-1 ring-amber-100/50 overflow-hidden">
                            <CardHeader
                                className={cn(
                                    "bg-amber-50/50 border-b border-amber-100/50 transition-colors",
                                    collapseEnabled && !pendingExpanded
                                        ? "px-3 py-2.5 md:px-6 md:py-3"
                                        : "px-3 py-3 md:px-6 md:py-4",
                                    collapseEnabled && "cursor-pointer select-none hover:bg-amber-100/50"
                                )}
                                onClick={collapseEnabled ? () => setPendingExpanded(v => !v) : undefined}
                            >
                                <div className="flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-2.5 min-w-0">
                                        {collapseEnabled && (
                                            <ChevronRight
                                                className={cn(
                                                    "h-4 w-4 text-amber-700 shrink-0 transition-transform duration-200",
                                                    pendingExpanded && "rotate-90"
                                                )}
                                            />
                                        )}
                                        <CardTitle className="text-base md:text-lg font-semibold text-amber-900 truncate">
                                            Pending Review
                                        </CardTitle>
                                        <Badge variant="secondary" className="bg-amber-100 text-amber-700 hover:bg-amber-100 shrink-0">
                                            {hasActiveFilters
                                                ? `${pendingItems.length} of ${allPendingItems.length}`
                                                : pendingItems.length}
                                        </Badge>
                                        {/* Compact selection chip — always visible when user has selections */}
                                        {canApprove && selectedCount > 0 && (
                                            <Badge
                                                variant="secondary"
                                                className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 shrink-0"
                                            >
                                                {selectedCount} selected
                                                {hiddenSelectedCount > 0 && ` · ${hiddenSelectedCount} hidden`}
                                            </Badge>
                                        )}
                                    </div>
                                    {/* Select All is only useful when section is expanded */}
                                    {canApprove && (!collapseEnabled || pendingExpanded) && (
                                        <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                                            {selectedCount === 0 && (
                                                <span className="text-xs text-amber-700 font-medium hidden md:inline">
                                                    0 selected
                                                </span>
                                            )}
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={handleSelectAll}
                                                className="h-8 border-amber-200 text-amber-700 hover:bg-amber-100 hover:text-amber-800"
                                            >
                                                {allPendingSelected ? "Deselect All" : "Select All"}
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            </CardHeader>
                            {shouldShowPendingBody && (
                                <>
                                    <div className="p-0">
                                        <ItemsTable
                                            data={pendingItems}
                                            columns={pendingColumns}
                                            emptyMessage="No pending items"
                                            onSelectionChange={handleMobileSelectionChange}
                                            rowSelection={rowSelection}
                                            enableSelection={canApprove}
                                            scrollMaxHeight="55vh"
                                        />
                                    </div>

                                    {/* Sticky Action Footer for Pending Items */}
                                    {canApprove && pendingItems.length > 0 && (
                                        <div className="px-3 py-3 md:px-6 md:py-4 bg-amber-50/30 border-t border-amber-100/50 flex flex-col-reverse sm:flex-row justify-end gap-3 rounded-b-lg">
                                            <Button
                                                variant="outline"
                                                className="w-full sm:w-auto border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                                                onClick={onRejectClick}
                                                disabled={selectedCount === 0 || processing}
                                            >
                                                <XCircle className="w-4 h-4 mr-2" /> Reject Selected
                                            </Button>
                                            <Button
                                                className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
                                                onClick={handleApprove}
                                                disabled={selectedCount === 0 || processing}
                                            >
                                                <CheckCircle2 className="w-4 h-4 mr-2" /> Approve Selected
                                            </Button>
                                        </div>
                                    )}
                                </>
                            )}
                        </Card>
                    )}

                    {/* APPROVED SECTION */}
                    {(showAllSections || statusFilter === "Approved") && approvedItems.length > 0 && (
                        <Card className="border-emerald-200/50 shadow-sm ring-1 ring-emerald-100/50 overflow-hidden">
                            <CardHeader
                                className={cn(
                                    "bg-emerald-50/50 border-b border-emerald-100/50 transition-colors",
                                    collapseEnabled && !approvedExpanded
                                        ? "px-3 py-2.5 md:px-6 md:py-3"
                                        : "px-3 py-3 md:px-6 md:py-4",
                                    collapseEnabled && "cursor-pointer select-none hover:bg-emerald-100/50"
                                )}
                                onClick={collapseEnabled ? () => setApprovedExpanded(v => !v) : undefined}
                            >
                                <div className="flex items-center gap-2.5">
                                    {collapseEnabled && (
                                        <ChevronRight
                                            className={cn(
                                                "h-4 w-4 text-emerald-700 shrink-0 transition-transform duration-200",
                                                approvedExpanded && "rotate-90"
                                            )}
                                        />
                                    )}
                                    <CardTitle className="text-base md:text-lg font-semibold text-emerald-900 truncate">
                                        Approved Items
                                    </CardTitle>
                                    <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 shrink-0">
                                        {hasActiveFilters
                                            ? `${approvedItems.length} of ${allApprovedItems.length}`
                                            : approvedItems.length}
                                    </Badge>
                                </div>
                            </CardHeader>
                            {shouldShowApprovedBody && (
                                <div className="p-0">
                                    <ItemsTable
                                        data={approvedItems}
                                        columns={readOnlyColumns}
                                        emptyMessage="No approved items"
                                        scrollMaxHeight={approvedItems.length > 8 ? "500px" : undefined}
                                    />
                                </div>
                            )}
                        </Card>
                    )}

                    {/* REJECTED SECTION */}
                    {(showAllSections || statusFilter === "Rejected") && rejectedItems.length > 0 && (
                        <Card className="border-rose-200/50 shadow-sm ring-1 ring-rose-100/50 overflow-hidden">
                            <CardHeader
                                className={cn(
                                    "bg-rose-50/50 border-b border-rose-100/50 transition-colors",
                                    collapseEnabled && !rejectedExpanded
                                        ? "px-3 py-2.5 md:px-6 md:py-3"
                                        : "px-3 py-3 md:px-6 md:py-4",
                                    collapseEnabled && "cursor-pointer select-none hover:bg-rose-100/50"
                                )}
                                onClick={collapseEnabled ? () => setRejectedExpanded(v => !v) : undefined}
                            >
                                <div className="flex items-center gap-2.5">
                                    {collapseEnabled && (
                                        <ChevronRight
                                            className={cn(
                                                "h-4 w-4 text-rose-700 shrink-0 transition-transform duration-200",
                                                rejectedExpanded && "rotate-90"
                                            )}
                                        />
                                    )}
                                    <CardTitle className="text-base md:text-lg font-semibold text-rose-900 truncate">
                                        Rejected Items
                                    </CardTitle>
                                    <Badge variant="secondary" className="bg-rose-100 text-rose-700 hover:bg-rose-100 shrink-0">
                                        {hasActiveFilters
                                            ? `${rejectedItems.length} of ${allRejectedItems.length}`
                                            : rejectedItems.length}
                                    </Badge>
                                </div>
                            </CardHeader>
                            {shouldShowRejectedBody && (
                                <div className="p-0">
                                    <ItemsTable
                                        data={rejectedItems}
                                        columns={rejectedColumns}
                                        emptyMessage="No rejected items"
                                        scrollMaxHeight={rejectedItems.length > 8 ? "500px" : undefined}
                                    />
                                </div>
                            )}
                        </Card>
                    )}
                </div>
            )}

            <RejectTDSModal
                open={isRejectModalOpen}
                onOpenChange={setIsRejectModalOpen}
                onConfirm={handleReject}
                loading={processing}
            />

            {editingItem?.tds_status === "New" ? (
                <EditRequestItemModal
                    open={isEditModalOpen}
                    onOpenChange={setIsEditModalOpen}
                    item={editingItem}
                    onSave={handleEditSave}
                />
            ) : (
                <ProjectEditTDSItemModal
                    open={isEditModalOpen}
                    onOpenChange={setIsEditModalOpen}
                    item={editingItem}
                    onSave={handleEditSave}
                />
            )}
        </div>
    );
};

export default TDSApprovalDetail;
