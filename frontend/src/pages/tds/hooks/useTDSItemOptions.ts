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
    const { data: wpList } = useFrappeGetDocList("Work Packages", { fields: ["name", "work_package_name"], limit: 0 });
    const { data: catList } = useFrappeGetDocList("Category", { fields: ["name", "category_name", "work_package"], limit: 0 });
    const { data: itemList } = useFrappeGetDocList("Items", { fields: ["name", "item_name", "category"], limit: 0 });
    const { data: makeList } = useFrappeGetDocList("Makelist", { fields: ["name", "make_name"], limit: 0 });
    const { data: catMakeList } = useFrappeGetDocList("Category Makelist", { fields: ["category", "make"], limit: 0 });

    // Fetch ALL TDS Repository entries for validation and custom items
    const { data: allTdsEntries } = useFrappeGetDocList("TDS Repository", {
        fields: ["name", "tds_item_id", "tds_item_name", "work_package", "category", "make"],
        limit: 0
    });

    // Fetch entries for current category (for make filtering)
    const { data: categoryEntries } = useFrappeGetDocList("TDS Repository", {
        filters: selectedCategory ? [["category", "=", selectedCategory]] : undefined,
        fields: ["tds_item_id", "make"],
        limit: 0
    }, selectedCategory ? undefined : null);

    // Get all custom items (CUS-*) for suggestions
    const allCustomItems = useMemo(() => {
        if (!allTdsEntries) return [];
        
        // Get unique custom items
        const customMap = new Map<string, { id: string; name: string; wp: string; cat: string }>();
        allTdsEntries
            .filter(d => d.tds_item_id?.startsWith("CUS-"))
            .forEach(d => {
                if (!customMap.has(d.tds_item_id)) {
                    customMap.set(d.tds_item_id, {
                        id: d.tds_item_id,
                        name: d.tds_item_name || d.tds_item_id,
                        wp: d.work_package,
                        cat: d.category
                    });
                }
            });
        
        return Array.from(customMap.values());
    }, [allTdsEntries]);

    // 1. Work Package Options
    const wpOptions = useMemo(() => wpList?.map(d => ({ label: d.work_package_name, value: d.name })) || [], [wpList]);

    // 2. Category Options (Dependent on WP)
    const catOptions = useMemo(() => {
        if (!selectedWP) return [];
        return catList
            ?.filter(d => d.work_package === selectedWP)
            .map(d => ({ label: d.category_name, value: d.name })) || [];
    }, [catList, selectedWP]);

    // 3. Standard Item Options filtered by WP (NEW: for the new flow)
    const itemOptionsForWP = useMemo(() => {
        if (!selectedWP || !itemList || !catList) return [];
        
        // Get categories for this WP
        const wpCategories = new Set(
            catList.filter(c => c.work_package === selectedWP).map(c => c.name)
        );
        
        // Get items belonging to those categories
        return itemList
            .filter(d => wpCategories.has(d.category))
            .map(d => {
                const category = catList.find(c => c.name === d.category);
                return { 
                    label: d.item_name, 
                    value: d.name,
                    category: d.category,
                    categoryName: category?.category_name || d.category
                };
            });
    }, [itemList, catList, selectedWP]);

    // 4. Item Options filtered by Category (OLD: for backwards compatibility)
    const itemOptions = useMemo(() => {
        if (!selectedCategory) return [];
        
        const validMakesForCategory = new Set(
            catMakeList
                ?.filter(cm => cm.category === selectedCategory)
                .map(cm => cm.make) || []
        );

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
                if (currentItem && d.name === currentItem.tds_item_id) return true;
                if (validMakesForCategory.size === 0) return true;
                const taken = itemTakenMakes.get(d.name);
                if (!taken) return true;
                let takenCount = 0;
                validMakesForCategory.forEach(vm => {
                    if (taken.has(vm)) takenCount++;
                });
                return takenCount < validMakesForCategory.size;
            })
            .map(d => ({ label: d.item_name, value: d.name })) || [];
    }, [itemList, selectedCategory, categoryEntries, catMakeList, currentItem]);

    // 5. Make Options (With duplicate prevention)
    const makeOptions = useMemo(() => {
        if (!selectedCategory || !catMakeList || !makeList) return [];
        
        const validMakesForCategory = new Set(
            catMakeList
                .filter(cm => cm.category === selectedCategory)
                .map(cm => cm.make)
        );

        const takenMakes = new Set(
            categoryEntries
                ?.filter(d => d.tds_item_id === watchedTdsItemId)
                ?.filter(entry => {
                    const currentItemOriginalMake = currentItem?.make;
                    if (currentItem && watchedTdsItemId === currentItem.tds_item_id && entry.make === currentItemOriginalMake) {
                        return false;
                    }
                    return true;
                })
                .map(d => d.make) || []
        );

        let availableMakes = makeList;
        if (validMakesForCategory.size > 0) {
            availableMakes = availableMakes.filter(m => validMakesForCategory.has(m.name));
        }

        const filteredMakes = availableMakes
            .filter(d => !takenMakes.has(d.name))
            .map(d => ({ label: d.make_name, value: d.name }));
        
        return [...filteredMakes, { label: "Others", value: "__others__" }];
            
    }, [makeList, catMakeList, selectedCategory, categoryEntries, watchedTdsItemId, currentItem]);

    // Helper: Get category info from item ID
    const getCategoryForItem = (itemId: string) => {
        // Check if it's a custom item
        const customItem = allCustomItems.find(c => c.id === itemId);
        if (customItem) {
            return { category: customItem.cat, workPackage: customItem.wp };
        }
        // Check standard items
        const item = itemList?.find(i => i.name === itemId);
        if (item) {
            const category = catList?.find(c => c.name === item.category);
            return { 
                category: item.category, 
                workPackage: category?.work_package || "" 
            };
        }
        return null;
    };

    return {
        wpOptions,
        catOptions,
        itemOptions,
        itemOptionsForWP,
        makeOptions,
        allCustomItems,
        categoryEntries,
        getCategoryForItem,
        catList,
        itemList
    };
};

