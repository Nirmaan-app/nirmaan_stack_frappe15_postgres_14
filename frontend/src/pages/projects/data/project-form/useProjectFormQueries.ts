import { useFrappeGetDocList, useFrappeGetCall, useFrappeGetDoc } from "frappe-react-sdk";
import { Customers } from "@/types/NirmaanStack/Customers";
import { ProjectTypes } from "@/types/NirmaanStack/ProjectTypes";
import { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers";
import { Category } from "@/types/NirmaanStack/Category";
import { CategoryMakelist } from "@/types/NirmaanStack/CategoryMakelist";
import { useApiErrorLogger } from "@/utils/sentry/useApiErrorLogger";

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

export interface CriticalPOCategoryType {
    name: string;
    category_name: string;
}

export interface DesignMasterDataResponse {
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

// ─── Project Form Cache Keys (Standardized) ─────────────
export const projectFormKeys = {
    workPackages: () => ["project-form", "work-packages"] as const,
    customers: () => ["project-form", "customers"] as const,
    projectTypes: () => ["project-form", "project-types"] as const,
    users: () => ["project-form", "users"] as const,
    categories: () => ["project-form", "categories"] as const,
    categoryMakeList: () => ["project-form", "category-makelist"] as const,
    workHeaders: () => ["project-form", "work-headers"] as const,
    designMasterData: () => ["project-form", "design-master-data"] as const,
    criticalPOCategories: () => ["project-form", "critical-po-categories"] as const,
    pincode: (pincode: string) => ["project-form", "pincode", pincode] as const
};

// ─── Queries ─────────────────────────────────────────────────

export const useProjectFormWorkPackages = () => {
    const response = useFrappeGetDocList<any>(
        "Work Packages",
        {
            fields: ['work_package_name'],
            filters: [["work_package_name", "not in", ["Tool & Equipments", "Services", "Additional Charges"]]],
            limit: 1000
        },
        projectFormKeys.workPackages()
    );

    useApiErrorLogger(response.error, {
        hook: "useProjectFormWorkPackages",
        api: "Work Packages List",
        feature: "project-form",
    });

    return response;
};

export const useProjectFormCustomers = () => {
    const response = useFrappeGetDocList<Customers>(
        "Customers",
        {
            fields: ["name", "company_name", "creation"],
            limit: 0,
            orderBy: { field: "creation", order: "desc" }
        },
        projectFormKeys.customers()
    );

    useApiErrorLogger(response.error, {
        hook: "useProjectFormCustomers",
        api: "Customers List",
        feature: "project-form",
    });

    return response;
};

export const useProjectFormProjectTypes = () => {
    const response = useFrappeGetDocList<ProjectTypes>(
        "Project Types",
        {
            fields: ["name", "project_type_name", "creation"],
            limit: 0,
            orderBy: { field: "creation", order: "desc" }
        },
        projectFormKeys.projectTypes()
    );

    useApiErrorLogger(response.error, {
        hook: "useProjectFormProjectTypes",
        api: "Project Types List",
        feature: "project-form",
    });

    return response;
};

export const useProjectFormUsers = () => {
    const response = useFrappeGetDocList<NirmaanUsers>(
        "Nirmaan Users",
        {
            fields: ["name", "full_name", "role_profile"],
            filters: [["name", "!=", "Administrator"]],
            limit: 0
        },
        projectFormKeys.users()
    );

    useApiErrorLogger(response.error, {
        hook: "useProjectFormUsers",
        api: "Nirmaan Users List",
        feature: "project-form",
    });

    return response;
};

export const useProjectFormCategories = () => {
    const response = useFrappeGetDocList<Category>(
        "Category",
        {
            fields: ["category_name", "work_package", "name"],
            filters: [["work_package", "not in", ["Tool & Equipments", "Services"]]],
            limit: 0,
        },
        projectFormKeys.categories()
    );

    useApiErrorLogger(response.error, {
        hook: "useProjectFormCategories",
        api: "Category List",
        feature: "project-form",
    });

    return response;
};

export const useProjectFormCategoryMakeList = () => {
    const response = useFrappeGetDocList<CategoryMakelist>(
        "Category Makelist",
        {
            fields: ["make", "category"],
            limit: 0,
        },
        projectFormKeys.categoryMakeList()
    );

    useApiErrorLogger(response.error, {
        hook: "useProjectFormCategoryMakeList",
        api: "Category Makelist",
        feature: "project-form",
    });

    return response;
};

export const useProjectFormWorkHeaders = () => {
    const response = useFrappeGetDocList<WorkHeaderType>(
        "Work Headers",
        {
            fields: ["name", "work_header_name", "work_package_link"],
            limit: 0,
        },
        projectFormKeys.workHeaders()
    );

    useApiErrorLogger(response.error, {
        hook: "useProjectFormWorkHeaders",
        api: "Work Headers List",
        feature: "project-form",
    });

    return response;
};

export const useProjectFormDesignMasterData = () => {
    const response = useFrappeGetCall<DesignMasterDataResponse>(
        "nirmaan_stack.api.design_tracker.tracker_options.get_all_master_data",
        {},
        "design-master-data-for-project-form" // preserving this static string since useFrappeGetCall parses it uniquely internally if SWR is used under the hood, but explicitly passed
    );

    useApiErrorLogger(response.error, {
        hook: "useProjectFormDesignMasterData",
        api: "Design Master Data",
        feature: "project-form",
    });

    return response;
};

export const useProjectFormCriticalPOCategories = () => {
    const response = useFrappeGetDocList<CriticalPOCategoryType>(
        "Critical PO Category",
        {
            fields: ["name", "category_name"],
            limit: 0,
        },
        projectFormKeys.criticalPOCategories()
    );

    useApiErrorLogger(response.error, {
        hook: "useProjectFormCriticalPOCategories",
        api: "Critical PO Category List",
        feature: "project-form",
    });

    return response;
};

export const useProjectFormPincode = (pincode: string) => {
    const response = useFrappeGetDoc(
        "Pincodes",
        pincode,
        pincode ? projectFormKeys.pincode(pincode) : null
    );

    useApiErrorLogger(response.error, {
        hook: "useProjectFormPincode",
        api: "Pincodes Doc",
        feature: "project-form",
    });

    return response;
};
