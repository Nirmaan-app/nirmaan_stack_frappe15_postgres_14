/**
 * CriticalTasksTab — the "All … / Critical POs" tabs shared by the PO and DN steps.
 *
 * The "all" tab shows the step's own selection table (`children`). The "Critical POs" tab lists the
 * project's Critical PO Tasks that have linked POs; ticking a task selects its POs. Going back to
 * the "all" tab clears the task selection. Project scope only (`showCritical`): Critical PO Tasks
 * live inside a project, so in vendor scope only the table shows.
 */
import { ReactNode, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertTriangle, Link2, CheckSquare, Square } from "lucide-react";
import { CriticalPOTask } from "../useBulkDownloadWizard";

interface CriticalTasksTabProps {
    /** The plain list's tab label, e.g. "All POs". */
    allLabel: string;
    allCount: number;
    /** The step's own selection table, shown in the "all" tab. */
    children: ReactNode;
    /** Project scope only. */
    showCritical: boolean;
    criticalTasks: CriticalPOTask[];
    /** How many POs are selected, shown beside the task count. */
    selectedCount: number;
    onSelectTasks: (taskNames: string[]) => void;
}

const TAB_TRIGGER_CLASS = "px-4 h-8 text-xs font-bold rounded-lg transition-all data-[state=active]:bg-white data-[state=active]:text-blue-600 data-[state=active]:shadow-sm text-slate-500";

const countBadgeClass = (active: boolean) =>
    `ml-2 h-5 px-1.5 text-[11px] font-bold border-none rounded-md ${active ? "bg-blue-50 text-blue-600" : "bg-slate-200/50 text-slate-500"}`;

export const CriticalTasksTab = ({
    allLabel, allCount, children, showCritical, criticalTasks, selectedCount, onSelectTasks,
}: CriticalTasksTabProps) => {
    const [selectedCriticalTasks, setSelectedCriticalTasks] = useState<string[]>([]);
    const [activeTab, setActiveTab] = useState<string>("all");

    const tasksWithPOs = useMemo(
        () => criticalTasks.filter((t) => (t.linked_pos ?? []).length > 0),
        [criticalTasks]
    );

    const handleCriticalToggle = (taskName: string) => {
        setSelectedCriticalTasks((prev) => {
            const next = prev.includes(taskName) ? prev.filter((t) => t !== taskName) : [...prev, taskName];
            onSelectTasks(next);
            return next;
        });
    };

    const selectAllCritical = () => {
        const all = tasksWithPOs.map((t) => t.name);
        setSelectedCriticalTasks(all);
        onSelectTasks(all);
    };

    const deselectAllCritical = () => {
        setSelectedCriticalTasks([]);
        onSelectTasks([]);
    };

    return (
        <Tabs value={activeTab} onValueChange={(val) => {
            setActiveTab(val);
            if (val === "all") deselectAllCritical();
        }}>
            {showCritical && (
                <TabsList className="bg-[#F8FAFC] p-1 h-10 gap-1 rounded-lg border border-gray-100 mb-3">
                    <TabsTrigger value="all" className={TAB_TRIGGER_CLASS}>
                        {allLabel}
                        <Badge className={countBadgeClass(activeTab === "all")}>{allCount}</Badge>
                    </TabsTrigger>
                    <TabsTrigger value="critical" className={TAB_TRIGGER_CLASS}>
                        Critical POs
                        {tasksWithPOs.length > 0 && (
                            <Badge className={countBadgeClass(activeTab === "critical")}>{tasksWithPOs.length}</Badge>
                        )}
                    </TabsTrigger>
                </TabsList>
            )}

            <TabsContent value="all" className="mt-0">
                {children}
            </TabsContent>

            {showCritical && (
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
                                        : `${selectedCriticalTasks.length} task${selectedCriticalTasks.length !== 1 ? "s" : ""} selected · ${selectedCount} PO${selectedCount !== 1 ? "s" : ""}`}
                                </p>
                                <Button variant="outline" size="sm" className="h-7 text-xs"
                                    onClick={selectedCriticalTasks.length === tasksWithPOs.length ? deselectAllCritical : selectAllCritical}>
                                    {selectedCriticalTasks.length === tasksWithPOs.length
                                        ? <><Square className="h-3 w-3 mr-1" />Deselect All</>
                                        : <><CheckSquare className="h-3 w-3 mr-1" />Select All</>}
                                </Button>
                            </div>
                            {tasksWithPOs.map((task) => {
                                const linkedPOs = (task.linked_pos ?? []);
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
            )}
        </Tabs>
    );
};
