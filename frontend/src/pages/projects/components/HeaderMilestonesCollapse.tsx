import React, {
    forwardRef,
    useEffect,
    useImperativeHandle,
    useMemo,
    useState,
} from "react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { TailSpin } from "react-loader-spinner";
import { toast } from "@/components/ui/use-toast";
import { getStatusBadgeClasses } from "@/pages/Manpower-and-WorkMilestones/utils/milestoneHelpers";

interface HeaderMilestonePreviewRow {
    name: string;
    work_milestone_name: string;
    work_header: string;
    status: string;
    progress?: number | string;
    is_new_from_master?: number;
}

interface HeaderMilestonesPreviewResponse {
    message: {
        source: "report" | "master";
        report_name: string | null;
        report_date: string | null;
        report_zone: string | null;
        milestones: HeaderMilestonePreviewRow[];
    };
}

export interface HeaderMilestonesCollapseHandle {
    hasChanges: () => boolean;
    save: () => Promise<void>;
    cancel: () => void;
}

interface HeaderMilestonesCollapseProps {
    project: string;
    workHeaderDocName: string;
    zones: string[];
    isEditing: boolean;
    onDirtyChange?: (headerDocName: string, dirty: boolean) => void;
}

export const HeaderMilestonesCollapse = forwardRef<
    HeaderMilestonesCollapseHandle,
    HeaderMilestonesCollapseProps
>(({ project, workHeaderDocName, zones, isEditing, onDirtyChange }, ref) => {
    const { data, error, isLoading, mutate } = useFrappeGetCall<HeaderMilestonesPreviewResponse>(
        "nirmaan_stack.api.milestone.get_header_milestones_preview.get_header_milestones_preview",
        {
            project,
            work_header: workHeaderDocName,
        },
        project && workHeaderDocName ? undefined : null
    );

    const { call: seedHeaderMilestones } = useFrappePostCall(
        "nirmaan_stack.api.milestone.get_header_milestones_preview.seed_header_milestones"
    );

    const payload = data?.message;
    const milestones = useMemo(() => payload?.milestones || [], [payload]);
    const fromReport = payload?.source === "report";
    const dprName = payload?.report_name;

    const initialSelected = useMemo(
        () =>
            new Set(
                milestones
                    .filter((m) => m.status !== "Disabled")
                    .map((m) => m.work_milestone_name)
            ),
        [milestones]
    );

    const [selected, setSelected] = useState<Set<string>>(initialSelected);

    useEffect(() => {
        setSelected(initialSelected);
    }, [initialSelected]);

    // Reset local selection when leaving edit mode (cancel path handled by parent).
    useEffect(() => {
        if (!isEditing) setSelected(initialSelected);
    }, [isEditing, initialSelected]);

    // True only when the user actually toggled something from the loaded
    // baseline. Used for the per-header Reset affordance.
    const hasLocalChanges = useMemo(() => {
        if (selected.size !== initialSelected.size) return true;
        for (const n of selected) if (!initialSelected.has(n)) return true;
        return false;
    }, [selected, initialSelected]);

    const hasChanges = useMemo(() => {
        // Master mode always needs a save (first-time seed into a new report).
        if (payload && !fromReport && milestones.length > 0) return true;
        return hasLocalChanges;
    }, [payload, fromReport, milestones.length, hasLocalChanges]);

    useEffect(() => {
        onDirtyChange?.(workHeaderDocName, hasChanges);
        return () => {
            onDirtyChange?.(workHeaderDocName, false);
        };
    }, [hasChanges, workHeaderDocName, onDirtyChange]);

    useImperativeHandle(
        ref,
        () => ({
            hasChanges: () => hasChanges,
            cancel: () => setSelected(initialSelected),
            save: async () => {
                if (!hasChanges) return;
                await seedHeaderMilestones({
                    project,
                    work_header: workHeaderDocName,
                    zones,
                    active_milestone_names: Array.from(selected),
                });
                await mutate();
            },
        }),
        [
            hasChanges,
            selected,
            project,
            workHeaderDocName,
            zones,
            seedHeaderMilestones,
            mutate,
        ]
    );

    const toggle = (name: string, checked: boolean) => {
        if (!isEditing) return;
        setSelected((prev) => {
            const next = new Set(prev);
            if (checked) next.add(name);
            else next.delete(name);
            return next;
        });
    };

    if (isLoading) {
        return (
            <div className="flex items-center gap-2 px-6 py-3 text-xs text-gray-500">
                <TailSpin width={14} height={14} color="#9ca3af" />
                Loading milestones...
            </div>
        );
    }

    if (error) {
        return (
            <div className="px-6 py-3 text-xs text-red-600">
                Failed to load milestones for this header.
            </div>
        );
    }

    if (milestones.length === 0) {
        return (
            <div className="px-6 py-3 text-xs text-gray-500 italic">
                No milestones defined under this header.
            </div>
        );
    }

    return (
        <div className="px-6 py-3 bg-gray-50/40 border-t border-gray-100">
            <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">
                    {fromReport
                        ? `From latest completed report${payload?.report_zone ? ` — ${payload.report_zone}` : ""}${payload?.report_date ? ` (${payload.report_date})` : ""}`
                        : "From master"}
                </p>
                <div className="flex items-center gap-2">
                    <span className="text-[11px] text-gray-400">
                        {selected.size} of {milestones.length} selected
                    </span>
                    {isEditing && hasLocalChanges && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-[11px] text-gray-600 hover:text-gray-900"
                            onClick={() => setSelected(initialSelected)}
                            title="Revert this header's milestones to its last saved state"
                        >
                            <RotateCcw className="h-3 w-3 mr-1" />
                            Reset
                        </Button>
                    )}
                </div>
            </div>

            <ul className="space-y-1.5">
                {milestones.map((m) => {
                    const checked = selected.has(m.work_milestone_name);
                    const isNewFromMaster = Boolean(m.is_new_from_master);
                    return (
                        <li
                            key={m.name}
                            className={`flex items-center gap-3 text-sm ${checked ? "" : "opacity-60"}`}
                        >
                            <Checkbox
                                checked={checked}
                                disabled={!isEditing}
                                onCheckedChange={(c) => toggle(m.work_milestone_name, Boolean(c))}
                            />
                            <span className="flex-1 text-gray-800 break-words flex items-center gap-2 flex-wrap">
                                {m.work_milestone_name}
                                {isNewFromMaster && (
                                    <span
                                        className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200"
                                        title="Not yet in any completed report — will be added on Save"
                                    >
                                        From Master
                                    </span>
                                )}
                            </span>
                            {fromReport ? (
                                <Badge
                                    variant="secondary"
                                    className={`${getStatusBadgeClasses(m.status)} text-[11px] flex-shrink-0`}
                                >
                                    {m.status}
                                </Badge>
                            ) : (
                                <span className="text-[11px] text-gray-400 flex-shrink-0">master</span>
                            )}
                        </li>
                    );
                })}
            </ul>
        </div>
    );
});

HeaderMilestonesCollapse.displayName = "HeaderMilestonesCollapse";

export default HeaderMilestonesCollapse;

// Toast helpers re-exported for parents that want consistent messaging.
export const toastSuccess = (description: string) =>
    toast({ title: "Saved", description, variant: "success" });
