import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/use-toast";
import { getUrlStringParam } from "@/hooks/useServerDataTable";
import { cn } from "@/lib/utils";
import { Category } from "@/types/NirmaanStack/Category";
import { CategoryMakelist } from "@/types/NirmaanStack/CategoryMakelist";
import { Projects, ProjectWPCategoryMake } from "@/types/NirmaanStack/Projects";
import { urlStateManager } from "@/utils/urlStateManager";
import { FrappeDoc, useFrappeGetDocList, useFrappeUpdateDoc } from "frappe-react-sdk";
import { Check, Pencil, Package, Tag } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import ReactSelect from "react-select";
import { KeyedMutator } from "swr";

interface ProjectMakesTabProps {
  projectData?: Projects;
  initialTab: string;
  options?: {
    label: string;
    value: string;
  }[];
  project_mutate: KeyedMutator<FrappeDoc<Projects>>;
}

interface DisplayCategoryWithMakes {
  categoryDocName: string;
  categoryDisplayName: string;
  selectedMakeDocNames: string[];
}

export const ProjectMakesTab: React.FC<ProjectMakesTabProps> = ({
  projectData,
  initialTab,
  options,
  project_mutate,
}) => {
  const renderInitialTab = useMemo(() => {
    return getUrlStringParam("makesTab", initialTab);
  }, [initialTab]);

  const [makesTab, setMakesTab] = useState<string>(renderInitialTab);
  const [displayCategoriesAndMakes, setDisplayCategoriesAndMakes] = useState<DisplayCategoryWithMakes[]>([]);
  const [editingCategory, setEditingCategory] = useState<DisplayCategoryWithMakes | null>(null);
  const [dialogSelectedMakes, setDialogSelectedMakes] = useState<Array<{ label: string; value: string }>>([]);
  const [dialogReactSelectOptions, setDialogReactSelectOptions] = useState<Array<{ label: string; value: string }>>([]);
  const [dialogOpen, setDialogOpen] = useState(false);

  const { updateDoc, loading: updateLoading } = useFrappeUpdateDoc();

  const { data: allCategories, isLoading: categoriesLoading } = useFrappeGetDocList<Category>("Category", {
    fields: ["name", "category_name"],
    limit: 0,
  });

  const { data: allMakesList, isLoading: makesListLoading } = useFrappeGetDocList("Makelist", {
    fields: ["name", "make_name"],
    limit: 0,
  });

  const { data: categoryMakeList, isLoading: categoryMakeListLoading } = useFrappeGetDocList<CategoryMakelist>(
    "Category Makelist",
    {
      fields: ["make", "category"],
      limit: 0,
    }
  );

  // Sync tab state TO URL
  useEffect(() => {
    if (urlStateManager.getParam("makesTab") !== makesTab) {
      urlStateManager.updateParam("makesTab", makesTab);
    }
  }, [makesTab]);

  // Sync URL state TO tab state
  useEffect(() => {
    const unsubscribe = urlStateManager.subscribe("makesTab", (_, value) => {
      const newTab = value || initialTab;
      if (makesTab !== newTab) {
        setMakesTab(newTab);
      }
    });
    return unsubscribe;
  }, [initialTab, makesTab]);

  // Process project data for display
  useEffect(() => {
    if (projectData?.project_wp_category_makes && makesTab && allCategories) {
      const categoryMap = new Map<string, DisplayCategoryWithMakes>();

      projectData.project_wp_category_makes.forEach((item) => {
        if (item.procurement_package === makesTab) {
          if (!categoryMap.has(item.category)) {
            const categoryInfo = allCategories.find((c) => c.name === item.category);
            categoryMap.set(item.category, {
              categoryDocName: item.category,
              categoryDisplayName: categoryInfo?.category_name || item.category,
              selectedMakeDocNames: [],
            });
          }
          if (item.make) {
            categoryMap.get(item.category)!.selectedMakeDocNames.push(item.make);
          }
        }
      });

      const processedData = Array.from(categoryMap.values()).map((catData) => ({
        ...catData,
        selectedMakeDocNames: Array.from(new Set(catData.selectedMakeDocNames)).sort(),
      }));
      setDisplayCategoriesAndMakes(processedData);
    } else {
      setDisplayCategoriesAndMakes([]);
    }
  }, [makesTab, projectData, allCategories]);

  // Populate dialog when editing
  useEffect(() => {
    if (editingCategory && categoryMakeList && allMakesList) {
      const currentSelectedMakeOptions = editingCategory.selectedMakeDocNames.map((makeDocName) => {
        const makeDetail = allMakesList.find((m) => m.name === makeDocName);
        return {
          label: makeDetail?.make_name || makeDocName,
          value: makeDocName,
        };
      });
      setDialogSelectedMakes(currentSelectedMakeOptions);

      const availableMakesForCategory = categoryMakeList
        .filter((cml) => cml.category === editingCategory.categoryDocName && cml.make)
        .map((cml) => {
          const makeDetail = allMakesList.find((m) => m.name === cml.make);
          return {
            label: makeDetail?.make_name || cml.make!,
            value: cml.make!,
          };
        })
        .sort((a, b) => a.label.localeCompare(b.label));
      setDialogReactSelectOptions(availableMakesForCategory);
    } else {
      setDialogSelectedMakes([]);
      setDialogReactSelectOptions([]);
    }
  }, [editingCategory, categoryMakeList, allMakesList]);

  const toggleDialog = () => {
    if (dialogOpen) {
      setEditingCategory(null);
    }
    setDialogOpen((prevState) => !prevState);
  };

  const handleUpdateMakes = async () => {
    if (!projectData || !editingCategory || !makesTab) return;

    try {
      const currentProjectMakes: ProjectWPCategoryMake[] = projectData.project_wp_category_makes
        ? JSON.parse(JSON.stringify(projectData.project_wp_category_makes))
        : [];

      const otherMakes = currentProjectMakes.filter(
        (item) => !(item.procurement_package === makesTab && item.category === editingCategory.categoryDocName)
      );

      const newMakesForThisCategory: Omit<ProjectWPCategoryMake, "name">[] = [];
      if (dialogSelectedMakes.length > 0) {
        dialogSelectedMakes.forEach((selectedMakeOption) => {
          newMakesForThisCategory.push({
            procurement_package: makesTab,
            category: editingCategory.categoryDocName,
            make: selectedMakeOption.value,
          });
        });
      } else {
        newMakesForThisCategory.push({
          procurement_package: makesTab,
          category: editingCategory.categoryDocName,
          make: null,
        });
      }

      const finalMakesPayload = [...otherMakes, ...newMakesForThisCategory];

      await updateDoc("Projects", projectData.name, {
        project_wp_category_makes: finalMakesPayload,
      });

      await project_mutate();

      toast({
        title: "Success!",
        description: `Makes for "${editingCategory.categoryDisplayName}" updated successfully.`,
        variant: "success",
      });

      toggleDialog();
    } catch (error: any) {
      console.error("Error while updating makes:", error);
      toast({
        title: "Update Failed!",
        description: error?.message || "An unknown error occurred.",
        variant: "destructive",
      });
    }
  };

  const currentWPLabel = options?.find((o) => o.value === makesTab)?.label || makesTab;

  // Loading state
  if (categoryMakeListLoading || categoriesLoading || makesListLoading) {
    return (
      <div className="space-y-4">
        {/* Skeleton for package selector */}
        <div className="flex gap-2">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-8 w-24 rounded-md" />
          ))}
        </div>
        {/* Skeleton for table */}
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <div className="bg-gray-50 px-4 py-3">
            <Skeleton className="h-4 w-32" />
          </div>
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="px-4 py-3 border-t border-gray-100 flex items-center justify-between">
              <Skeleton className="h-4 w-40" />
              <div className="flex gap-2">
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Work Package Selector */}
      {options && options.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Package className="h-3.5 w-3.5" />
            <span>Select Work Package</span>
          </div>
          <ScrollArea className="w-full">
            <div className="flex gap-1.5 pb-2">
              {options.map((option) => (
                <button
                  key={option.value}
                  onClick={() => setMakesTab(option.value)}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-all",
                    "border whitespace-nowrap",
                    makesTab === option.value
                      ? "bg-gray-900 text-white border-gray-900 shadow-sm"
                      : "bg-white text-gray-600 border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                  )}
                >
                  {makesTab === option.value && <Check className="h-3.5 w-3.5" />}
                  {option.label}
                </button>
              ))}
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </div>
      )}

      {/* Categories Table */}
      <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
        {/* Table Header */}
        <div className="grid grid-cols-[1fr,2fr,auto] gap-4 px-4 py-2.5 bg-gray-50 border-b border-gray-200">
          <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Category</div>
          <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Selected Makes</div>
          <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide w-16 text-center">Action</div>
        </div>

        {/* Table Body */}
        <div className="divide-y divide-gray-100">
          {displayCategoriesAndMakes.length === 0 && makesTab && (
            <div className="px-4 py-8 text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-100 mb-3">
                <Tag className="h-5 w-5 text-gray-400" />
              </div>
              <p className="text-sm text-gray-500">
                No categories found for <span className="font-medium text-gray-700">{currentWPLabel}</span>
              </p>
              <p className="text-xs text-gray-400 mt-1">
                Categories will appear here once configured in the project
              </p>
            </div>
          )}

          {displayCategoriesAndMakes.map((categoryData) => (
            <div
              key={categoryData.categoryDocName}
              className="grid grid-cols-[1fr,2fr,auto] gap-4 px-4 py-3 items-center hover:bg-gray-50/50 transition-colors group"
            >
              {/* Category Name */}
              <div className="text-sm font-medium text-gray-900">{categoryData.categoryDisplayName}</div>

              {/* Makes Badges */}
              <div className="flex flex-wrap gap-1.5">
                {categoryData.selectedMakeDocNames.length > 0 ? (
                  categoryData.selectedMakeDocNames.map((makeDocName) => {
                    const makeDetail = allMakesList?.find((m) => m.name === makeDocName);
                    return (
                      <Badge
                        key={makeDocName}
                        variant="secondary"
                        className="bg-gray-100 text-gray-700 hover:bg-gray-200 text-xs font-normal px-2 py-0.5"
                      >
                        {makeDetail?.make_name || makeDocName}
                      </Badge>
                    );
                  })
                ) : (
                  <span className="text-xs text-gray-400 italic">No makes selected</span>
                )}
              </div>

              {/* Edit Button */}
              <div className="w-16 flex justify-center">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEditingCategory(categoryData);
                    toggleDialog();
                  }}
                  className="h-7 w-7 p-0 text-gray-400 hover:text-gray-600 hover:bg-gray-100 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>

        {/* Table Footer with count */}
        {displayCategoriesAndMakes.length > 0 && (
          <div className="px-4 py-2 bg-gray-50 border-t border-gray-200">
            <p className="text-xs text-gray-500">
              {displayCategoriesAndMakes.length} {displayCategoriesAndMakes.length === 1 ? "category" : "categories"} •{" "}
              {displayCategoriesAndMakes.reduce((acc, cat) => acc + cat.selectedMakeDocNames.length, 0)} makes configured
            </p>
          </div>
        )}
      </div>

      {/* Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={toggleDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader className="space-y-3">
            <DialogTitle className="text-lg font-semibold text-gray-900">
              Edit Makes
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-3">
                <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-500 mb-0.5">Category</p>
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {editingCategory?.categoryDisplayName}
                    </p>
                  </div>
                  <div className="h-8 w-px bg-gray-200" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-500 mb-0.5">Work Package</p>
                    <p className="text-sm font-medium text-gray-900 truncate">{currentWPLabel}</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-gray-700">Select Makes</label>
                  <ReactSelect
                    options={dialogReactSelectOptions}
                    value={dialogSelectedMakes}
                    className="text-sm"
                    placeholder="Search and select makes..."
                    isMulti
                    isClearable
                    onChange={(selectedOptions) =>
                      setDialogSelectedMakes(selectedOptions as Array<{ label: string; value: string }>)
                    }
                    styles={{
                      control: (base, state) => ({
                        ...base,
                        minHeight: "38px",
                        borderColor: state.isFocused ? "#1f2937" : "#e5e7eb",
                        boxShadow: state.isFocused ? "0 0 0 1px #1f2937" : "none",
                        "&:hover": {
                          borderColor: "#d1d5db",
                        },
                      }),
                      multiValue: (base) => ({
                        ...base,
                        backgroundColor: "#f3f4f6",
                        borderRadius: "4px",
                      }),
                      multiValueLabel: (base) => ({
                        ...base,
                        color: "#374151",
                        fontSize: "13px",
                        padding: "2px 6px",
                      }),
                      multiValueRemove: (base) => ({
                        ...base,
                        color: "#9ca3af",
                        "&:hover": {
                          backgroundColor: "#e5e7eb",
                          color: "#4b5563",
                        },
                      }),
                      placeholder: (base) => ({
                        ...base,
                        color: "#9ca3af",
                      }),
                      menu: (base) => ({
                        ...base,
                        zIndex: 50,
                      }),
                    }}
                  />
                  <p className="text-xs text-gray-400">
                    {dialogSelectedMakes.length} make{dialogSelectedMakes.length !== 1 ? "s" : ""} selected
                  </p>
                </div>
              </div>
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-end gap-2 pt-4 border-t border-gray-100 mt-4">
            <DialogClose asChild>
              <Button variant="ghost" size="sm" className="text-gray-600">
                Cancel
              </Button>
            </DialogClose>
            <Button
              onClick={handleUpdateMakes}
              size="sm"
              disabled={updateLoading}
              className="bg-gray-900 hover:bg-gray-800 text-white"
            >
              {updateLoading ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                      fill="none"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Saving...
                </span>
              ) : (
                "Save Changes"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ProjectMakesTab;
