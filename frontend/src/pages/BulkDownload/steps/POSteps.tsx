/**
 * POSteps — handles PO rate option + vendor/date/status filters + All POs / Critical POs tabs
 */
import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Download, Loader2, AlertTriangle, Link2, CheckSquare, Square } from "lucide-react";
import { BaseItemList, BaseItem, formatCreationDate } from "./BaseItemList";
import { FilterBar } from "../FilterBar";
import { POItem, CriticalPOTask } from "../useBulkDownloadWizard";
import { DateFilterValue } from "@/components/ui/standalone-date-filter";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { useUserData } from "@/hooks/useUserData";

function parseLinkedPOs(raw?: string): string[] {
    if (!raw) return [];
    try {
        const p = typeof raw === "string" ? JSON.parse(raw) : raw;
        return Array.isArray(p?.pos) ? p.pos : [];
    } catch { return []; }
}

interface POStepsProps {
    items: POItem[];
    isLoading: boolean;
    selectedIds: string[];
    onToggle: (id: string) => void;
    onBack: () => void;
    onDownload: () => void;
    loading: boolean;
    withRate: boolean;
    onWithRateChange: (v: boolean) => void;
    // Filters
    vendorOptions: { value: string; label: string }[];
    poVendorFilter: string[];
    onToggleVendor: (v: string) => void;
    poDateFilter?: DateFilterValue;
    setPoDateFilter: (val?: DateFilterValue) => void;
    onClearPoFilters: () => void;
    // Status
    poStatuses: string[];
    // Critical tasks
    criticalTasks: CriticalPOTask[];
    onSelectMultipleCriticalTaskPOs: (taskNames: string[]) => void;
}

/** Color map for common PO statuses */
const STATUS_COLORS: Record<string, { bg: string; text: string; activeBg: string; activeBorder: string }> = {
    "Approved": { bg: "bg-green-50", text: "text-green-700", activeBg: "bg-green-100", activeBorder: "border-green-400" },
    "Partially Delivered": { bg: "bg-amber-50", text: "text-amber-700", activeBg: "bg-amber-100", activeBorder: "border-amber-400" },
    "Dispatched": { bg: "bg-blue-50", text: "text-blue-700", activeBg: "bg-blue-100", activeBorder: "border-blue-400" },
    "Delivered": { bg: "bg-emerald-50", text: "text-emerald-700", activeBg: "bg-emerald-100", activeBorder: "border-emerald-400" },
};
const DEFAULT_STATUS_COLOR = { bg: "bg-muted", text: "text-muted-foreground", activeBg: "bg-muted", activeBorder: "border-primary" };

export const POSteps = ({
    items,
    isLoading,
    selectedIds,
    onToggle,
    onBack,
    onDownload,
    loading,
    withRate,
    onWithRateChange,
    vendorOptions,
    poVendorFilter,
    onToggleVendor,
    poDateFilter,
    setPoDateFilter,
    onClearPoFilters,
    poStatuses,
    criticalTasks,
    onSelectMultipleCriticalTaskPOs,
}: POStepsProps) => {
    const { role } = useUserData();
    const isProjectManager = role === "Nirmaan Project Manager Profile";

    const [selectedCriticalTasks, setSelectedCriticalTasks] = useState<string[]>([]);
    const [statusFilter, setStatusFilter] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState("all");

    // Enforce without rate for Project Managers natively
    const effectiveWithRate = isProjectManager ? false : withRate;

    const tasksWithPOs = useMemo(
        () => criticalTasks.filter((t) => parseLinkedPOs(t.associated_pos).length > 0),
        [criticalTasks]
    );

    const handleCriticalToggle = (taskName: string) => {
        setSelectedCriticalTasks((prev) => {
            const next = prev.includes(taskName) ? prev.filter((t) => t !== taskName) : [...prev, taskName];
            onSelectMultipleCriticalTaskPOs(next);
            return next;
        });
    };

    const selectAllCritical = () => {
        const all = tasksWithPOs.map((t) => t.name);
        setSelectedCriticalTasks(all);
        onSelectMultipleCriticalTaskPOs(all);
    };

    const deselectAllCritical = () => {
        setSelectedCriticalTasks([]);
        onSelectMultipleCriticalTaskPOs([]);
    };

    // Apply status filter on top of items (already vendor+date filtered by hook)
    const filteredItems = useMemo(() => {
        if (!statusFilter) return items;
        return items.filter((po) => po.status === statusFilter);
    }, [items, statusFilter]);

    // Count POs per status (from unfiltered items)
    const statusCounts = useMemo(() => {
        const map: Record<string, number> = {};
        items.forEach((po) => { if (po.status) map[po.status] = (map[po.status] || 0) + 1; });
        return map;
    }, [items]);

    const poBaseItems: BaseItem[] = filteredItems.map((po) => ({
        name: po.name,
        subtitle: po.vendor_name || po.vendor || "—",
        rightLabel: po.amount != null ? formatToRoundedIndianRupee(po.amount) : undefined,
        status: po.status,
        dateStr: formatCreationDate(po.creation),
    }));

    return (
        <div className="flex flex-col gap-4">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                    <h2 className="text-xl font-bold">Select Procurement Orders</h2>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        {selectedIds.length === 0 ? "None selected" : `${selectedIds.length} selected`}
                    </p>
                </div>
                {/* Rate toggle */}
                <div className={`flex items-center gap-2 border rounded-lg px-3 py-2 ${isProjectManager ? "bg-muted/70 opacity-80" : "bg-muted/40"}`}>
                    <Switch
                        id="with-rate"
                        checked={effectiveWithRate}
                        onCheckedChange={onWithRateChange}
                        disabled={isProjectManager}
                    />
                    <Label htmlFor="with-rate" className={`text-sm ${isProjectManager ? "cursor-not-allowed opacity-70 flex flex-col items-start gap-0.5" : "cursor-pointer"}`}>
                        {effectiveWithRate ? "With Rate" : "Without Rate"}
                        {isProjectManager && (
                           <span className="text-[10px] text-muted-foreground font-normal">Disabled for Project Managers</span>
                        )}
                    </Label>
                </div>
            </div>

            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={(val) => {
                setActiveTab(val);
                if (val === "all") deselectAllCritical();
            }}>
                <div className="flex flex-col sm:flex-row sm:items-start gap-3 mb-2">
                    <div className="flex-1">
                        {activeTab === "all" && (
                            <FilterBar
                                vendorOptions={vendorOptions}
                                vendorFilter={poVendorFilter}
                                onToggleVendor={onToggleVendor}
                                dateFilter={poDateFilter}
                                onDateFilter={setPoDateFilter}
                                onClearFilters={() => { onClearPoFilters(); setStatusFilter(null); }}
                            />
                        )}
                    </div>
                    <div className="shrink-0 pt-1">
                        <TabsList className="h-8">
                            <TabsTrigger value="all" className="text-xs h-7 px-3">
                                All POs
                                <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">{items.length}</Badge>
                            </TabsTrigger>
                            <TabsTrigger value="critical" className="text-xs h-7 px-3 gap-1">
                                <AlertTriangle className="h-3 w-3 text-orange-500" />
                                Critical POs
                                {tasksWithPOs.length > 0 && (
                                    <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">{tasksWithPOs.length}</Badge>
                                )}
                            </TabsTrigger>
                        </TabsList>
                    </div>
                </div>

                {/* All POs tab */}
                <TabsContent value="all" className="mt-0">
                    {/* Status filter chips */}
                    {poStatuses.length > 1 && (
                        <div className="flex flex-wrap items-center gap-1.5 mb-3">
                            <span className="text-[11px] text-muted-foreground font-medium mr-1">Status:</span>
                            <button
                                onClick={() => setStatusFilter(null)}
                                className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium border transition-colors ${!statusFilter ? "bg-primary text-primary-foreground border-primary" : "bg-muted/50 text-muted-foreground border-border hover:bg-muted"}`}
                            >
                                All
                                <span className="ml-1 opacity-70">{items.length}</span>
                            </button>
                            {poStatuses.map((status) => {
                                const c = STATUS_COLORS[status] || DEFAULT_STATUS_COLOR;
                                const active = statusFilter === status;
                                return (
                                    <button
                                        key={status}
                                        onClick={() => setStatusFilter(active ? null : status)}
                                        className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium border transition-colors ${active ? `${c.activeBg} ${c.text} ${c.activeBorder}` : `${c.bg} ${c.text} border-transparent hover:border-current/20`}`}
                                    >
                                        {status}
                                        <span className="ml-1 opacity-70">{statusCounts[status] || 0}</span>
                                    </button>
                                );
                            })}
                        </div>
                    )}

                    <BaseItemList
                        items={poBaseItems}
                        isLoading={isLoading}
                        selectedIds={selectedIds}
                        onToggle={onToggle}
                        emptyMessage="No POs match current filters"
                        onClearFilters={() => { onClearPoFilters(); setStatusFilter(null); }}
                    />
                </TabsContent>

                {/* Critical POs tab */}
                <TabsContent value="critical" className="mt-0">
                    {tasksWithPOs.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-48 border rounded-xl text-muted-foreground gap-2">
                            <AlertTriangle className="h-8 w-8 text-muted-foreground/40" />
                            <p className="text-sm">No Critical PO Tasks with linked POs found.</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            <div className="flex items-center justify-between mb-3">
                                <p className="text-xs text-muted-foreground">
                                    {selectedCriticalTasks.length === 0
                                        ? "Select tasks — their linked POs will be queued."
                                        : `${selectedCriticalTasks.length} task${selectedCriticalTasks.length !== 1 ? "s" : ""} selected`}
                                </p>
                                <Button variant="outline" size="sm" className="h-7 text-xs"
                                    onClick={selectedCriticalTasks.length === tasksWithPOs.length ? deselectAllCritical : selectAllCritical}>
                                    {selectedCriticalTasks.length === tasksWithPOs.length
                                        ? <><Square className="h-3 w-3 mr-1" />Deselect All</>
                                        : <><CheckSquare className="h-3 w-3 mr-1" />Select All</>}
                                </Button>
                            </div>
                            {tasksWithPOs.map((task) => {
                                const linkedPOs = parseLinkedPOs(task.associated_pos);
                                const isActive = selectedCriticalTasks.includes(task.name);
                                return (
                                    <div key={task.name} onClick={() => handleCriticalToggle(task.name)}
                                        className={`rounded-xl border-2 p-4 cursor-pointer transition-all ${isActive ? "border-orange-400 bg-orange-50 dark:bg-orange-950/20" : "border-border hover:border-orange-300 hover:bg-muted/40"}`}>
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="flex gap-3 min-w-0">
                                                <Checkbox checked={isActive}
                                                    onCheckedChange={() => handleCriticalToggle(task.name)}
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="mt-0.5 shrink-0 data-[state=checked]:bg-orange-500 data-[state=checked]:border-orange-500"
                                                />
                                                <div className="min-w-0">
                                                    <p className="font-semibold text-sm">{task.item_name}</p>
                                                    {task.critical_po_category && (
                                                        <p className="text-xs text-muted-foreground">{task.critical_po_category}</p>
                                                    )}
                                                    <div className="flex flex-wrap gap-1 mt-2">
                                                        {linkedPOs.map((po) => (
                                                            <span key={po} className={`inline-flex items-center gap-1 text-[11px] font-medium rounded-md px-1.5 py-0.5 border ${isActive ? "bg-orange-100 border-orange-300 text-orange-800" : "bg-muted border-border text-muted-foreground"}`}>
                                                                <Link2 className="h-2.5 w-2.5" />{po}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                            <Badge variant={isActive ? "default" : "secondary"} className={`shrink-0 text-[11px] ${isActive ? "bg-orange-500" : ""}`}>
                                                {linkedPOs.length} PO{linkedPOs.length !== 1 ? "s" : ""}
                                            </Badge>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </TabsContent>
            </Tabs>

            {/* Footer */}
            <div className="flex items-center justify-between pt-2">
                <Button variant="ghost" onClick={onBack} disabled={loading}>
                    <ArrowLeft className="h-4 w-4 mr-2" />Back
                </Button>
                <Button onClick={onDownload} disabled={loading || selectedIds.length === 0} className="min-w-40">
                    {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                    {loading ? "Generating..." : selectedIds.length === 0 ? "Select POs to download" : `Download ${selectedIds.length} PO${selectedIds.length !== 1 ? "s" : ""}`}
                </Button>
            </div>
        </div>
    );
};
