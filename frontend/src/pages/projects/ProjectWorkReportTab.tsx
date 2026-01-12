// src/pages/projects/ProjectWorkReportTab.tsx
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Projects, ProjectWorkHeaderEntry, ProjectZoneEntry } from "@/types/NirmaanStack/Projects";
import { FrappeDoc, useFrappeUpdateDoc, useFrappeGetDocList } from "frappe-react-sdk";
import type { KeyedMutator } from "swr";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/components/ui/use-toast";
import { TailSpin } from "react-loader-spinner";
import { MilestonesSummary } from "../Manpower-and-WorkMilestones/MilestonesSummary";
import { Pencil, Check, ChevronDown, ChevronUp, Settings } from "lucide-react";

import { SetupProgressTrackingDialog } from "./components/SetupProgressTrackingDialog";
import { ProjectZoneEditSection } from "./components/projectZoneEditSection";

interface ProjectWorkReportTabProps {
    projectData: Projects;
    project_mutate: KeyedMutator<FrappeDoc<Projects>>;
    current_role: string;
}

interface WorkHeaderDoc {
    name: string;
    work_package_link: string;
    work_header_name: string;
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

    const isMilestoneTrackingEnabled = Boolean(projectData.enable_project_milestone_tracking);

    const { updateDoc, loading: updateDocLoading } = useFrappeUpdateDoc();

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
    const { data: allWorkHeaders, isLoading: allWorkHeadersLoading, error: allWorkHeadersError } = useFrappeGetDocList<WorkHeaderDoc>(
        "Work Headers",
        {
            fields: ["name", "work_header_name", "work_package_link"],
            limit: 0
        }
    );

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

    const handleSaveHeaders = async () => {
        try {
            const headersToSave = localWorkHeaders
                .filter((entry) => entry.enabled)
                .map((entry) => ({
                    name: entry.name,
                    project_work_header_name: entry.work_header_doc_name,
                    enabled: true,
                }));

            await updateDoc("Projects", projectData.name, {
                project_work_header_entries: headersToSave,
            });
            await project_mutate();
            toast({
                title: "Success",
                description: "Work headers updated successfully.",
                variant: "success",
            });
            setIsEditingHeaders(false);
        } catch (error) {
            console.error("Failed to update work headers:", error);
            toast({
                title: "Error",
                description: "Failed to update work headers.",
                variant: "destructive",
            });
        }
    };

    const handleCancelHeaders = useCallback(() => {
        if (allWorkHeaders && projectData) {
            setLocalWorkHeaders(generateCombinedHeaders(projectData, allWorkHeaders, toBoolean, getLinkedWorkHeaderName));
        } else {
            setLocalWorkHeaders([]);
        }
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

                                    {isEditingHeaders ? (
                                        <div className="flex items-center gap-2">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={handleCancelHeaders}
                                                disabled={updateDocLoading}
                                                className="h-8 text-gray-600"
                                            >
                                                Cancel
                                            </Button>
                                            <Button
                                                size="sm"
                                                onClick={handleSaveHeaders}
                                                disabled={updateDocLoading || isSaveDisabledHeaders}
                                                className="h-8 bg-emerald-500 hover:bg-emerald-600 text-white"
                                            >
                                                {updateDocLoading ? (
                                                    <TailSpin width={14} height={14} color="white" />
                                                ) : (
                                                    <>
                                                        <Check className="h-3.5 w-3.5 mr-1" /> Save
                                                    </>
                                                )}
                                            </Button>
                                        </div>
                                    ) : (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setIsEditingHeaders(true)}
                                            disabled={isEditingZones}
                                            className="h-8"
                                        >
                                            <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
                                        </Button>
                                    )}
                                </div>

                                {/* Work Headers List */}
                                <div className="border border-gray-200 rounded max-h-64 overflow-y-auto">
                                    {groupedWorkHeaders.map(([packageName, headers], groupIdx) => (
                                        <div key={packageName} className={groupIdx > 0 ? "border-t border-gray-200" : ""}>
                                            <div className="px-3 py-2 bg-gray-50 sticky top-0">
                                                <span className="text-xs font-medium text-gray-600 uppercase tracking-wide">
                                                    {packageName}
                                                </span>
                                            </div>
                                            <div className="grid grid-cols-2 gap-x-4 gap-y-1 px-3 py-2">
                                                {headers.map((entry) => (
                                                    <label
                                                        key={entry.work_header_doc_name}
                                                        className={`flex items-center gap-2 py-1.5 ${isEditingHeaders ? "cursor-pointer" : ""}`}
                                                    >
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
                                                        <span className={`text-sm ${entry.enabled ? "text-gray-900" : "text-gray-500"}`}>
                                                            {entry.work_header_display_name}
                                                        </span>
                                                    </label>
                                                ))}
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
            {isMilestoneTrackingEnabled && Boolean(projectDataWithZones?.project_zones?.length) && (
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
            )}

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
            <MilestonesSummary
                workReport={true}
                projectIdForWorkReport={projectData?.name}
                parentSelectedZone={selectedZone as any}
            />
        </>
    );
};
