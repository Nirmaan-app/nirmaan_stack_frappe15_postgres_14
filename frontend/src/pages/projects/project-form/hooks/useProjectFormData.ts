import { useFrappeDocTypeEventListener, useFrappeGetCall, useFrappeGetDoc, useFrappeGetDocList } from "frappe-react-sdk";
import { useCallback, useMemo, useState } from "react";
import { Customers } from "@/types/NirmaanStack/Customers";
import { ProjectTypes } from "@/types/NirmaanStack/ProjectTypes";
import { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers";
import { Category } from "@/types/NirmaanStack/Category";
import { CategoryMakelist } from "@/types/NirmaanStack/CategoryMakelist";

export interface SelectOption {
    label: string;
    value: string;
}

export interface WorkPackageType {
    work_package_name: string;
}

export interface WorkHeaderType {
    name: string;
    work_header_name: string;
    work_package_link: string;
}

export interface DesignTaskTemplate {
    task_name: string;
    deadline_offset?: number;
}

export interface DesignCategory {
    category_name: string;
    tasks: DesignTaskTemplate[];
}

interface DesignMasterDataResponse {
    message: {
        categories: Array<{
            category_name: string;
            tasks: Array<{
                task_name: string;
                deadline_offset?: number;
            }>;
        }>;
    };
}

/**
 * Hook to fetch all data needed for the project form
 *
 * Consolidates multiple useFrappeGetDocList calls into a single hook
 * for cleaner component code.
 */
export const useProjectFormData = () => {
    // Work Packages
    const {
        data: workPackageList,
        isLoading: workPackagesLoading,
        error: workPackagesError
    } = useFrappeGetDocList("Work Packages", {
        fields: ['work_package_name'],
        filters: [["work_package_name", "not in", ["Tool & Equipments", "Services", "Additional Charges"]]],
        limit: 1000
    });

    // Customers
    const {
        data: customers,
        isLoading: customersLoading,
        error: customersError,
        mutate: customersMutate
    } = useFrappeGetDocList<Customers>('Customers', {
        fields: ["name", "company_name", "creation"],
        limit: 0,
        orderBy: { field: "creation", order: "desc" }
    });

    // Project Types
    const {
        data: projectTypes,
        isLoading: projectTypesLoading,
        error: projectTypesError,
        mutate: projectTypesMutate
    } = useFrappeGetDocList<ProjectTypes>('Project Types', {
        fields: ["name", "project_type_name", "creation"],
        limit: 0,
        orderBy: { field: "creation", order: "desc" }
    });

    // Users
    const {
        data: users,
        isLoading: usersLoading,
        error: usersError
    } = useFrappeGetDocList<NirmaanUsers>('Nirmaan Users', {
        fields: ["name", "full_name", "role_profile"],
        filters: [["name", "!=", "Administrator"]],
        limit: 0
    });

    // Categories
    const {
        data: categories,
        isLoading: categoriesLoading
    } = useFrappeGetDocList<Category>("Category", {
        fields: ["category_name", "work_package", "name"],
        filters: [["work_package", "not in", ["Tool & Equipments", "Services"]]],
        limit: 0,
    });

    // Category Make List
    const {
        data: categoryMakeList,
        isLoading: categoryMakeListLoading
    } = useFrappeGetDocList<CategoryMakelist>("Category Makelist", {
        fields: ["make", "category"],
        limit: 0,
    });

    // Work Headers (for Daily Progress Report Setup)
    const {
        data: workHeaders,
        isLoading: workHeadersLoading,
        error: workHeadersError
    } = useFrappeGetDocList<WorkHeaderType>("Work Headers", {
        fields: ["name", "work_header_name", "work_package_link"],
        limit: 0,
    });

    // Design Categories (for Design Packages Setup)
    const {
        data: designMasterData,
        isLoading: designCategoriesLoading,
        error: designCategoriesError
    } = useFrappeGetCall<DesignMasterDataResponse>(
        "nirmaan_stack.api.design_tracker.tracker_options.get_all_master_data",
        {},
        "design-master-data-for-project-form"
    );

    // Process design categories - only include those with tasks
    const designCategories: DesignCategory[] = useMemo(() => {
        const categories = designMasterData?.message?.categories || [];
        return categories
            .filter(cat => Array.isArray(cat.tasks) && cat.tasks.length > 0)
            .map(cat => ({
                category_name: cat.category_name,
                tasks: cat.tasks.map(t => ({
                    task_name: t.task_name,
                    deadline_offset: t.deadline_offset
                }))
            }));
    }, [designMasterData]);

    // Listen for project type changes
    useFrappeDocTypeEventListener("Project Types", async () => {
        await projectTypesMutate();
    });

    // Pincode lookup
    const [pincode, setPincode] = useState("");
    const { data: pincodeData } = useFrappeGetDoc("Pincodes", pincode);

    const debouncedPincodeFetch = useCallback((value: string) => {
        if (value.length >= 6) {
            setPincode(value);
        } else {
            setPincode("");
        }
    }, []);

    // Transform data to select options
    const customerOptions: SelectOption[] = customers?.map(item => ({
        label: item.company_name,
        value: item.name
    })) || [];

    const projectTypeOptions: SelectOption[] = projectTypes?.map(item => ({
        label: item.project_type_name,
        value: item.name
    })) || [];

    const workPackages: WorkPackageType[] = workPackageList?.map(item => ({
        work_package_name: item.work_package_name,
    })) || [];

    // User options by role
    const projectLeadOptions: SelectOption[] = users?.filter(
        item => item.role_profile === "Nirmaan Project Lead Profile"
    ).map(item => ({
        label: item.full_name,
        value: item.name
    })) || [];

    const projectManagerOptions: SelectOption[] = users?.filter(
        item => item.role_profile === "Nirmaan Project Manager Profile"
    ).map(item => ({
        label: item.full_name,
        value: item.name
    })) || [];

    const designLeadOptions: SelectOption[] = users?.filter(
        item => item.role_profile === "Nirmaan Design Executive Profile"
    ).map(item => ({
        label: item.full_name,
        value: item.name
    })) || [];

    const procurementLeadOptions: SelectOption[] = users?.filter(
        item => item.role_profile === "Nirmaan Procurement Executive Profile"
    ).map(item => ({
        label: item.full_name,
        value: item.name
    })) || [];

    const accountantOptions: SelectOption[] = users?.filter(
        item => item.role_profile === "Nirmaan Accountant Profile"
    ).map(item => ({
        label: item.full_name,
        value: item.name
    })) || [];

    // Loading states
    const isLoading = workPackagesLoading || customersLoading || projectTypesLoading || usersLoading;
    const isPackageDataLoading = categoriesLoading || categoryMakeListLoading;
    const isWorkHeadersLoading = workHeadersLoading;
    const isDesignCategoriesLoading = designCategoriesLoading;

    return {
        // Raw data
        customers,
        users,
        categories,
        categoryMakeList,
        workHeaders,
        designCategories,

        // Options for selects
        customerOptions,
        projectTypeOptions,
        workPackages,
        projectLeadOptions,
        projectManagerOptions,
        designLeadOptions,
        procurementLeadOptions,
        accountantOptions,

        // Pincode
        pincodeData,
        debouncedPincodeFetch,

        // Mutate functions
        customersMutate,
        projectTypesMutate,

        // Loading states
        isLoading,
        isPackageDataLoading,
        isWorkHeadersLoading,
        isDesignCategoriesLoading,
        customersLoading,
        projectTypesLoading,
        usersLoading,

        // Errors
        workPackagesError,
        customersError,
        projectTypesError,
        usersError,
        workHeadersError,
        designCategoriesError,
    };
};

export type ProjectFormData = ReturnType<typeof useProjectFormData>;
