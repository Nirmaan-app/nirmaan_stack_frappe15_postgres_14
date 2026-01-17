import { useMemo } from "react";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { TDSItem } from "../components/types";

interface UseTDSItemOptionsProps {
    selectedWP?: string;
    selectedCategory?: string;
    watchedTdsItemId?: string;
    currentItem?: TDSItem | null; // For Edit mode preservation
}

export const useTDSItemOptions = ({ selectedWP, selectedCategory, watchedTdsItemId, currentItem }: UseTDSItemOptionsProps) => {
    
    // Fetch Data
    // Using limit: 0 (or large generic limit in some versions of SDK, assuming 0 means all or standard ample limit)
    // The user code used limit:0, I will stick to that to preserve behavior.
    const { data: wpList } = useFrappeGetDocList("Procurement Packages", { fields: ["name", "work_package_name"], limit: 0 });
    const { data: catList } = useFrappeGetDocList("Category", { fields: ["name", "category_name", "work_package"], limit: 0 });
    const { data: itemList } = useFrappeGetDocList("Items", { fields: ["name", "item_name", "category"], limit: 0 });
    const { data: makeList } = useFrappeGetDocList("Makelist", { fields: ["name", "make_name"], limit: 0 });
    const { data: catMakeList } = useFrappeGetDocList("Category Makelist", { fields: ["category", "make"], limit: 0 });

    // Fetch existing TDS entries for validation
    const { data: categoryEntries } = useFrappeGetDocList("TDS Repository", {
        filters: selectedCategory ? [["category", "=", selectedCategory]] : undefined,
        fields: ["tds_item_id", "make"],
        limit: 0
    }, selectedCategory ? undefined : null);


    // Compute Options

    // 1. Work Package Options
    const wpOptions = useMemo(() => wpList?.map(d => ({ label: d.work_package_name, value: d.name })) || [], [wpList]);

    // 2. Category Options (Dependent on WP)
    const catOptions = useMemo(() => {
        if (!selectedWP) return [];
        return catList
            ?.filter(d => d.work_package === selectedWP)
            .map(d => ({ label: d.category_name, value: d.name })) || [];
    }, [catList, selectedWP]);

    // 3. Item Options (With "Saturation" check - hide fully booked items)
    const itemOptions = useMemo(() => {
        if (!selectedCategory) return [];
        
        // Get valid makes for the category from CategoryMakelist
        const validMakesForCategory = new Set(
            catMakeList
                ?.filter(cm => cm.category === selectedCategory)
                .map(cm => cm.make) || []
        );

        // Map of ItemID -> Set of TakenMakes from TDS Repository
        const itemTakenMakes = new Map<string, Set<string>>();
        if (categoryEntries) {
            categoryEntries.forEach(d => {
                if (!itemTakenMakes.has(d.tds_item_id)) {
                    itemTakenMakes.set(d.tds_item_id, new Set());
                }
                itemTakenMakes.get(d.tds_item_id)!.add(d.make);
            });
        }

        return itemList
            ?.filter(d => d.category === selectedCategory)
            .filter(d => {
                // PRESERVATION LOGIC: If we are editing this specific item, keeping it visible is critical
                if (currentItem && d.name === currentItem.tds_item_id) return true;

                // Saturation Logic:
                // If no specific makes are restricted, we assume infinite makes? 
                // Previous logic says: "If validMakesForCategory size is 0, return true."
                if (validMakesForCategory.size === 0) return true;

                const taken = itemTakenMakes.get(d.name);
                if (!taken) return true; // No makes taken yet

                let takenCount = 0;
                validMakesForCategory.forEach(vm => {
                    if (taken.has(vm)) takenCount++;
                });

                // If number of Taken Valid Makes < Total Valid Makes, then there is space.
                return takenCount < validMakesForCategory.size;
            })
            .map(d => ({ label: d.item_name, value: d.name })) || [];
    }, [itemList, selectedCategory, categoryEntries, catMakeList, currentItem]);

    // 4. Make Options (With duplicate prevention)
    const makeOptions = useMemo(() => {
        if (!selectedCategory || !catMakeList || !makeList) return [];
        
        // Allowed Makes for this Category
        const validMakesForCategory = new Set(
            catMakeList
                .filter(cm => cm.category === selectedCategory)
                .map(cm => cm.make)
        );

        // Already Taken Makes for this Item
        const takenMakes = new Set(
            categoryEntries
                ?.filter(d => d.tds_item_id === watchedTdsItemId)
                ?.filter(entry => {
                    // PRESERVATION LOGIC:
                    // If we are editing the item (watched ID == current item ID), 
                    // AND the entry matches the current item's original make,
                    // DO NOT count it as taken (so it shows in dropdown).
                    const currentItemOriginalMake = currentItem?.make;
                    if (currentItem && watchedTdsItemId === currentItem.tds_item_id && entry.make === currentItemOriginalMake) {
                        return false;
                    }
                    return true;
                })
                .map(d => d.make) || []
        );

        let availableMakes = makeList;

        // Apply Allowed List Filter
        if (validMakesForCategory.size > 0) {
            availableMakes = availableMakes.filter(m => validMakesForCategory.has(m.name));
        }

        // Apply Taken Filter
        return availableMakes
            .filter(d => !takenMakes.has(d.name))
            .map(d => ({ label: d.make_name, value: d.name }));
            
    }, [makeList, catMakeList, selectedCategory, categoryEntries, watchedTdsItemId, currentItem]);

    return {
        wpOptions,
        catOptions,
        itemOptions,
        makeOptions,
        // Expose raw data if strictly needed (currently options cover most needs)
        categoryEntries 
    };
};
