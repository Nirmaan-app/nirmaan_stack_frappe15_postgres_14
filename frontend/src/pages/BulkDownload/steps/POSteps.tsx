/**
 * POSteps — handles PO rate option + unified filter bar + All POs / Critical POs tabs
 * Pixel-perfect v2: matches screenshot with search, icon filter buttons, selection bar, bordered cards.
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
    onSelectMultipleCriticalTaskPOs: (taskNames: string[]) => void;
    // Uplifted Search
    searchQuery: string;
    setSearchQuery: (q: string) => void;
    filteredItems: POItem[];
    statusFilter: string[];
    toggleStatus: (s: string) => void;
}

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
    searchQuery,
    setSearchQuery,
    filteredItems,
    statusFilter,
    toggleStatus,
}: POStepsProps) => {
    const { role } = useUserData();
    const isProjectManager = role === "Nirmaan Project Manager Profile";

    const [selectedCriticalTasks, setSelectedCriticalTasks] = useState<string[]>([]);
    const [activeTab, setActiveTab] = useState<string>("all");

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

    // Apply status filter on top of items (others already vendor+date+search filtered by hook)
    const finalizedItems = useMemo(() => {
        let list = filteredItems;
        if (statusFilter.length > 0) {
            list = list.filter((po) => po.status && statusFilter.includes(po.status));
        }
        return list;
    }, [filteredItems, statusFilter]);

    const poBaseItems: BaseItem[] = finalizedItems.map((po) => ({
        name: po.name,
        subtitle: po.vendor_name || po.vendor || "—",
        rightLabel: po.amount != null ? formatToRoundedIndianRupee(po.amount) : undefined,
        status: po.status,
        dateStr: formatCreationDate(po.creation),
    }));

    // Select All / Deselect All for current filtered view
    const allFilteredSelected = finalizedItems.length > 0 && finalizedItems.every((i) => selectedIds.includes(i.name));
    const handleSelectAll = () => {
        const idsToAdd = finalizedItems.map((i) => i.name).filter((id) => !selectedIds.includes(id));
        if (idsToAdd.length > 0) {
            // We need to add to existing selection, so use onToggle for each
            idsToAdd.forEach((id) => onToggle(id));
        }
    };
    const handleDeselectAll = () => {
        finalizedItems.filter((i) => selectedIds.includes(i.name)).forEach((i) => onToggle(i.name));
    };

    const handleClearAllFilters = () => {
        onClearPoFilters();
        setStatusFilter(null);
        setSearchQuery("");
    };

    return (
        <div className="flex flex-col gap-4">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                    <h2 className="text-xl font-bold">Select Procurement Orders</h2>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Choose Procurement Orders to include in your download
                    </p>
                </div>
                {/* Rate toggle */}
                <div className={`flex items-center gap-2 border rounded-lg px-3 py-2 ${isProjectManager ? "bg-muted/70 opacity-80" : "bg-muted/40"}`}>
                    <Label htmlFor="with-rate" className={`text-sm ${isProjectManager ? "cursor-not-allowed opacity-70" : "cursor-pointer"}`}>
                        {effectiveWithRate ? "With Rate" : "Without Rate"}
                    </Label>
                    <Switch
                        id="with-rate"
                        checked={effectiveWithRate}
                        onCheckedChange={onWithRateChange}
                        disabled={isProjectManager}
                    />
                </div>
            </div>

            {/* Tabs wrapper */}
            <Tabs value={activeTab} onValueChange={(val) => {
                setActiveTab(val);
                if (val === "all") deselectAllCritical();
            }}>
                {/* FilterBar + Selection Bar (only on "all" tab) */}
                {activeTab === "all" && (
                    <FilterBar
                        searchQuery={searchQuery}
                        onSearchChange={setSearchQuery}
                        searchPlaceholder="Search by PO ID"
                        vendorOptions={vendorOptions}
                        vendorFilter={poVendorFilter}
                        onToggleVendor={onToggleVendor}
                        dateFilter={poDateFilter}
                        onDateFilter={setPoDateFilter}
                        statusOptions={poStatuses}
                        statusFilter={statusFilter}
                        onToggleStatus={toggleStatus}
                        onClearFilters={handleClearAllFilters}
                        selectedCount={finalizedItems.filter((i) => selectedIds.includes(i.name)).length}
                        totalCount={finalizedItems.length}
                        allSelected={allFilteredSelected}
                        onSelectAll={handleSelectAll}
                        onDeselectAll={handleDeselectAll}
                        tabSlot={
                            <TabsList className="bg-[#F8FAFC] p-1 h-10 gap-1 rounded-lg border border-gray-100">
                                <TabsTrigger 
                                    value="all" 
                                    className="px-4 h-8 text-xs font-bold rounded-lg transition-all data-[state=active]:bg-white data-[state=active]:text-blue-600 data-[state=active]:shadow-sm text-slate-500"
                                >
                                    All POs
                                    <Badge className={`ml-2 h-5 px-1.5 text-[11px] font-bold border-none rounded-md ${activeTab === "all" ? "bg-blue-50 text-blue-600" : "bg-slate-200/50 text-slate-500"}`}>
                                        {finalizedItems.length}
                                    </Badge>
                                </TabsTrigger>
                                <TabsTrigger 
                                    value="critical" 
                                    className="px-4 h-8 text-xs font-bold rounded-lg transition-all data-[state=active]:bg-white data-[state=active]:text-blue-600 data-[state=active]:shadow-sm text-slate-500"
                                >
                                    Critical POs
                                    {tasksWithPOs.length > 0 && (
                                        <Badge className={`ml-2 h-5 px-1.5 text-[11px] font-bold border-none rounded-md ${activeTab === "critical" ? "bg-blue-50 text-blue-600" : "bg-slate-200/50 text-slate-500"}`}>
                                            {tasksWithPOs.length}
                                        </Badge>
                                    )}
                                </TabsTrigger>
                            </TabsList>
                        }
                    />
                )}

                {/* Critical tab header — show tabs when on critical tab */}
                {activeTab === "critical" && (
                    <div className="flex items-center justify-between py-1.5 mb-2">
                        <TabsList className="bg-[#F8FAFC] p-1 h-10 gap-1 rounded-lg border border-gray-100">
                            <TabsTrigger 
                                value="all" 
                                className="px-4 h-8 text-xs font-bold rounded-lg transition-all data-[state=active]:bg-white data-[state=active]:text-blue-600 data-[state=active]:shadow-sm text-slate-500"
                            >
                                All POs
                                <Badge className={`ml-2 h-5 px-1.5 text-[11px] font-bold border-none rounded-md ${activeTab === "all" ? "bg-blue-50 text-blue-600" : "bg-slate-200/50 text-slate-500"}`}>
                                    {finalizedItems.length}
                                </Badge>
                            </TabsTrigger>
                            <TabsTrigger 
                                value="critical" 
                                className="px-4 h-8 text-xs font-bold rounded-lg transition-all data-[state=active]:bg-white data-[state=active]:text-blue-600 data-[state=active]:shadow-sm text-slate-500"
                            >
                                Critical POs
                                {tasksWithPOs.length > 0 && (
                                    <Badge className={`ml-2 h-5 px-1.5 text-[11px] font-bold border-none rounded-md ${activeTab === "critical" ? "bg-blue-50 text-blue-600" : "bg-slate-200/50 text-slate-500"}`}>
                                        {tasksWithPOs.length}
                                    </Badge>
                                )}
                            </TabsTrigger>
                        </TabsList>

                        <div className="flex items-center gap-4 pr-1">
                            <p className="text-sm text-slate-500 font-medium whitespace-nowrap">
                            {finalizedItems.filter((i) => selectedIds.includes(i.name)).length}/{finalizedItems.length} Selected
                            </p>
                            <Button variant="ghost" size="sm" className="h-9 px-3 border border-gray-200 rounded-lg bg-white shadow-sm gap-2.5 text-sm font-semibold text-gray-700"
                                onClick={allFilteredSelected ? handleDeselectAll : handleSelectAll}>
                                <Checkbox 
                                    checked={allFilteredSelected} 
                                    onCheckedChange={allFilteredSelected ? handleDeselectAll : handleSelectAll}
                                    className="data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600 pointer-events-none"
                                />
                                Select All
                            </Button>
                        </div>
                    </div>
                )}

                {/* All POs tab */}
                <TabsContent value="all" className="mt-0">
                    <BaseItemList
                        items={poBaseItems}
                        isLoading={isLoading}
                        selectedIds={selectedIds}
                        onToggle={onToggle}
                        emptyMessage="No POs match current filters"
                        onClearFilters={handleClearAllFilters}
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
                <Button
                    onClick={onDownload}
                    disabled={loading || selectedIds.length === 0}
                    variant={selectedIds.length > 0 ? "destructive" : "outline"}
                    className="min-w-44"
                >
                    {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                    {loading
                        ? "Generating..."
                        : selectedIds.length === 0
                            ? "Select POs to download"
                            : `Download ${selectedIds.length} PO${selectedIds.length !== 1 ? "s" : ""}`
                    }
                </Button>
            </div>
        </div>
    );
};
