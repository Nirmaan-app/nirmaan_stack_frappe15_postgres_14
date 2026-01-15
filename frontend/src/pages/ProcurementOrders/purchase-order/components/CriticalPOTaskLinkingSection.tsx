import React from "react";
import ReactSelect from "react-select";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { TailSpin } from "react-loader-spinner";
import {
  Link2,
  Package,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
} from "lucide-react";
import { formatDate } from "@/utils/FormatDate";
import {
  UseCriticalPOTaskLinkingReturn,
  CategoryOption,
  TaskOption,
} from "../hooks/useCriticalPOTaskLinking";
import { ItemsHoverCard } from "@/components/helpers/ItemsHoverCard";

// React-Select custom styles for enterprise theme
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
    selectedTask,
    setSelectedCategory,
    setSelectedTask,
    selectedTaskDetails,
    linkedPOsToSelectedTask,
    poLinkedToOtherTasks,
  } = linkingState;

  // Determine if task selection is mandatory
  const isMandatory = hasCriticalPOSetup && !isPoAlreadyLinked;
  const showValidationError = isMandatory && !selectedTask;

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
                selectedTask
                  ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                  : "bg-red-100 text-red-700 border-red-200 animate-pulse"
              }`}
            >
              {selectedTask ? "Linked" : "Required"}
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
                Category
              </Label>
              <ReactSelect<CategoryOption>
                options={categoryOptions}
                placeholder="Search or select category..."
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

            {/* Task Dropdown */}
            <div className="space-y-1.5">
              <Label className={`text-xs font-medium ${
                showValidationError ? "text-red-600" : "text-slate-500"
              }`}>
                Task {isMandatory && <span className="text-red-500">*</span>}
              </Label>
              <ReactSelect<TaskOption>
                options={filteredTaskOptions}
                placeholder="Search task by name or subcategory..."
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
                value={selectedTask}
                onChange={(newValue) => setSelectedTask(newValue as TaskOption | null)}
                filterOption={taskFilterOption}
                noOptionsMessage={() =>
                  selectedCategory
                    ? "No tasks found in this category"
                    : "No tasks available"
                }
              />
            </div>

            {/* Validation Error Message */}
            {showValidationError && (
              <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-md">
                <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-red-700">
                    Task selection is required
                  </p>
                  <p className="text-xs text-red-600 mt-0.5">
                    Select a Critical PO Task to link this PO before dispatching.
                  </p>
                </div>
              </div>
            )}

            {/* Selected Task Details Card */}
            {selectedTaskDetails && (
              <div className="mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded-md space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">
                    Selected Task
                  </span>
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                </div>

                {/* Task Details Grid */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  <div>
                    <span className="text-slate-500">Item</span>
                    <p className="font-medium text-slate-800">
                      {selectedTaskDetails.item_name}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-500">Category</span>
                    <p className="font-medium text-slate-800">
                      {selectedTaskDetails.critical_po_category}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-500">Sub-Category</span>
                    <p className="font-medium text-slate-800">
                      {selectedTaskDetails.sub_category || "-"}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-500">PO Release Deadline</span>
                    <p className="font-medium text-slate-800">
                      {formatDate(selectedTaskDetails.po_release_date)}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-500">Current Status</span>
                    <p className="font-medium text-slate-800">
                      {selectedTaskDetails.status}
                    </p>
                  </div>
                  {selectedTaskDetails.revised_date && (
                    <div>
                      <span className="text-slate-500">Revised Deadline</span>
                      <p className="font-medium text-slate-800">
                        {formatDate(selectedTaskDetails.revised_date)}
                      </p>
                    </div>
                  )}
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
                          Linking will associate this PO with multiple tasks.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Linked POs Warning */}
                {linkedPOsToSelectedTask.length > 0 && (
                  <div className="pt-2 mt-2 border-t border-emerald-200">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs text-slate-600">
                          <span className="text-amber-600 font-medium">
                            {linkedPOsToSelectedTask.length} PO(s) already linked:
                          </span>
                        </p>
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          {linkedPOsToSelectedTask.map((po) => (
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
