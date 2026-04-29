import { useMemo, useState } from "react";
import { format } from "date-fns";
import { ClipboardList, Loader2, Play, Flag } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useWorkPlanData, useProjectDocForWorkPlan, WorkPlanDoc } from "@/pages/projects/data/work-plan/useWorkPlanQueries";

interface WorkPlanReferencePanelProps {
    projectId: string;
}

interface FlatTask extends WorkPlanDoc {
    milestoneName: string;
    zone: string;
}

const formatDate = (dateStr?: string | null): string => {
    if (!dateStr) return "—";
    try {
        return format(new Date(dateStr), "dd-MMM-yyyy");
    } catch {
        return dateStr;
    }
};

export const WorkPlanReferencePanel = ({ projectId }: WorkPlanReferencePanelProps) => {
    const [zoneFilter, setZoneFilter] = useState<string>("All");

    const { data: result, isLoading, error } = useWorkPlanData(projectId);
    const { data: projectDoc } = useProjectDocForWorkPlan(projectId);

    const zones: string[] = useMemo(() => {
        if (!projectDoc?.project_zones) return [];
        return projectDoc.project_zones.map((z: any) => z.zone_name).sort();
    }, [projectDoc]);

    // Flatten all planned activities (tasks) across all milestones, newest task first
    const tasks = useMemo<FlatTask[]>(() => {
        const data = result?.message?.data || {};
        const flat: FlatTask[] = [];
        Object.values(data).forEach((items) => {
            (items || []).forEach((item) => {
                (item.work_plan_doc || []).forEach((plan) => {
                    flat.push({
                        ...plan,
                        milestoneName: item.work_milestone_name,
                        zone: item.zone,
                    });
                });
            });
        });
        flat.sort((a, b) => {
            const aCreation = (a as any).creation || "";
            const bCreation = (b as any).creation || "";
            return bCreation.localeCompare(aCreation);
        });
        return flat;
    }, [result]);

    const filteredTasks = useMemo(() => {
        return tasks.filter((t) => {
            if (zoneFilter !== "All" && t.zone !== zoneFilter) return false;
            return true;
        });
    }, [tasks, zoneFilter]);

    const headerSummary = useMemo(() => {
        const parts: string[] = [`${filteredTasks.length} task${filteredTasks.length === 1 ? "" : "s"}`];
        if (zoneFilter !== "All") parts.push(`Zone ${zoneFilter}`);
        return parts.join(" · ");
    }, [filteredTasks.length, zoneFilter]);

    return (
        <div className="border border-blue-100 rounded-lg bg-blue-50/30 overflow-hidden mb-4">
            {/* Header */}
            <div className="flex items-center gap-2 px-3 py-2.5">
                <ClipboardList className="h-4 w-4 text-blue-600 shrink-0" />
                <span className="text-sm font-semibold text-gray-800">Existing Work Plan Tasks</span>
                <span className="text-[11px] text-gray-500 truncate">({headerSummary})</span>
            </div>

            <div className="border-t border-blue-100 bg-white p-3 space-y-3">
                    {/* Filters */}
                    <div className="flex flex-wrap items-center gap-2">
                        {zones.length > 0 && (
                            <div className="flex items-center gap-1.5">
                                <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Zone</span>
                                <Select value={zoneFilter} onValueChange={setZoneFilter}>
                                    <SelectTrigger className="h-7 w-[140px] text-xs">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="All" className="text-xs">All Zones</SelectItem>
                                        {zones.map((z) => (
                                            <SelectItem key={z} value={z} className="text-xs">{z}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                    </div>

                    {/* Body */}
                    {isLoading && (
                        <div className="flex items-center justify-center py-6 text-gray-500 text-xs gap-2">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Loading work plan tasks...
                        </div>
                    )}

                    {!isLoading && error && (
                        <div className="text-xs text-red-600 py-2">Failed to load work plan tasks.</div>
                    )}

                    {!isLoading && !error && filteredTasks.length === 0 && (
                        <div className="text-center py-6 text-xs text-gray-500 bg-gray-50/50 rounded border border-dashed">
                            No work plan tasks match the current filters.
                        </div>
                    )}

                    {!isLoading && !error && filteredTasks.length > 0 && (
                        <div className="border border-gray-200 rounded-md bg-white max-h-[200px] overflow-y-auto">
                            {/* Sticky Column Header */}
                            <div className="sticky top-0 z-10 flex items-center gap-3 px-3 py-1.5 bg-gray-100 border-b border-gray-200 text-[10px] font-bold text-gray-600 uppercase tracking-wide">
                                <span className="flex-1 min-w-0">Task</span>
                                <span className="shrink-0 hidden md:inline flex-1 min-w-0 truncate">Note</span>
                                <span className="shrink-0 hidden md:inline w-[60px] truncate">Zone</span>
                                <span className="shrink-0 w-[70px] text-center">Progress</span>
                                <span className="shrink-0 hidden lg:inline w-[90px]">Start</span>
                                <span className="shrink-0 hidden lg:inline w-[90px]">End</span>
                            </div>

                            {/* Rows */}
                            <div className="divide-y divide-gray-100">
                                {filteredTasks.map((task) => {
                                    const progressNum = parseInt(String(task.wp_progress || "0"), 10);
                                    const note = task.wp_description || task.wp_remarks || "";
                                    return (
                                        <div
                                            key={task.name}
                                            className="flex items-center gap-3 px-3 py-1.5 hover:bg-gray-50 text-xs"
                                        >
                                            <span className="font-semibold text-gray-900 truncate flex-1 min-w-0" title={task.wp_title}>
                                                {task.wp_title}
                                            </span>
                                            <span
                                                className="shrink-0 hidden md:inline flex-1 min-w-0 text-[10px] text-gray-500 truncate italic"
                                                title={note || undefined}
                                            >
                                                {note || "—"}
                                            </span>
                                            <span className="shrink-0 hidden md:inline w-[60px] text-[10px] text-gray-400 truncate">
                                                {task.zone || "—"}
                                            </span>
                                            <span className="shrink-0 w-[70px] flex items-center justify-end gap-1 text-[10px] text-gray-500">
                                                <span className="w-10 h-1 bg-gray-200 rounded-full overflow-hidden inline-block">
                                                    <span
                                                        className={`block h-full ${progressNum >= 100 ? "bg-emerald-500" :
                                                            progressNum >= 50 ? "bg-amber-500" :
                                                                progressNum > 0 ? "bg-sky-500" : "bg-gray-300"
                                                            }`}
                                                        style={{ width: `${Math.min(progressNum, 100)}%` }}
                                                    />
                                                </span>
                                                <span className="font-semibold text-gray-700 tabular-nums w-7 text-right">{progressNum}%</span>
                                            </span>
                                            <span className="shrink-0 hidden lg:flex items-center gap-1 w-[90px] text-[10px] text-gray-500">
                                                <Play className="h-2.5 w-2.5" /> {formatDate(task.wp_start_date)}
                                            </span>
                                            <span className="shrink-0 hidden lg:flex items-center gap-1 w-[90px] text-[10px] text-gray-500">
                                                <Flag className="h-2.5 w-2.5" /> {formatDate(task.wp_end_date)}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
        </div>
    );
};

export default WorkPlanReferencePanel;
