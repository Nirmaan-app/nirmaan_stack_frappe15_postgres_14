// src/pages/projects/components/ProjectZoneEditSection.tsx
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TailSpin } from "react-loader-spinner";
import { CircleCheckBig, XIcon, PlusIcon, PencilIcon } from "lucide-react";
import { toast } from "@/components/ui/use-toast";
import { FrappeDoc, KeyedMutator, useFrappeUpdateDoc, useFrappePostCall } from "frappe-react-sdk"; // Added useFrappePostCall
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"; 

// Assuming types are imported from a shared location or re-declared for module usage
interface ProjectZoneEntry {
    name?: string; // Child Doc name (Frappe primary key for row)
    zone_name: string;
}
interface Projects {
    name: string;
    project_zones: ProjectZoneEntry[];
}
interface ProjectsWithZones extends Projects {
    // Other fields if necessary
}

interface ProjectZoneEditSectionProps {
    projectData: ProjectsWithZones;
    isEditing: boolean;
    setIsEditing: React.Dispatch<React.SetStateAction<boolean>>; // Setter for parent state
    project_mutate: KeyedMutator<FrappeDoc<Projects>>; // Mutator for parent re-fetch
    isEditingHeaders: boolean; // For disabling self
}


// --- Rename Dialog Component (Local) ---
interface RenameDialogProps {
    isOpen: boolean;
    zone: ProjectZoneEntry;
    onClose: () => void;
    // onSave passes Frappe project name, child doc name, old name, new name
    onSave: (projectName: string, frappeDocName: string, oldZoneName: string, newZoneName: string) => void;
    isLoading: boolean;
    localProjectZones: ProjectZoneEntry[];
}

const RenameZoneDialog: React.FC<RenameDialogProps> = ({ isOpen, zone, onClose, onSave, isLoading, localProjectZones }) => {
    const [newName, setNewName] = useState(zone.zone_name);

    useEffect(() => {
        if (isOpen) {
            setNewName(zone.zone_name);
        }
    }, [isOpen, zone.zone_name]);

    const isLocalDuplicate = useMemo(() => {
        const trimmedNewName = newName.trim();
        if (trimmedNewName === zone.zone_name.trim()) return false;
        
        return localProjectZones
            .filter(z => z.name !== zone.name) // Check against all OTHER zones
            .some(z => z.zone_name.trim() === trimmedNewName);
    }, [newName, zone.name, zone.zone_name, localProjectZones]);

    const handleSave = () => {
        const trimmedNewName = newName.trim();
        const trimmedOldName = zone.zone_name.trim();

        if (trimmedNewName === trimmedOldName || !trimmedNewName || isLocalDuplicate || !zone.name) {
            if (!trimmedNewName) toast({ title: "Validation", description: "Zone name cannot be empty.", variant: "destructive" });
            if (isLocalDuplicate) toast({ title: "Validation", description: "Zone name is already in use.", variant: "destructive" });
            return;
        }
        
        // Pass projectData.name (parent doc name) as the first argument, which is the project ID
        onSave(zone.name, zone.name, trimmedOldName, trimmedNewName); 
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !isLoading && open ? {} : onClose()}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Rename Zone: {zone.zone_name}</DialogTitle>
                    <DialogDescription>
                        Enter the new name for the zone. This will trigger a system update to reflect the change in all progress reports.
                    </DialogDescription>
                </DialogHeader>
                <div className="py-4">
                    <Input
                        id="new-zone-name"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder="New Zone Name"
                        autoFocus
                    />
                    {(isLocalDuplicate || !newName.trim()) && (
                         <p className="text-red-500 text-sm mt-1">Zone name cannot be empty or a duplicate.</p>
                    )}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={isLoading}>
                        Cancel
                    </Button>
                    <Button 
                        onClick={handleSave} 
                        disabled={isLoading || !newName.trim() || isLocalDuplicate || newName.trim() === zone.zone_name.trim()}
                    >
                         {isLoading ? <TailSpin width={16} height={16} color="white" /> : "Save & Cascade Rename"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};


// --- ProjectZoneEditSection Component ---

export const ProjectZoneEditSection: React.FC<ProjectZoneEditSectionProps> = ({
    projectData,
    isEditing,
    setIsEditing,
    project_mutate,
    isEditingHeaders,
}) => {
    // Internal state now manages the local list
    const [localProjectZones, setLocalProjectZones] = useState<ProjectZoneEntry[]>(projectData.project_zones || []);
    const [newZoneName, setNewZoneName] = useState('');

    // Rename Dialog State
    const [renameDialogOpen, setRenameDialogOpen] = useState(false);
    const [zoneToRename, setZoneToRename] = useState<ProjectZoneEntry | null>(null);
    
    // Hooks for API interaction
    const { updateDoc, loading: updateDocLoading } = useFrappeUpdateDoc();
    
    // Dedicated hook for the backend API call (Simulated useFrappePostCall)
    const { call:RenameProjectZones, isLoading: renameLoading } = useFrappePostCall('nirmaan_stack.api.projects.rename_project_zones.rename_zone_and_cascade'); 

    // Sync local zone state with project data when not editing
    useEffect(() => {
        if (!isEditing) {
            setLocalProjectZones(projectData.project_zones || []);
            setNewZoneName('');
        }
    }, [projectData.project_zones, isEditing]);

    // --- Validation (Bulk Save) ---
    const isZoneSaveDisabled = useMemo(() => {
        const trimmedNames = localProjectZones.map(z => z.zone_name.trim()).filter(Boolean);
        const hasEmptyName = localProjectZones.some(z => !z.zone_name.trim());
        const hasDuplicates = new Set(trimmedNames).size !== trimmedNames.length;
        return hasEmptyName || hasDuplicates;
    }, [localProjectZones]);

    // --- Bulk Edit Handlers ---

    const handleAddZone = useCallback(() => {
        const newZone = newZoneName.trim();
        if (!newZone) return;

        if (localProjectZones.some(z => z.zone_name.trim() === newZone)) {
            toast({ title: "Error", description: "Zone name must be unique.", variant: "destructive" });
            return;
        }

        const newEntry: ProjectZoneEntry = { zone_name: newZone };
        setLocalProjectZones(prev => [...prev, newEntry]);
        setNewZoneName('');
    }, [newZoneName, localProjectZones]);

    const handleRemoveZone = useCallback((index: number) => {
        setLocalProjectZones(prev => prev.filter((_, i) => i !== index));
    }, []);

    const handleSaveZones = async () => {
        const zonesToSave = localProjectZones
            .filter(z => z.zone_name.trim()) 
            .map(zone => ({
                name: zone.name, 
                zone_name: zone.zone_name.trim() 
            }));

        if (isZoneSaveDisabled) return;

        try {
            await updateDoc("Projects", projectData.name, {
                project_zones: zonesToSave,
            });
            await project_mutate();
            toast({
                title: "Success",
                description: "Project Zones updated successfully.",
                variant: "success",
            });
            setIsEditing(false); // Update parent state
        } catch (error) {
            console.error("Failed to update project zones:", error);
            toast({
                title: "Error",
                description: "Failed to update Project Zones.",
                variant: "destructive",
            });
        }
    };

    const handleCancelZones = () => {
        setLocalProjectZones(projectData.project_zones || []); // Reset state
        setNewZoneName('');
        setIsEditing(false); // Update parent state
    };
    
    // --- Rename Handlers (Direct API Call) ---

    const handleStartRename = (zone: ProjectZoneEntry) => {
        if (!zone.name) {
             toast({ title: "Error", description: "New zones must be saved before renaming.", variant: "warning" });
             return;
        }
        setZoneToRename(zone);
        setRenameDialogOpen(true);
    };

    const handleRenameDirect = useCallback(async (projectName: string, frappeDocName: string, oldZoneName: string, newZoneName: string) => {
        
        try {
            // STEP 1: Call the dedicated backend method for cascading rename
            await RenameProjectZones({
                project_name: projectName,
                zone_doc_name: frappeDocName, // The unique child table row ID
                old_zone_name: oldZoneName, // The old zone name (for filtering reports)
                new_zone_name: newZoneName, // The new zone name (for updating records)
            });

            // STEP 2: Update local state immediately for visual feedback
            const updatedZones = localProjectZones.map((zone) => 
                zone.name === frappeDocName ? { ...zone, zone_name: newZoneName } : zone
            );
            setLocalProjectZones(updatedZones);

            // STEP 3: Close dialog and clear state
            setRenameDialogOpen(false);
            setZoneToRename(null);
            
            toast({
                title: "Success",
                description: `Zone renamed from "${oldZoneName}" to "${newZoneName}". Reports will be updated shortly.`,
                variant: "success",
            });
            
            // Trigger parent component to re-fetch/re-render fully
            await project_mutate(); 

        } catch (error) {
            console.error("Failed to rename and cascade zone:", error);
            toast({
                title: "Error",
                description: "Failed to rename zone (Backend error).",
                variant: "destructive",
            });
        }
    }, [localProjectZones, projectData.name, project_mutate, RenameProjectZones]); 


    // --- Render Logic ---

    const zonesToRender = isEditing ? localProjectZones : projectData.project_zones;
    const zonesExist = zonesToRender && zonesToRender.length > 0;
    const isAnyLoading = updateDocLoading || renameLoading;

    const renderZoneList = () => {
        if (!zonesExist && !isEditing) {
            return (
                <div className="p-3 border rounded-md bg-white my-2">
                    <p className="text-sm text-gray-500 italic">No zones currently defined for this project.</p>
                </div>
            );
        }

        const ZoneListContent = (
            <div className="flex flex-wrap gap-2">
                {isEditing && (
                    <div className="flex items-center space-x-2 w-full mb-2 border-b pb-2">
                        <Input
                            placeholder="Enter New Zone Name"
                            value={newZoneName}
                            onChange={(e) => setNewZoneName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleAddZone()}
                            className="h-9 w-64"
                            disabled={updateDocLoading}
                        />
                        <Button 
                            onClick={handleAddZone} 
                            size="sm" 
                            disabled={updateDocLoading || !newZoneName.trim()}
                            variant="outline"
                        >
                            <PlusIcon className="h-4 w-4 mr-1" /> Add
                        </Button>
                    </div>
                )}
                
                {zonesToRender.map((zone, index) => (
                    <div 
                        key={zone.name || `new-${index}`} 
                        className="p-2 bg-gray-100 rounded-lg border border-gray-300 shadow-sm flex items-center justify-between space-x-2"
                        style={{ minWidth: '150px' }}
                    >
                        <span className="text-sm font-medium truncate">{zone.zone_name}</span>
                        
                        <div className="flex space-x-1">
                            
                            <Button 
                                variant="ghost" 
                                size="icon" 
                                onClick={() => handleStartRename(zone)} 
                                className="h-7 w-7 text-blue-500 hover:bg-blue-50"
                                // disabled={isEditing || isAnyLoading || !zone.name} 
                                title={!zone.name ? "Save the new zone first to enable renaming" : "Rename Zone (Cascading Update)"}
                            >
                                <PencilIcon className="h-4 w-4" />
                            </Button>

                            {isEditing && ( // Only show Remove when in bulk edit mode
                                <Button 
                                    variant="ghost" 
                                    size="icon" 
                                    onClick={() => handleRemoveZone(index)} 
                                    className="h-7 w-7 text-red-500 hover:bg-red-50"
                                    disabled={zone.name||updateDocLoading}
                                >
                                    <XIcon className="h-4 w-4" />
                                </Button>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        );

        return (
            <div className="p-3 border rounded-md bg-white my-2">
                {isEditing && isZoneSaveDisabled && <p className="text-red-500 text-sm mb-2">Zone names must be unique and non-empty.</p>}
                {ZoneListContent}
            </div>
        );
    };

    return (
        <>
            <div className="flex items-center justify-between mt-4 mb-2">
                <h3 className="text-lg font-semibold">Project Zones</h3>
                
                {/* Zone Edit Buttons (Save/Cancel/Edit) */}
                {isEditing ? (
                    <div className="flex space-x-2">
                        <Button variant="outline" onClick={handleCancelZones} size="sm" disabled={updateDocLoading}>
                            <XIcon size={16} className="mr-1 text-red-500" />Cancel
                        </Button>
                        <Button 
                            variant="default" 
                            onClick={handleSaveZones} 
                            disabled={updateDocLoading || isZoneSaveDisabled || renameLoading}
                            size="sm"
                        >
                            {updateDocLoading ? (
                                <TailSpin width={14} height={14} color="white" /> 
                            ) : (
                                <>
                                    <CircleCheckBig size={16} className="mr-1" />Save Zones
                                </>
                            )}
                        </Button>
                    </div>
                ) : (
                    <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => setIsEditing(true)}
                        disabled={isEditingHeaders || renameLoading} // Disable if header editing or rename is in progress
                    >
                        <PencilIcon size={20} className="mr-2" /> Edit Zones
                    </Button>
                )}
            </div>

            {renderZoneList()}

            {/* Rename Dialog */}
            {zoneToRename && (
                <RenameZoneDialog
                    isOpen={renameDialogOpen}
                    zone={zoneToRename}
                    onClose={() => setRenameDialogOpen(false)}
                    onSave={(projectName, frappeDocName, oldZoneName, newZoneName) => handleRenameDirect(projectData.name, frappeDocName, oldZoneName, newZoneName)}
                    isLoading={renameLoading}
                    localProjectZones={localProjectZones}
                />
            )}
        </>
    );
};

// // src/pages/projects/components/ProjectZoneEditSection.tsx
// import React, { useState, useEffect, useMemo, useCallback } from "react";
// import { Button } from "@/components/ui/button";
// import { Input } from "@/components/ui/input";
// import { TailSpin } from "react-loader-spinner";
// import { CircleCheckBig, XIcon, PlusIcon, PencilIcon } from "lucide-react";
// import { toast } from "@/components/ui/use-toast";
// import { FrappeDoc, KeyedMutator, useFrappeUpdateDoc } from "frappe-react-sdk"; // Needed for internal API call

// // Assuming types are imported from a shared location or re-declared for module usage
// interface ProjectZoneEntry {
//     name?: string; 
//     zone_name: string;
// }
// interface Projects {
//     name: string;
//     project_zones: ProjectZoneEntry[];
// }
// interface ProjectsWithZones extends Projects {
//     // Other fields if necessary
// }

// interface ProjectZoneEditSectionProps {
//     projectData: ProjectsWithZones;
//     isEditing: boolean;
//     setIsEditing: React.Dispatch<React.SetStateAction<boolean>>; // Setter for parent state
//     project_mutate: KeyedMutator<FrappeDoc<Projects>>; // Mutator for parent re-fetch
//     isEditingHeaders: boolean; // For disabling self
// }

// export const ProjectZoneEditSection: React.FC<ProjectZoneEditSectionProps> = ({
//     projectData,
//     isEditing,
//     setIsEditing,
//     project_mutate,
//     isEditingHeaders,
// }) => {
//     // Internal state now manages the local list
//     const [localProjectZones, setLocalProjectZones] = useState<ProjectZoneEntry[]>(projectData.project_zones || []);
//     const [newZoneName, setNewZoneName] = useState('');

//     const { updateDoc, loading: updateDocLoading } = useFrappeUpdateDoc();

//     // Sync local zone state with project data when not editing
//     useEffect(() => {
//         if (!isEditing) {
//             setLocalProjectZones(projectData.project_zones || []);
//             setNewZoneName('');
//         }
//     }, [projectData.project_zones, isEditing]);

//     // --- Validation (Moved from Parent) ---
//     const isZoneSaveDisabled = useMemo(() => {
//         const trimmedNames = localProjectZones.map(z => z.zone_name.trim()).filter(Boolean);
//         const hasEmptyName = localProjectZones.some(z => !z.zone_name.trim());
//         const hasDuplicates = new Set(trimmedNames).size !== trimmedNames.length;
//         return hasEmptyName || hasDuplicates;
//     }, [localProjectZones]);

//     // --- Handlers (Moved from Parent) ---

//     const handleAddZone = useCallback(() => {
//         const newZone = newZoneName.trim();
//         if (!newZone) return;

//         if (localProjectZones.some(z => z.zone_name.trim() === newZone)) {
//             toast({ title: "Error", description: "Zone name must be unique.", variant: "destructive" });
//             return;
//         }

//         const newEntry: ProjectZoneEntry = { zone_name: newZone };
//         setLocalProjectZones(prev => [...prev, newEntry]);
//         setNewZoneName('');
//     }, [newZoneName, localProjectZones]);

//     const handleRemoveZone = useCallback((index: number) => {
//         setLocalProjectZones(prev => prev.filter((_, i) => i !== index));
//     }, []);

//     const handleSaveZones = async () => {
//         const zonesToSave = localProjectZones
//             .filter(z => z.zone_name.trim()) 
//             .map(zone => ({
//                 name: zone.name, 
//                 zone_name: zone.zone_name.trim() 
//             }));

//         if (isZoneSaveDisabled) return;

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
//             setIsEditing(false); // Update parent state
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
//         setIsEditing(false); // Update parent state
//     };


//     // --- Render Logic ---

//     const zonesToRender = isEditing ? localProjectZones : projectData.project_zones;
//     const zonesExist = zonesToRender && zonesToRender.length > 0;

//     const renderZoneList = () => {
//         if (!zonesExist && !isEditing) {
//             return (
//                 <div className="p-3 border rounded-md bg-white my-2">
//                     <p className="text-sm text-gray-500 italic">No zones currently defined for this project.</p>
//                 </div>
//             );
//         }

//         const ZoneListContent = (
//             <div className="flex flex-wrap gap-2">
//                 {isEditing && (
//                     <div className="flex items-center space-x-2 w-full mb-2 border-b pb-2">
//                         <Input
//                             placeholder="Enter New Zone Name"
//                             value={newZoneName}
//                             onChange={(e) => setNewZoneName(e.target.value)}
//                             onKeyDown={(e) => e.key === 'Enter' && handleAddZone()}
//                             className="h-9 w-64"
//                             disabled={updateDocLoading}
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
//                         style={{ minWidth: '150px' }}
//                     >
//                         <span className="text-sm font-medium truncate">{zone.zone_name}</span>
                        
//                         {isEditing && (
//                             <div className="flex space-x-1">
                                
//                                 <Button 
//                                     variant="ghost" 
//                                     size="icon" 
//                                     className="h-7 w-7 text-blue-500 hover:bg-blue-50"
//                                     disabled={true} 
//                                     title="Rename functionality is managed externally"
//                                 >
//                                     <PencilIcon className="h-4 w-4" />
//                                 </Button>

//                                 {/* Only allow removal of zones that haven't been saved yet (no 'name' field) */}
//                                 {(!zone.name) && (
//                                     <Button 
//                                         variant="ghost" 
//                                         size="icon" 
//                                         onClick={() => handleRemoveZone(index)} 
//                                         className="h-7 w-7 text-red-500 hover:bg-red-50"
//                                         disabled={updateDocLoading}
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

//         return (
//             <div className="p-3 border rounded-md bg-white my-2">
//                 {isEditing && isZoneSaveDisabled && <p className="text-red-500 text-sm mb-2">Zone names must be unique and non-empty.</p>}
//                 {ZoneListContent}
//             </div>
//         );
//     };

//     return (
//         <>
//             <div className="flex items-center justify-between mt-4 mb-2">
//                 <h3 className="text-lg font-semibold">Project Zones</h3>
                
//                 {/* Zone Edit Buttons (Save/Cancel/Edit) */}
//                 {isEditing ? (
//                     <div className="flex space-x-2">
//                         <Button variant="outline" onClick={handleCancelZones} size="sm" disabled={updateDocLoading}>
//                             <XIcon size={16} className="mr-1 text-red-500" />Cancel
//                         </Button>
//                         <Button 
//                             variant="default" 
//                             onClick={handleSaveZones} 
//                             disabled={updateDocLoading || isZoneSaveDisabled}
//                             size="sm"
//                         >
//                             {updateDocLoading ? (
//                                 <TailSpin width={14} height={14} color="white" /> 
//                             ) : (
//                                 <>
//                                     <CircleCheckBig size={16} className="mr-1" />Save Zones
//                                 </>
//                             )}
//                         </Button>
//                     </div>
//                 ) : (
//                     <Button 
//                         variant="outline" 
//                         size="sm" 
//                         onClick={() => setIsEditing(true)}
//                         disabled={isEditingHeaders} 
//                     >
//                         <PencilIcon size={20} className="mr-2" /> Edit Zones
//                     </Button>
//                 )}
//             </div>

//             {renderZoneList()}
//         </>
//     );
// };