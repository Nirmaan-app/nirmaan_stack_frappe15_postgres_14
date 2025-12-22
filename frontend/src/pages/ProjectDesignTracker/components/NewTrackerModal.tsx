import React, { useMemo, useState } from "react";
import { format } from "date-fns";
import { useFrappeCreateDoc } from "frappe-react-sdk";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from '@/components/ui/label';
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
import { DesignTrackerTask } from "../types";

const DOCTYPE = 'Project Design Tracker';

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

    // Zone State
    const [zones, setZones] = useState<string[]>([]);
    const [currentZoneInput, setCurrentZoneInput] = useState("");
    const [isManualZone, setIsManualZone] = useState<boolean | null>(null); // null = not selected, true = yes, false = no

    const { createDoc, loading: createLoading } = useFrappeCreateDoc();

    const visibleCategories = useMemo(() => {
        if (!categoryData) return [];
        return categoryData.filter((cat: any) => Array.isArray(cat.tasks) && cat.tasks.length > 0);
    }, [categoryData]);

    const handleCategoryToggle = (categoryName: string) => {
        setSelectedCategories(prev => prev.includes(categoryName) ? prev.filter(c => c !== categoryName) : [...prev, categoryName])
    };

    const handleManualZoneChange = (value: string) => {
        const isManual = value === "yes";
        setIsManualZone(isManual);

        if (isManual) {
            // Reset to empty to allow manual entry
            setZones([]);
        } else {
            // Set to default zone
            setZones(["Default"]);
        }
        setCurrentZoneInput("");
    };

    const handleAddZone = () => {
        if (currentZoneInput.trim()) {
            // Validation: Alphanumeric only
            const trimmed = currentZoneInput.trim();
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
        }
    };

    const handleRemoveZone = (zoneToRemove: string) => {
        setZones(zones.filter(z => z !== zoneToRemove));
    };

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
                    const taskItems = categoryDef.tasks;

                    taskItems.forEach(taskDef => {
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
            setIsManualZone(null);

            onSuccess();
            onClose();
        } catch (error: any) {
            toast({ title: "Creation Failed", description: error.message || "Failed to create tracker.", variant: "destructive" })
        }
    };

    // Reset state when modal opens/closes
    React.useEffect(() => {
        if (isOpen) {
            setSelectedProjectId(preSelectedProjectId || null);
            setSelectedCategories([]);
            setZones([]);
            setCurrentZoneInput("");
            setIsManualZone(null);
        }
    }, [isOpen, preSelectedProjectId]);

    return (
        <AlertDialog open={isOpen} onOpenChange={onClose}>
            <AlertDialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
                <AlertDialogHeader>
                    <AlertDialogTitle className="text-center">Create Design Tracker</AlertDialogTitle>
                    {preSelectedProjectId && (
                        <AlertDialogDescription className="text-center">
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
                                menuPosition={'auto'}
                                placeholder="Search Project..."
                            />
                        </div>
                    )}

                    {/* Step 2: Zone Selection */}
                    <div className="space-y-3">
                        <Label>{preSelectedProjectId ? 'Step 1' : 'Step 2'}: Add Zones *</Label>

                        <div className="space-y-2">
                             <Label className="text-sm font-normal text-muted-foreground">Do you want to setup manual zones for this Project?</Label>
                             <div className="flex gap-4">
                                <div className="flex items-center space-x-2">
                                    <input
                                        type="radio"
                                        id="r-yes"
                                        name="manual-zones"
                                        value="yes"
                                        checked={isManualZone === true}
                                        onChange={() => handleManualZoneChange('yes')}
                                        className="h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                                    />
                                    <Label htmlFor="r-yes">Yes</Label>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <input
                                        type="radio"
                                        id="r-no"
                                        name="manual-zones"
                                        value="no"
                                        checked={isManualZone === false}
                                        onChange={() => handleManualZoneChange('no')}
                                        className="h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                                    />
                                    <Label htmlFor="r-no">No</Label>
                                </div>
                             </div>
                        </div>

                        {/* Input Box - Only show if Manual is Yes */}
                        {isManualZone === true && (
                            <div className="flex gap-2">
                                <Input
                                    value={currentZoneInput}
                                    onChange={(e) => setCurrentZoneInput(e.target.value)}
                                    placeholder="Enter Zone Name (e.g. Tower A)"
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault();
                                            handleAddZone();
                                        }
                                    }}
                                />
                                <Button type="button" onClick={handleAddZone} variant="secondary">Add</Button>
                            </div>
                        )}

                        {/* Zone List Display */}
                        <div className="flex flex-wrap gap-2 min-h-[40px] items-center">
                            {zones.length === 0 && <span className="text-gray-400 text-sm italic">No zones selected.</span>}

                            {zones.map((zone) => (
                                <Badge key={zone} variant="secondary" className="px-3 py-1 text-sm bg-white border shadow-sm">
                                    {zone}
                                    {isManualZone && (
                                        <button onClick={() => handleRemoveZone(zone)} className="ml-2 text-gray-400 hover:text-red-500">
                                            ×
                                        </button>
                                    )}
                                </Badge>
                            ))}
                        </div>
                    </div>


                    {/* Step 3: Category Selection */}
                    <div className="space-y-2">
                        <Label>{preSelectedProjectId ? 'Step 2' : 'Step 3'}: Choose Categories *</Label>

                        {visibleCategories.length > 0 ? (
                            <div className="grid grid-cols-3 gap-2">
                                {visibleCategories.map((cat: any) => (
                                    <Button
                                        key={cat.category_name}
                                        variant={selectedCategories.includes(cat.category_name) ? "default" : "outline"}
                                        onClick={() => handleCategoryToggle(cat.category_name)}
                                        size="sm"
                                        className="text-xs h-auto py-2 whitespace-normal h-full min-h-[40px]"
                                    >
                                        {cat.category_name}
                                    </Button>
                                ))}
                            </div>
                        ) : (
                            <div className="p-4 text-center text-sm text-gray-500 bg-gray-50 rounded-md">
                                No categories available with defined tasks.
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
