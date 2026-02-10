import React, { useMemo, useEffect } from "react";
import ReactSelect from 'react-select';
import { Label } from "@/components/ui/label";
import { Folder, ListTodo } from "lucide-react";

interface Task {
    name: string;
    item_name: string;
    critical_po_category: string;
    associated_pos: string[];
    associated_pos_count: number;
    status?: string;
    sub_category?: string;
}

interface CategoryTaskSelectorProps {
    categories: string[];
    tasks: Task[];
    selectedCategory: string;
    selectedTask: string;
    onCategoryChange: (category: string) => void;
    onTaskChange: (taskId: string, taskDoc: Task | null) => void;
    isLoading?: boolean;
    disabled?: boolean;
    required?: boolean;
}

// Custom styles for React-Select
const selectStyles = {
    control: (base: any, state: any) => ({
        ...base,
        minHeight: '40px',
        borderColor: state.isFocused ? '#3b82f6' : '#e2e8f0',
        boxShadow: state.isFocused ? '0 0 0 2px rgba(59, 130, 246, 0.2)' : 'none',
        '&:hover': {
            borderColor: '#3b82f6'
        }
    }),
    option: (base: any, state: any) => ({
        ...base,
        backgroundColor: state.isSelected ? '#3b82f6' : state.isFocused ? '#f1f5f9' : 'white',
        color: state.isSelected ? 'white' : '#1e293b',
        cursor: 'pointer'
    }),
    placeholder: (base: any) => ({
        ...base,
        color: '#94a3b8'
    })
};

export const CategoryTaskSelector: React.FC<CategoryTaskSelectorProps> = ({
    categories,
    tasks,
    selectedCategory,
    selectedTask,
    onCategoryChange,
    onTaskChange,
    isLoading = false,
    disabled = false,
    required = false,
}) => {
    // Filter tasks based on selected category
    const filteredTasks = useMemo(() => {
        if (!selectedCategory) return tasks;
        return tasks.filter((task) => task.critical_po_category === selectedCategory);
    }, [tasks, selectedCategory]);

    // Category options for React-Select
    const categoryOptions = useMemo(() => {
        return categories.map(cat => ({ value: cat, label: cat }));
    }, [categories]);

    // Task options for React-Select
    const taskOptions = useMemo(() => {
        return filteredTasks.map(task => ({
            value: task.name,
            label: task.item_name,
            subCategory: task.sub_category,
            category: task.critical_po_category,
            posCount: task.associated_pos_count
        }));
    }, [filteredTasks]);

    // Auto-fill category when task is selected
    useEffect(() => {
        if (selectedTask) {
            const task = tasks.find((t) => t.name === selectedTask);
            if (task && task.critical_po_category) {
                if (selectedCategory !== task.critical_po_category) {
                    onCategoryChange(task.critical_po_category);
                }
            }
        }
    }, [selectedTask, tasks]);

    // Handle category change
    const handleCategoryChange = (option: any) => {
        const value = option?.value || "";
        onCategoryChange(value);
        // Clear task when category changes
        if (selectedTask) {
            const currentTask = tasks.find((t) => t.name === selectedTask);
            if (currentTask && currentTask.critical_po_category !== value) {
                onTaskChange("", null);
            }
        }
    };

    // Handle task change
    const handleTaskChange = (option: any) => {
        const value = option?.value || "";
        const taskDoc = tasks.find((t) => t.name === value) || null;
        onTaskChange(value, taskDoc);
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-col md:flex-row md:items-start gap-4">
                {/* Category Selection */}
                <div className="flex-1 min-w-0 space-y-2">
                    <Label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                        <Folder className="h-4 w-4 text-blue-500" />
                        Critical PO Category
                        {required && <span className="text-red-500">*</span>}
                    </Label>
                    <ReactSelect
                        options={categoryOptions}
                        value={categoryOptions.find(opt => opt.value === selectedCategory) || null}
                        onChange={handleCategoryChange}
                        placeholder="Select Category..."
                        isDisabled={disabled || isLoading}
                        styles={{
                            ...selectStyles,
                            control: (base: any, state: any) => ({
                                ...base,
                                minHeight: '40px',
                                borderColor: required && !selectedCategory 
                                    ? '#ef4444' 
                                    : state.isFocused ? '#3b82f6' : '#e2e8f0',
                                boxShadow: state.isFocused 
                                    ? required && !selectedCategory 
                                        ? '0 0 0 2px rgba(239, 68, 68, 0.2)' 
                                        : '0 0 0 2px rgba(59, 130, 246, 0.2)' 
                                    : 'none',
                                '&:hover': {
                                    borderColor: required && !selectedCategory ? '#ef4444' : '#3b82f6'
                                }
                            }),
                            option: (base: any, state: any) => ({
                                ...base,
                                backgroundColor: state.isSelected ? '#3b82f6' : state.isFocused ? '#f1f5f9' : 'white',
                                color: state.isSelected ? 'white' : '#1e293b',
                                cursor: 'pointer'
                            })
                        }}
                        isClearable
                    />
                </div>

                {/* Task Selection */}
                <div className="flex-1 min-w-0 space-y-2">
                    <Label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                        <ListTodo className="h-4 w-4 text-orange-500" />
                        Critical PO Task
                        {required && <span className="text-red-500">*</span>}
                    </Label>
                    <ReactSelect
                        options={taskOptions}
                        value={taskOptions.find(opt => opt.value === selectedTask) || null}
                        onChange={handleTaskChange}
                        placeholder="Select Task..."
                        isDisabled={disabled || isLoading}
                        formatOptionLabel={(option: any) => (
                            <div className="flex items-center gap-1">
                                <span>{option.label}</span>
                                {option.subCategory && (
                                    <span className="text-xs text-gray-500">({option.subCategory})</span>
                                )}
                                {option.category && (
                                    <span className="text-xs text-blue-500 ml-1">- {option.category}</span>
                                )}
                                {option.posCount > 0 && (
                                    <span className="text-xs text-green-500 ml-1">({option.posCount} POs)</span>
                                )}
                            </div>
                        )}
                        styles={{
                            ...selectStyles,
                            control: (base: any, state: any) => ({
                                ...base,
                                minHeight: '40px',
                                borderColor: required && !selectedTask 
                                    ? '#ef4444' 
                                    : state.isFocused ? '#3b82f6' : '#e2e8f0',
                                boxShadow: state.isFocused 
                                    ? required && !selectedTask 
                                        ? '0 0 0 2px rgba(239, 68, 68, 0.2)' 
                                        : '0 0 0 2px rgba(59, 130, 246, 0.2)' 
                                    : 'none',
                                '&:hover': {
                                    borderColor: required && !selectedTask ? '#ef4444' : '#3b82f6'
                                }
                            }),
                            option: (base: any, state: any) => ({
                                ...base,
                                backgroundColor: state.isSelected ? '#3b82f6' : state.isFocused ? '#f1f5f9' : 'white',
                                color: state.isSelected ? 'white' : '#1e293b',
                                cursor: 'pointer'
                            })
                        }}
                        isClearable
                        noOptionsMessage={() => 
                            filteredTasks.length === 0 
                                ? `No tasks available${selectedCategory ? ' for this category' : ''}`
                                : 'No options'
                        }
                    />
                </div>
            </div>

            {/* Selected task info */}
            {selectedTask && (
                <div className="p-3 bg-muted rounded-md text-sm">
                    {(() => {
                        const task = tasks.find((t) => t.name === selectedTask);
                        if (!task) return null;
                        return (
                            <div className="space-y-1">
                                {/* <div className="font-medium"></div> */}
                                <div className="flex items-center gap-2 text-muted-foreground">
                                  <span>{task.item_name}{task.sub_category ? ` (${task.sub_category})` : ''}</span>
                                  <span>|</span>
                                    <span>Category: {task.critical_po_category || "None"}</span>
                                    <span>|</span>
                                    <span>
                                        {task.associated_pos_count > 0
                                            ? `${task.associated_pos_count} Associated POs`
                                            : "No Associated POs"}
                                    </span>
                                </div>
                            </div>
                        );
                    })()}
                </div>
            )}
        </div>
    );
};

export default CategoryTaskSelector;
