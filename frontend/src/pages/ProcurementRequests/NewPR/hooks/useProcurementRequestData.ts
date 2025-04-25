import { useMemo } from 'react';
import { useFrappeGetDocList, useFrappeGetDoc } from 'frappe-react-sdk';
import { useProcurementRequestStore } from '../store/useProcurementRequestStore';
import { Projects } from '@/types/NirmaanStack/Projects';
import { ProcurementPackages } from '@/types/NirmaanStack/ProcurementPackages';
import { Category } from '@/types/NirmaanStack/Category';
import { NirmaanUsers } from '@/types/NirmaanStack/NirmaanUsers';
import { Items } from '@/types/NirmaanStack/Items';

interface UseProcurementRequestDataResult {
    project?: Projects;
    wpList?: ProcurementPackages[];
    categoryList?: Category[];
    itemList?: Items[];
    usersList?: NirmaanUsers[];
    itemOptions: { label: string; value: string; unit: string; category: string; tax: number }[];
    catOptions: { label: string; value: string; tax: number }[];
    isLoading: boolean;
    error: Error | null;
    itemMutate: () => Promise<any>; // Expose item mutation if needed (e.g., after creating new item)
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

    // Fetch Users (for comments, etc.) - Consider filtering if needed
    const { data: usersList, isLoading: usersLoading, error: usersError } = useFrappeGetDocList<NirmaanUsers>(
        "Nirmaan Users", {
            fields: ["name", "full_name"], // Only fetch needed fields
            limit: 1000,
        }
    );

    // Memoize derived options for ReactSelect
    const catOptions = useMemo(() => {
        return category_list?.map(cat => ({
            value: cat.name, // Use name (DocType key) as value
            label: cat.category_name,
            tax: parseFloat(cat.tax || "0"),
        })) || [];
    }, [category_list]);

     const itemOptions = useMemo(() => {
        if (!item_list || !catOptions.length) return [];
        const categoryTaxMap = new Map(catOptions.map(cat => [cat.value, cat.tax]));
        return item_list.map(item => ({
            value: item.name, // Use name (DocType key) as value
            label: item.item_name,
            unit: item.unit_name || 'N/A', // Provide default
            category: item.category, // Store category name (key)
            tax: categoryTaxMap.get(item.category) || 0,
        }));
    }, [item_list, catOptions]);


    const isLoading = wpLoading || catLoading || itemLoading || usersLoading || (!project && !!projectId); // Include project loading check
    const error = wpError || catError || itemError || projectError || usersError;

    return {
        project,
        wpList: wp_list,
        categoryList: category_list,
        itemList: item_list,
        usersList,
        itemOptions,
        catOptions,
        isLoading,
        error: error instanceof Error ? error : null,
        itemMutate, // Return mutate function for items
    };
};