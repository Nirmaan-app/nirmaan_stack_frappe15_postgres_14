import { useMemo } from 'react';
import { useFrappeGetDocList, useFrappeGetDoc } from 'frappe-react-sdk';
import { useProcurementRequestStore } from '../store/useProcurementRequestStore';
import { Projects } from '@/types/NirmaanStack/Projects';
import { ProcurementPackages } from '@/types/NirmaanStack/ProcurementPackages';
import { Category } from '@/types/NirmaanStack/Category';
import { Items } from '@/types/NirmaanStack/Items';
import { ItemOption, MakeOption } from '../types';
import { Makelist } from '@/types/NirmaanStack/Makelist';
import { CategoryMakelist } from '@/types/NirmaanStack/CategoryMakelist';

interface UseProcurementRequestDataResult {
    project?: Projects;
    wpList?: ProcurementPackages[];
    categoryList?: Category[];
    itemList?: Items[];
    // usersList?: NirmaanUsers[];
    itemOptions: { label: string; value: string; unit: string; category: string; tax: number }[];
    // catOptions: CategoryOption[];
    isLoading: boolean;
    error: Error | null;
    itemMutate: () => Promise<any>; // Expose item mutation if needed (e.g., after creating new item)
    makeList?: Makelist[];
    allMakeOptions: MakeOption[];
    makeListMutate: () => Promise<any>;
    categoryMakelist?: CategoryMakelist[];
    categoryMakeListMutate: () => Promise<any>;
}

export const useProcurementRequestData = (): UseProcurementRequestDataResult => {
    // Get projectId and selectedWP from the store
    const projectId = useProcurementRequestStore(state => state.projectId);
    const selectedWP = useProcurementRequestStore(state => state.selectedWP);

    // Fetch Project Details
    const { data: project, error: projectError } = useFrappeGetDoc<Projects>(
        "Projects",
        projectId!, // Assert non-null as it should be set by initialization
        !!projectId ? undefined : null, // Only fetch if projectId is set
    );

    // Fetch Work Packages
    const { data: wp_list, isLoading: wpLoading, error: wpError } = useFrappeGetDocList<ProcurementPackages>(
        "Procurement Packages", {
            fields: ["work_package_name", "work_package_image"],
            orderBy: { field: "work_package_name", order: "asc" },
            limit: 1000,
        }
    );

    // Fetch Categories based on selectedWP
    const { data: category_list, isLoading: catLoading, error: catError } = useFrappeGetDocList<Category>(
        "Category", {
            fields: ["category_name", "work_package", "image_url", "tax", "new_items", "name"],
            filters: selectedWP ? [["work_package", "=", selectedWP]] : [], // Only filter if WP selected
            orderBy: { field: "category_name", order: "asc" },
            limit: 1000,
        },
        !!selectedWP ? undefined : null // Only fetch if selectedWP is set
    );

    // Fetch Items based on fetched categories
    const categoryNames = useMemo(() => category_list?.map((c) => c.name) || [], [category_list]);

    const { data: item_list, isLoading: itemLoading, error: itemError, mutate: itemMutate } = useFrappeGetDocList<Items>(
        "Items", {
            fields: ["name", "item_name", "make_name", "unit_name", "category", "creation"],
            filters: categoryNames.length > 0 ? [["category", "in", categoryNames]] : [],
            orderBy: { field: "creation", order: "desc" },
            limit: 100000, // Still large, consider alternatives if perf issues
        },
        categoryNames.length > 0 ? undefined : null // Only fetch if categories are set
    );

    const {data: categoryMakelist, isLoading: categoryMakeListLoading, error: categoryMakeListError, mutate: categoryMakeListMutate} = useFrappeGetDocList<CategoryMakelist>("Category Makelist", {
        fields: ["category", "make"],
        filters: [["category", "in", categoryNames]],
        orderBy: { field: "category", order: "asc" },
        limit: 100000,
    },
    categoryNames.length > 0 ? undefined : null // Only fetch if categories are set
    )

     // --- Fetch Make List ---
     const { data: make_list, isLoading: makeLoading, error: makeError, mutate: makeListMutate } = useFrappeGetDocList<Makelist>(
        "Makelist", {
            fields: ["name", "make_name"],
            limit: 10000, // Consider if this needs pagination for very large lists
        }
    );

    // --- Derived Make Options ---
    const allMakeOptions = useMemo<MakeOption[]>(() => {
        return make_list?.map(make => ({
            value: make.name, // Use DocType name (which might be same as make_name if not customized)
            label: make.make_name,
        })) || [];
    }, [make_list]);


    // --- Derived Options ---
    //  const catOptions = useMemo(() => {
    //     // Basic options without makes, makes are handled via the project data separately
    //     return category_list?.map(cat => ({
    //         value: cat.name,
    //         label: cat.category_name,
    //         tax: parseNumber(cat.tax),
    //         // newItemsDisabled flag is still useful here
    //         newItemsDisabled: cat.new_items === "false",
    //     })) || [];
    // }, [category_list]);

    const itemOptions = useMemo<ItemOption[]>(() => {
        if (!item_list || !category_list) return []; // Depend on category_list too
         // Create a map for quick tax lookup
        const categoryTaxMap = new Map(category_list.map(cat => [cat.name, parseFloat(cat.tax || "0")]));
        return item_list.map(item => ({
            value: item.name,
            label: item.item_name,
            unit: item.unit_name || 'N/A',
            category: item.category,
            tax: categoryTaxMap.get(item.category) || 0,
        }));
    }, [item_list, category_list]); // Use category_list dependency


    // Update isLoading and error aggregation
    const isLoading = wpLoading || catLoading || itemLoading || makeLoading || categoryMakeListLoading || (!project && !!projectId);
    const error = wpError || catError || itemError || projectError || makeError || categoryMakeListError;

    return {
        project,
        wpList: wp_list,
        categoryList: category_list,
        itemList: item_list,
        // usersList,
        itemOptions,
        // catOptions,
        isLoading,
        error: error instanceof Error ? error : null,
        itemMutate, // Return mutate function for items
        makeList: make_list,
        allMakeOptions,
        makeListMutate,
        categoryMakelist,
        categoryMakeListMutate
    };
};