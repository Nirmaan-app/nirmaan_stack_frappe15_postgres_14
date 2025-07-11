import React, { useState, useMemo, useCallback } from "react";
import ReactSelect, {
  components,
  MenuListProps,
  SingleValue,
} from "react-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@/components/ui/dialog"; // Adjust path
import { Pencil, CirclePlus } from "lucide-react";
import {
  CategoryMakesMap,
  CategorySelection,
  ItemOption,
  MakeOption,
  ProcurementRequestItem,
} from "../types"; // Adjust path
import { useUserData } from "@/hooks/useUserData"; // Adjust path
import { Category } from "@/types/NirmaanStack/Category";
import { parseNumber } from "@/utils/parseNumber";
import { Label } from "@/components/ui/label";
import { ManageCategoryMakesDialog } from "./ManageCategoryMakesDialog";
import { Makelist } from "@/types/NirmaanStack/Makelist";
import { CategoryMakelist } from "@/types/NirmaanStack/CategoryMakelist";
import { IFuseOptions } from "fuse.js";
import { FuzzySearchSelect } from "@/components/ui/fuzzy-search-select";

// Custom MenuList for Make Select
export const CustomMakeMenuList = (props: MenuListProps<MakeOption, false>) => {
  const { children, selectProps } = props;

  const onManageMakesClick = (selectProps as any)?.onManageMakesClick;

  return (
    <div>
      <components.MenuList {...props}>
        <div>{children}</div>
      </components.MenuList>
      {onManageMakesClick && (
        <div className="bottom-0 z-10 bg-white border-t border-gray-200 px-2 py-1">
          <Button
            variant="ghost"
            className="w-full rounded-md flex items-center justify-center gap-1 text-sm h-9 text-blue-600 hover:bg-blue-50"
            onClick={onManageMakesClick}
            onTouchStart={onManageMakesClick}
          >
            <CirclePlus className="w-4 h-4" />
            Add Existing / New Make
          </Button>
        </div>
      )}
    </div>
  );
};

const ItemCustomMenuList = (props: MenuListProps<ItemOption, false>) => {
  const { children } = props;
  const onAddItemClick = (props as any)?.onAddItemClick;
  // const isNewItemsDisabled = (props as any)?.isNewItemsDisabled;

  return (
    <div>
      <components.MenuList {...props}>{children}</components.MenuList>
      {onAddItemClick && (
        <div className="bottom-0 z-10 bg-white border-t border-gray-200 px-2 py-1">
          <Button
            variant="ghost"
            className="w-full rounded-md flex items-center justify-center gap-1 text-sm h-9 text-blue-600 hover:bg-blue-50"
            onClick={onAddItemClick}
            onTouchStart={onAddItemClick}
            // disabled={isNewItemsDisabled} // Disable button based on prop
          >
            <CirclePlus className="mr-2 h-4 w-4" />
            Create/Request New Item
          </Button>
        </div>
      )}
    </div>
  );
};

interface ItemSelectorControlsProps {
  selectedWP: string;
  itemOptions: ItemOption[];
  allMakeOptions: MakeOption[];
  selectedCategories: CategorySelection[];
  onAddItem: (
    itemData: Omit<ProcurementRequestItem, "uniqueId" | "status">
  ) => void; // isRequest removed, handled in hook
  onOpenNewItemDialog: () => void;
  allowWpEdit: boolean;
  onEditWP: () => void;
  disabled?: boolean;
  categoryList?: Category[];
  updateCategoryMakesInStore: (categoryName: string, newMake: string) => void;
  makeList?: Makelist[]; // <<< Pass makeList for AddMakeComponent in dialog
  makeListMutate: () => Promise<any>;
  categoryMakelist?: CategoryMakelist[]; // <<< Pass categoryMakelist for AddMakeComponent in dialog
  categoryMakeListMutate?: () => Promise<any>;
  initialCategoryMakes: CategoryMakesMap; // <<< Add baseline makes map from store
  itemFuseOptions: IFuseOptions<ItemOption>;
}

export const ItemSelectorControls: React.FC<ItemSelectorControlsProps> = ({
  selectedWP,
  itemOptions,
  allMakeOptions,
  selectedCategories,
  onAddItem,
  onOpenNewItemDialog,
  allowWpEdit,
  onEditWP,
  disabled = false,
  categoryList,
  updateCategoryMakesInStore,
  makeList, // <<< Receive makeList
  makeListMutate,
  categoryMakelist,
  categoryMakeListMutate,
  initialCategoryMakes, // <<< Receive baseline makes
  itemFuseOptions,
}) => {
  // --- State ---
  const [curItem, setCurItem] = useState<SingleValue<ItemOption>>(null);
  const [curMake, setCurMake] = useState<SingleValue<MakeOption>>(null);
  const [curQuantity, setCurQuantity] = useState<string>("");
  const [curComment, setCurComment] = useState<string>("");
  const [isManageMakesDialogOpen, setIsManageMakesDialogOpen] = useState(false);
  const userData = useUserData();

  // const [resetFlag, setResetFlag] = useState(false);

  // console.log("selectedCategories", selectedCategories)

  // --- Memos and Derived State ---
  const currentItemCategoryName = curItem?.category;

  // --- *** FINAL REVISED LOGIC for availableMakeOptions *** ---
  const availableMakeOptions = useMemo(() => {
    // --- Logging Start ---
    console.log("--- ISC useMemo Start ---");
    console.log("currentItemCategoryName:", currentItemCategoryName);
    console.log(
      "selectedCategories (prop):",
      JSON.stringify(selectedCategories)
    );
    console.log(
      "initialCategoryMakes (prop):",
      JSON.stringify(initialCategoryMakes)
    );
    // --- Logging End ---

    if (!currentItemCategoryName) {
      console.log("ISC useMemo: No category, returning []");
      return [];
    }

    // Use a Set to automatically handle unique make names (values)
    const applicableMakeValues = new Set<string>();

    // 1. Determine the BASE list (Initial Config OR Fallback)
    const initialMakes = initialCategoryMakes?.[currentItemCategoryName];
    const hasInitialMakes =
      Array.isArray(initialMakes) && initialMakes.length > 0;

    if (hasInitialMakes) {
      // Use initial makes from the WP Project config as the base
      console.log(`ISC useMemo: Using initialMakes as base:`, initialMakes);
      initialMakes!.forEach((makeValue) => applicableMakeValues.add(makeValue));
    } else if (categoryMakelist) {
      // Fallback to CategoryMakelist if initial makes are empty/not defined
      console.log(
        `ISC useMemo: Initial makes empty, using CategoryMakelist fallback as base.`
      );
      categoryMakelist
        .filter(
          (entry) => entry.category === currentItemCategoryName && entry.make
        )
        .forEach((entry) => applicableMakeValues.add(entry.make!)); // Add makes from fallback
    } else {
      console.log(
        `ISC useMemo: No initial makes and no categoryMakelist provided for base.`
      );
    }
    console.log(
      `ISC useMemo: Makes after base determination:`,
      Array.from(applicableMakeValues)
    );

    // 2. ADD makes from Session/procList (selectedCategories)
    // Ensure makes used in items or explicitly added this session (via Manage Makes)
    // are *always* included in the available options.
    // const derivedCategoryDetails = selectedCategories.find(c => c.name === currentItemCategoryName);
    // if (derivedCategoryDetails?.makes && Array.isArray(derivedCategoryDetails.makes)) {
    //     console.log(`ISC useMemo: Adding makes from selectedCategories:`, derivedCategoryDetails.makes);
    //     derivedCategoryDetails.makes.forEach(makeValue => applicableMakeValues.add(makeValue));
    // } else {
    //     console.log(`ISC useMemo: No additional makes found in selectedCategories.`);
    // }

    console.log(
      `ISC useMemo: Final applicable make values set:`,
      Array.from(applicableMakeValues)
    );

    // 3. Filter allMakeOptions based on the final applicable set of make values
    let potentialMakeOptions = allMakeOptions.filter((opt) =>
      applicableMakeValues.has(opt.value)
    );

    // 4. Sort the final list alphabetically by label for consistent display
    potentialMakeOptions.sort((a, b) => a.label.localeCompare(b.label));

    console.log(
      "ISC useMemo: Final potentialMakeOptions (before return):",
      JSON.stringify(potentialMakeOptions)
    );
    console.log("--- ISC useMemo End ---");
    return potentialMakeOptions;
  }, [
    currentItemCategoryName,
    selectedCategories, // Derived makes from store (items + session adds)
    initialCategoryMakes, // Baseline makes from project WP config
    allMakeOptions, // The complete list of make options
    categoryMakelist, // Fallback list if initial is empty
  ]);
  // --- End FINAL REVISED LOGIC ---

  const isNewItemsCreationDisabledForCategory = useMemo(() => {
    if (!curItem?.category || !categoryList) return false;
    const categoryDetails = categoryList.find(
      (c) => c.name === curItem.category
    );
    return (
      categoryDetails?.new_items === "false" &&
      userData?.role !== "Nirmaan Admin Profile"
    );
  }, [curItem, categoryList, userData?.role]);

  // --- Handlers ---
  const handleItemChange = useCallback(
    (selectedOption: SingleValue<ItemOption>) => {
      setCurItem(selectedOption);
      setCurMake(null);
      setCurQuantity("");
      setCurComment("");
    },
    []
  ); // No dependencies needed if it only sets state

  const handleAddItemClick = useCallback(() => {
    if (!curItem || !curQuantity || parseNumber(curQuantity) <= 0) {
      alert("Please select an item and enter a valid quantity.");
      return;
    }
    onAddItem({
      name: curItem.value,
      item: curItem.label,
      unit: curItem.unit,
      quantity: parseNumber(curQuantity),
      category: curItem.category,
      tax: curItem.tax,
      make: curMake?.value || undefined,
      comment: curComment.trim() || undefined,
    });
    setCurItem(null);
    setCurMake(null);
    setCurQuantity("");
    setCurComment("");
  }, [curItem, curQuantity, curMake, curComment, onAddItem]); // Dependencies needed

  const handleOpenManageMakesDialog = useCallback(() => {
    if (!curItem?.category) {
      alert("Please select an item first to manage makes for its category.");
      return;
    }
    setIsManageMakesDialogOpen(true);
  }, [curItem]); // Dependency needed

  const handleMakesManaged = useCallback(
    (newlyAssociatedMakes: MakeOption[]) => {
      if (!currentItemCategoryName) return;
      let makeToSelectAfterwards: MakeOption | null = null; // To auto-select the first added make
      newlyAssociatedMakes.forEach((make) => {
        updateCategoryMakesInStore(currentItemCategoryName, make.value);
        if (!makeToSelectAfterwards) {
          // Keep track of the first one added
          makeToSelectAfterwards = make;
        }
      });

      setIsManageMakesDialogOpen(false);

      // Auto-select the first newly added make if available
      if (makeToSelectAfterwards) {
        const fullOption = allMakeOptions.find(
          (opt) => opt.value === makeToSelectAfterwards!.value
        );
        if (fullOption) {
          setCurMake(fullOption); // Update local state
        }
      }
    },
    [currentItemCategoryName, updateCategoryMakesInStore, allMakeOptions]
  );

  return (
    <div className="space-y-4">
      {/* Work Package Display (No changes) */}
      <div className="flex items-center justify-between">
        {/* Left-side content */}
        <div className="space-y-1">
          <h3 className="max-sm:text-xs font-semibold text-gray-400">
            Package
          </h3>

          {/* The package name stays here */}
          <p className="font-semibold max-sm:text-sm">{selectedWP}</p>
        </div>

        {/* Right-side content - The Reset button is moved here */}
        {allowWpEdit && (
          <Dialog>
            <DialogTrigger asChild>
              <Button size="sm">Reset</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>Reset Order List?</DialogTitle>
                <DialogDescription>
                  Changing the work package will clear your current item list.
                  Are you sure?
                </DialogDescription>
              </DialogHeader>
              <div className="flex items-center justify-center gap-4 pt-2">
                <DialogClose asChild>
                  <Button variant="outline" size="sm">
                    No
                  </Button>
                </DialogClose>
                <Button size="sm" onClick={onEditWP}>
                  Yes, Change
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* --- Item Selector --- */}
      <div>
        <Label
          htmlFor="item-select"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          Item <sup className="text-red-500">*</sup>
        </Label>
        <FuzzySearchSelect
          inputId="item-select"
          placeholder={"Select or Create/Request Item..."}
          value={curItem}
          allOptions={itemOptions}
          fuseOptions={itemFuseOptions}
          onChange={handleItemChange}
          isDisabled={disabled}
          isClearable
          customMenuListComponent={ItemCustomMenuList} // Pass your custom menu
          customMenuListProps={{
            // Props for your custom menu
            onAddItemClick: onOpenNewItemDialog,
            isNewItemsDisabled: isNewItemsCreationDisabledForCategory, // Pass the disabled state
          }}
        />
      </div>

      {/* --- Row for Make / Qty / Unit --- */}
      {/* --- Row for Make / Qty / Unit (Horizontal, wraps, baseline aligned) --- */}
      <div className="flex flex-row items-baseline gap-2 sm:gap-4">
        {/* Make Selector (Flexible width) */}
        <div className="w-2/3">
          {" "}
          {/* Allow grow/shrink, base width ~160px */}
          <Label
            htmlFor="make-select"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Make<sup className="text-red-500">*</sup>
          </Label>
          <ReactSelect
            inputId="make-select"
            placeholder={!curItem ? "NA" : "Select Make..."} // Changed placeholder slightly
            value={curMake}
            isDisabled={disabled || !curItem}
            options={availableMakeOptions}
            onChange={(selectedOption) => setCurMake(selectedOption)}
            onManageMakesClick={handleOpenManageMakesDialog}
            components={{ MenuList: CustomMakeMenuList }} // Use CustomMakeMenuList for Make
            // selectProps={{ customProps: makeSelectCustomProps }}
            isClearable
          />
        </div>

        {/* Unit Display (Fixed base width) */}
        <div className="w-1/6">
          {" "}
          {/* Fixed base width ~80px */}
          <Label className="block text-sm font-medium text-gray-700 mb-1">
            Unit
          </Label>
          <Input
            type="text"
            disabled
            value={curItem?.unit || "--"}
            className="bg-gray-100 cursor-not-allowed"
          />
        </div>

        {/* Qty Input (Fixed base width) */}
        <div className="w-1/6">
          {" "}
          {/* Fixed base width ~96px */}
          <Label
            htmlFor="quantity-input"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Qty<sup className="text-red-500">*</sup>
          </Label>
          <Input
            id="quantity-input"
            type="number"
            placeholder="0.00"
            value={curQuantity}
            onChange={(e) => setCurQuantity(e.target.value)}
            disabled={disabled || !curItem}
            min="0"
            step="any"
          />
        </div>
      </div>

      {/* --- Comment Input (Full Width) --- */}
      <div>
        <Label
          htmlFor="comment-input"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          Item Comments
        </Label>
        <Input
          id="comment-input"
          type="text"
          placeholder="Add notes for this item..."
          value={curComment}
          onChange={(e) => setCurComment(e.target.value)}
          disabled={disabled || !curItem}
        />
      </div>

      {/* --- Add Item Button (Full Width) --- */}
      <Button
        onClick={handleAddItemClick}
        disabled={
          disabled ||
          !curItem ||
          !curQuantity ||
          !curMake ||
          parseFloat(curQuantity) <= 0
        }
        variant={"outline"}
        className="w-full border border-primary text-primary hover:bg-primary/5"
      >
        Add to Cart
      </Button>

      {/* --- Manage Makes Dialog Instance --- */}
      {currentItemCategoryName && (
        <ManageCategoryMakesDialog
          isOpen={isManageMakesDialogOpen}
          onOpenChange={setIsManageMakesDialogOpen}
          categoryName={currentItemCategoryName}
          associatedMakes={
            selectedCategories.find((c) => c.name === currentItemCategoryName)
              ?.makes ?? // Check derived state first
            initialCategoryMakes[currentItemCategoryName] ?? // Fallback to initial state
            [] // Default to empty array
          }
          // allMakeOptions={allMakeOptions}
          onMakesAssociated={handleMakesManaged}
          makeList={makeList} // Pass makeList down
          makeListMutate={makeListMutate}
          categoryMakelist={categoryMakelist} // Pass categoryMakelist down
          categoryMakeListMutate={categoryMakeListMutate}
        />
      )}
    </div>
  );
};
