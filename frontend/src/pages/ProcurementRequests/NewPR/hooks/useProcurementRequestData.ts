import { useFrappeGetDocList, useFrappeGetDoc } from 'frappe-react-sdk';
import { useProcurementRequestStore } from '../store/useProcurementRequestStore';
import { Projects } from '@/types/NirmaanStack/Projects';
import { ProcurementPackages } from '@/types/NirmaanStack/ProcurementPackages';
import { Category } from '@/types/NirmaanStack/Category';
import { useItemCatalog, ItemCatalogOption } from '@/hooks/useItemCatalog';

interface UseProcurementRequestDataResult {
    project?: Projects;
    wpList?: ProcurementPackages[];
    categoryList?: Category[];
    itemOptions: ItemCatalogOption[];
    isLoading: boolean;
    error: Error | null;
    itemMutate: () => Promise<any>;
    categoryMakeListMutate: () => Promise<any>;
}

export const useProcurementRequestData = (): UseProcurementRequestDataResult => {
    // Get projectId from the store
    const projectId = useProcurementRequestStore(state => state.projectId);

    // Fetch Project Details
    const { data: project, error: projectError } = useFrappeGetDoc<Projects>(
        "Projects",
        projectId!,
        !!projectId ? undefined : null,
    );

    // Fetch Work Packages (for WorkPackageSelector)
    const { data: wp_list, isLoading: wpLoading, error: wpError } = useFrappeGetDocList<ProcurementPackages>(
        "Procurement Packages", {
            fields: ["work_package_name", "work_package_image"],
            orderBy: { field: "work_package_name", order: "asc" },
            limit: 0,
        },
        "All_Work_Packages"
    );

    // Use shared item catalog for items, categories, and category makelists
    const {
        itemOptions,
        categories,
        isLoading: catalogLoading,
        error: catalogError,
        itemMutate,
        categoryMakeListMutate,
    } = useItemCatalog();

    // Update isLoading and error aggregation
    const isLoading = wpLoading || catalogLoading || (!project && !!projectId);
    const error = wpError || projectError || catalogError;

    return {
        project,
        wpList: wp_list,
        categoryList: categories,
        itemOptions,
        isLoading,
        error: error instanceof Error ? error : null,
        itemMutate,
        categoryMakeListMutate,
    };
};
