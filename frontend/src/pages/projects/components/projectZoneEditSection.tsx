// src/pages/projects/components/ProjectZoneEditSection.tsx
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TailSpin } from "react-loader-spinner";
import { X, Plus, Pencil, Check } from "lucide-react";
import { toast } from "@/components/ui/use-toast";
import { FrappeDoc, useFrappeUpdateDoc, useFrappePostCall } from "frappe-react-sdk";
import type { KeyedMutator } from "swr";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

// Validation constants
const ZONE_NAME_REGEX = /^[a-zA-Z0-9\s,]+$/;
const VALID_CHAR_REGEX = /^[a-zA-Z0-9\s,]$/;
const INVALID_CHARS_REGEX = /[^a-zA-Z0-9\s,]/g;

interface ProjectZoneEntry {
    name?: string;
    zone_name: string;
}

interface Projects {
    name: string;
    project_zones: ProjectZoneEntry[];
}

interface ProjectsWithZones extends Projects {}

interface ProjectZoneEditSectionProps {
    projectData: ProjectsWithZones;
    isEditing: boolean;
    setIsEditing: React.Dispatch<React.SetStateAction<boolean>>;
    project_mutate: KeyedMutator<FrappeDoc<Projects>>;
    isEditingHeaders: boolean;
}

// Input validation handlers
const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const allowedKeys = [
        "Backspace", "Delete", "Tab", "Escape", "Enter",
        "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
        "Home", "End"
    ];

    if (allowedKeys.includes(e.key) || e.ctrlKey || e.metaKey) {
        return;
    }

    if (!VALID_CHAR_REGEX.test(e.key)) {
        e.preventDefault();
    }
};

const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>, setValue: (val: string) => void) => {
    e.preventDefault();
    const pasteData = e.clipboardData.getData("text");
    const sanitized = pasteData.replace(INVALID_CHARS_REGEX, "");
    if (sanitized !== pasteData) {
        toast({ title: "Note", description: "Special characters removed." });
    }
    setValue(sanitized);
};

// Rename Dialog Component
interface RenameDialogProps {
    isOpen: boolean;
    zone: ProjectZoneEntry;
    onClose: () => void;
    onSave: (projectName: string, frappeDocName: string, oldZoneName: string, newZoneName: string) => void;
    isLoading: boolean;
    localProjectZones: ProjectZoneEntry[];
}

const RenameZoneDialog: React.FC<RenameDialogProps> = ({
    isOpen,
    zone,
    onClose,
    onSave,
    isLoading,
    localProjectZones
}) => {
    const [newName, setNewName] = useState(zone.zone_name);

    useEffect(() => {
        if (isOpen) {
            setNewName(zone.zone_name);
        }
    }, [isOpen, zone.zone_name]);

    const isFormatValid = useMemo(() => {
        if (!newName) return false;
        return ZONE_NAME_REGEX.test(newName);
    }, [newName]);

    const isLocalDuplicate = useMemo(() => {
        const trimmedNewName = newName.trim();
        if (trimmedNewName === zone.zone_name.trim()) return false;

        return localProjectZones
            .filter((z) => z.name !== zone.name)
            .some((z) => z.zone_name.trim().toLowerCase() === trimmedNewName.toLowerCase());
    }, [newName, zone.name, zone.zone_name, localProjectZones]);

    const handleSave = () => {
        const trimmedNewName = newName.trim();
        const trimmedOldName = zone.zone_name.trim();

        if (trimmedNewName === trimmedOldName || !trimmedNewName || isLocalDuplicate || !zone.name) {
            if (!trimmedNewName) toast({ title: "Error", description: "Zone name cannot be empty.", variant: "destructive" });
            if (isLocalDuplicate) toast({ title: "Error", description: "Zone name already exists.", variant: "destructive" });
            return;
        }

        onSave(zone.name, zone.name, trimmedOldName, trimmedNewName);
    };

    const canSave = newName.trim() && !isLocalDuplicate && newName.trim() !== zone.zone_name.trim() && isFormatValid;

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !isLoading && !open && onClose()}>
            <DialogContent className="sm:max-w-[400px]">
                <DialogHeader>
                    <DialogTitle className="text-base font-medium">Rename Zone</DialogTitle>
                    <DialogDescription className="text-xs text-gray-500">
                        Renaming will update all related progress reports.
                    </DialogDescription>
                </DialogHeader>

                <div className="py-4 space-y-3">
                    <div className="space-y-1.5">
                        <Label className="text-xs text-gray-500">Current Name</Label>
                        <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded text-sm text-gray-600">
                            {zone.zone_name}
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-xs text-gray-500">New Name</Label>
                        <Input
                            id="new-zone-name"
                            value={newName}
                            onChange={(e) => setNewName(e.target.value.replace(INVALID_CHARS_REGEX, ""))}
                            onKeyDown={handleKeyDown}
                            onPaste={(e) => handlePaste(e, setNewName)}
                            placeholder="Enter new zone name"
                            className="h-9 text-sm"
                            autoFocus
                        />
                    </div>

                    {isLocalDuplicate && (
                        <p className="text-xs text-red-500">This zone name already exists.</p>
                    )}
                </div>

                <DialogFooter className="gap-2">
                    <Button variant="ghost" onClick={onClose} disabled={isLoading} className="text-gray-600">
                        Cancel
                    </Button>
                    <Button
                        onClick={handleSave}
                        disabled={isLoading || !canSave}
                        className="bg-sky-500 hover:bg-sky-600 text-white"
                    >
                        {isLoading ? (
                            <TailSpin width={14} height={14} color="white" />
                        ) : (
                            "Save"
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

// Main Component
export const ProjectZoneEditSection: React.FC<ProjectZoneEditSectionProps> = ({
    projectData,
    isEditing,
    setIsEditing,
    project_mutate,
    isEditingHeaders,
}) => {
    const [localProjectZones, setLocalProjectZones] = useState<ProjectZoneEntry[]>(projectData.project_zones || []);
    const [newZoneName, setNewZoneName] = useState("");
    const [renameDialogOpen, setRenameDialogOpen] = useState(false);
    const [zoneToRename, setZoneToRename] = useState<ProjectZoneEntry | null>(null);

    const { updateDoc, loading: updateDocLoading } = useFrappeUpdateDoc();
    const { call: RenameProjectZones, loading: renameLoading } = useFrappePostCall(
        "nirmaan_stack.api.projects.rename_project_zones.rename_zone_and_cascade"
    );

    // Sync local state with project data when not editing
    useEffect(() => {
        if (!isEditing) {
            setLocalProjectZones(projectData.project_zones || []);
            setNewZoneName("");
        }
    }, [projectData.project_zones, isEditing]);

    // Validation
    const isZoneSaveDisabled = useMemo(() => {
        const trimmedNames = localProjectZones.map((z) => z.zone_name.trim()).filter(Boolean);
        const hasEmptyName = localProjectZones.some((z) => !z.zone_name.trim());
        const hasDuplicates = new Set(trimmedNames.map(n => n.toLowerCase())).size !== trimmedNames.length;
        return hasEmptyName || hasDuplicates;
    }, [localProjectZones]);

    // Add zone handler
    const handleAddZone = useCallback(() => {
        const newZone = newZoneName.trim();
        if (!newZone) return;

        if (localProjectZones.some((z) => z.zone_name.trim().toLowerCase() === newZone.toLowerCase())) {
            toast({ title: "Error", description: "Zone name must be unique.", variant: "destructive" });
            return;
        }

        setLocalProjectZones((prev) => [...prev, { zone_name: newZone }]);
        setNewZoneName("");
    }, [newZoneName, localProjectZones]);

    // Remove zone handler
    const handleRemoveZone = useCallback((index: number) => {
        setLocalProjectZones((prev) => prev.filter((_, i) => i !== index));
    }, []);

    // Save zones handler
    const handleSaveZones = async () => {
        const zonesToSave = localProjectZones
            .filter((z) => z.zone_name.trim())
            .map((zone) => ({
                name: zone.name,
                zone_name: zone.zone_name.trim(),
            }));

        if (isZoneSaveDisabled) return;

        try {
            await updateDoc("Projects", projectData.name, {
                project_zones: zonesToSave,
            });
            await project_mutate();
            toast({
                title: "Success",
                description: "Zones updated successfully.",
                variant: "success",
            });
            setIsEditing(false);
        } catch (error) {
            console.error("Failed to update project zones:", error);
            toast({
                title: "Error",
                description: "Failed to update zones.",
                variant: "destructive",
            });
        }
    };

    // Cancel edit handler
    const handleCancelZones = () => {
        setLocalProjectZones(projectData.project_zones || []);
        setNewZoneName("");
        setIsEditing(false);
    };

    // Rename handlers
    const handleStartRename = (zone: ProjectZoneEntry) => {
        if (!zone.name) {
            toast({ title: "Info", description: "Save new zones before renaming." });
            return;
        }
        setZoneToRename(zone);
        setRenameDialogOpen(true);
    };

    const handleRenameDirect = useCallback(
        async (projectName: string, frappeDocName: string, oldZoneName: string, newZoneName: string) => {
            try {
                await RenameProjectZones({
                    project_name: projectName,
                    zone_doc_name: frappeDocName,
                    old_zone_name: oldZoneName,
                    new_zone_name: newZoneName,
                });

                const updatedZones = localProjectZones.map((zone) =>
                    zone.name === frappeDocName ? { ...zone, zone_name: newZoneName } : zone
                );
                setLocalProjectZones(updatedZones);

                setRenameDialogOpen(false);
                setZoneToRename(null);

                toast({
                    title: "Success",
                    description: `Zone renamed to "${newZoneName}".`,
                    variant: "success",
                });

                await project_mutate();
            } catch (error) {
                console.error("Failed to rename zone:", error);
                toast({
                    title: "Error",
                    description: "Failed to rename zone.",
                    variant: "destructive",
                });
            }
        },
        [localProjectZones, projectData.name, project_mutate, RenameProjectZones]
    );

    const zonesToRender = isEditing ? localProjectZones : projectData.project_zones;
    const zonesExist = zonesToRender && zonesToRender.length > 0;
    const isAnyLoading = updateDocLoading || renameLoading;

    return (
        <>
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
                <div>
                    <h3 className="text-sm font-medium text-gray-900">Project Zones</h3>
                    <p className="text-xs text-gray-500 mt-0.5">
                        {zonesExist ? `${zonesToRender.length} zone${zonesToRender.length > 1 ? "s" : ""} configured` : "No zones configured"}
                    </p>
                </div>

                {isEditing ? (
                    <div className="flex items-center gap-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleCancelZones}
                            disabled={isAnyLoading}
                            className="h-8 text-gray-600"
                        >
                            Cancel
                        </Button>
                        <Button
                            size="sm"
                            onClick={handleSaveZones}
                            disabled={isAnyLoading || isZoneSaveDisabled}
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
                        onClick={() => setIsEditing(true)}
                        disabled={isEditingHeaders || renameLoading}
                        className="h-8"
                    >
                        <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
                    </Button>
                )}
            </div>

            {/* Zone List */}
            <div className="border border-gray-200 rounded">
                {/* Add zone input (editing mode) */}
                {isEditing && (
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 bg-gray-50">
                        <Input
                            type="text"
                            placeholder="Enter zone name"
                            value={newZoneName}
                            onChange={(e) => setNewZoneName(e.target.value.replace(INVALID_CHARS_REGEX, ""))}
                            onKeyDown={(e) => {
                                handleKeyDown(e);
                                if (e.key === "Enter" && !e.defaultPrevented && newZoneName.trim()) {
                                    handleAddZone();
                                }
                            }}
                            onPaste={(e) => handlePaste(e, setNewZoneName)}
                            disabled={updateDocLoading}
                            className="flex-1 h-8 text-sm"
                        />
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleAddZone}
                            disabled={updateDocLoading || !newZoneName.trim()}
                            className="h-8 px-2"
                        >
                            <Plus className="h-4 w-4" />
                        </Button>
                    </div>
                )}

                {/* Zones */}
                {zonesExist ? (
                    <div className="divide-y divide-gray-200">
                        {zonesToRender.map((zone, index) => (
                            <div
                                key={zone.name || `new-${index}`}
                                className="flex items-center justify-between px-3 py-2"
                            >
                                <span className="text-sm text-gray-700">{zone.zone_name}</span>

                                <div className="flex items-center gap-1">
                                    {/* Rename button - always visible for saved zones */}
                                    {zone.name && (
                                        <button
                                            type="button"
                                            onClick={() => handleStartRename(zone)}
                                            disabled={isAnyLoading}
                                            className="p-1.5 text-gray-400 hover:text-sky-500 disabled:opacity-50"
                                            title="Rename zone"
                                        >
                                            <Pencil className="h-3.5 w-3.5" />
                                        </button>
                                    )}

                                    {/* Remove button - only for new zones in edit mode */}
                                    {isEditing && !zone.name && (
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveZone(index)}
                                            disabled={updateDocLoading}
                                            className="p-1.5 text-gray-400 hover:text-red-500 disabled:opacity-50"
                                            title="Remove zone"
                                        >
                                            <X className="h-3.5 w-3.5" />
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="px-3 py-4 text-center">
                        <p className="text-sm text-gray-500">No zones defined.</p>
                        {!isEditing && (
                            <p className="text-xs text-gray-400 mt-1">Click Edit to add zones.</p>
                        )}
                    </div>
                )}

                {/* Validation error */}
                {isEditing && isZoneSaveDisabled && localProjectZones.length > 0 && (
                    <div className="px-3 py-2 bg-red-50 border-t border-red-100">
                        <p className="text-xs text-red-600">Zone names must be unique and non-empty.</p>
                    </div>
                )}
            </div>

            {/* Rename Dialog */}
            {zoneToRename && (
                <RenameZoneDialog
                    isOpen={renameDialogOpen}
                    zone={zoneToRename}
                    onClose={() => setRenameDialogOpen(false)}
                    onSave={(_projectName, frappeDocName, oldZoneName, newZoneName) =>
                        handleRenameDirect(projectData.name, frappeDocName, oldZoneName, newZoneName)
                    }
                    isLoading={renameLoading}
                    localProjectZones={localProjectZones}
                />
            )}
        </>
    );
};
