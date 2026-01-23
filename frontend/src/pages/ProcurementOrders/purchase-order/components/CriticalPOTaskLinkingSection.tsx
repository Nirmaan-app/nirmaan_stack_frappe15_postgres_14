import React from "react";
import ReactSelect from "react-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { TailSpin } from "react-loader-spinner";
import {
  Link2,
  Package,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  X,
} from "lucide-react";
import { formatDate } from "@/utils/FormatDate";
import {
  UseCriticalPOTaskLinkingReturn,
  CategoryOption,
  TaskOption,
} from "../hooks/useCriticalPOTaskLinking";
import { ItemsHoverCard } from "@/components/helpers/ItemsHoverCard";

// React-Select custom styles for enterprise theme - now with multi-select support
const selectStyles = {
  control: (base: any, state: any) => ({
    ...base,
    minHeight: "36px",
    fontSize: "14px",
    borderColor: state.isFocused ? "#f59e0b" : "#e2e8f0",
    boxShadow: state.isFocused ? "0 0 0 1px #f59e0b" : "none",
    "&:hover": { borderColor: "#f59e0b" },
    backgroundColor: "#fff",
    cursor: "pointer",
  }),
  option: (base: any, state: any) => ({
    ...base,
    fontSize: "14px",
    backgroundColor: state.isSelected
      ? "#f59e0b"
      : state.isFocused
      ? "#fef3c7"
      : "#fff",
    color: state.isSelected ? "#fff" : "#1e293b",
    cursor: "pointer",
    "&:active": { backgroundColor: "#fbbf24" },
  }),
  menu: (base: any) => ({
    ...base,
    zIndex: 99999,
    boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
    border: "1px solid #e2e8f0",
    borderRadius: "8px",
    overflow: "hidden",
  }),
  menuList: (base: any) => ({
    ...base,
    padding: "4px",
  }),
  placeholder: (base: any) => ({
    ...base,
    color: "#94a3b8",
  }),
  singleValue: (base: any) => ({
    ...base,
    color: "#1e293b",
  }),
  // Multi-select styles
  multiValue: (base: any) => ({
    ...base,
    backgroundColor: "#fef3c7",
    borderRadius: "4px",
    border: "1px solid #fbbf24",
  }),
  multiValueLabel: (base: any) => ({
    ...base,
    color: "#92400e",
    fontSize: "12px",
    fontWeight: 500,
    padding: "2px 6px",
  }),
  multiValueRemove: (base: any) => ({
    ...base,
    color: "#b45309",
    "&:hover": {
      backgroundColor: "#fbbf24",
      color: "#78350f",
    },
  }),
};

// Custom filter function to search task by name, category, and subcategory
// Note: react-select's filterOption receives { label, value, data: OriginalOption }
// where OriginalOption is TaskOption { label, value, data: CriticalPOTask }
const taskFilterOption = (
  option: { label: string; value: string; data: TaskOption },
  inputValue: string
): boolean => {
  const searchLower = inputValue.toLowerCase();
  // option.data is TaskOption, option.data.data is CriticalPOTask
  const task = option.data?.data;

  if (!task) {
    return option.label.toLowerCase().includes(searchLower);
  }

  // Search item_name, category, and sub_category
  return (
    task.item_name?.toLowerCase().includes(searchLower) ||
    task.critical_po_category?.toLowerCase().includes(searchLower) ||
    (task.sub_category?.toLowerCase().includes(searchLower) ?? false)
  );
};

interface CriticalPOTaskLinkingSectionProps {
  linkingState: UseCriticalPOTaskLinkingReturn;
}

export const CriticalPOTaskLinkingSection: React.FC<CriticalPOTaskLinkingSectionProps> = ({
  linkingState,
}) => {
  const {
    isLoading,
    hasCriticalPOSetup,
    isPoAlreadyLinked,
    categoryOptions,
    filteredTaskOptions,
    selectedCategory,
    selectedTasks,
    setSelectedCategory,
    setSelectedTasks,
    removeTask,
    selectedTasksDetails,
    linkedPOsToSelectedTasks,
    poLinkedToOtherTasks,
  } = linkingState;

  // Determine if task selection is mandatory
  const isMandatory = hasCriticalPOSetup && !isPoAlreadyLinked;
  const showValidationError = isMandatory && selectedTasks.length === 0;

  // Check if any selected task is from a different category than currently filtered
  const hasTasksFromOtherCategories = selectedCategory && selectedTasks.some(
    (t) => t.data.critical_po_category !== selectedCategory.value
  );

  // Extract PO ID (2nd part after /)
  const extractPOId = (fullName: string) => {
    const parts = fullName.split("/");
    return parts.length > 1 ? parts[1] : fullName;
  };

  if (isLoading) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
        <div className="px-4 py-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-amber-500 text-white flex items-center justify-center">
              <Link2 className="w-3.5 h-3.5" />
            </div>
            <span className="text-sm font-semibold text-slate-700">
              Critical PO Task Linking
            </span>
          </div>
        </div>
        <div className="p-4 flex justify-center">
          <TailSpin width={24} height={24} color="#f59e0b" />
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-white border rounded-lg shadow-sm transition-all duration-200 ${
      showValidationError
        ? "border-red-300 ring-1 ring-red-200"
        : "border-slate-200"
    }`}>
      {/* Section Header */}
      <div className={`px-4 py-3 border-b ${
        showValidationError ? "border-red-100 bg-red-50/30" : "border-slate-100"
      }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`w-6 h-6 rounded-full text-white flex items-center justify-center ${
              showValidationError ? "bg-red-500" : "bg-amber-500"
            }`}>
              <Link2 className="w-3.5 h-3.5" />
            </div>
            <span className="text-sm font-semibold text-slate-700">
              Critical PO Task Linking
            </span>
          </div>
          {isMandatory && (
            <Badge
              className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 ${
                selectedTasks.length > 0
                  ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                  : "bg-red-100 text-red-700 border-red-200 animate-pulse"
              }`}
            >
              {selectedTasks.length > 0
                ? `${selectedTasks.length} Selected`
                : "Required"}
            </Badge>
          )}
        </div>
      </div>

      <div className="p-4 space-y-4">
        {!hasCriticalPOSetup ? (
          /* No Setup State */
          <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-md border border-dashed border-slate-300">
            <Package className="w-5 h-5 text-slate-400" />
            <div>
              <p className="text-sm text-slate-600">
                Critical PO linking not available
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                Setup Critical PO Categories for this project first
              </p>
            </div>
          </div>
        ) : (
          /* Setup Exists - Show Dropdowns */
          <>
            {/* Category Dropdown */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-500">
                Filter by Category (optional)
              </Label>
              <ReactSelect<CategoryOption>
                options={categoryOptions}
                placeholder="Search or select category to filter..."
                isClearable
                styles={selectStyles}
                menuPosition="fixed"
                menuShouldBlockScroll={false}
                value={selectedCategory}
                onChange={(newValue) => setSelectedCategory(newValue as CategoryOption | null)}
                filterOption={(option, input) =>
                  option.label.toLowerCase().includes(input.toLowerCase())
                }
              />
            </div>

            {/* Task Dropdown - NOW MULTI-SELECT */}
            <div className="space-y-1.5">
              <Label className={`text-xs font-medium ${
                showValidationError ? "text-red-600" : "text-slate-500"
              }`}>
                Tasks {isMandatory && <span className="text-red-500">*</span>}
                <span className="font-normal text-slate-400 ml-1">(select one or more)</span>
              </Label>
              <ReactSelect<TaskOption, true>
                isMulti
                options={filteredTaskOptions}
                placeholder="Search and select tasks..."
                isClearable
                styles={{
                  ...selectStyles,
                  control: (base: any, state: any) => ({
                    ...selectStyles.control(base, state),
                    borderColor: showValidationError
                      ? "#fca5a5"
                      : state.isFocused
                      ? "#f59e0b"
                      : "#e2e8f0",
                    boxShadow: showValidationError
                      ? "0 0 0 1px #fca5a5"
                      : state.isFocused
                      ? "0 0 0 1px #f59e0b"
                      : "none",
                  }),
                }}
                menuPosition="fixed"
                menuShouldBlockScroll={false}
                value={selectedTasks}
                onChange={(newValue) => setSelectedTasks(newValue as TaskOption[])}
                filterOption={taskFilterOption}
                noOptionsMessage={() =>
                  selectedCategory
                    ? "No tasks found in this category"
                    : "No tasks available"
                }
                closeMenuOnSelect={false}
              />
            </div>

            {/* Validation Error Message */}
            {showValidationError && (
              <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-md">
                <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-red-700">
                    At least one task must be selected
                  </p>
                  <p className="text-xs text-red-600 mt-0.5">
                    Select one or more Critical PO Tasks to link this PO before dispatching.
                  </p>
                </div>
              </div>
            )}

            {/* Selected Tasks Details Card - Now shows multiple tasks */}
            {selectedTasksDetails.length > 0 && (
              <div className="mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded-md space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">
                    Selected Tasks ({selectedTasksDetails.length})
                  </span>
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                </div>

                {/* Cross-category notice */}
                {hasTasksFromOtherCategories && (
                  <p className="text-xs text-amber-600 -mt-1">
                    Includes tasks from other categories
                  </p>
                )}

                {/* Task List with remove buttons */}
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {selectedTasks.map((taskOption) => {
                    const task = taskOption.data;
                    return (
                      <div
                        key={taskOption.value}
                        className="flex items-center justify-between p-2 bg-white rounded border border-emerald-200 text-xs"
                      >
                        <div className="flex-1 min-w-0 mr-2">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-slate-800 truncate">
                              {task.item_name}
                            </span>
                            {task.sub_category && (
                              <span className="text-slate-400 truncate">
                                ({task.sub_category})
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-0.5 text-slate-500">
                            <span>{task.critical_po_category}</span>
                            <span>|</span>
                            <span>Due: {formatDate(task.po_release_date)}</span>
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeTask(taskOption.value)}
                          className="h-6 w-6 p-0 text-slate-400 hover:text-red-500 hover:bg-red-50 shrink-0"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    );
                  })}
                </div>

                {/* Cross-Task Conflict Warning - PO already linked to OTHER tasks */}
                {poLinkedToOtherTasks.length > 0 && (
                  <div className="pt-2 mt-2 border-t border-emerald-200">
                    <div className="flex items-start gap-2 p-2 bg-amber-50 rounded-md border border-amber-200">
                      <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs font-medium text-amber-700">
                          This PO is already linked to other task(s):
                        </p>
                        <ul className="mt-1 space-y-0.5">
                          {poLinkedToOtherTasks.map((linkedTask) => (
                            <li
                              key={linkedTask.taskName}
                              className="text-xs text-slate-600"
                            >
                              • {linkedTask.itemName}{" "}
                              <span className="text-slate-400">({linkedTask.category})</span>
                            </li>
                          ))}
                        </ul>
                        <p className="text-xs text-amber-600 mt-1.5 font-medium">
                          These links will be preserved.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Linked POs Warning - POs already linked to selected tasks */}
                {linkedPOsToSelectedTasks.length > 0 && (
                  <div className="pt-2 mt-2 border-t border-emerald-200">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs text-slate-600">
                          <span className="text-amber-600 font-medium">
                            {linkedPOsToSelectedTasks.length} other PO(s) linked to selected task(s):
                          </span>
                        </p>
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          {linkedPOsToSelectedTasks.map((po) => (
                            <div key={po} className="flex items-center gap-1 bg-white rounded border border-slate-200 px-1.5 py-0.5">
                              <Badge
                                variant="outline"
                                className="text-xs font-mono border-none px-0"
                              >
                                {extractPOId(po)}
                              </Badge>
                              <ItemsHoverCard
                                parentDoc={{ name: po }}
                                parentDoctype="Procurement Orders"
                                childTableName="items"
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
