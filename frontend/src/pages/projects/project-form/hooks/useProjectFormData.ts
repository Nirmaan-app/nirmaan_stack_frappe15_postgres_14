import { useFrappeDocTypeEventListener } from "frappe-react-sdk";
import { useCallback, useMemo, useState } from "react";
import {
    useProjectFormWorkPackages,
    useProjectFormCustomers,
    useProjectFormProjectTypes,
    useProjectFormUsers,
    useProjectFormCategories,
    useProjectFormCategoryMakeList,
    useProjectFormWorkHeaders,
    useProjectFormDesignMasterData,
    useProjectFormCriticalPOCategories,
    useProjectFormPincode,
    WorkPackageType,
    DesignCategory,
} from "@/pages/projects/data/project-form/useProjectFormQueries";
import { useGstOptions } from "@/hooks/useGstOptions";

export interface SelectOption {
    label: string;
    value: string;
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
    } = useProjectFormWorkPackages();

    // Customers
    const {
        data: customers,
        isLoading: customersLoading,
        error: customersError,
        mutate: customersMutate
    } = useProjectFormCustomers();

    // Project Types
    const {
        data: projectTypes,
        isLoading: projectTypesLoading,
        error: projectTypesError,
        mutate: projectTypesMutate
    } = useProjectFormProjectTypes();

    // Users
    const {
        data: users,
        isLoading: usersLoading,
        error: usersError
    } = useProjectFormUsers();

    // Categories
    const {
        data: categories,
        isLoading: categoriesLoading
    } = useProjectFormCategories();

    // Category Make List
    const {
        data: categoryMakeList,
        isLoading: categoryMakeListLoading
    } = useProjectFormCategoryMakeList();

    // Work Headers (for Daily Progress Report Setup)
    const {
        data: workHeaders,
        isLoading: workHeadersLoading,
        error: workHeadersError
    } = useProjectFormWorkHeaders();

    // Design Categories (for Design Packages Setup)
    const {
        data: designMasterData,
        isLoading: designCategoriesLoading,
        error: designCategoriesError
    } = useProjectFormDesignMasterData();

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

    // Critical PO Categories (for Critical PO Setup)
    const {
        data: criticalPOCategories,
        isLoading: criticalPOCategoriesLoading,
        error: criticalPOCategoriesError
    } = useProjectFormCriticalPOCategories();

    // Project GSTs
    const { gstOptions, isLoading: gstLoading, error: gstError } = useGstOptions();

    // Listen for project type changes
    useFrappeDocTypeEventListener("Project Types", async () => {
        await projectTypesMutate();
    });

    // Pincode lookup
    const [pincode, setPincode] = useState("");
    const { data: pincodeData } = useProjectFormPincode(pincode);

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
    const isLoading = workPackagesLoading || customersLoading || projectTypesLoading || usersLoading || gstLoading;
    const isPackageDataLoading = categoriesLoading || categoryMakeListLoading;
    const isWorkHeadersLoading = workHeadersLoading;
    const isDesignCategoriesLoading = designCategoriesLoading;
    const isCriticalPOCategoriesLoading = criticalPOCategoriesLoading;

    return {
        // Raw data
        customers,
        users,
        categories,
        categoryMakeList,
        workHeaders,
        designCategories,
        criticalPOCategories,

        // Options for selects
        customerOptions,
        projectTypeOptions,
        workPackages,
        projectLeadOptions,
        projectManagerOptions,
        designLeadOptions,
        procurementLeadOptions,
        accountantOptions,
        gstOptions,

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
        isCriticalPOCategoriesLoading,
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
        criticalPOCategoriesError,
        gstError,
    };
};

export type ProjectFormData = ReturnType<typeof useProjectFormData>;
