// src/pages/projects/components/ProjectWorkReportTab.tsx
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Projects, ProjectWorkHeaderEntry } from "@/types/NirmaanStack/Projects";
import { WorkHeaders } from "@/types/NirmaanStack/WorkHeaders";
import { FrappeDoc, KeyedMutator, useFrappeUpdateDoc, useFrappeGetDocList } from "frappe-react-sdk";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/use-toast";
import { TailSpin } from "react-loader-spinner";
import { MilestonesSummary } from "../Manpower-and-WorkMilestones/MilestonesSummary";
import { PencilIcon, CircleCheckBig, CheckIcon, XIcon } from "lucide-react";

interface ProjectWorkReportTabProps {
    projectData: Projects;
    project_mutate: KeyedMutator<FrappeDoc<Projects>>;
    current_role: string;
}

export const ProjectWorkReportTab: React.FC<ProjectWorkReportTabProps> = ({
    projectData,
    project_mutate,
    current_role
}) => {
    const [localWorkHeaders, setLocalWorkHeaders] = useState<ProjectWorkHeaderEntry[]>([]);
    const [isEditing, setIsEditing] = useState(false);
    const [isMilestoneTrackingEnabled, setIsMilestoneTrackingEnabled] = useState<boolean>(projectData.enable_project_milestone_tracking);
    const [isToggleLoading, setIsToggleLoading] = useState<boolean>(false);
    const { updateDoc, loading: updateDocLoading } = useFrappeUpdateDoc();

    // Fetch all available Work Headers
    const { data: allWorkHeaders, isLoading: allWorkHeadersLoading, error: allWorkHeadersError } = useFrappeGetDocList<WorkHeaders>(
        "Work Headers",
        {
            fields: ['name', 'work_header_name'],
            limit: 0
        }
    );

    // Sync toggle state with project data
    useEffect(() => {
        setIsMilestoneTrackingEnabled(projectData.enable_project_milestone_tracking);
    }, [projectData.enable_project_milestone_tracking]);

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

    // Initialize local work headers
    useEffect(() => {
        if (allWorkHeaders && projectData) {
            const projectEnabledWorkHeadersMap = new Map<string, ProjectWorkHeaderEntry>();
            if (projectData.project_work_header_entries) {
                projectData.project_work_header_entries.forEach(entry => {
                    const linkedName = getLinkedWorkHeaderName(entry);
                    if (linkedName) {
                        projectEnabledWorkHeadersMap.set(linkedName, { ...entry, enabled: toBoolean(entry.enabled) });
                    }
                });
            }

            const combinedHeaders: ProjectWorkHeaderEntry[] = allWorkHeaders.map(masterHeader => {
                const masterHeaderName = masterHeader.name;
                const masterHeaderDisplayName = masterHeader.work_header_name;

                if (projectEnabledWorkHeadersMap.has(masterHeaderName)) {
                    const existingEntry = projectEnabledWorkHeadersMap.get(masterHeaderName)!;
                    return {
                        ...existingEntry,
                        project_work_header_name: masterHeaderDisplayName,
                        enabled: existingEntry.enabled,
                        name: existingEntry.name || undefined,
                    };
                } else {
                    return {
                        project_work_header_name: masterHeaderDisplayName,
                        enabled: false,
                    };
                }
            });

            setLocalWorkHeaders(combinedHeaders);
        } else if (!projectData) {
            setLocalWorkHeaders([]);
        }
    }, [projectData, allWorkHeaders, toBoolean, getLinkedWorkHeaderName]);

    // Handle toggle switch change
    const handleMilestoneTrackingToggle = async (checked: boolean) => {
        setIsToggleLoading(true);
        try {
            await updateDoc("Projects", projectData.name, {
                enable_project_milestone_tracking: checked
            });
            
            setIsMilestoneTrackingEnabled(checked);
            
            toast({
                title: "Success",
                description: `Project Milestone Tracking ${checked ? 'enabled' : 'disabled'}.`,
                variant: "success",
            });
            
            await project_mutate();
        } catch (error) {
            console.error("Failed to toggle milestone tracking:", error);
            toast({
                title: "Error",
                description: "Failed to update milestone tracking setting.",
                variant: "destructive",
            });
            setIsMilestoneTrackingEnabled(!checked);
        } finally {
            setIsToggleLoading(false);
        }
    };

    const handleCheckboxChange = useCallback((index: number, checked: boolean | "indeterminate") => {
        setLocalWorkHeaders(prevHeaders => {
            const newHeaders = [...prevHeaders];
            if (newHeaders[index]) {
                newHeaders[index] = { ...newHeaders[index], enabled: checked as boolean };
            }
            return newHeaders;
        });
    }, []);

    const handleSave = async () => {
        try {
            const headersToSave = localWorkHeaders
                .filter(entry => entry.enabled)
                .map(entry => {
                    const masterHeader = allWorkHeaders?.find(wh => wh.work_header_name === entry.project_work_header_name);

                    if (!masterHeader) {
                        console.warn(`Could not find master Work Header for display name: ${entry.project_work_header_name}. Skipping this entry.`);
                        return null;
                    }

                    return {
                        name: entry.name,
                        project_work_header_name: masterHeader.name,
                        enabled: true,
                    };
                })
                .filter(Boolean);

            await updateDoc("Projects", projectData.name, {
                project_work_header_entries: headersToSave,
            });
            await project_mutate();
            toast({
                title: "Success",
                description: "Work Headers updated successfully.",
                variant: "success",
            });
            setIsEditing(false);
        } catch (error) {
            console.error("Failed to update work headers:", error);
            toast({
                title: "Error",
                description: "Failed to update Work Headers.",
                variant: "destructive",
            });
        }
    };

    const handleCancel = useCallback(() => {
        if (allWorkHeaders && projectData) {
            const projectEnabledWorkHeadersMap = new Map<string, ProjectWorkHeaderEntry>();
            if (projectData.project_work_header_entries) {
                projectData.project_work_header_entries.forEach(entry => {
                    const linkedName = getLinkedWorkHeaderName(entry);
                    if (linkedName) {
                        projectEnabledWorkHeadersMap.set(linkedName, { ...entry, enabled: toBoolean(entry.enabled) });
                    }
                });
            }

            const combinedHeaders: ProjectWorkHeaderEntry[] = allWorkHeaders.map(masterHeader => {
                const masterHeaderName = masterHeader.name;
                const masterHeaderDisplayName = masterHeader.work_header_name;

                if (projectEnabledWorkHeadersMap.has(masterHeaderName)) {
                    const existingEntry = projectEnabledWorkHeadersMap.get(masterHeaderName)!;
                    return {
                        ...existingEntry,
                        project_work_header_name: masterHeaderDisplayName,
                        enabled: existingEntry.enabled,
                        name: existingEntry.name || undefined,
                    };
                } else {
                    return {
                        project_work_header_name: masterHeaderDisplayName,
                        enabled: false,
                    };
                }
            });
            setLocalWorkHeaders(combinedHeaders);
        } else {
            setLocalWorkHeaders([]);
        }
        setIsEditing(false);
    }, [projectData, allWorkHeaders, toBoolean, getLinkedWorkHeaderName]);

    const isSaveDisabled = useMemo(() => {
        const currentEnabledHeaderDocIds = new Set(
            localWorkHeaders.filter(entry => entry.enabled)
                .map(entry => {
                    const masterHeader = allWorkHeaders?.find(wh => wh.work_header_name === entry.project_work_header_name);
                    return masterHeader ? masterHeader.name : null;
                })
                .filter(Boolean) as string[]
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
    }, [localWorkHeaders, projectData?.project_work_header_entries, allWorkHeaders, toBoolean, getLinkedWorkHeaderName]);

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

   

    if (!allWorkHeaders || allWorkHeaders.length === 0) {
        return (
            <div className="p-4 text-center text-gray-600">
                No Work Headers are defined in the system. Please create Work Headers first to enable tracking.
            </div>
        );
    }

    if (!localWorkHeaders || localWorkHeaders.length === 0) {
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
                            <h3 className="text-lg font-semibold">Work Headers</h3>
                            <p className="text-sm text-gray-600">
                                {isMilestoneTrackingEnabled 
                                    ? "Tracking is enabled for this project" 
                                    : "Tracking is disabled for this project"}
                            </p>
                        </div>
                        <div className="flex items-center space-x-2">
                            <span className="text-sm font-medium text-gray-700">
                                {isMilestoneTrackingEnabled ? "Enabled" : "Disabled"}
                            </span>
                            <button
                                type="button"
                                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                                    isMilestoneTrackingEnabled ? 'bg-blue-600' : 'bg-gray-200'
                                }`}
                                role="switch"
                                aria-checked={isMilestoneTrackingEnabled}
                                disabled={isToggleLoading}
                                onClick={() => handleMilestoneTrackingToggle(!isMilestoneTrackingEnabled)}
                            >
                                <span
                                    aria-hidden="true"
                                    className={`pointer-events-none relative inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                        isMilestoneTrackingEnabled ? 'translate-x-5' : 'translate-x-0'
                                    }`}
                                >
                                    <span
                                        className={`absolute inset-0 flex h-full w-full items-center justify-center transition-opacity ${
                                            isMilestoneTrackingEnabled ? 'opacity-0 duration-100 ease-out' : 'opacity-100 duration-200 ease-in'
                                        }`}
                                        aria-hidden="true"
                                    >
                                        <svg className="h-3 w-3 text-gray-400" fill="none" viewBox="0 0 12 12">
                                            <path d="M4 8l2-2m0 0l2-2M6 6L4 4m2 2l2 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                        </svg>
                                    </span>
                                    <span
                                        className={`absolute inset-0 flex h-full w-full items-center justify-center transition-opacity ${
                                            isMilestoneTrackingEnabled ? 'opacity-100 duration-200 ease-in' : 'opacity-0 duration-100 ease-out'
                                        }`}
                                        aria-hidden="true"
                                    >
                                        <svg className="h-3 w-3 text-blue-600" fill="currentColor" viewBox="0 0 12 12">
                                            <path d="M3.707 5.293a1 1 0 00-1.414 1.414l1.414-1.414zM5 8l-.707.707a1 1 0 001.414 0L5 8zm4.707-4.293a1 1 0 00-1.414-1.414l1.414 1.414zm-7.414 2l2 2 1.414-1.414-2-2-1.414 1.414zm3.414 2l4-4-1.414-1.414-4 4 1.414 1.414z" />
                                        </svg>
                                    </span>
                                </span>
                            </button>
                            {isToggleLoading && <TailSpin width={20} height={20} />}
                        </div>
                    </div>

                    {/* Work Headers Section - Only shown when tracking is enabled */}
                    {isMilestoneTrackingEnabled ? (
                        <div>
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-lg font-semibold">Tracked Work Headers</h3>
                                {!isEditing && (
                                    <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
                                        <PencilIcon size={20} className="mr-2" /> Edit
                                    </Button>
                                )}
                                {isEditing && (
                                    <div className="flex justify-end space-x-2">
                                        <Button variant="outline" onClick={handleCancel}>
                                            <XIcon size={24} className="mr-2 text-red-500" color="#ee2020" />Cancel
                                        </Button>
                                        <Button variant="outline" onClick={handleSave} disabled={updateDocLoading || isSaveDisabled}>
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

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
                                {localWorkHeaders.map((entry, index) => (
                                    <div
                                        key={entry.name || `new-${entry.project_work_header_name}-${index}`}
                                        className="flex items-center space-x-2"
                                    >
                                        {isEditing ? (
                                            <Checkbox
                                                id={`wh-${entry.name || `new-${entry.project_work_header_name}-${index}`}`}
                                                checked={entry.enabled}
                                                onCheckedChange={(checked) => handleCheckboxChange(index, checked)}
                                            />
                                        ) : (
                                            <span className={`h-4 w-4 rounded-sm border ${entry.enabled ? 'bg-primary border-primary' : 'bg-gray-200 border-gray-300'} flex items-center justify-center`}>
                                                {entry.enabled && <CheckIcon className="h-3 w-3 text-white" />}
                                            </span>
                                        )}
                                        <Label
                                            htmlFor={isEditing && `wh-${entry.name || `new-${entry.project_work_header_name}-${index}`}`}
                                            className={isEditing ? "cursor-pointer" : ""}
                                        >
                                            {entry.project_work_header_name}
                                        </Label>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ):("")}
                </div>
            )}
            
            <MilestonesSummary 
                workReport={true} 
                projectIdForWorkReport={projectData?.name}
                // isMilestoneTrackingEnabled={isMilestoneTrackingEnabled}
            />
        </>
    );
};

// // src/pages/projects/components/ProjectWorkReportTab.tsx
// import React, { useState, useEffect, useCallback, useMemo } from "react";
// import { Projects, ProjectWorkHeaderEntry } from "@/types/NirmaanStack/Projects";
// import { FrappeDoc, KeyedMutator, useFrappeUpdateDoc } from "frappe-react-sdk";
// import { Button } from "@/components/ui/button";
// import { Checkbox } from "@/components/ui/checkbox";
// import { Label } from "@/components/ui/label";
// import { toast } from "@/components/ui/use-toast";
// import { TailSpin } from "react-loader-spinner";
// import { MilestonesSummary } from "../Manpower-and-WorkMilestones/MilestonesSummary";

// // Import icons: Pencil (for edit) and Check (for save)
// import { PencilIcon, CircleCheckBig, CheckIcon, XIcon } from "lucide-react"; // XIcon for cancel

// interface ProjectWorkReportTabProps {
//     projectData: Projects;
//     project_mutate: KeyedMutator<FrappeDoc<Projects>>;
//     current_role: string;
// }

// export const ProjectWorkReportTab: React.FC<ProjectWorkReportTabProps> = ({
//     projectData,
//     project_mutate,
//     current_role
// }) => {
//     const [localWorkHeaders, setLocalWorkHeaders] = useState<ProjectWorkHeaderEntry[]>([]);
//     const [isEditing, setIsEditing] = useState(false);
//     const { updateDoc, loading: updateDocLoading } = useFrappeUpdateDoc();

//     const toBoolean = useCallback((val: boolean | string | "True" | "False" | undefined | null): boolean => {
//         if (typeof val === 'boolean') {
//             return val;
//         }
//         if (typeof val === 'string') {
//             return val.toLowerCase() === 'true';
//         }
//         return false;
//     }, []);

//     useEffect(() => {
//         if (projectData?.project_work_header_entries) {
//             setLocalWorkHeaders(
//                 projectData.project_work_header_entries.map(entry => ({
//                     ...entry,
//                     enabled: toBoolean(entry.enabled)
//                 }))
//             );
//         } else {
//             setLocalWorkHeaders([]);
//         }
//     }, [projectData?.project_work_header_entries, toBoolean]);

//     const handleCheckboxChange = useCallback((index: number, checked: boolean | "indeterminate") => {
//         setLocalWorkHeaders(prevHeaders => {
//             const newHeaders = [...prevHeaders];
//             if (newHeaders[index]) {
//                 newHeaders[index] = { ...newHeaders[index], enabled: checked as boolean };
//             }
//             return newHeaders;
//         });
//     }, []);

//     const handleSave = async () => {
//         try {
//             const headersToSave = localWorkHeaders;

//             await updateDoc("Projects", projectData.name, {
//                 project_work_header_entries: headersToSave,
//                 enable_project_milestone_tracking: true,
//             });
//             await project_mutate();
//             toast({
//                 title: "Success",
//                 description: "Work Headers updated successfully.",
//                 variant: "success",
//             });
//             setIsEditing(false);
//         } catch (error) {
//             console.error("Failed to update work headers:", error);
//             toast({
//                 title: "Error",
//                 description: "Failed to update Work Headers.",
//                 variant: "destructive",
//             });
//         }
//     };

//     const handleCancel = () => {
//         if (projectData?.project_work_header_entries) {
//             setLocalWorkHeaders(
//                 projectData.project_work_header_entries.map(entry => ({
//                     ...entry,
//                     enabled: toBoolean(entry.enabled)
//                 }))
//             );
//         } else {
//             setLocalWorkHeaders([]);
//         }
//         setIsEditing(false);
//     };

//     const isSaveDisabled = useMemo(() => {
//         const currentEnabledNames = new Set(
//             localWorkHeaders.filter(entry => entry.enabled)
//                 .map(entry => entry.name || (typeof entry.project_work_header_name === 'string' ? entry.project_work_header_name : (entry.project_work_header_name as any)?.name))
//                 .filter(Boolean) as string[]
//         );
//         const originalEnabledNames = new Set(
//             (projectData?.project_work_header_entries || []).filter(entry => toBoolean(entry.enabled))
//                 .map(entry => entry.name || (typeof entry.project_work_header_name === 'string' ? entry.project_work_header_name : (entry.project_work_header_name as any)?.name))
//                 .filter(Boolean) as string[]
//         );

//         if (currentEnabledNames.size !== originalEnabledNames.size) {
//             return false;
//         }

//         for (const name of currentEnabledNames) {
//             if (!originalEnabledNames.has(name)) {
//                 return false;
//             }
//         }
//         return true;
//     }, [localWorkHeaders, projectData?.project_work_header_entries, toBoolean]);


//     if (!projectData.enable_project_milestone_tracking) {
//         return (
//             <div className="p-4 text-center text-gray-600">
//                 Project Milestone Tracking is not enabled for this project.
//                 Please enable it in the Project Form's "Project Timeline" section.
//             </div>
//         );
//     }
    
  

//     if (!localWorkHeaders || localWorkHeaders.length === 0) {
//         return (
//             <div className="p-4 text-center text-gray-600">
//                 No Work Headers configured for milestone tracking.
//                 Please add them via the Project Form if milestone tracking is enabled.
//             </div>
//         );
//     }

//     return (
//       <>
//       {current_role === "Nirmaan Admin Profile" &&(
//          <div className="p-4 border rounded-md shadow-sm bg-white">
//             {/* Header with edit button */}
//             <div className="flex items-center justify-between mb-4">
//                 <h3 className="text-lg font-semibold">Tracked Work Headers</h3>
//                 {!isEditing ? (
//                     <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
//                         <PencilIcon size={20} className="mr-2" /> Edit
//                     </Button>
//                 ) : null}
//                 {isEditing && (
//                     <div className="flex justify-end space-x-2">
//                         <Button variant="outline" onClick={handleCancel}>
//                             <XIcon size={24} className="mr-2 text-red-500" color="#ee2020" />Cancel
//                         </Button>
//                         <Button variant="outline" onClick={handleSave} disabled={updateDocLoading || isSaveDisabled}>
//                             {updateDocLoading ? (
//                                 <TailSpin width={20} height={20} color="white" />
//                             ) : (
//                                 <>
//                                     <CircleCheckBig size={24} className="mr-2" color="#25ad4d" />Save
//                                     {/* Removed "Save Changes" text */}
//                                 </>
//                             )}
//                         </Button>
//                     </div>
//                 )}
//             </div>

//             {/* List of checkboxes/labels */}
//             <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2"> {/* Changed to grid for better spacing */}
//                 {localWorkHeaders.map((entry, index) => (
//                     <div
//                         key={entry.name || (typeof entry.project_work_header_name === 'string' ? entry.project_work_header_name : `idx-${index}`)}
//                         className="flex items-center space-x-2"
//                     >
//                         {isEditing ? (
//                             <Checkbox
//                                 id={`wh-${entry.name || (typeof entry.project_work_header_name === 'string' ? entry.project_work_header_name : `idx-${index}`)}`}
//                                 checked={entry.enabled}
//                                 onCheckedChange={(checked) => handleCheckboxChange(index, checked)}
//                             />
//                         ) : (
//                             <span className={`h-4 w-4 rounded-sm border ${entry.enabled ? 'bg-primary border-primary' : 'bg-gray-200 border-gray-300'} flex items-center justify-center`}>
//                                 {entry.enabled && <CheckIcon className="h-3 w-3 text-white" />} {/* Using CheckIcon here */}
//                             </span>
//                         )}
//                         <Label
//                             htmlFor={isEditing ? `wh-${entry.name || (typeof entry.project_work_header_name === 'string' ? entry.project_work_header_name : `idx-${index}`)}` : undefined}
//                             className={isEditing ? "cursor-pointer" : ""}
//                         >
//                             {typeof entry.project_work_header_name === 'string'
//                                 ? entry.project_work_header_name
//                                 : (entry.project_work_header_name as any)?.name || `Unknown Header ${index}`}
//                         </Label>
//                     </div>
//                 ))}
//             </div>

//         </div>
//       )}
//       <MilestonesSummary workReport={true} projectIdForWorkReport={projectData?.name}/>
//       </>
       
//     );
// };

///

// // src/pages/projects/components/ProjectWorkReportTab.tsx
// import React, { useState, useEffect, useCallback, useMemo } from "react";
// import { Projects, ProjectWorkHeaderEntry } from "@/types/NirmaanStack/Projects";
// import { FrappeDoc, KeyedMutator, useFrappeUpdateDoc } from "frappe-react-sdk";
// import { Button } from "@/components/ui/button";
// import { Checkbox } from "@/components/ui/checkbox";
// import { Label } from "@/components/ui/label";
// import { toast } from "@/components/ui/use-toast";
// import { TailSpin } from "react-loader-spinner";

// // Import icons: Pencil (for edit) and Check (for save)
// import { PencilIcon, CircleCheckBig,CheckIcon, XIcon } from "lucide-react"; // XIcon for cancel

// interface ProjectWorkReportTabProps {
//     projectData: Projects;
//     project_mutate: KeyedMutator<FrappeDoc<Projects>>;
//     current_role:string;
// }

// export const ProjectWorkReportTab: React.FC<ProjectWorkReportTabProps> = ({
//     projectData,
//     project_mutate,
//     current_role
// }) => {
//     const [localWorkHeaders, setLocalWorkHeaders] = useState<ProjectWorkHeaderEntry[]>([]);
//     const [isEditing, setIsEditing] = useState(false);
//     const { updateDoc, loading: updateDocLoading } = useFrappeUpdateDoc();

//     const toBoolean = useCallback((val: boolean | string | "True" | "False" | undefined | null): boolean => {
//         if (typeof val === 'boolean') {
//             return val;
//         }
//         if (typeof val === 'string') {
//             return val.toLowerCase() === 'true';
//         }
//         return false;
//     }, []);

//     useEffect(() => {
//         if (projectData?.project_work_header_entries) {
//             setLocalWorkHeaders(
//                 projectData.project_work_header_entries.map(entry => ({
//                     ...entry,
//                     enabled: toBoolean(entry.enabled)
//                 }))
//             );
//         } else {
//             setLocalWorkHeaders([]);
//         }
//     }, [projectData?.project_work_header_entries, toBoolean]);

//     const handleCheckboxChange = useCallback((index: number, checked: boolean | "indeterminate") => {
//         setLocalWorkHeaders(prevHeaders => {
//             const newHeaders = [...prevHeaders];
//             if (newHeaders[index]) {
//                 newHeaders[index] = { ...newHeaders[index], enabled: checked as boolean };
//             }
//             return newHeaders;
//         });
//     }, []);

//     const handleSave = async () => {
//         try {
//             const headersToSave = localWorkHeaders

//             await updateDoc("Projects", projectData.name, {
//                 project_work_header_entries: headersToSave,
//                 enable_project_milestone_tracking: true,
//             });
//             await project_mutate();
//             toast({
//                 title: "Success",
//                 description: "Work Headers updated successfully.",
//                 variant: "success",
//             });
//             setIsEditing(false);
//         } catch (error) {
//             console.error("Failed to update work headers:", error);
//             toast({
//                 title: "Error",
//                 description: "Failed to update Work Headers.",
//                 variant: "destructive",
//             });
//         }
//     };

//     const handleCancel = () => {
//         if (projectData?.project_work_header_entries) {
//             setLocalWorkHeaders(
//                 projectData.project_work_header_entries.map(entry => ({
//                     ...entry,
//                     enabled: toBoolean(entry.enabled)
//                 }))
//             );
//         } else {
//             setLocalWorkHeaders([]);
//         }
//         setIsEditing(false);
//     };

//     const isSaveDisabled = useMemo(() => {
//         const currentEnabledNames = new Set(
//             localWorkHeaders.filter(entry => entry.enabled)
//                             .map(entry => entry.name || (typeof entry.project_work_header_name === 'string' ? entry.project_work_header_name : (entry.project_work_header_name as any)?.name))
//                             .filter(Boolean) as string[]
//         );
//         const originalEnabledNames = new Set(
//             (projectData?.project_work_header_entries || []).filter(entry => toBoolean(entry.enabled))
//                                                              .map(entry => entry.name || (typeof entry.project_work_header_name === 'string' ? entry.project_work_header_name : (entry.project_work_header_name as any)?.name))
//                                                              .filter(Boolean) as string[]
//         );

//         if (currentEnabledNames.size !== originalEnabledNames.size) {
//             return false;
//         }

//         for (const name of currentEnabledNames) {
//             if (!originalEnabledNames.has(name)) {
//                 return false;
//             }
//         }
//         return true;
//     }, [localWorkHeaders, projectData?.project_work_header_entries, toBoolean]);


//     if (!projectData.enable_project_milestone_tracking) {
//         return (
//             <div className="p-4 text-center text-gray-600">
//                 Project Milestone Tracking is not enabled for this project.
//                 Please enable it in the Project Form's "Project Timeline" section.
//             </div>
//         );
//     }

//     if (!localWorkHeaders || localWorkHeaders.length === 0 current_roleNirmaan Admin Profile) {
//         return (
//             <div className="p-4 text-center text-gray-600">
//                 No Work Headers configured for milestone tracking.
//                 Please add them via the Project Form if milestone tracking is enabled.
//             </div>
//         );
//     }

//     return (
//         <div className="p-4 border rounded-md shadow-sm bg-white">
//             {/* Header with edit button */}
//             <div className="flex items-center justify-between mb-4">
//                 <h3 className="text-lg font-semibold">Tracked Work Headers</h3>
//                 {!isEditing ? (
//                     <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
//                         <PencilIcon size={24} className="mr-2" color="#e2d008" /> Edit
//                     </Button>
//                 ) : null}
//                 {isEditing && (
//                 <div className="flex justify-end space-x-2">
//                     <Button variant="outline" onClick={handleCancel}>
//                         <XIcon size={24} className="mr-2 text-red-500" color="#ee2020" />Cancel
//                     </Button>
//                     <Button variant="outline" onClick={handleSave} disabled={updateDocLoading || isSaveDisabled}>
//                         {updateDocLoading ? (
//                             <TailSpin width={20} height={20} color="white" />
//                         ) : (
//                             <>
//                                <CircleCheckBig size={24} color="#25ad4d" />Save
//                                 {/* Removed "Save Changes" text */}
//                             </>
//                         )}
//                     </Button>
//                 </div>
//             )}
//             </div>

//             {/* List of checkboxes/labels */}
//             <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2"> {/* Changed to grid for better spacing */}
//                 {localWorkHeaders.map((entry, index) => (
//                     <div
//                         key={entry.name || (typeof entry.project_work_header_name === 'string' ? entry.project_work_header_name : `idx-${index}`)}
//                         className="flex items-center space-x-2"
//                     >
//                         {isEditing ? (
//                             <Checkbox
//                                 id={`wh-${entry.name || (typeof entry.project_work_header_name === 'string' ? entry.project_work_header_name : `idx-${index}`)}`}
//                                 checked={entry.enabled}
//                                 onCheckedChange={(checked) => handleCheckboxChange(index, checked)}
//                             />
//                         ) : (
//                             <span className={`h-4 w-4 rounded-sm border ${entry.enabled ? 'bg-primary border-primary' : 'bg-gray-200 border-gray-300'} flex items-center justify-center`}>
//                                 {entry.enabled && <CheckIcon className="h-3 w-3 text-white" />} {/* Using CheckIcon here */}
//                             </span>
//                         )}
//                         <Label
//                             htmlFor={isEditing ? `wh-${entry.name || (typeof entry.project_work_header_name === 'string' ? entry.project_work_header_name : `idx-${index}`)}` : undefined}
//                             className={isEditing ? "cursor-pointer" : ""}
//                         >
//                             {typeof entry.project_work_header_name === 'string'
//                                 ? entry.project_work_header_name
//                                 : (entry.project_work_header_name as any)?.name || `Unknown Header ${index}`}
//                         </Label>
//                     </div>
//                 ))}
//             </div>

           
            
//         </div>
//     );
// };