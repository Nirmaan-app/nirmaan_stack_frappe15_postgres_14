// src/pages/projects/components/ProjectWorkReportTab.tsx
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Projects, ProjectWorkHeaderEntry } from "@/types/NirmaanStack/Projects";
import { FrappeDoc, KeyedMutator, useFrappeUpdateDoc } from "frappe-react-sdk";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/use-toast";
import { TailSpin } from "react-loader-spinner";

// Import icons: Pencil (for edit) and Check (for save)
import { PencilIcon, CircleCheckBig, CheckIcon, XIcon } from "lucide-react"; // XIcon for cancel

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
    const { updateDoc, loading: updateDocLoading } = useFrappeUpdateDoc();

    const toBoolean = useCallback((val: boolean | string | "True" | "False" | undefined | null): boolean => {
        if (typeof val === 'boolean') {
            return val;
        }
        if (typeof val === 'string') {
            return val.toLowerCase() === 'true';
        }
        return false;
    }, []);

    useEffect(() => {
        if (projectData?.project_work_header_entries) {
            setLocalWorkHeaders(
                projectData.project_work_header_entries.map(entry => ({
                    ...entry,
                    enabled: toBoolean(entry.enabled)
                }))
            );
        } else {
            setLocalWorkHeaders([]);
        }
    }, [projectData?.project_work_header_entries, toBoolean]);

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
            const headersToSave = localWorkHeaders;

            await updateDoc("Projects", projectData.name, {
                project_work_header_entries: headersToSave,
                enable_project_milestone_tracking: true,
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

    const handleCancel = () => {
        if (projectData?.project_work_header_entries) {
            setLocalWorkHeaders(
                projectData.project_work_header_entries.map(entry => ({
                    ...entry,
                    enabled: toBoolean(entry.enabled)
                }))
            );
        } else {
            setLocalWorkHeaders([]);
        }
        setIsEditing(false);
    };

    const isSaveDisabled = useMemo(() => {
        const currentEnabledNames = new Set(
            localWorkHeaders.filter(entry => entry.enabled)
                .map(entry => entry.name || (typeof entry.project_work_header_name === 'string' ? entry.project_work_header_name : (entry.project_work_header_name as any)?.name))
                .filter(Boolean) as string[]
        );
        const originalEnabledNames = new Set(
            (projectData?.project_work_header_entries || []).filter(entry => toBoolean(entry.enabled))
                .map(entry => entry.name || (typeof entry.project_work_header_name === 'string' ? entry.project_work_header_name : (entry.project_work_header_name as any)?.name))
                .filter(Boolean) as string[]
        );

        if (currentEnabledNames.size !== originalEnabledNames.size) {
            return false;
        }

        for (const name of currentEnabledNames) {
            if (!originalEnabledNames.has(name)) {
                return false;
            }
        }
        return true;
    }, [localWorkHeaders, projectData?.project_work_header_entries, toBoolean]);


    if (!projectData.enable_project_milestone_tracking) {
        return (
            <div className="p-4 text-center text-gray-600">
                Project Milestone Tracking is not enabled for this project.
                Please enable it in the Project Form's "Project Timeline" section.
            </div>
        );
    }
    
  

    if (!localWorkHeaders || localWorkHeaders.length === 0) {
        return (
            <div className="p-4 text-center text-gray-600">
                No Work Headers configured for milestone tracking.
                Please add them via the Project Form if milestone tracking is enabled.
            </div>
        );
    }

    return (
      <>
      {current_role === "Nirmaan Admin Profile" &&(
         <div className="p-4 border rounded-md shadow-sm bg-white">
            {/* Header with edit button */}
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">Tracked Work Headers</h3>
                {!isEditing ? (
                    <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
                        <PencilIcon size={20} className="mr-2" /> Edit
                    </Button>
                ) : null}
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
                                    {/* Removed "Save Changes" text */}
                                </>
                            )}
                        </Button>
                    </div>
                )}
            </div>

            {/* List of checkboxes/labels */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2"> {/* Changed to grid for better spacing */}
                {localWorkHeaders.map((entry, index) => (
                    <div
                        key={entry.name || (typeof entry.project_work_header_name === 'string' ? entry.project_work_header_name : `idx-${index}`)}
                        className="flex items-center space-x-2"
                    >
                        {isEditing ? (
                            <Checkbox
                                id={`wh-${entry.name || (typeof entry.project_work_header_name === 'string' ? entry.project_work_header_name : `idx-${index}`)}`}
                                checked={entry.enabled}
                                onCheckedChange={(checked) => handleCheckboxChange(index, checked)}
                            />
                        ) : (
                            <span className={`h-4 w-4 rounded-sm border ${entry.enabled ? 'bg-primary border-primary' : 'bg-gray-200 border-gray-300'} flex items-center justify-center`}>
                                {entry.enabled && <CheckIcon className="h-3 w-3 text-white" />} {/* Using CheckIcon here */}
                            </span>
                        )}
                        <Label
                            htmlFor={isEditing ? `wh-${entry.name || (typeof entry.project_work_header_name === 'string' ? entry.project_work_header_name : `idx-${index}`)}` : undefined}
                            className={isEditing ? "cursor-pointer" : ""}
                        >
                            {typeof entry.project_work_header_name === 'string'
                                ? entry.project_work_header_name
                                : (entry.project_work_header_name as any)?.name || `Unknown Header ${index}`}
                        </Label>
                    </div>
                ))}
            </div>

        </div>
      )}
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