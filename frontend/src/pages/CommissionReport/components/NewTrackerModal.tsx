import React, { useMemo, useState, useEffect } from "react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
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
import { CommissionReportTask, TaskTemplate } from "../types";
import { PenTool, Grid3X3 } from "lucide-react";
import { useCreateCommissionTracker } from "../data/useCommissionMutations";

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

    const { createTracker, loading: createLoading } = useCreateCommissionTracker();

    const visibleCategories = useMemo(() => {
        if (!categoryData) return [];
        return categoryData.filter((cat: any) => Array.isArray(cat.tasks) && cat.tasks.length > 0);
    }, [categoryData]);

    const handleCategoryToggle = (categoryName: string) => {
        setSelectedCategories(prev => prev.includes(categoryName) ? prev.filter(c => c !== categoryName) : [...prev, categoryName])
    };

    const handleConfirm = async () => {
        if (!selectedProjectId || selectedCategories.length === 0) {
            toast({ title: "Error", description: "Select project and at least one category.", variant: "destructive" });
            return;
        }

        const projectLabel = preSelectedProjectName || projectOptions.find(p => p.value === selectedProjectId)?.label;
        if (!projectLabel) return;

        const normalizeToDate = (rawDate?: string | null) => {
            if (!rawDate) return undefined;
            const parsed = new Date(rawDate);
            if (Number.isNaN(parsed.getTime())) return undefined;
            return parsed.toISOString().split("T")[0];
        };

        const selectedProjectDoc = projects?.find((p: any) => p.name === selectedProjectId);
        const handoverBaseDate =
            normalizeToDate(selectedProjectDoc?.handover_date) ||
            new Date().toISOString().split("T")[0];

        const tasksToGenerate: Partial<CommissionReportTask>[] = [];

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
                             // Commission deadlines are relative to Project Handover date.
                             const baseDate = new Date(handoverBaseDate);
                             const d = new Date(baseDate);
                             d.setDate(baseDate.getDate() + offset);
                             calculatedDeadline = format(d, 'yyyy-MM-dd');
                         }
                    }

                    tasksToGenerate.push({
                        task_name: taskName,
                        commission_category: catName,
                        task_status: 'Pending',
                        deadline: calculatedDeadline,
                    })
                });
            }
        });

        if (tasksToGenerate.length === 0) {
            toast({ title: "Error", description: "No tasks could be generated from selected categories.", variant: "destructive" });
            return;
        }

        try {
            await createTracker({
                project: selectedProjectId,
                project_name: projectLabel,
                start_date: handoverBaseDate,
                status: 'Assign Pending',
                commission_report_task: tasksToGenerate,
            });
            toast({ title: "Success", description: `Commission Report created for ${projectLabel}.`, variant: "success" });

            // Reset State
            setSelectedProjectId(preSelectedProjectId || null);
            setSelectedCategories([]);

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
                        <span>Create Commission Report</span>
                    </AlertDialogTitle>
                    {preSelectedProjectId && (
                        <AlertDialogDescription className="ml-[52px]">
                            Setting up commission report for <span className="font-semibold text-primary">{preSelectedProjectName}</span>
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
                                menuPortalTarget={document.body}
                                menuPosition="fixed"
                                placeholder="Search Project..."
                                styles={{
                                    menuPortal: (base) => ({
                                        ...base,
                                        zIndex: 9999,
                                        pointerEvents: 'auto'
                                    }),
                                    menu: (base) => ({
                                        ...base,
                                        pointerEvents: 'auto'
                                    })
                                }}
                            />
                        </div>
                    )}

                    {/* Step 2: Category Selection */}
                    <div className="space-y-4">
                        <div className="flex items-center gap-2 border-b border-gray-100 pb-2">
                            <Grid3X3 className="h-4 w-4 text-gray-500" />
                            <Label className="text-sm font-medium text-gray-700">
                                {preSelectedProjectId ? 'Step 1' : 'Step 2'}: Choose Categories <span className="text-red-500">*</span>
                            </Label>
                        </div>

                        {/* Show only when a project is selected */}
                        {selectedProjectId ? (
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
                                Select a project first to select categories
                            </div>
                        )}
                    </div>
                </div>

                <AlertDialogFooter>
                    <AlertDialogCancel disabled={createLoading} onClick={onClose}> Cancel</AlertDialogCancel>
                    <Button
                        onClick={handleConfirm}
                        disabled={!selectedProjectId || selectedCategories.length === 0 || createLoading}
                    >
                        {createLoading ? <TailSpin width={20} height={20} color="white" /> : "Confirm"}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
};
