// src/pages/projects/ProjectWorkReportTab.tsx
import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Projects, ProjectWorkHeaderEntry, ProjectZoneEntry } from "@/types/NirmaanStack/Projects";
import { FrappeDoc } from "frappe-react-sdk";
import type { KeyedMutator } from "swr";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/components/ui/use-toast";
import { TailSpin } from "react-loader-spinner";
import { MilestonesSummary } from "../Manpower-and-WorkMilestones/MilestonesSummary";
import { Pencil, Check, ChevronDown, ChevronUp, Settings } from "lucide-react";

import { SetupProgressTrackingDialog } from "./components/SetupProgressTrackingDialog";
import { ProjectZoneEditSection } from "./components/projectZoneEditSection";
import { HeaderMilestonesCollapse, HeaderMilestonesCollapseHandle } from "./components/HeaderMilestonesCollapse";
import { useProjectWorkReportApi } from "./data/tab/work-report/useProjectWorkReportTabApi";
import type { WorkHeaderDoc } from "./data/tab/work-report/useProjectWorkReportTabApi";

interface ProjectWorkReportTabProps {
    projectData: Projects;
    project_mutate: KeyedMutator<FrappeDoc<Projects>>;
    current_role: string;
}

interface LocalProjectWorkHeaderEntry {
    work_header_doc_name: string;
    work_header_display_name: string;
    work_package_link: string;
    enabled: boolean;
    name?: string;
}

interface ProjectsWithZones extends Projects {
    project_zones: ProjectZoneEntry[];
}

export const ProjectWorkReportTab: React.FC<ProjectWorkReportTabProps> = ({
    projectData,
    project_mutate,
    current_role
}) => {
    const projectDataWithZones = projectData as ProjectsWithZones;

    const [isSetupDialogOpen, setIsSetupDialogOpen] = useState(false);
    const [localWorkHeaders, setLocalWorkHeaders] = useState<LocalProjectWorkHeaderEntry[]>([]);
    const [isEditingHeaders, setIsEditingHeaders] = useState(false);
    const [isEditingZones, setIsEditingZones] = useState(false);
    const [isSettingsExpanded, setIsSettingsExpanded] = useState(false);
    const [selectedZone, setSelectedZone] = useState<string | null>(null);
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

    // Initialize selectedZone to first zone when project zones are available
    useEffect(() => {
        if (projectDataWithZones?.project_zones?.length > 0 && selectedZone === null) {
            setSelectedZone(projectDataWithZones.project_zones[0].zone_name);
        }
        if (!projectDataWithZones?.project_zones?.length) {
            setSelectedZone(null);
        }
    }, [projectDataWithZones?.project_zones, selectedZone]);

    // Fetch all available Work Headers
    const { data: allWorkHeaders, isLoading: allWorkHeadersLoading, error: allWorkHeadersError } = allWorkHeadersResponse;

    // Utility callbacks
    const toBoolean = useCallback((val: boolean | string | "True" | "False" | undefined | null): boolean => {
        if (typeof val === "boolean") return val;
        if (typeof val === "string") return val.toLowerCase() === "true";
        return false;
    }, []);

    const getLinkedWorkHeaderName = useCallback((entry: ProjectWorkHeaderEntry): string | null => {
        if (typeof entry.project_work_header_name === "string") {
            return entry.project_work_header_name;
        }
        if (typeof entry.project_work_header_name === "object" && (entry.project_work_header_name as any)?.name) {
            return (entry.project_work_header_name as any).name;
        }
        return null;
    }, []);

    const generateCombinedHeaders = useCallback((
        projectData: Projects,
        allWorkHeaders: WorkHeaderDoc[],
        toBoolean: (val: any) => boolean,
        getLinkedWorkHeaderName: (entry: ProjectWorkHeaderEntry) => string | null
    ): LocalProjectWorkHeaderEntry[] => {
        const projectEnabledWorkHeadersMap = new Map<string, ProjectWorkHeaderEntry>();
        if (projectData.project_work_header_entries) {
            projectData.project_work_header_entries.forEach((entry) => {
                const linkedName = getLinkedWorkHeaderName(entry);
                if (linkedName) {
                    projectEnabledWorkHeadersMap.set(linkedName, { ...entry, enabled: toBoolean(entry.enabled) });
                }
            });
        }

        const combinedHeaders: LocalProjectWorkHeaderEntry[] = (allWorkHeaders || []).map((masterHeader) => {
            const masterHeaderDocName = masterHeader.name;
            const masterHeaderDisplayName = masterHeader.work_header_name;
            const masterHeaderWorkPackageLink = masterHeader.work_package_link || "General Work Package";

            const existingEntry = projectEnabledWorkHeadersMap.get(masterHeaderDocName);

            return {
                work_header_doc_name: masterHeaderDocName,
                work_header_display_name: masterHeaderDisplayName,
                work_package_link: masterHeaderWorkPackageLink,
                enabled: existingEntry ? existingEntry.enabled : false,
                name: existingEntry ? existingEntry.name : undefined,
            };
        });

        combinedHeaders.sort((a, b) =>
            a.work_package_link.localeCompare(b.work_package_link) ||
            a.work_header_display_name.localeCompare(b.work_header_display_name)
        );

        return combinedHeaders;
    }, []);

    // Initialize local work headers
    useEffect(() => {
        if (allWorkHeaders && projectData) {
            setLocalWorkHeaders(generateCombinedHeaders(projectData, allWorkHeaders, toBoolean, getLinkedWorkHeaderName));
        } else if (!projectData) {
            setLocalWorkHeaders([]);
        }
    }, [projectData, allWorkHeaders, toBoolean, getLinkedWorkHeaderName, generateCombinedHeaders]);

    // Work Header handlers
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
    }, [projectData, allWorkHeaders, toBoolean, getLinkedWorkHeaderName, generateCombinedHeaders]);

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

        if (currentEnabledHeaderDocIds.size !== originalEnabledHeaderDocIds.size) {
            return false;
        }

        for (const id of currentEnabledHeaderDocIds) {
            if (!originalEnabledHeaderDocIds.has(id)) {
                return false;
            }
        }
        return true;
    }, [localWorkHeaders, projectData?.project_work_header_entries, toBoolean, getLinkedWorkHeaderName]);

    const handleUnifiedSave = useCallback(async () => {
        const headerDirty = !isSaveDisabledHeaders;
        const milestoneDirty = dirtyHeaderIds.size > 0;

        if (!headerDirty && !milestoneDirty) {
            setIsEditingHeaders(false);
            return;
        }

        setSavingUnified(true);
        try {
            if (headerDirty) {
                await persistHeaders();
            }

            if (milestoneDirty) {
                // Only save milestones for headers still enabled after header save.
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

            toast({
                title: "Saved",
                description: "Headers and milestones updated.",
                variant: "success",
            });
            setDirtyHeaderIds(new Set());
            setIsEditingHeaders(false);
        } catch (e: any) {
            toast({
                title: "Save Failed",
                description: e?.message || "Could not save changes.",
                variant: "destructive",
            });
        } finally {
            setSavingUnified(false);
        }
    }, [isSaveDisabledHeaders, dirtyHeaderIds, persistHeaders, localWorkHeaders]);

    // Group work headers by package
    const groupedWorkHeaders = useMemo(() => {
        const groups = new Map<string, LocalProjectWorkHeaderEntry[]>();
        localWorkHeaders.forEach((header) => {
            const packageLink = header.work_package_link;
            if (!groups.has(packageLink)) {
                groups.set(packageLink, []);
            }
            groups.get(packageLink)!.push(header);
        });
        return Array.from(groups.entries());
    }, [localWorkHeaders]);

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
        setIsSetupDialogOpen(false);
    };

    // Loading state
    if (allWorkHeadersLoading) {
        return (
            <div className="flex justify-center items-center h-40">
                <TailSpin width={32} height={32} color="#6b7280" />
            </div>
        );
    }

    if (allWorkHeadersError) {
        return (
            <div className="p-4 text-center">
                <p className="text-sm text-red-600">Error loading work headers: {allWorkHeadersError.message}</p>
            </div>
        );
    }

    if (!projectDataWithZones.project_zones || allWorkHeaders === undefined) {
        return (
            <div className="p-4 text-center">
                <p className="text-sm text-gray-500">Initializing...</p>
            </div>
        );
    }

    const hasAdminAccess = ["Nirmaan Admin Profile", "Nirmaan PMO Executive Profile", "Nirmaan Project Lead Profile"].includes(current_role);

    return (
        <>
            {/* Settings Card - Only visible to admins */}
            {hasAdminAccess && (
                <div className="border border-gray-200 rounded bg-white mb-4">
                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                        <div className="flex items-center gap-3">
                            <Settings className="h-4 w-4 text-gray-400" />
                            <div>
                                <h3 className="text-sm font-medium text-gray-900">Progress Tracking</h3>
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

                    {/* Expandable Settings Section */}
                    {isMilestoneTrackingEnabled && isSettingsExpanded && (
                        <div className="px-4 py-4 space-y-6">
                            {/* Zones Section */}
                            <ProjectZoneEditSection
                                projectData={projectDataWithZones}
                                isEditing={isEditingZones}
                                setIsEditing={setIsEditingZones}
                                project_mutate={project_mutate as any}
                                isEditingHeaders={isEditingHeaders}
                            />

                            {/* Divider */}
                            <div className="border-t border-gray-200" />

                            {/* Work Headers Section */}
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

                                {/* Work Headers List */}
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
                                                    // Collapse is visible whenever the header is enabled (whether editing or not).
                                                    const canExpand = entry.enabled;
                                                    const canToggleExpand = canExpand;
                                                    // During edit, keep the collapse mounted once expanded so local
                                                    // checkbox state survives chevron toggles. Outside edit, mount only
                                                    // while expanded (lazy).
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
                                                                    {canExpand && (
                                                                        isExpanded ? (
                                                                            <ChevronUp className="h-4 w-4 text-gray-500" />
                                                                        ) : (
                                                                            <ChevronDown className="h-4 w-4 text-gray-500" />
                                                                        )
                                                                    )}
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
            )}

            {/* Zone Selector - Only show if tracking is enabled and zones exist */}
            {/* {isMilestoneTrackingEnabled && Boolean(projectDataWithZones?.project_zones?.length) && (
                <div className="border border-gray-200 rounded bg-white mb-4">
                    <div className="flex items-center gap-3 px-4 py-3">
                        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide flex-shrink-0">
                            Zone
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                            {projectDataWithZones.project_zones.map((zone) => (
                                <button
                                    key={zone.zone_name}
                                    type="button"
                                    onClick={() => setSelectedZone(zone.zone_name)}
                                    disabled={isEditingZones || isEditingHeaders}
                                    className={`px-3 py-1.5 text-sm rounded transition-colors ${
                                        selectedZone === zone.zone_name
                                            ? "bg-sky-500 text-white"
                                            : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                                >
                                    {zone.zone_name}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )} */}

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

            {/* Milestone Summary */}
            {isMilestoneTrackingEnabled && Boolean(projectDataWithZones?.project_zones?.length) && (
                <MilestonesSummary
                    workReport={true}
                    projectIdForWorkReport={projectData?.name}
                    // parentSelectedZone={selectedZone as any}
                />
            )}
        </>
    );
};
