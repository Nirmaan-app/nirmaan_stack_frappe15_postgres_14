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
}) => {
    // Filter tasks based on selected category
    const filteredTasks = useMemo(() => {
        if (!selectedCategory) return tasks;
        return tasks.filter((task) => task.critical_po_category === selectedCategory);
    }, [tasks, selectedCategory]);

    // Category options for React-Select
    const categoryOptions = useMemo(() => {
        return [
            { value: "", label: "All Categories" },
            ...categories.map(cat => ({ value: cat, label: cat }))
        ];
    }, [categories]);

    // Task options for React-Select
    const taskOptions = useMemo(() => {
        const options = [
            { value: "", label: "No task selected" },
            ...filteredTasks.map(task => ({
                value: task.name,
                label: `${task.item_name}${task.associated_pos_count > 0 ? ` (${task.associated_pos_count} POs)` : ''}`
            }))
        ];
        return options;
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
            {/* Category Selector */}
            <div className="space-y-2">
                <Label className="flex items-center gap-2">
                    <Folder className="h-4 w-4" />
                    Critical PO Category
                </Label>
                <ReactSelect
                    value={categoryOptions.find(opt => opt.value === selectedCategory)}
                    onChange={handleCategoryChange}
                    options={categoryOptions}
                    isDisabled={disabled || isLoading}
                    isLoading={isLoading}
                    placeholder="Select a category (optional)"
                    isClearable
                    styles={selectStyles}
                />
            </div>

            {/* Task Selector */}
            <div className="space-y-2">
                <Label className="flex items-center gap-2">
                    <ListTodo className="h-4 w-4" />
                    Critical PO Task
                    <span className="text-muted-foreground text-xs">(optional)</span>
                </Label>
                <ReactSelect
                    value={taskOptions.find(opt => opt.value === selectedTask)}
                    onChange={handleTaskChange}
                    options={taskOptions}
                    isDisabled={disabled || isLoading}
                    isLoading={isLoading}
                    placeholder="Select a task"
                    isClearable
                    styles={selectStyles}
                    noOptionsMessage={() => 
                        filteredTasks.length === 0 
                            ? `No tasks available${selectedCategory ? ' for this category' : ''}`
                            : 'No options'
                    }
                />
            </div>

            {/* Selected task info */}
            {selectedTask && (
                <div className="p-3 bg-muted rounded-md text-sm">
                    {(() => {
                        const task = tasks.find((t) => t.name === selectedTask);
                        if (!task) return null;
                        return (
                            <div className="space-y-1">
                                <div className="font-medium">{task.item_name}</div>
                                <div className="flex items-center gap-2 text-muted-foreground">
                                    <span>Category: {task.critical_po_category || "None"}</span>
                                    <span>•</span>
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
