/**
 * DNSteps — Delivery Notes: same vendor/date filters + Critical POs tabs as PO, but no rate toggle
 */
import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Download, Loader2, AlertTriangle, Link2, CheckSquare, Square } from "lucide-react";
import { BaseItemList, BaseItem, formatCreationDate } from "./BaseItemList";
import { FilterBar } from "../FilterBar";
import { POItem, CriticalPOTask } from "../useBulkDownloadWizard";
import { DateFilterValue } from "@/components/ui/standalone-date-filter";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

function parseLinkedPOs(raw?: string): string[] {
    if (!raw) return [];
    try {
        const p = typeof raw === "string" ? JSON.parse(raw) : raw;
        return Array.isArray(p?.pos) ? p.pos : [];
    } catch { return []; }
}

interface DNStepsProps {
    items: POItem[];
    isLoading: boolean;
    selectedIds: string[];
    onToggle: (id: string) => void;
    onSelectAll: (ids: string[]) => void;
    onDeselectAll: () => void;
    onBack: () => void;
    onDownload: () => void;
    loading: boolean;
    vendorOptions: { value: string; label: string }[];
    poVendorFilter: string[];
    onToggleVendor: (v: string) => void;
    poDateFilter?: DateFilterValue;
    setPoDateFilter: (val?: DateFilterValue) => void;
    onClearPoFilters: () => void;
    criticalTasks: CriticalPOTask[];
    onSelectMultipleCriticalTaskPOs: (taskNames: string[]) => void;
}

export const DNSteps = ({
    items, isLoading, selectedIds, onToggle, onSelectAll, onDeselectAll,
    onBack, onDownload, loading,
    vendorOptions, poVendorFilter, onToggleVendor,
    poDateFilter, setPoDateFilter, onClearPoFilters,
    criticalTasks, onSelectMultipleCriticalTaskPOs,
}: DNStepsProps) => {
    const tasksWithPOs = useMemo(
        () => criticalTasks.filter((t) => parseLinkedPOs(t.associated_pos).length > 0),
        [criticalTasks]
    );

    const [selectedCriticalTasks, setSelectedCriticalTasks] = useState<string[]>([]);
    const [activeTab, setActiveTab] = useState("all");

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

    const dnBaseItems: BaseItem[] = items.map((po) => ({
        name: po.name,
        subtitle: po.vendor_name || po.vendor || "—",
        rightLabel: po.amount != null ? formatToRoundedIndianRupee(po.amount) : undefined,
        status: po.status,
        dateStr: formatCreationDate(po.creation),
    }));

    const allSelected = items.length > 0 && items.every((i) => selectedIds.includes(i.name));

    return (
        <div className="flex flex-col gap-4">
            <div>
                <h2 className="text-xl font-bold">Select Delivery Notes</h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                    {selectedIds.length === 0 ? "None selected" : `${selectedIds.length} selected`}
                </p>
            </div>

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
                                onClearFilters={onClearPoFilters}
                            />
                        )}
                    </div>
                    <div className="shrink-0 pt-1">
                        <TabsList className="h-8">
                            <TabsTrigger value="all" className="text-xs h-7 px-3">
                                All DNs
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

                <TabsContent value="all" className="mt-0">
                    <BaseItemList
                        items={dnBaseItems}
                        isLoading={isLoading}
                        selectedIds={selectedIds}
                        onToggle={onToggle}
                        emptyMessage="No Delivery Notes match current filters"
                        onClearFilters={onClearPoFilters}
                    />
                </TabsContent>

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

            <div className="flex items-center justify-between pt-2">
                <Button variant="ghost" onClick={onBack} disabled={loading}>
                    <ArrowLeft className="h-4 w-4 mr-2" />Back
                </Button>
                <Button onClick={onDownload} disabled={loading || selectedIds.length === 0} className="min-w-44">
                    {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                    {loading ? "Generating..." : selectedIds.length === 0 ? "Select DNs to download" : `Download ${selectedIds.length} DN${selectedIds.length !== 1 ? "s" : ""}`}
                </Button>
            </div>
        </div>
    );
};
