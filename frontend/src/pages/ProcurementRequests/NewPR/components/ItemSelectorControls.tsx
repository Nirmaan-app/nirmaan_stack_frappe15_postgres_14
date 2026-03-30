import React, { useState, useMemo, useCallback } from "react";
import ReactSelect, {
  components,
  MenuListProps,
  SingleValue,
  GroupBase,
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
import { CirclePlus } from "lucide-react";
import {
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
import { IFuseOptions } from "fuse.js";
import { FuzzySearchSelect } from "@/components/ui/fuzzy-search-select";
import { useMakeOptions } from "@/hooks/useMakeOptions";
import { ProjectWPCategoryMake } from "@/types/NirmaanStack/Projects";

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
  onAddItem: (
    itemData: Omit<ProcurementRequestItem, "uniqueId" | "status">
  ) => void;
  onOpenNewItemDialog: () => void;
  allowWpEdit: boolean;
  onEditWP: () => void;
  disabled?: boolean;
  categoryList?: Category[];
  updateCategoryMakesInStore: (categoryName: string, newMake: string) => void;
  makeList?: Makelist[];
  makeListMutate: () => Promise<any>;
  selectedHeaderTags: { tag_header: string; tag_package: string }[];
  categoryToPackageMap: Record<string, string>;
  itemFuseOptions: IFuseOptions<ItemOption>;
  procList: ProcurementRequestItem[];
  allProjectPackages: string[];
  projectWpCategoryMakes: ProjectWPCategoryMake[] | undefined;
  relevantPackages: string[];
}

export const ItemSelectorControls: React.FC<ItemSelectorControlsProps> = ({
  selectedWP,
  itemOptions,
  onAddItem,
  onOpenNewItemDialog,
  allowWpEdit,
  onEditWP,
  disabled = false,
  categoryList,
  updateCategoryMakesInStore,
  makeList,
  makeListMutate,
  selectedHeaderTags,
  categoryToPackageMap,
  itemFuseOptions,
  procList,
  allProjectPackages: _allProjectPackages,
  projectWpCategoryMakes,
  relevantPackages,
}) => {
  // --- State ---
  const [curItem, setCurItem] = useState<SingleValue<ItemOption>>(null);
  const [curMake, setCurMake] = useState<SingleValue<MakeOption>>(null);
  const [curQuantity, setCurQuantity] = useState<string>("");
  const [curComment, setCurComment] = useState<string>("");
  const [isManageMakesDialogOpen, setIsManageMakesDialogOpen] = useState(false);
  const userData = useUserData();

  // --- Memos and Derived State ---
  const currentItemCategoryName = curItem?.category;

  const filteredItemOptions = useMemo(() => {
    const addedItemNames = new Set(procList.map(item => item.name));
    return itemOptions.filter(opt => !addedItemNames.has(opt.value));
  }, [itemOptions, procList]);

  const {
    makeOptions: availableMakeOptions,
    allMakeOptions,
    categoryMakelist,
    categoryMakeListMutate,
  } = useMakeOptions({
    categoryName: currentItemCategoryName,
    projectWpCategoryMakes,
    relevantPackages,
  });

  const isNewItemsCreationDisabledForCategory = useMemo(() => {
    if (!curItem?.category || !categoryList) return false;
    const categoryDetails = categoryList.find(
      (c) => c.name === curItem.category
    );
    return (
      categoryDetails?.new_items === "false" &&
      userData?.role !== "Nirmaan Admin Profile" &&
      userData?.role !== "Nirmaan PMO Executive Profile"
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
  );

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
      work_package: categoryToPackageMap[curItem.category] || (selectedHeaderTags.length > 0 ? selectedHeaderTags[0].tag_package : selectedWP),
    });
    setCurItem(null);
    setCurMake(null);
    setCurQuantity("");
    setCurComment("");
  }, [curItem, curQuantity, curMake, curComment, onAddItem, selectedHeaderTags, selectedWP]);

  const handleOpenManageMakesDialog = useCallback(() => {
    if (!curItem?.category) {
      alert("Please select an item first to manage makes for its category.");
      return;
    }
    setIsManageMakesDialogOpen(true);
  }, [curItem]);

  const handleMakesManaged = useCallback(
    (newlyAssociatedMakes: MakeOption[]) => {
      if (!currentItemCategoryName) return;
      let makeToSelectAfterwards: MakeOption | null = null;
      newlyAssociatedMakes.forEach((make) => {
        updateCategoryMakesInStore(currentItemCategoryName, make.value);
        if (!makeToSelectAfterwards) {
          makeToSelectAfterwards = make;
        }
      });

      setIsManageMakesDialogOpen(false);

      if (makeToSelectAfterwards) {
        const fullOption = allMakeOptions.find(
          (opt) => opt.value === makeToSelectAfterwards!.value
        );
        if (fullOption) {
          setCurMake(fullOption);
        }
      }
    },
    [currentItemCategoryName, updateCategoryMakesInStore, allMakeOptions]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
        <div className="flex flex-col gap-1.5 flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide shrink-0">Headers Tags:</span>
            {selectedHeaderTags.map((tag, idx) => (
              <span
                key={idx}
                className="px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-medium border border-primary/20 whitespace-nowrap"
              >
                {tag.tag_header}
              </span>
            ))}
          </div>
          {/* <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide shrink-0">Packages:</span>
            {allProjectPackages.map((pkg, idx) => (
              <span
                key={idx}
                className="px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 text-[10px] font-medium border border-blue-200 whitespace-nowrap"
              >
                {pkg}
              </span>
            ))}
          </div> */}
        </div>

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
          allOptions={filteredItemOptions}
          fuseOptions={itemFuseOptions}
          onChange={handleItemChange as any}
          isDisabled={disabled}
          isClearable
          customMenuListComponent={ItemCustomMenuList as any}
          customMenuListProps={{
            onAddItemClick: onOpenNewItemDialog,
            isNewItemsDisabled: isNewItemsCreationDisabledForCategory,
          } as any}
        />
      </div>

      <div className="flex flex-row items-baseline gap-2 sm:gap-4">
        <div className="w-2/3">
          <Label
            htmlFor="make-select"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Make<sup className="text-red-500">*</sup>
          </Label>
          <ReactSelect<MakeOption, false, GroupBase<MakeOption>>
            inputId="make-select"
            placeholder={!curItem ? "NA" : "Select Make..."}
            value={curMake}
            isDisabled={disabled || !curItem}
            options={availableMakeOptions}
            onChange={(selectedOption) => setCurMake(selectedOption)}
            {...({ onManageMakesClick: handleOpenManageMakesDialog } as any)}
            components={{ MenuList: CustomMakeMenuList as any }}
            isClearable
          />
        </div>

        <div className="w-1/6">
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

        <div className="w-1/6">
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

      {currentItemCategoryName && (
        <ManageCategoryMakesDialog
          isOpen={isManageMakesDialogOpen}
          onOpenChange={setIsManageMakesDialogOpen}
          categoryName={currentItemCategoryName}
          associatedMakes={availableMakeOptions.map((opt) => opt.value)}
          onMakesAssociated={handleMakesManaged}
          makeList={makeList}
          makeListMutate={makeListMutate}
          categoryMakelist={categoryMakelist}
          categoryMakeListMutate={categoryMakeListMutate}
        />
      )}
    </div>
  );
};
