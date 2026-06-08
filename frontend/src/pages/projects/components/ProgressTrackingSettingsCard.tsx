// Self-contained Progress Tracking settings card.
// Mounted in both ProjectWorkReportTab and ProjectScheduler so both tabs share
// the same setup wizard, zones editor, and work-headers + milestone editor.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Projects, ProjectZoneEntry } from "@/types/NirmaanStack/Projects";
import { FrappeDoc } from "frappe-react-sdk";
import type { KeyedMutator } from "swr";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/components/ui/use-toast";
import { TailSpin } from "react-loader-spinner";
import { Pencil, Check, ChevronDown, ChevronUp, Settings } from "lucide-react";

import { SetupProgressTrackingDialog } from "./SetupProgressTrackingDialog";
import { ProjectZoneEditSection } from "./projectZoneEditSection";
import { HeaderMilestonesCollapse, HeaderMilestonesCollapseHandle } from "./HeaderMilestonesCollapse";
import { useProjectWorkReportApi } from "../data/tab/work-report/useProjectWorkReportTabApi";
import { useWorkHeaderOrder } from "@/hooks/useWorkHeaderOrder";
import {
    toBoolean,
    getLinkedWorkHeaderName,
    generateCombinedHeaders,
    LocalProjectWorkHeaderEntry,
} from "../data/tab/work-report/projectTrackingHelpers";

interface ProjectsWithZones extends Projects {
    project_zones: ProjectZoneEntry[];
}

export interface ProgressTrackingSettingsCardProps {
    projectData: Projects;
    project_mutate: KeyedMutator<FrappeDoc<Projects>>;
    current_role: string;
    /** Optional callback fired after wizard or unified-save completes. Use this from the
     *  Schedule tab to refetch the Project Schedule doc. */
    onAfterSave?: () => Promise<void> | void;
    /** Card heading. Defaults to "Progress Tracking"; the Schedule tab passes "Project Schedule". */
    title?: string;
}

export const ProgressTrackingSettingsCard: React.FC<ProgressTrackingSettingsCardProps> = ({
    projectData,
    project_mutate,
    current_role,
    onAfterSave,
    title = "Progress Tracking",
}) => {
    const projectDataWithZones = projectData as ProjectsWithZones;

    const [isSetupDialogOpen, setIsSetupDialogOpen] = useState(false);
    const [localWorkHeaders, setLocalWorkHeaders] = useState<LocalProjectWorkHeaderEntry[]>([]);
    const [isEditingHeaders, setIsEditingHeaders] = useState(false);
    const [isEditingZones, setIsEditingZones] = useState(false);
    const [isSettingsExpanded, setIsSettingsExpanded] = useState(false);
    const [expandedHeaderIds, setExpandedHeaderIds] = useState<Set<string>>(new Set());
    // Tracks which header collapses are mounted during the current edit
    // session. Once mounted, a collapse stays mounted even if the user
    // toggles its chevron — preserving in-progress checkbox changes across
    // collapse/expand. Reset whenever edit mode exits.
    const [mountedDuringEditIds, setMountedDuringEditIds] = useState<Set<string>>(new Set());
    const [dirtyHeaderIds, setDirtyHeaderIds] = useState<Set<string>>(new Set());
    const [savingUnified, setSavingUnified] = useState(false);
    const collapseRefs = useRef<Map<string, HeaderMilestonesCollapseHandle>>(new Map());

    const isMilestoneTrackingEnabled = Boolean(projectData.enable_project_milestone_tracking);

    const { updateProjectDoc, updateDocLoading, allWorkHeadersResponse } = useProjectWorkReportApi();
    const { data: allWorkHeaders, isLoading: allWorkHeadersLoading } = allWorkHeadersResponse;
    const { workHeaderOrderMap } = useWorkHeaderOrder();

    // Initialize local work headers
    useEffect(() => {
        if (allWorkHeaders && projectData) {
            setLocalWorkHeaders(generateCombinedHeaders(projectData, allWorkHeaders, toBoolean, getLinkedWorkHeaderName));
        } else if (!projectData) {
            setLocalWorkHeaders([]);
        }
    }, [projectData, allWorkHeaders]);

    const handleCheckboxChange = useCallback((docName: string, checked: boolean | "indeterminate") => {
        setLocalWorkHeaders((prevHeaders) => {
            const index = prevHeaders.findIndex((h) => h.work_header_doc_name === docName);
            if (index === -1) return prevHeaders;
            const newHeaders = [...prevHeaders];
            newHeaders[index] = { ...newHeaders[index], enabled: checked as boolean };
            return newHeaders;
        });
    }, []);

    const persistHeaders = useCallback(async () => {
        const headersToSave = localWorkHeaders
            .filter((entry) => entry.enabled)
            .map((entry) => ({
                name: entry.name,
                project_work_header_name: entry.work_header_doc_name,
                enabled: true,
            }));
        await updateProjectDoc(projectData.name, {
            project_work_header_entries: headersToSave,
        });
        await project_mutate();
    }, [localWorkHeaders, projectData?.name, updateProjectDoc, project_mutate]);

    const handleCancelEdit = useCallback(() => {
        if (allWorkHeaders && projectData) {
            setLocalWorkHeaders(generateCombinedHeaders(projectData, allWorkHeaders, toBoolean, getLinkedWorkHeaderName));
        } else {
            setLocalWorkHeaders([]);
        }
        collapseRefs.current.forEach((h) => h.cancel());
        setDirtyHeaderIds(new Set());
        setIsEditingHeaders(false);
    }, [projectData, allWorkHeaders]);

    const isSaveDisabledHeaders = useMemo(() => {
        const currentEnabledHeaderDocIds = new Set(
            localWorkHeaders.filter((entry) => entry.enabled).map((entry) => entry.work_header_doc_name)
        );
        const originalEnabledHeaderDocIds = new Set(
            (projectData?.project_work_header_entries || [])
                .filter((entry) => toBoolean(entry.enabled))
                .map((entry) => getLinkedWorkHeaderName(entry))
                .filter(Boolean) as string[]
        );
        if (currentEnabledHeaderDocIds.size !== originalEnabledHeaderDocIds.size) return false;
        for (const id of currentEnabledHeaderDocIds) {
            if (!originalEnabledHeaderDocIds.has(id)) return false;
        }
        return true;
    }, [localWorkHeaders, projectData?.project_work_header_entries]);

    const handleUnifiedSave = useCallback(async () => {
        const headerDirty = !isSaveDisabledHeaders;
        const milestoneDirty = dirtyHeaderIds.size > 0;
        if (!headerDirty && !milestoneDirty) {
            setIsEditingHeaders(false);
            return;
        }
        setSavingUnified(true);
        try {
            if (headerDirty) await persistHeaders();
            if (milestoneDirty) {
                const stillEnabled = new Set(
                    localWorkHeaders.filter((h) => h.enabled).map((h) => h.work_header_doc_name)
                );
                for (const id of dirtyHeaderIds) {
                    if (!stillEnabled.has(id)) continue;
                    const handle = collapseRefs.current.get(id);
                    if (handle && handle.hasChanges()) {
                        await handle.save();
                    }
                }
            }
            toast({ title: "Saved", description: "Headers and milestones updated.", variant: "success" });
            setDirtyHeaderIds(new Set());
            setIsEditingHeaders(false);
            if (onAfterSave) await onAfterSave();
        } catch (e: any) {
            toast({
                title: "Save Failed",
                description: e?.message || "Could not save changes.",
                variant: "destructive",
            });
        } finally {
            setSavingUnified(false);
        }
    }, [isSaveDisabledHeaders, dirtyHeaderIds, persistHeaders, localWorkHeaders, onAfterSave]);

    // Group by package, then within each package sort headers by their numeric
    // `order` field (Work Headers.order) so the layout matches the schedule
    // grid and milestones summary. Packages themselves are ordered by the
    // smallest header `order` they contain — i.e. whichever package owns the
    // earliest-ordered header appears first.
    const groupedWorkHeaders = useMemo(() => {
        const groups = new Map<string, LocalProjectWorkHeaderEntry[]>();
        localWorkHeaders.forEach((header) => {
            const packageLink = header.work_package_link;
            if (!groups.has(packageLink)) groups.set(packageLink, []);
            groups.get(packageLink)!.push(header);
        });
        groups.forEach((headers) => {
            headers.sort((a, b) => {
                const orderA = workHeaderOrderMap[a.work_header_doc_name] ?? 9999;
                const orderB = workHeaderOrderMap[b.work_header_doc_name] ?? 9999;
                if (orderA !== orderB) return orderA - orderB;
                return a.work_header_display_name.localeCompare(b.work_header_display_name);
            });
        });
        const minOrder = (headers: LocalProjectWorkHeaderEntry[]) =>
            headers.reduce(
                (m, h) => Math.min(m, workHeaderOrderMap[h.work_header_doc_name] ?? 9999),
                9999,
            );
        return Array.from(groups.entries()).sort(([pkgA, hA], [pkgB, hB]) => {
            const orderA = minOrder(hA);
            const orderB = minOrder(hB);
            if (orderA !== orderB) return orderA - orderB;
            return pkgA.localeCompare(pkgB);
        });
    }, [localWorkHeaders, workHeaderOrderMap]);

    const enabledHeadersCount = localWorkHeaders.filter((h) => h.enabled).length;

    const toggleHeaderExpanded = useCallback((docName: string) => {
        setExpandedHeaderIds((prev) => {
            const next = new Set(prev);
            if (next.has(docName)) next.delete(docName);
            else next.add(docName);
            return next;
        });
    }, []);

    const registerCollapseRef = useCallback(
        (docName: string) => (handle: HeaderMilestonesCollapseHandle | null) => {
            if (handle) collapseRefs.current.set(docName, handle);
            else collapseRefs.current.delete(docName);
        },
        []
    );

    const handleCollapseDirtyChange = useCallback((docName: string, dirty: boolean) => {
        setDirtyHeaderIds((prev) => {
            const has = prev.has(docName);
            if (dirty === has) return prev;
            const next = new Set(prev);
            if (dirty) next.add(docName);
            else next.delete(docName);
            return next;
        });
    }, []);

    const enabledHeaderIds = useMemo(
        () => localWorkHeaders.filter((h) => h.enabled).map((h) => h.work_header_doc_name),
        [localWorkHeaders]
    );

    const projectZoneNames = useMemo(
        () =>
            (projectDataWithZones?.project_zones || [])
                .map((z: any) => z.zone_name)
                .filter(Boolean),
        [projectDataWithZones?.project_zones]
    );

    const handleStartEdit = useCallback(() => {
        setIsEditingHeaders(true);
        setExpandedHeaderIds(new Set(enabledHeaderIds));
    }, [enabledHeaderIds]);

    // Auto-expand newly-enabled headers during edit so their milestones become editable.
    useEffect(() => {
        if (!isEditingHeaders) {
            // Leaving edit mode: drop the "keep mounted" set so view mode
            // can lazy-mount fresh on expand.
            setMountedDuringEditIds(new Set());
            return;
        }
        setExpandedHeaderIds((prev) => {
            const next = new Set(prev);
            for (const id of enabledHeaderIds) next.add(id);
            return next;
        });
    }, [isEditingHeaders, enabledHeaderIds]);

    // While editing, accumulate every header that has been expanded at least
    // once so its collapse stays mounted (and retains in-progress selection)
    // even if the user toggles its chevron closed.
    useEffect(() => {
        if (!isEditingHeaders) return;
        setMountedDuringEditIds((prev) => {
            let changed = false;
            const next = new Set(prev);
            for (const id of expandedHeaderIds) {
                if (!next.has(id)) {
                    next.add(id);
                    changed = true;
                }
            }
            return changed ? next : prev;
        });
    }, [isEditingHeaders, expandedHeaderIds]);

    const handleSetupSuccess = async () => {
        await project_mutate();
        if (onAfterSave) await onAfterSave();
        setIsSetupDialogOpen(false);
    };

    const hasAdminAccess = ["Nirmaan Admin Profile", "Nirmaan PMO Executive Profile", "Nirmaan Project Lead Profile"].includes(
        current_role
    );

    if (!hasAdminAccess) return null;

    if (allWorkHeadersLoading) {
        return (
            <div className="flex justify-center items-center h-16">
                <TailSpin width={20} height={20} color="#6b7280" />
            </div>
        );
    }

    return (
        <>
            <div className="border border-gray-200 rounded bg-white mb-4">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                    <div className="flex items-center gap-3">
                        <Settings className="h-4 w-4 text-gray-400" />
                        <div>
                            <h3 className="text-sm font-medium text-gray-900">{title}</h3>
                            <p className="text-xs text-gray-500">
                                {isMilestoneTrackingEnabled ? "Enabled" : "Not configured"}
                            </p>
                        </div>
                    </div>

                    {!isMilestoneTrackingEnabled ? (
                        <Button
                            size="sm"
                            onClick={() => setIsSetupDialogOpen(true)}
                            className="h-8 bg-sky-500 hover:bg-sky-600 text-white"
                        >
                            Setup
                        </Button>
                    ) : (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setIsSettingsExpanded(!isSettingsExpanded)}
                            className="h-8 text-gray-600"
                        >
                            {isSettingsExpanded ? (
                                <>
                                    <ChevronUp className="h-4 w-4 mr-1" /> Hide
                                </>
                            ) : (
                                <>
                                    <ChevronDown className="h-4 w-4 mr-1" /> Settings
                                </>
                            )}
                        </Button>
                    )}
                </div>

                {/* Expandable Section */}
                {isMilestoneTrackingEnabled && isSettingsExpanded && (
                    <div className="px-4 py-4 space-y-6">
                        {/* Zones */}
                        <ProjectZoneEditSection
                            projectData={projectDataWithZones}
                            isEditing={isEditingZones}
                            setIsEditing={setIsEditingZones}
                            project_mutate={project_mutate as any}
                            isEditingHeaders={isEditingHeaders}
                        />

                        <div className="border-t border-gray-200" />

                        {/* Work Headers */}
                        <div>
                            <div className="flex items-center justify-between mb-3">
                                <div>
                                    <h3 className="text-sm font-medium text-gray-900">Work Headers</h3>
                                    <p className="text-xs text-gray-500 mt-0.5">
                                        {enabledHeadersCount} of {localWorkHeaders.length} enabled
                                    </p>
                                </div>

                                <div className="flex items-center gap-2">
                                    {isEditingHeaders ? (
                                        <>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={handleCancelEdit}
                                                disabled={savingUnified || updateDocLoading}
                                                className="h-8 text-gray-600"
                                            >
                                                Cancel
                                            </Button>
                                            <Button
                                                size="sm"
                                                onClick={handleUnifiedSave}
                                                disabled={
                                                    savingUnified ||
                                                    updateDocLoading ||
                                                    (isSaveDisabledHeaders && dirtyHeaderIds.size === 0)
                                                }
                                                className="h-8 bg-emerald-500 hover:bg-emerald-600 text-white"
                                            >
                                                {savingUnified || updateDocLoading ? (
                                                    <TailSpin width={14} height={14} color="white" />
                                                ) : (
                                                    <>
                                                        <Check className="h-3.5 w-3.5 mr-1" /> Save
                                                    </>
                                                )}
                                            </Button>
                                        </>
                                    ) : (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={handleStartEdit}
                                            disabled={isEditingZones}
                                            className="h-8"
                                        >
                                            <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
                                        </Button>
                                    )}
                                </div>
                            </div>

                            <div className="border border-gray-200 rounded max-h-96 overflow-y-auto">
                                {groupedWorkHeaders.map(([packageName, headers], groupIdx) => (
                                    <div key={packageName} className={groupIdx > 0 ? "border-t border-gray-200" : ""}>
                                        <div className="px-3 py-2 bg-gray-50 sticky top-0 z-[1]">
                                            <span className="text-xs font-medium text-gray-600 uppercase tracking-wide">
                                                {packageName}
                                            </span>
                                        </div>
                                        <div className="divide-y divide-gray-100">
                                            {headers.map((entry) => {
                                                const isExpanded = expandedHeaderIds.has(entry.work_header_doc_name);
                                                const canExpand = entry.enabled;
                                                const canToggleExpand = canExpand;
                                                const shouldMount =
                                                    canExpand &&
                                                    (isExpanded ||
                                                        (isEditingHeaders &&
                                                            mountedDuringEditIds.has(entry.work_header_doc_name)));
                                                return (
                                                    <div key={entry.work_header_doc_name}>
                                                        <div className="flex items-center gap-2 px-3 py-2">
                                                            {isEditingHeaders ? (
                                                                <Checkbox
                                                                    checked={entry.enabled}
                                                                    onCheckedChange={(checked) =>
                                                                        handleCheckboxChange(entry.work_header_doc_name, checked)
                                                                    }
                                                                    disabled={isEditingZones}
                                                                />
                                                            ) : (
                                                                <span
                                                                    className={`h-4 w-4 rounded-sm border flex items-center justify-center flex-shrink-0 ${
                                                                        entry.enabled
                                                                            ? "bg-emerald-500 border-emerald-500"
                                                                            : "bg-gray-100 border-gray-300"
                                                                    }`}
                                                                >
                                                                    {entry.enabled && <Check className="h-3 w-3 text-white" />}
                                                                </span>
                                                            )}

                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    canToggleExpand && toggleHeaderExpanded(entry.work_header_doc_name)
                                                                }
                                                                disabled={!canToggleExpand}
                                                                className={`flex-1 flex items-center justify-between text-left ${
                                                                    canToggleExpand ? "cursor-pointer" : "cursor-default"
                                                                }`}
                                                            >
                                                                <span
                                                                    className={`text-sm ${
                                                                        entry.enabled ? "text-gray-900" : "text-gray-500"
                                                                    }`}
                                                                >
                                                                    {entry.work_header_display_name}
                                                                </span>
                                                                {canExpand &&
                                                                    (isExpanded ? (
                                                                        <ChevronUp className="h-4 w-4 text-gray-500" />
                                                                    ) : (
                                                                        <ChevronDown className="h-4 w-4 text-gray-500" />
                                                                    ))}
                                                            </button>
                                                        </div>

                                                        {shouldMount && (
                                                            <div style={{ display: isExpanded ? undefined : "none" }}>
                                                                <HeaderMilestonesCollapse
                                                                    ref={registerCollapseRef(entry.work_header_doc_name)}
                                                                    project={projectData.name}
                                                                    workHeaderDocName={entry.work_header_doc_name}
                                                                    zones={projectZoneNames}
                                                                    isEditing={isEditingHeaders}
                                                                    onDirtyChange={handleCollapseDirtyChange}
                                                                />
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Setup Dialog */}
            <SetupProgressTrackingDialog
                projectData={projectDataWithZones}
                allWorkHeaders={allWorkHeaders || []}
                allWorkHeadersLoading={allWorkHeadersLoading}
                isOpen={isSetupDialogOpen}
                onClose={() => setIsSetupDialogOpen(false)}
                onSuccess={handleSetupSuccess}
                generateCombinedHeaders={generateCombinedHeaders as any}
                toBoolean={toBoolean as any}
                getLinkedWorkHeaderName={getLinkedWorkHeaderName as any}
            />
        </>
    );
};

export default ProgressTrackingSettingsCard;
