// src/pages/projects/components/ProjectWorkReportTab.tsx
import React, { useState, useEffect, useCallback, useMemo } from "react";
// Assuming ProjectZoneEntry type is imported from a common types file
import { Projects, ProjectWorkHeaderEntry, ProjectZoneEntry } from "@/types/NirmaanStack/Projects"; 
import { WorkHeaders } from "@/types/NirmaanStack/WorkHeaders";
import { FrappeDoc, KeyedMutator, useFrappeUpdateDoc, useFrappeGetDocList } from "frappe-react-sdk";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/use-toast";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { TailSpin } from "react-loader-spinner";
import { MilestonesSummary } from "../Manpower-and-WorkMilestones/MilestonesSummary";
import { PencilIcon, CircleCheckBig, CheckIcon, XIcon, PlusIcon, ChevronDown, ChevronUp } from "lucide-react";
import {Input} from "@/components/ui/input";

// Import the separate dialog and the new zone edit component
import { SetupProgressTrackingDialog } from "./components/SetupProgressTrackingDialog"
import { ProjectZoneEditSection } from "./components/projectZoneEditSection"; // <--- RESTORED IMPORT


interface ProjectWorkReportTabProps {
    projectData: Projects;
    project_mutate: KeyedMutator<FrappeDoc<Projects>>;
    current_role: string;
}

// Augment WorkHeaders type (Shared Type 1)
interface WorkHeaderDoc extends WorkHeaders {
    work_package_link: string;
    work_header_name: string;
}

// Local state structure for combined and grouped rendering (Shared Type 2)
interface LocalProjectWorkHeaderEntry {
    work_header_doc_name: string;
    work_header_display_name: string;
    work_package_link: string;
    enabled: boolean;
    name?: string;
}

// Augment Projects type with project_zones for consistency (Shared Type 3)
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

    // Accordion state for Track Progress section (closed by default)
    const [isProgressAccordionOpen, setIsProgressAccordionOpen] = useState(false);

    // Zone selection state (managed locally, no URL updates to avoid tab navigation issues)
    const [selectedZone, setSelectedZone] = useState<string | null>(null);

    // Note: localProjectZones state is now primarily managed inside ProjectZoneEditSection
    // The state is kept here to be passed to the child, but its management is delegated.
    // We initialize it once, and the child handles subsequent changes via its internal logic.
    // The parent's useEffect below will handle resyncing on external changes.
    const [localProjectZones, setLocalProjectZones] = useState<ProjectZoneEntry[]>(projectData.project_zones || []);

    // Convert to proper boolean to prevent React from rendering "0" when false
    const isMilestoneTrackingEnabled = Boolean(projectData.enable_project_milestone_tracking);

    const { updateDoc, loading: updateDocLoading } = useFrappeUpdateDoc();

    // Sync local zone state with project data when not editing (for initial and cancel reset)
    useEffect(() => {
        if (!isEditingZones) {
            setLocalProjectZones(projectData.project_zones || []);
        }
    }, [projectData.project_zones, isEditingZones]);

    // Initialize selectedZone to first zone when project zones are available
    useEffect(() => {
        if (projectDataWithZones?.project_zones?.length > 0 && selectedZone === null) {
            setSelectedZone(projectDataWithZones.project_zones[0].zone_name);
        }
        // Reset zone if no project zones exist
        if (!projectDataWithZones?.project_zones?.length) {
            setSelectedZone(null);
        }
    }, [projectDataWithZones?.project_zones, selectedZone]);


    // Fetch all available Work Headers
    const { data: allWorkHeaders, isLoading: allWorkHeadersLoading, error: allWorkHeadersError } = useFrappeGetDocList<WorkHeaderDoc>(
        "Work Headers",
        {
            fields: ['name', 'work_header_name', 'work_package_link'],
            limit: 0
        }
    );

    // --- Shared Utility Callbacks (Used by both main component and Dialog) ---
    const toBoolean = useCallback((val: boolean | string | "True" | "False" | undefined | null): boolean => {
        if (typeof val === 'boolean') {
            return val;
        }
        if (typeof val === 'string') {
            return val.toLowerCase() === 'true';
        }
        return false;
    }, []);

    const getLinkedWorkHeaderName = useCallback((entry: ProjectWorkHeaderEntry): string | null => {
        if (typeof entry.project_work_header_name === 'string') {
            return entry.project_work_header_name;
        }
        if (typeof entry.project_work_header_name === 'object' && (entry.project_work_header_name as any)?.name) {
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
            projectData.project_work_header_entries.forEach(entry => {
                const linkedName = getLinkedWorkHeaderName(entry);
                if (linkedName) {
                    projectEnabledWorkHeadersMap.set(linkedName, { ...entry, enabled: toBoolean(entry.enabled) });
                }
            });
        }

        const combinedHeaders: LocalProjectWorkHeaderEntry[] = (allWorkHeaders || []).map(masterHeader => {
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
    // --- End Shared Utility Callbacks ---


    // Initialize local work headers
    useEffect(() => {
        if (allWorkHeaders && projectData) {
            setLocalWorkHeaders(generateCombinedHeaders(projectData, allWorkHeaders, toBoolean, getLinkedWorkHeaderName));
        } else if (!projectData) {
            setLocalWorkHeaders([]);
        }
    }, [projectData, allWorkHeaders, toBoolean, getLinkedWorkHeaderName, generateCombinedHeaders]);


    // --- Work Header Handlers (In-place editing) ---

    // Handle checkbox change by Doc Name
    const handleCheckboxChange = useCallback((docName: string, checked: boolean | "indeterminate") => {
        setLocalWorkHeaders(prevHeaders => {
            const index = prevHeaders.findIndex(h => h.work_header_doc_name === docName);
            if (index === -1) return prevHeaders;

            const newHeaders = [...prevHeaders];
            newHeaders[index] = { ...newHeaders[index], enabled: checked as boolean };
            return newHeaders;
        });
    }, []);

    // Handle Save Work Headers
    const handleSaveHeaders = async () => {
        try {
            const headersToSave = localWorkHeaders
                .filter(entry => entry.enabled)
                .map(entry => {
                    return {
                        name: entry.name,
                        project_work_header_name: entry.work_header_doc_name,
                        enabled: true,
                    };
                });

            await updateDoc("Projects", projectData.name, {
                project_work_header_entries: headersToSave,
            });
            await project_mutate();
            toast({
                title: "Success",
                description: "Work Headers updated successfully.",
                variant: "success",
            });
            setIsEditingHeaders(false);
        } catch (error) {
            console.error("Failed to update work headers:", error);
            toast({
                title: "Error",
                description: "Failed to update Work Headers.",
                variant: "destructive",
            });
        }
    };

    // Handle Cancel Work Headers
    const handleCancelHeaders = useCallback(() => {
        if (allWorkHeaders && projectData) {
            setLocalWorkHeaders(generateCombinedHeaders(projectData, allWorkHeaders, toBoolean, getLinkedWorkHeaderName));
        } else {
            setLocalWorkHeaders([]);
        }
        setIsEditingHeaders(false);
    }, [projectData, allWorkHeaders, toBoolean, getLinkedWorkHeaderName, generateCombinedHeaders]);
    
    // isSaveDisabled for Headers
    const isSaveDisabledHeaders = useMemo(() => {
        const currentEnabledHeaderDocIds = new Set(
            localWorkHeaders.filter(entry => entry.enabled)
                .map(entry => entry.work_header_doc_name)
        );

        const originalEnabledHeaderDocIds = new Set(
            (projectData?.project_work_header_entries || [])
                .filter(entry => toBoolean(entry.enabled))
                .map(entry => getLinkedWorkHeaderName(entry))
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

    // Grouping for rendering headers
    const groupedWorkHeaders = useMemo(() => {
        const groups = new Map<string, LocalProjectWorkHeaderEntry[]>();
        localWorkHeaders.forEach(header => {
            const packageLink = header.work_package_link;
            if (!groups.has(packageLink)) {
                groups.set(packageLink, []);
            }
            groups.get(packageLink)!.push(header);
        });
        return Array.from(groups.entries());
    }, [localWorkHeaders]);

    const handleSetupSuccess = async () => {
        await project_mutate();
        setIsSetupDialogOpen(false);
    };

    if (allWorkHeadersLoading) {
        return (
            <div className="flex justify-center items-center h-40">
                <TailSpin width={40} height={40} color="#007bff" />
            </div>
        );
    }

    if (allWorkHeadersError) {
        return (
            <div className="p-4 text-center text-red-600">
                Error loading available Work Headers: {allWorkHeadersError.message}
            </div>
        );
    }

    if (!projectDataWithZones.project_zones || allWorkHeaders === undefined) { 
        return (
            <div className="p-4 text-center text-gray-600">
                Initializing Work Headers list...
            </div>
        );
    }

    return (
        <>
            {["Nirmaan Admin Profile", "Nirmaan Project Lead Profile"].includes(current_role) && (
                <div className="p-4 border rounded-md shadow-sm bg-white">
                    <div className="flex items-center justify-between mb-6 pb-4 border-b">
                        <div>
                            <h3 className="text-lg font-semibold"> Track Project Progress</h3>
                            <p className="text-sm text-gray-600">
                                {isMilestoneTrackingEnabled 
                                    ? "Progress Tracking is enabled for this project" 
                                    : "Progress Tracking is disabled for this project"}
                            </p>
                        </div>
                         {!isMilestoneTrackingEnabled ? (
                            <Button onClick={() => setIsSetupDialogOpen(true)}>
                                Setup Progress Tracking
                            </Button>
                        ) : (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setIsProgressAccordionOpen(!isProgressAccordionOpen)}
                                className="flex items-center gap-2"
                            >
                                {isProgressAccordionOpen ? (
                                    <>
                                        <ChevronUp className="h-4 w-4" />
                                        Hide Settings
                                    </>
                                ) : (
                                    <>
                                        <ChevronDown className="h-4 w-4" />
                                        Show Settings
                                    </>
                                )}
                            </Button>
                        )}
                    </div>

                    {/* Work Headers and Zones Section - Only shown when tracking is enabled */}
                    {isMilestoneTrackingEnabled && (
                        <Collapsible open={isProgressAccordionOpen} onOpenChange={setIsProgressAccordionOpen}>
                            <CollapsibleContent className="space-y-4 pt-4">
                                {/* --- Zone Section --- */}
                                <ProjectZoneEditSection
                                    projectData={projectDataWithZones}
                                    isEditing={isEditingZones}
                                    setIsEditing={setIsEditingZones}
                                    project_mutate={project_mutate}
                                    isEditingHeaders={isEditingHeaders}
                                />

                                {/* --- Work Headers Section --- */}
                                <div className="flex items-center justify-between mt-6 mb-4 pt-4 border-t">
                                    <h3 className="text-lg font-semibold">Tracked Work Headers</h3>
                                    {!isEditingHeaders && (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setIsEditingHeaders(true)}
                                            disabled={isEditingZones} // Disable header edit if zones are being edited
                                        >
                                            <PencilIcon size={20} className="mr-2" /> Edit Headers
                                        </Button>
                                    )}
                                    {isEditingHeaders && (
                                        <div className="flex justify-end space-x-2">
                                            <Button variant="outline" onClick={handleCancelHeaders}>
                                                <XIcon size={24} className="mr-2 text-red-500" color="#ee2020" />Cancel
                                            </Button>
                                            <Button variant="outline" onClick={handleSaveHeaders} disabled={updateDocLoading || isSaveDisabledHeaders}>
                                                {updateDocLoading ? (
                                                    <TailSpin width={20} height={20} color="white" />
                                                ) : (
                                                    <>
                                                        <CircleCheckBig size={24} className="mr-2" color="#25ad4d" />Save
                                                    </>
                                                )}
                                            </Button>
                                        </div>
                                    )}
                                </div>

                                {/* Render grouped work headers */}
                                <div className="space-y-4">
                                    {groupedWorkHeaders.map(([workPackage, headers]) => (
                                        <div key={workPackage} className="border p-4 rounded-md bg-gray-50">
                                            <h4 className="text-md font-semibold mb-3 text-gray-800 border-b pb-2">{workPackage}</h4>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
                                                {headers.map((entry) => (
                                                    <div
                                                        key={entry.work_header_doc_name}
                                                        className="flex items-center space-x-3"
                                                    >
                                                        {isEditingHeaders ? (
                                                            <Checkbox
                                                                id={`wh-${entry.work_header_doc_name}`}
                                                                checked={entry.enabled}
                                                                onCheckedChange={(checked) => handleCheckboxChange(entry.work_header_doc_name, checked)}
                                                                disabled={isEditingZones} // Disable checkbox if zones are being edited
                                                            />
                                                        ) : (
                                                            <span className={`h-4 w-4 rounded-sm border ${entry.enabled ? 'bg-primary border-primary' : 'bg-gray-200 border-gray-300'} flex items-center justify-center flex-shrink-0`}>
                                                                {entry.enabled && <CheckIcon className="h-3 w-3 text-white" />}
                                                            </span>
                                                        )}
                                                        <Label
                                                            htmlFor={isEditingHeaders ? `wh-${entry.work_header_doc_name}` : undefined}
                                                            className={isEditingHeaders ? "cursor-pointer text-gray-700" : "text-gray-700"}
                                                        >
                                                            {entry.work_header_display_name}
                                                        </Label>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </CollapsibleContent>
                        </Collapsible>
                    )}
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

            {/* Zone Selector - Only show if tracking is enabled and zones exist */}
            {isMilestoneTrackingEnabled && Boolean(projectDataWithZones?.project_zones?.length) && (
                <div className="p-4 border rounded-md shadow-sm bg-white mt-4">
                    <div className="flex flex-col gap-4">
                        <div className="flex items-center gap-2 w-full overflow-x-auto pb-1 flex-shrink-0">
                            <span className="font-semibold text-gray-700 whitespace-nowrap flex-shrink-0 hidden md:block">
                                Select Zone:
                            </span>
                            <div className="flex rounded-md border border-gray-300 overflow-hidden flex-shrink-0">
                                {projectDataWithZones.project_zones.map((zone) => (
                                    <button
                                        key={zone.zone_name}
                                        className={`px-2 py-1 text-xs font-medium transition-colors md:text-sm md:px-3 md:py-1.5 ${
                                            selectedZone === zone.zone_name
                                                ? 'bg-blue-600 text-white shadow-inner'
                                                : 'bg-white text-blue-600 hover:bg-blue-50'
                                        }`}
                                        onClick={() => setSelectedZone(zone.zone_name)}
                                        disabled={isEditingZones || isEditingHeaders}
                                    >
                                        <span className="text-xs md:text-sm">{zone.zone_name}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Milestone Summary - Always show */}
            <MilestonesSummary
                workReport={true}
                projectIdForWorkReport={projectData?.name}
                parentSelectedZone={selectedZone}
            />
        </>
    );
};



// // src/pages/projects/components/ProjectWorkReportTab.tsx
// import React, { useState, useEffect, useCallback, useMemo } from "react";
// // Assuming ProjectZoneEntry type is imported from a common types file
// import { Projects, ProjectWorkHeaderEntry, ProjectZoneEntry } from "@/types/NirmaanStack/Projects"; 
// import { WorkHeaders } from "@/types/NirmaanStack/WorkHeaders";
// import { FrappeDoc, KeyedMutator, useFrappeUpdateDoc, useFrappeGetDocList } from "frappe-react-sdk";
// import { Button } from "@/components/ui/button";
// import { Checkbox } from "@/components/ui/checkbox";
// import { Label } from "@/components/ui/label";
// import { toast } from "@/components/ui/use-toast";
// import { TailSpin } from "react-loader-spinner";
// import { MilestonesSummary } from "../Manpower-and-WorkMilestones/MilestonesSummary";
// import { PencilIcon, CircleCheckBig, CheckIcon, XIcon,PlusIcon } from "lucide-react";
// import {Input} from "@/components/ui/input";

// // Import the separate dialog and the new zone edit component
// import { SetupProgressTrackingDialog } from "./components/SetupProgressTrackingDialog"

// interface ProjectWorkReportTabProps {
//     projectData: Projects;
//     project_mutate: KeyedMutator<FrappeDoc<Projects>>;
//     current_role: string;
// }

// // Augment WorkHeaders type (Shared Type 1)
// interface WorkHeaderDoc extends WorkHeaders {
//     work_package_link: string;
//     work_header_name: string;
// }

// // Local state structure for combined and grouped rendering (Shared Type 2)
// interface LocalProjectWorkHeaderEntry {
//     work_header_doc_name: string;
//     work_header_display_name: string;
//     work_package_link: string;
//     enabled: boolean;
//     name?: string;
// }

// // Augment Projects type with project_zones for consistency (Shared Type 3)
// interface ProjectsWithZones extends Projects {
//     project_zones: ProjectZoneEntry[];
// }


// export const ProjectWorkReportTab: React.FC<ProjectWorkReportTabProps> = ({
//     projectData,
//     project_mutate,
//     current_role
// }) => {
//     const projectDataWithZones = projectData as ProjectsWithZones;

//     const [isSetupDialogOpen, setIsSetupDialogOpen] = useState(false);
//     const [localWorkHeaders, setLocalWorkHeaders] = useState<LocalProjectWorkHeaderEntry[]>([]);
//     const [isEditingHeaders, setIsEditingHeaders] = useState(false); // Renamed from isEditing
//     const [isEditingZones, setIsEditingZones] = useState(false); // <--- New state for zone editing
//     const [localProjectZones, setLocalProjectZones] = useState<ProjectZoneEntry[]>(projectData.project_zones || []);
//     const [newZoneName, setNewZoneName] = useState(''); // State for adding new zone in edit mode

//     const isMilestoneTrackingEnabled = projectData.enable_project_milestone_tracking;

//     const { updateDoc, loading: updateDocLoading } = useFrappeUpdateDoc();

//     // Fetch all available Work Headers
//     const { data: allWorkHeaders, isLoading: allWorkHeadersLoading, error: allWorkHeadersError } = useFrappeGetDocList<WorkHeaderDoc>(
//         "Work Headers",
//         {
//             fields: ['name', 'work_header_name', 'work_package_link'],
//             limit: 0
//         }
//     );

//     // --- Shared Utility Callbacks (Used by both main component and Dialog/EditSection) ---
//     const toBoolean = useCallback((val: boolean | string | "True" | "False" | undefined | null): boolean => {
//         if (typeof val === 'boolean') {
//             return val;
//         }
//         if (typeof val === 'string') {
//             return val.toLowerCase() === 'true';
//         }
//         return false;
//     }, []);

//     const getLinkedWorkHeaderName = useCallback((entry: ProjectWorkHeaderEntry): string | null => {
//         if (typeof entry.project_work_header_name === 'string') {
//             return entry.project_work_header_name;
//         }
//         if (typeof entry.project_work_header_name === 'object' && (entry.project_work_header_name as any)?.name) {
//             return (entry.project_work_header_name as any).name;
//         }
//         return null;
//     }, []);

//     const generateCombinedHeaders = useCallback((
//         projectData: Projects, 
//         allWorkHeaders: WorkHeaderDoc[], 
//         toBoolean: (val: any) => boolean, 
//         getLinkedWorkHeaderName: (entry: ProjectWorkHeaderEntry) => string | null
//     ): LocalProjectWorkHeaderEntry[] => {
//         const projectEnabledWorkHeadersMap = new Map<string, ProjectWorkHeaderEntry>();
//         if (projectData.project_work_header_entries) {
//             projectData.project_work_header_entries.forEach(entry => {
//                 const linkedName = getLinkedWorkHeaderName(entry);
//                 if (linkedName) {
//                     projectEnabledWorkHeadersMap.set(linkedName, { ...entry, enabled: toBoolean(entry.enabled) });
//                 }
//             });
//         }

//         const combinedHeaders: LocalProjectWorkHeaderEntry[] = (allWorkHeaders || []).map(masterHeader => {
//             const masterHeaderDocName = masterHeader.name;
//             const masterHeaderDisplayName = masterHeader.work_header_name;
//             const masterHeaderWorkPackageLink = masterHeader.work_package_link || "General Work Package"; 

//             const existingEntry = projectEnabledWorkHeadersMap.get(masterHeaderDocName);

//             return {
//                 work_header_doc_name: masterHeaderDocName,
//                 work_header_display_name: masterHeaderDisplayName,
//                 work_package_link: masterHeaderWorkPackageLink,
//                 enabled: existingEntry ? existingEntry.enabled : false,
//                 name: existingEntry ? existingEntry.name : undefined,
//             };
//         });
        
//         combinedHeaders.sort((a, b) => 
//             a.work_package_link.localeCompare(b.work_package_link) || 
//             a.work_header_display_name.localeCompare(b.work_header_display_name)
//         );

//         return combinedHeaders;
//     }, []);
//     // --- End Shared Utility Callbacks ---


//     // Initialize local work headers
//     useEffect(() => {
//         if (allWorkHeaders && projectData) {
//             setLocalWorkHeaders(generateCombinedHeaders(projectData, allWorkHeaders, toBoolean, getLinkedWorkHeaderName));
//         } else if (!projectData) {
//             setLocalWorkHeaders([]);
//         }
//     }, [projectData, allWorkHeaders, toBoolean, getLinkedWorkHeaderName, generateCombinedHeaders]);


//     // --- Work Header Handlers (In-place editing) ---

//     // Handle checkbox change by Doc Name
//     const handleCheckboxChange = useCallback((docName: string, checked: boolean | "indeterminate") => {
//         setLocalWorkHeaders(prevHeaders => {
//             const index = prevHeaders.findIndex(h => h.work_header_doc_name === docName);
//             if (index === -1) return prevHeaders;

//             const newHeaders = [...prevHeaders];
//             newHeaders[index] = { ...newHeaders[index], enabled: checked as boolean };
//             return newHeaders;
//         });
//     }, []);

//     // Handle Save Work Headers
//     const handleSaveHeaders = async () => {
//         try {
//             const headersToSave = localWorkHeaders
//                 .filter(entry => entry.enabled)
//                 .map(entry => {
//                     return {
//                         name: entry.name,
//                         project_work_header_name: entry.work_header_doc_name,
//                         enabled: true,
//                     };
//                 });

//             await updateDoc("Projects", projectData.name, {
//                 project_work_header_entries: headersToSave,
//             });
//             await project_mutate();
//             toast({
//                 title: "Success",
//                 description: "Work Headers updated successfully.",
//                 variant: "success",
//             });
//             setIsEditingHeaders(false);
//         } catch (error) {
//             console.error("Failed to update work headers:", error);
//             toast({
//                 title: "Error",
//                 description: "Failed to update Work Headers.",
//                 variant: "destructive",
//             });
//         }
//     };

//     // Handle Cancel Work Headers
//     const handleCancelHeaders = useCallback(() => {
//         if (allWorkHeaders && projectData) {
//             setLocalWorkHeaders(generateCombinedHeaders(projectData, allWorkHeaders, toBoolean, getLinkedWorkHeaderName));
//         } else {
//             setLocalWorkHeaders([]);
//         }
//         setIsEditingHeaders(false);
//     }, [projectData, allWorkHeaders, toBoolean, getLinkedWorkHeaderName, generateCombinedHeaders]);
    
//     // isSaveDisabled for Headers
//     const isSaveDisabledHeaders = useMemo(() => {
//         const currentEnabledHeaderDocIds = new Set(
//             localWorkHeaders.filter(entry => entry.enabled)
//                 .map(entry => entry.work_header_doc_name)
//         );

//         const originalEnabledHeaderDocIds = new Set(
//             (projectData?.project_work_header_entries || [])
//                 .filter(entry => toBoolean(entry.enabled))
//                 .map(entry => getLinkedWorkHeaderName(entry))
//                 .filter(Boolean) as string[]
//         );

//         if (currentEnabledHeaderDocIds.size !== originalEnabledHeaderDocIds.size) {
//             return false;
//         }

//         for (const id of currentEnabledHeaderDocIds) {
//             if (!originalEnabledHeaderDocIds.has(id)) {
//                 return false;
//             }
//         }
//         return true;
//     }, [localWorkHeaders, projectData?.project_work_header_entries, toBoolean, getLinkedWorkHeaderName]);

//     // Grouping for rendering headers
//     const groupedWorkHeaders = useMemo(() => {
//         const groups = new Map<string, LocalProjectWorkHeaderEntry[]>();
//         localWorkHeaders.forEach(header => {
//             const packageLink = header.work_package_link;
//             if (!groups.has(packageLink)) {
//                 groups.set(packageLink, []);
//             }
//             groups.get(packageLink)!.push(header);
//         });
//         return Array.from(groups.entries());
//     }, [localWorkHeaders]);

//     const handleSetupSuccess = async () => {
//         await project_mutate();
//         setIsSetupDialogOpen(false);
//     };

//     // --- Zone Edit Handlers (Passed to ProjectZoneEditSection) ---

//      const handleAddZone = () => {
//         const newZone = newZoneName.trim();
//         if (!newZone) return;

//         // Simple duplication check against local state
//         if (localProjectZones.some(z => z.zone_name.trim() === newZone)) {
//             toast({ title: "Error", description: "Zone name must be unique.", variant: "destructive" });
//             return;
//         }

//         const newEntry: ProjectZoneEntry = { 
//             zone_name: newZone,
//         };
//         setLocalProjectZones(prev => [...prev, newEntry]);
//         setNewZoneName('');
//     };


//         const handleRemoveZone = (index: number) => {
//         setLocalProjectZones(prev => prev.filter((_, i) => i !== index));
//     };

//      const handleSaveZones = async () => {
//         const zonesToSave = localProjectZones
//             .filter(z => z.zone_name.trim()) 
//             .map(zone => ({
//                 name: zone.name, 
//                 zone_name: zone.zone_name.trim() 
//             }));

//         const trimmedNames = zonesToSave.map(z => z.zone_name);
//         if (new Set(trimmedNames).size !== trimmedNames.length) {
//             toast({ title: "Error", description: "Zone names must be unique and non-empty.", variant: "destructive" });
//             return;
//         }

//         try {
//             await updateDoc("Projects", projectData.name, {
//                 project_zones: zonesToSave,
//             });
//             await project_mutate();
//             toast({
//                 title: "Success",
//                 description: "Project Zones updated successfully.",
//                 variant: "success",
//             });
//             setIsEditingZones(false);
//         } catch (error) {
//             console.error("Failed to update project zones:", error);
//             toast({
//                 title: "Error",
//                 description: "Failed to update Project Zones.",
//                 variant: "destructive",
//             });
//         }
//     };

//     const handleCancelZones = () => {
//         setLocalProjectZones(projectData.project_zones || []); // Reset state
//         setNewZoneName('');
//         setIsEditingZones(false);
//     };
//     // --- End Zone Edit Handlers ---
//     // Check for unique/empty when saving is enabled (for visual feedback)
//     const isZoneSaveDisabled = useMemo(() => {
//         const trimmedNames = localProjectZones.map(z => z.zone_name.trim()).filter(Boolean);
//         const hasEmptyName = localProjectZones.some(z => !z.zone_name.trim());
//         const hasDuplicates = new Set(trimmedNames).size !== trimmedNames.length;
//         return hasEmptyName || hasDuplicates;
//     }, [localProjectZones]);

//     // --- Custom Zone Render Section ---
//     const renderZoneDisplay = () => {
//         const zonesToRender = isEditingZones ? localProjectZones : projectDataWithZones.project_zones;
//         const zonesExist = zonesToRender && zonesToRender.length > 0;

//         if (!zonesExist && !isEditingZones) {
//             return (
//                 <div className="p-3 border rounded-md bg-white my-2">
//                     <p className="text-sm text-gray-500 italic">No zones currently defined for this project.</p>
//                 </div>
//             );
//         }

//         const ZoneList = (
//             <div className="flex flex-wrap gap-2">
//                 {isEditingZones && (
//                     <div className="flex items-center space-x-2 w-full mb-2 border-b pb-2">
//                         <Input
//                             placeholder="Enter New Zone Name"
//                             value={newZoneName}
//                             onChange={(e) => setNewZoneName(e.target.value)}
//                             onKeyDown={(e) => e.key === 'Enter' && handleAddZone()}
//                             className="h-9 w-64"
//                         />
//                         <Button 
//                             onClick={handleAddZone} 
//                             size="sm" 
//                             disabled={updateDocLoading || !newZoneName.trim()}
//                             variant="outline"
//                         >
//                             <PlusIcon className="h-4 w-4 mr-1" /> Add
//                         </Button>
//                     </div>
//                 )}
                
//                 {zonesToRender.map((zone, index) => (
//                     <div 
//                         key={zone.name || `new-${index}`} 
//                         className="p-2 bg-gray-100 rounded-lg border border-gray-300 shadow-sm flex items-center justify-between space-x-2"
//                         style={{ minWidth: '150px' }} // Ensure visibility of the badge
//                     >
//                         <span className="text-sm font-medium truncate">{zone.zone_name}</span>
                        
//                         {isEditingZones && (
//                             <div className="flex space-x-1">
                                
//                                 <Button 
//                                     variant="ghost" 
//                                     size="icon" 
//                                     className="h-7 w-7 text-blue-500 hover:bg-blue-50"
//                                     disabled={isEditingZones} 
//                                     title="Rename functionality is managed externally"
//                                 >
//                                     <PencilIcon className="h-4 w-4" />
//                                 </Button>

//                                 {/* Only allow removal of zones that haven't been saved yet (no 'name' field) */}
//                                 {!zone.name && (
//                                     <Button 
//                                         variant="ghost" 
//                                         size="icon" 
//                                         onClick={() => handleRemoveZone(index)} 
//                                         className="h-7 w-7 text-red-500 hover:bg-red-50"
//                                     >
//                                         <XIcon className="h-4 w-4" />
//                                     </Button>
//                                 )}
//                             </div>
//                         )}
//                     </div>
//                 ))}
//             </div>
//         );

//         if (isEditingZones) {
//             return (
//                 <div className="p-3 border rounded-md bg-white my-2">
//                     {/* Edit Header Bar is now handled by the outer component structure */}
//                     {isZoneSaveDisabled && <p className="text-red-500 text-sm mb-2">Zone names must be unique and non-empty.</p>}

//                     {ZoneList}
//                 </div>
//             );
//         }

//         return <div className="p-3 border rounded-md bg-white my-2">{ZoneList}</div>;
//     };
//     // End Custom Zone Render Section
//     // --- Render Logic ---

//     if (allWorkHeadersLoading) {
//         return (
//             <div className="flex justify-center items-center h-40">
//                 <TailSpin width={40} height={40} color="#007bff" />
//             </div>
//         );
//     }

//     if (allWorkHeadersError) {
//         return (
//             <div className="p-4 text-center text-red-600">
//                 Error loading available Work Headers: {allWorkHeadersError.message}
//             </div>
//         );
//     }

//     if (!localWorkHeaders || localWorkHeaders.length === 0) {
//         return (
//             <div className="p-4 text-center text-gray-600">
//                 Initializing Work Headers list...
//             </div>
//         );
//     }

//     return (
//         <>
//             {["Nirmaan Admin Profile", "Nirmaan Project Lead Profile"].includes(current_role) && (
//                 <div className="p-4 border rounded-md shadow-sm bg-white">
//                     <div className="flex items-center justify-between mb-6 pb-4 border-b">
//                         <div>
//                             <h3 className="text-lg font-semibold"> Track Project Progress</h3>
//                             <p className="text-sm text-gray-600">
//                                 {isMilestoneTrackingEnabled 
//                                     ? "Progress Tracking is enabled for this project" 
//                                     : "Progress Tracking is disabled for this project"}
//                             </p>
//                         </div>
//                          {!isMilestoneTrackingEnabled ? (
//                             <Button onClick={() => setIsSetupDialogOpen(true)}>
//                                 Setup Progress Tracking
//                             </Button>
//                         ) : (
//                             // Changed button to be less confusing since there are separate edit buttons below
//                             <div className="text-sm text-gray-500 italic">
//                                 Use the edit buttons below to manage settings.
//                             </div>
//                         )}
//                     </div>

//                     {/* Work Headers and Zones Section - Only shown when tracking is enabled */}
//                     {isMilestoneTrackingEnabled ? (
//                         <div>
//                             {/* --- Zone Section --- */}
//                            <div className="flex items-center justify-between mt-4 mb-2">
//                                 <h3 className="text-lg font-semibold">Project Zones</h3>
                                
//                                 {/* Zone Edit Buttons (Save/Cancel/Edit) */}
//                                 {isEditingZones ? (
//                                     <div className="flex space-x-2">
//                                         <Button variant="outline" onClick={handleCancelZones} size="sm" disabled={updateDocLoading}>
//                                             <XIcon size={16} className="mr-1 text-red-500" />Cancel
//                                         </Button>
//                                         <Button 
//                                             variant="default" 
//                                             onClick={handleSaveZones} 
//                                             disabled={updateDocLoading || isZoneSaveDisabled}
//                                             size="sm"
//                                         >
//                                             {updateDocLoading ? (
//                                                 <TailSpin width={14} height={14} color="white" /> 
//                                             ) : (
//                                                 <>
//                                                     <CircleCheckBig size={16} className="mr-1" />Save Zones
//                                                 </>
//                                             )}
//                                         </Button>
//                                     </div>
//                                 ) : (
//                                     <Button 
//                                         variant="outline" 
//                                         size="sm" 
//                                         onClick={() => setIsEditingZones(true)}
//                                         disabled={isEditingHeaders} 
//                                     >
//                                         <PencilIcon size={20} className="mr-2" /> Edit Zones
//                                     </Button>
//                                 )}
//                             </div>

//                             {renderZoneDisplay()}
                            
                           
                           
//                             {/* --- Work Headers Section --- */}
//                             <div className="flex items-center justify-between mt-6 mb-4 pt-4 border-t">
//                                 <h3 className="text-lg font-semibold">Tracked Work Headers</h3>
//                                 {!isEditingHeaders && (
//                                     <Button 
//                                         variant="outline" 
//                                         size="sm" 
//                                         onClick={() => setIsEditingHeaders(true)}
//                                         disabled={isEditingZones} // Disable header edit if zones are being edited
//                                     >
//                                         <PencilIcon size={20} className="mr-2" /> Edit Headers
//                                     </Button>
//                                 )}
//                                 {isEditingHeaders && (
//                                     <div className="flex justify-end space-x-2">
//                                         <Button variant="outline" onClick={handleCancelHeaders}>
//                                             <XIcon size={24} className="mr-2 text-red-500" color="#ee2020" />Cancel
//                                         </Button>
//                                         <Button variant="outline" onClick={handleSaveHeaders} disabled={updateDocLoading || isSaveDisabledHeaders}>
//                                             {updateDocLoading ? (
//                                                 <TailSpin width={20} height={20} color="white" />
//                                             ) : (
//                                                 <>
//                                                     <CircleCheckBig size={24} className="mr-2" color="#25ad4d" />Save
//                                                 </>
//                                             )}
//                                         </Button>
//                                     </div>
//                                 )}
//                             </div>

//                             <div className="space-y-4">
//                                 {groupedWorkHeaders.map(([workPackage, headers]) => (
//                                     <div key={workPackage} className="border p-4 rounded-md bg-gray-50">
//                                         <h4 className="text-md font-semibold mb-3 text-gray-800 border-b pb-2">{workPackage}</h4>
//                                         <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
//                                             {headers.map((entry) => (
//                                                 <div
//                                                     key={entry.work_header_doc_name}
//                                                     className="flex items-center space-x-3"
//                                                 >
//                                                     {isEditingHeaders ? (
//                                                         <Checkbox
//                                                             id={`wh-${entry.work_header_doc_name}`}
//                                                             checked={entry.enabled}
//                                                             onCheckedChange={(checked) => handleCheckboxChange(entry.work_header_doc_name, checked)}
//                                                             disabled={isEditingZones} // Disable checkbox if zones are being edited
//                                                         />
//                                                     ) : (
//                                                         <span className={`h-4 w-4 rounded-sm border ${entry.enabled ? 'bg-primary border-primary' : 'bg-gray-200 border-gray-300'} flex items-center justify-center flex-shrink-0`}>
//                                                             {entry.enabled && <CheckIcon className="h-3 w-3 text-white" />}
//                                                         </span>
//                                                     )}
//                                                     <Label
//                                                         htmlFor={isEditingHeaders ? `wh-${entry.work_header_doc_name}` : undefined}
//                                                         className={isEditingHeaders ? "cursor-pointer text-gray-700" : "text-gray-700"}
//                                                     >
//                                                         {entry.work_header_display_name}
//                                                     </Label>
//                                                 </div>
//                                             ))}
//                                         </div>
//                                     </div>
//                                 ))}
//                             </div>
//                         </div>
//                     ):("")}
//                 </div>
//             )}

//             {/* Setup Dialog */}
//              <SetupProgressTrackingDialog
//                 projectData={projectDataWithZones}
//                 allWorkHeaders={allWorkHeaders || []}
//                 allWorkHeadersLoading={allWorkHeadersLoading}
//                 isOpen={isSetupDialogOpen}
//                 onClose={() => setIsSetupDialogOpen(false)}
//                 onSuccess={handleSetupSuccess}
//                 generateCombinedHeaders={generateCombinedHeaders as any}
//                 toBoolean={toBoolean as any}
//                 getLinkedWorkHeaderName={getLinkedWorkHeaderName as any}
//             />

//             <MilestonesSummary 
//                 workReport={true} 
//                 projectIdForWorkReport={projectData?.name}
//             />
//         </>
//     );
// };

