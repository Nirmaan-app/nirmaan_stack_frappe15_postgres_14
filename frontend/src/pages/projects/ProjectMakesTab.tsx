import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/use-toast";
import { getUrlStringParam } from "@/hooks/useServerDataTable";
import { Category } from "@/types/NirmaanStack/Category";
import { CategoryMakelist } from "@/types/NirmaanStack/CategoryMakelist";
import { Projects, ProjectWPCategoryMake } from "@/types/NirmaanStack/Projects";
import { urlStateManager } from "@/utils/urlStateManager";
import { Radio } from "antd";
import { FrappeDoc, useFrappeGetDocList, useFrappeUpdateDoc } from "frappe-react-sdk";
import React, { useEffect, useMemo, useState } from "react";
import { TailSpin } from "react-loader-spinner";
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

// For internal state representing a category and its selected makes for display and editing
interface DisplayCategoryWithMakes {
  categoryDocName: string;    // e.g., "Bricks"
  categoryDisplayName: string; // e.g., "Bricks Category Display Name" (if available)
  selectedMakeDocNames: string[]; // Array of Make DocNames currently selected for this category in this WP
}


export const ProjectMakesTab: React.FC<ProjectMakesTabProps> = ({
  projectData,
  initialTab,
  options, // These are for the WP selector Radio.Group
  project_mutate,
}) => {
  const renderInitialTab = useMemo(() => {
    return getUrlStringParam("makesTab", initialTab);
  }, [initialTab]); // Recalculate if initialTab changes

  const [makesTab, setMakesTab] = useState<string>(renderInitialTab); // stores selected WP DocName

  // This state will now hold an array of DisplayCategoryWithMakes for the selected makesTab (WP)
  const [displayCategoriesAndMakes, setDisplayCategoriesAndMakes] = useState<DisplayCategoryWithMakes[]>([]);

  // State for the edit dialog
  const [editingCategory, setEditingCategory] = useState<DisplayCategoryWithMakes | null>(null);
  const [dialogSelectedMakes, setDialogSelectedMakes] = useState<Array<{ label: string; value: string }>>([]);
  const [dialogReactSelectOptions, setDialogReactSelectOptions] = useState<Array<{ label: string; value: string }>>([]);
  const [dialogOpen, setDialogOpen] = useState(false);

  const { updateDoc, loading: updateLoading } = useFrappeUpdateDoc();

  // Fetch all categories to get their display names
  const { data: allCategories, isLoading: categoriesLoading } = useFrappeGetDocList<Category>("Category", {
    fields: ["name", "category_name"], // name is DocName, category_name is display name
    limit: 0,
  });

  // Fetch all makes to map Make DocName to Make Label for ReactSelect options
  const { data: allMakesList, isLoading: makesListLoading } = useFrappeGetDocList("Makelist", {
      fields: ["name", "make_name"], // name is DocName, make_name is label
      limit: 0,
  });
  
  // This is still useful for populating the ReactSelect in the dialog with ALL possible makes for a category
  const { data: categoryMakeList, isLoading: categoryMakeListLoading } = useFrappeGetDocList<CategoryMakelist>(
    "Category Makelist",
    {
      fields: ["make", "category"], // make is Make DocName, category is Category DocName
      limit: 0, // Fetch all
    }
  );

  // Effect to sync tab state TO URL (remains the same)
  useEffect(() => {
    if (urlStateManager.getParam("makesTab") !== makesTab) {
      urlStateManager.updateParam("makesTab", makesTab);
    }
  }, [makesTab]);

  // Effect to sync URL state TO tab state (remains the same)
  useEffect(() => {
    const unsubscribe = urlStateManager.subscribe("makesTab", (_, value) => {
      const newTab = value || initialTab;
      if (makesTab !== newTab) {
        setMakesTab(newTab);
      }
    });
    return unsubscribe;
  }, [initialTab, makesTab]); // Added makesTab to dependencies


  // *** REVISED: Effect to process projectData and set displayCategoriesAndMakes ***
  useEffect(() => {
    if (projectData?.project_wp_category_makes && makesTab && allCategories) {
      const categoryMap = new Map<string, DisplayCategoryWithMakes>();

      projectData.project_wp_category_makes.forEach((item) => {
        if (item.procurement_package === makesTab) { // Filter by selected Work Package (makesTab)
          if (!categoryMap.has(item.category)) {
            const categoryInfo = allCategories.find(c => c.name === item.category);
            categoryMap.set(item.category, {
              categoryDocName: item.category,
              categoryDisplayName: categoryInfo?.category_name || item.category,
              selectedMakeDocNames: [],
            });
          }
          if (item.make) { // Make is optional
            categoryMap.get(item.category)!.selectedMakeDocNames.push(item.make);
          }
        }
      });
      
      const processedData = Array.from(categoryMap.values()).map(catData => ({
          ...catData,
          selectedMakeDocNames: Array.from(new Set(catData.selectedMakeDocNames)).sort() // Ensure unique and sorted
      }));
      setDisplayCategoriesAndMakes(processedData);
    } else {
      setDisplayCategoriesAndMakes([]); // Clear if no data or WP selected
    }
  }, [makesTab, projectData, allCategories]);


  // *** REVISED: Effect to populate dialog when editingCategory changes ***
  useEffect(() => {
    if (editingCategory && categoryMakeList && allMakesList) {
      // Populate selectedMakes for ReactSelect (these are {label, value} objects)
      const currentSelectedMakeOptions = editingCategory.selectedMakeDocNames.map(makeDocName => {
        const makeDetail = allMakesList.find(m => m.name === makeDocName);
        return {
          label: makeDetail?.make_name || makeDocName,
          value: makeDocName,
        };
      });
      setDialogSelectedMakes(currentSelectedMakeOptions);

      // Populate all available makes for this category for ReactSelect options
      const availableMakesForCategory = categoryMakeList
        .filter((cml) => cml.category === editingCategory.categoryDocName && cml.make)
        .map(cml => {
            const makeDetail = allMakesList.find(m => m.name === cml.make);
            return ({
                label: makeDetail?.make_name || cml.make!, // Use make_name if available
                value: cml.make!,
            });
        })
        .sort((a,b) => a.label.localeCompare(b.label));
      setDialogReactSelectOptions(availableMakesForCategory);

    } else {
      setDialogSelectedMakes([]);
      setDialogReactSelectOptions([]);
    }
  }, [editingCategory, categoryMakeList, allMakesList]);

  const toggleDialog = () => {
    if (dialogOpen) {
      setEditingCategory(null); // Clear editing state when closing
    }
    setDialogOpen((prevState) => !prevState);
  };

  // *** REVISED: handleUpdateMakes function ***
  const handleUpdateMakes = async () => {
    if (!projectData || !editingCategory || !makesTab) return;

    try {
      // Current makes for the project (all WPs, all categories)
      const currentProjectMakes: ProjectWPCategoryMake[] = projectData.project_wp_category_makes 
        ? JSON.parse(JSON.stringify(projectData.project_wp_category_makes)) // Deep copy
        : [];

      // 1. Remove all existing makes for the makesTab (WP) and editingCategory.categoryDocName
      const otherMakes = currentProjectMakes.filter(
        (item) => !(item.procurement_package === makesTab && item.category === editingCategory.categoryDocName)
      );

      // 2. Prepare new make entries for the current WP and category based on dialogSelectedMakes
      const newMakesForThisCategory: Omit<ProjectWPCategoryMake, 'name'>[] = [];
      if (dialogSelectedMakes.length > 0) {
        dialogSelectedMakes.forEach(selectedMakeOption => {
          newMakesForThisCategory.push({
            procurement_package: makesTab, // Current selected Work Package (WP DocName)
            category: editingCategory.categoryDocName,
            make: selectedMakeOption.value, // This is Make DocName
          });
        });
      } else {
        // If no makes are selected in the dialog, add one entry with make: null
        // (as per your requirement: "if no makes... create a single document")
        newMakesForThisCategory.push({
            procurement_package: makesTab,
            category: editingCategory.categoryDocName,
            make: null, 
        });
      }

      // 3. Combine old makes (for other WPs/Categories) with new makes for the edited category
      const finalMakesPayload = [...otherMakes, ...newMakesForThisCategory];
      
      await updateDoc("Projects", projectData.name, {
        project_wp_category_makes: finalMakesPayload, // Send the complete list
      });

      await project_mutate(); // Revalidate SWR cache

      toast({
        title: "Success!",
        description: `Makes for category '${editingCategory.categoryDisplayName}' in '${makesTab}' updated successfully!`,
        variant: "success",
      });

      toggleDialog(); // Close dialog
    } catch (error: any) {
      console.error("Error while updating makes:", error);
      toast({
        title: "Update Failed!",
        description: error?.message || "An unknown error occurred.",
        variant: "destructive",
      });
    }
  };
  
  if (categoryMakeListLoading || categoriesLoading || makesListLoading) {
    return <div className="p-4">Loading configuration... <TailSpin height={20} width={20} /></div>;
  }

  return (
    <>
      {options && (
        <Radio.Group
          options={options} // These should be { label: WPDisplayName, value: WPDocName }
          // defaultValue={initialTab} // Let useState handle default from URL
          optionType="button"
          buttonStyle="solid"
          value={makesTab} // Controlled by state
          onChange={(e) => setMakesTab(e.target.value)}
          className="mb-4"
        />
      )}

      <Table>
        <TableHeader className="bg-red-100">
          <TableRow>
            <TableHead className="w-[35%]">Category</TableHead>
            <TableHead className="w-[50%]">Makes</TableHead>
            <TableHead>Add/Edit</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {displayCategoriesAndMakes.length === 0 && makesTab && (
            <TableRow>
              <TableCell colSpan={3} className="text-center text-gray-500 py-4">
                No categories configured with makes for work package: {options?.find(o => o.value === makesTab)?.label || makesTab}.
                Or, this Work Package might not have any categories associated with it in the project.
              </TableCell>
            </TableRow>
          )}
          {displayCategoriesAndMakes.map((categoryData) => (
            <TableRow key={categoryData.categoryDocName}>
              <TableCell>{categoryData.categoryDisplayName}</TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-2">
                  {categoryData.selectedMakeDocNames.length > 0 ? (
                    categoryData.selectedMakeDocNames.map((makeDocName) => {
                      const makeDetail = allMakesList?.find(m => m.name === makeDocName);
                      return (<Badge key={makeDocName}>{makeDetail?.make_name || makeDocName}</Badge>);
                    })
                  ) : (
                    <span>--</span>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <Button
                  onClick={() => {
                    setEditingCategory(categoryData);
                    toggleDialog();
                  }}
                  variant="outline"
                  size="sm"
                >
                  Edit
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={toggleDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Edit Makes for <span className="text-primary">{editingCategory?.categoryDisplayName}</span>
              <br/>
              <span className="text-sm font-normal text-gray-600">
                (Work Package: {options?.find(o => o.value === makesTab)?.label || makesTab})
              </span>
            </DialogTitle>
            <DialogDescription className="pt-4">
              <ReactSelect
                options={dialogReactSelectOptions} // All possible makes for this category from CategoryMakelist
                value={dialogSelectedMakes}       // Currently selected makes for this category in this WP
                className="w-full"
                placeholder="Select Makes..."
                isMulti
                onChange={(selectedOptions) =>
                  setDialogSelectedMakes(selectedOptions as Array<{ label: string; value: string }>)
                }
              />
            </DialogDescription>
            <div className="pt-4 flex justify-end gap-2 items-center">
              {updateLoading ? (
                <TailSpin color="red" height={30} width={30} />
              ) : (
                <>
                  <DialogClose asChild>
                    <Button variant="secondary" type="button">Cancel</Button>
                  </DialogClose>
                  <Button onClick={handleUpdateMakes} type="button">Save Changes</Button>
                </>
              )}
            </div>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ProjectMakesTab;