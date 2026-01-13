import React, { useMemo, useState, useCallback, useEffect } from "react";
import { format } from "date-fns";
import { useFrappeCreateDoc, useFrappeGetDoc } from "frappe-react-sdk";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from "@/components/ui/radiogroup";
import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogCancel
} from "@/components/ui/alert-dialog";
import { TailSpin } from "react-loader-spinner";
import { toast } from "@/components/ui/use-toast";
import ReactSelect from 'react-select';
import { DesignTrackerTask, TaskTemplate } from "../types";
import { Copy, Plus, X, PenTool, MapPin, Grid3X3 } from "lucide-react";
import type { MenuPosition } from 'react-select';

const DOCTYPE = 'Project Design Tracker';

// Zone source options for smart zone handling
type ZoneSource = 'copy_from_progress' | 'single' | 'multiple';

interface ProjectZone {
    zone_name: string;
}

interface NewTrackerModalProps {
    isOpen: boolean;
    onClose: () => void;
    projectOptions: { label: string; value: string }[];
    projects: any[];
    categoryData: any[];
    onSuccess: () => void;
    preSelectedProjectId?: string;
    preSelectedProjectName?: string;
}

export const NewTrackerModal: React.FC<NewTrackerModalProps> = ({
    isOpen,
    onClose,
    projectOptions,
    projects,
    categoryData,
    onSuccess,
    preSelectedProjectId,
    preSelectedProjectName
}) => {
    const [selectedProjectId, setSelectedProjectId] = useState<string | null>(preSelectedProjectId || null);
    const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

    // Smart Zone State
    const [zoneSource, setZoneSource] = useState<ZoneSource | null>(null);
    const [zones, setZones] = useState<string[]>([]);
    const [currentZoneInput, setCurrentZoneInput] = useState("");

    const { createDoc, loading: createLoading } = useFrappeCreateDoc();

    // Fetch project zones from the Projects doctype when a project is selected
    const { data: projectDoc, isLoading: projectZonesLoading } = useFrappeGetDoc<{
        project_zones?: Array<{ zone_name: string }>;
        enable_project_milestone_tracking?: number;
    }>(
        "Projects",
        selectedProjectId || "",
        selectedProjectId ? undefined : null // Don't fetch if no project selected
    );

    // Extract Daily Progress zones from project document
    const dailyProgressZones = useMemo<ProjectZone[]>(() => {
        if (!projectDoc?.project_zones || !Array.isArray(projectDoc.project_zones)) {
            return [];
        }
        return projectDoc.project_zones.filter(z => z.zone_name);
    }, [projectDoc]);

    // Check if project has Daily Progress enabled with zones
    const hasDailyProgressZones = useMemo(() => {
        return projectDoc?.enable_project_milestone_tracking === 1 && dailyProgressZones.length > 0;
    }, [projectDoc, dailyProgressZones]);

    const visibleCategories = useMemo(() => {
        if (!categoryData) return [];
        return categoryData.filter((cat: any) => Array.isArray(cat.tasks) && cat.tasks.length > 0);
    }, [categoryData]);

    const handleCategoryToggle = (categoryName: string) => {
        setSelectedCategories(prev => prev.includes(categoryName) ? prev.filter(c => c !== categoryName) : [...prev, categoryName])
    };

    // Handle zone source selection (copy from progress, single, or multiple)
    const handleZoneSourceChange = useCallback((source: ZoneSource) => {
        setZoneSource(source);

        if (source === 'copy_from_progress') {
            // Copy zones from Daily Progress
            setZones(dailyProgressZones.map(z => z.zone_name));
        } else if (source === 'single') {
            // Single zone (Default)
            setZones(["Default"]);
        } else if (source === 'multiple') {
            // Multiple zones - start fresh
            setZones([]);
        }
        setCurrentZoneInput("");
    }, [dailyProgressZones]);

    const handleAddZone = useCallback(() => {
        const trimmed = currentZoneInput.trim();
        if (!trimmed) return;

        // Validation: Alphanumeric and spaces only
        const isValidFormat = /^[a-zA-Z0-9 ]+$/.test(trimmed);
        if (!isValidFormat) {
            toast({ title: "Invalid Format", description: "Zone name must contain only letters and numbers.", variant: "destructive" });
            return;
        }

        // Duplicate Check (Case Insensitive)
        const isDuplicate = zones.some(z => z.toLowerCase() === trimmed.toLowerCase());
        if (isDuplicate) {
            toast({ title: "Duplicate Zone", description: "This zone name already exists.", variant: "destructive" });
            return;
        }

        setZones([...zones, trimmed]);
        setCurrentZoneInput("");
    }, [currentZoneInput, zones]);

    const handleRemoveZone = useCallback((zoneToRemove: string) => {
        setZones(zones.filter(z => z !== zoneToRemove));
    }, [zones]);

    // Reset zone selection when project changes
    useEffect(() => {
        if (selectedProjectId) {
            setZoneSource(null);
            setZones([]);
            setCurrentZoneInput("");
        }
    }, [selectedProjectId]);

    const handleConfirm = async () => {
        if (!selectedProjectId || selectedCategories.length === 0) {
            toast({ title: "Error", description: "Select project and at least one category.", variant: "destructive" });
            return;
        }

        if (zones.length === 0) {
            toast({ title: "Error", description: "Please add at least one Zone.", variant: "destructive" });
            return;
        }

        const projectLabel = preSelectedProjectName || projectOptions.find(p => p.value === selectedProjectId)?.label;
        if (!projectLabel) return;

        const tasksToGenerate: Partial<DesignTrackerTask>[] = [];

        // Loop through Zones first (or tasks, order doesn't strictly matter for DB, but logical for UI)
        zones.forEach(zoneName => {
            selectedCategories.forEach(catName => {
                const categoryDef = categoryData.find(c => c.category_name === catName);

                if (categoryDef && Array.isArray(categoryDef.tasks) && categoryDef.tasks.length > 0) {
                    const taskItems: TaskTemplate[] = categoryDef.tasks;

                    taskItems.forEach((taskDef: TaskTemplate) => {
                        const taskName = taskDef.task_name;
                        let calculatedDeadline = undefined;
                        if (taskDef.deadline_offset !== undefined && taskDef.deadline_offset !== null) {
                             const offset = Number(taskDef.deadline_offset);
                             if (!isNaN(offset)) {
                                 // Use project start_date if available (found in projects list), else today
                                 const projectStart = projects?.find((p: any) => p.name === selectedProjectId)?.project_start_date;
                                 const baseDate = projectStart ? new Date(projectStart) : new Date();
                                 const d = new Date(baseDate);
                                 d.setDate(baseDate.getDate() + offset);
                                 calculatedDeadline = format(d, 'yyyy-MM-dd');
                             }
                        }

                        tasksToGenerate.push({
                            task_name: taskName,
                            design_category: catName,
                            task_status: 'Not Started',
                            deadline: calculatedDeadline,
                            task_zone: zoneName // Set the Zone

                        })
                    });
                }
            });
        });

        if (tasksToGenerate.length === 0) {
            toast({ title: "Error", description: "No tasks could be generated from selected categories.", variant: "destructive" });
            return;
        }

        // Prepare Zone Child Table Data
        const zoneChildTableData = zones.map(z => ({ tracker_zone: z }));

        try {
            await createDoc(DOCTYPE, {
                project: selectedProjectId,
                project_name: projectLabel,
                start_date: projects?.find((p: any) => p.name === selectedProjectId)?.project_start_date,
                status: 'Assign Pending',
                design_tracker_task: tasksToGenerate,
                zone: zoneChildTableData // Send Zones to backend
            });
            toast({ title: "Success", description: `Design Tracker created for ${projectLabel}.`, variant: "success" });

            // Reset State
            setSelectedProjectId(preSelectedProjectId || null);
            setSelectedCategories([]);
            setZones([]);
            setCurrentZoneInput("");
            setZoneSource(null);

            onSuccess();
            onClose();
        } catch (error: any) {
            toast({ title: "Creation Failed", description: error.message || "Failed to create tracker.", variant: "destructive" })
        }
    };

    // Reset state when modal opens/closes
    useEffect(() => {
        if (isOpen) {
            setSelectedProjectId(preSelectedProjectId || null);
            setSelectedCategories([]);
            setZones([]);
            setCurrentZoneInput("");
            setZoneSource(null);
        }
    }, [isOpen, preSelectedProjectId]);

    return (
        <AlertDialog open={isOpen} onOpenChange={onClose}>
            <AlertDialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
                <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-pink-100 flex items-center justify-center">
                            <PenTool className="h-5 w-5 text-pink-600" />
                        </div>
                        <span>Create Design Tracker</span>
                    </AlertDialogTitle>
                    {preSelectedProjectId && (
                        <AlertDialogDescription className="ml-[52px]">
                            Setting up design tracker for <span className="font-semibold text-primary">{preSelectedProjectName}</span>
                        </AlertDialogDescription>
                    )}
                </AlertDialogHeader>
                <div className="space-y-6 py-2">
                    {/* Step 1: Project Selection - Only show if not pre-selected */}
                    {!preSelectedProjectId && (
                        <div className="space-y-2">
                            <Label>Step 1: Select Project *</Label>
                            <ReactSelect
                                options={projectOptions}
                                value={projectOptions.find((p: any) => p.value === selectedProjectId) || null}
                                onChange={(option: any) => setSelectedProjectId(option ? option.value : null)}
                                classNamePrefix="react-select"
                                menuPosition={'fixed' as MenuPosition}
                                placeholder="Search Project..."
                            />
                        </div>
                    )}

                    {/* Step 2: Zone Configuration */}
                    <div className="space-y-4">
                        <div className="flex items-center gap-2 border-b border-gray-100 pb-2">
                            <MapPin className="h-4 w-4 text-gray-500" />
                            <Label className="text-sm font-medium text-gray-700">
                                {preSelectedProjectId ? 'Step 1' : 'Step 2'}: Configure Zones <span className="text-red-500">*</span>
                            </Label>
                        </div>

                        {/* Loading state for project zones */}
                        {selectedProjectId && projectZonesLoading && (
                            <div className="p-4 text-center text-sm text-gray-500">
                                <TailSpin width={20} height={20} color="#6b7280" wrapperClass="justify-center mb-2" />
                                Loading zone configuration...
                            </div>
                        )}

                        {/* Zone source selection */}
                        {selectedProjectId && !projectZonesLoading && (
                            <div className="border border-gray-200 rounded overflow-hidden">
                                {/* Copy from Daily Progress option (if available) */}
                                {hasDailyProgressZones && (
                                    <div className="p-4 bg-blue-50/50 border-b border-gray-200">
                                        <Label className="text-xs font-medium text-gray-600 uppercase tracking-wide">
                                            Zone Source
                                        </Label>
                                        <p className="text-xs text-gray-400 mt-1 mb-3">
                                            You can copy zones from Daily Progress or configure custom zones
                                        </p>

                                        <RadioGroup
                                            value={zoneSource || ''}
                                            onValueChange={(value: string) => handleZoneSourceChange(value as ZoneSource)}
                                            className="space-y-2"
                                        >
                                            <label className="flex items-center gap-3 px-3 py-2 bg-white border border-gray-200 rounded cursor-pointer hover:border-blue-300">
                                                <RadioGroupItem value="copy_from_progress" id="zone-copy" />
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-2">
                                                        <Copy className="h-3.5 w-3.5 text-blue-500" />
                                                        <span className="text-sm text-gray-700">Copy from Daily Progress</span>
                                                    </div>
                                                    <p className="text-xs text-gray-400 mt-0.5">
                                                        Use the same {dailyProgressZones.length} zone{dailyProgressZones.length !== 1 ? 's' : ''} configured for this project
                                                    </p>
                                                </div>
                                            </label>
                                            <label className="flex items-center gap-3 px-3 py-2 bg-white border border-gray-200 rounded cursor-pointer hover:border-gray-300">
                                                <RadioGroupItem value="single" id="zone-single" />
                                                <div>
                                                    <span className="text-sm text-gray-700">Single Zone (Default)</span>
                                                    <p className="text-xs text-gray-400">All designs tracked under one zone</p>
                                                </div>
                                            </label>
                                            <label className="flex items-center gap-3 px-3 py-2 bg-white border border-gray-200 rounded cursor-pointer hover:border-gray-300">
                                                <RadioGroupItem value="multiple" id="zone-multiple" />
                                                <div>
                                                    <span className="text-sm text-gray-700">Multiple Zones (Custom)</span>
                                                    <p className="text-xs text-gray-400">Configure custom zones for design tracking</p>
                                                </div>
                                            </label>
                                        </RadioGroup>
                                    </div>
                                )}

                                {/* Direct zone type selection (if no Daily Progress zones) */}
                                {!hasDailyProgressZones && (
                                    <div className="p-4 bg-gray-50/50">
                                        <Label className="text-xs font-medium text-gray-600 uppercase tracking-wide">
                                            Zone Configuration
                                        </Label>
                                        <p className="text-xs text-gray-400 mt-1 mb-3">
                                            Zones help organize design tasks by area
                                        </p>

                                        <RadioGroup
                                            value={zoneSource || ''}
                                            onValueChange={(value: string) => handleZoneSourceChange(value as ZoneSource)}
                                            className="space-y-2"
                                        >
                                            <label className="flex items-center gap-3 px-3 py-2 bg-white border border-gray-200 rounded cursor-pointer hover:border-gray-300">
                                                <RadioGroupItem value="single" id="zone-single-direct" />
                                                <div>
                                                    <span className="text-sm text-gray-700">Single Zone (Default)</span>
                                                    <p className="text-xs text-gray-400">All designs tracked under one zone</p>
                                                </div>
                                            </label>
                                            <label className="flex items-center gap-3 px-3 py-2 bg-white border border-gray-200 rounded cursor-pointer hover:border-gray-300">
                                                <RadioGroupItem value="multiple" id="zone-multiple-direct" />
                                                <div>
                                                    <span className="text-sm text-gray-700">Multiple Zones</span>
                                                    <p className="text-xs text-gray-400">Track designs by tower, wing, or area</p>
                                                </div>
                                            </label>
                                        </RadioGroup>
                                    </div>
                                )}

                                {/* Multiple Zones Input (when multiple selected) */}
                                {zoneSource === 'multiple' && (
                                    <div className="p-4 border-t border-gray-200">
                                        {/* Zone List */}
                                        {zones.length > 0 && (
                                            <div className="flex flex-wrap gap-2 mb-3">
                                                {zones.map((zone) => (
                                                    <div
                                                        key={zone}
                                                        className="flex items-center gap-1.5 px-2.5 py-1 bg-white border border-gray-200 rounded text-sm"
                                                    >
                                                        <span className="text-gray-700">{zone}</span>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleRemoveZone(zone)}
                                                            className="text-gray-400 hover:text-red-500"
                                                        >
                                                            <X className="h-3.5 w-3.5" />
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {/* Add Zone Input */}
                                        <div className="flex gap-2">
                                            <Input
                                                type="text"
                                                placeholder="Enter zone name (e.g., Tower A, Block B)"
                                                value={currentZoneInput}
                                                onChange={(e) => setCurrentZoneInput(e.target.value)}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        e.preventDefault();
                                                        handleAddZone();
                                                    }
                                                }}
                                                className="flex-1 h-9 text-sm"
                                            />
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                onClick={handleAddZone}
                                                disabled={!currentZoneInput.trim()}
                                                className="h-9 px-3"
                                            >
                                                <Plus className="h-4 w-4" />
                                            </Button>
                                        </div>

                                        {zones.length === 0 && (
                                            <p className="text-xs text-amber-600 mt-2">
                                                Add at least one zone to continue
                                            </p>
                                        )}
                                    </div>
                                )}

                                {/* Copied Zones Display */}
                                {zoneSource === 'copy_from_progress' && zones.length > 0 && (
                                    <div className="p-4 bg-blue-50/30 border-t border-gray-200">
                                        <Label className="text-xs font-medium text-gray-600 uppercase tracking-wide">
                                            Zones (Copied from Daily Progress)
                                        </Label>
                                        <div className="mt-2 flex flex-wrap gap-2">
                                            {zones.map((zone) => (
                                                <span
                                                    key={zone}
                                                    className="px-2.5 py-1 bg-white border border-blue-200 rounded text-sm text-gray-700"
                                                >
                                                    {zone}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Single Zone Display */}
                                {zoneSource === 'single' && (
                                    <div className="p-4 border-t border-gray-200">
                                        <div className="flex flex-wrap gap-2">
                                            <span className="px-2.5 py-1 bg-gray-100 border border-gray-200 rounded text-sm text-gray-700">
                                                Default (Single Zone)
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* No project selected message */}
                        {!selectedProjectId && (
                            <div className="p-4 text-center text-sm text-gray-400 border border-dashed border-gray-200 rounded">
                                Select a project first to configure zones
                            </div>
                        )}
                    </div>


                    {/* Step 3: Category Selection */}
                    <div className="space-y-4">
                        <div className="flex items-center gap-2 border-b border-gray-100 pb-2">
                            <Grid3X3 className="h-4 w-4 text-gray-500" />
                            <Label className="text-sm font-medium text-gray-700">
                                {preSelectedProjectId ? 'Step 2' : 'Step 3'}: Choose Categories <span className="text-red-500">*</span>
                            </Label>
                        </div>

                        {/* Show only when zones are configured */}
                        {zones.length > 0 ? (
                            <div className="border border-gray-200 rounded overflow-hidden">
                                <div className="p-4">
                                    <Label className="text-xs font-medium text-gray-600 uppercase tracking-wide">
                                        Design Categories
                                    </Label>
                                    <p className="text-xs text-gray-400 mt-1 mb-3">
                                        Select categories to create design tasks
                                    </p>

                                    {visibleCategories.length > 0 ? (
                                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                            {visibleCategories.map((cat: any) => {
                                                const isSelected = selectedCategories.includes(cat.category_name);
                                                return (
                                                    <Button
                                                        key={cat.category_name}
                                                        type="button"
                                                        variant={isSelected ? "default" : "outline"}
                                                        onClick={() => handleCategoryToggle(cat.category_name)}
                                                        size="sm"
                                                        className="text-xs h-auto py-2 whitespace-normal min-h-[40px] justify-start"
                                                    >
                                                        <span className="truncate">{cat.category_name}</span>
                                                        <span className="ml-1 text-[10px] opacity-70">
                                                            ({cat.tasks?.length || 0})
                                                        </span>
                                                    </Button>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <div className="p-4 text-center text-sm text-gray-400 border border-dashed border-gray-200 rounded">
                                            No categories available with defined tasks.
                                        </div>
                                    )}

                                    {selectedCategories.length > 0 && (
                                        <p className="text-xs text-gray-500 mt-3">
                                            {selectedCategories.length} categor{selectedCategories.length !== 1 ? 'ies' : 'y'} selected
                                        </p>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="p-4 text-center text-sm text-gray-400 border border-dashed border-gray-200 rounded">
                                Configure zones first to select categories
                            </div>
                        )}
                    </div>
                </div>

                <AlertDialogFooter>
                    <AlertDialogCancel disabled={createLoading} onClick={onClose}> Cancel</AlertDialogCancel>
                    <Button
                        onClick={handleConfirm}
                        disabled={!selectedProjectId || selectedCategories.length === 0 || zones.length === 0 || createLoading}
                    >
                        {createLoading ? <TailSpin width={20} height={20} color="white" /> : "Confirm"}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
};
