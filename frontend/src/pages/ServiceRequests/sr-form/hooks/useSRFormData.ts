import { useMemo } from "react";
import { useFrappeGetDoc, useFrappeGetDocList } from "frappe-react-sdk";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { Projects } from "@/types/NirmaanStack/Projects";
import { useGstOptions } from "@/hooks/useGstOptions";

/* ─────────────────────────────────────────────────────────────
   INTERFACE DEFINITIONS
   ───────────────────────────────────────────────────────────── */

export interface VendorOption {
    value: string;
    label: string;
    city?: string;
    state?: string;
    vendor_type?: string;
    gst?: string;
}

export interface CategoryOption {
    value: string;
    label: string;
    image_url?: string;
}

export interface ProjectGSTOption {
    location: string;
    gst: string;
}

export interface WOServiceCategory {
    name: string;
    category_name: string;
}

export interface WOServiceItem {
    name: string;
    item_name: string;
    category_link: string;
    unit?: string;
    rate?: number;
}

export interface UseSRFormDataReturn {
    // Service items (all available items for the rate card)
    serviceItems: WOServiceItem[];
    itemsLoading: boolean;

    // Service categories that have at least one WO Service Item (for the main package picker)
    categories: CategoryOption[];
    // Service categories with NO items — shown only in the Add Custom Service dialog
    emptyCategories: CategoryOption[];
    categoriesLoading: boolean;
    categoriesError: unknown;

    // Loading states
    vendors: VendorOption[];
    vendorsLoading: boolean;
    vendorsError: unknown;

    // Project data
    project: Projects | undefined;
    projectLoading: boolean;
    projectError: unknown;

    // Derived data
    projectGSTOptions: ProjectGSTOption[];
    autoSelectedGST: string | null;

    // Loading states
    isLoading: boolean;
    hasError: boolean;
}

/* ─────────────────────────────────────────────────────────────
   HOOK IMPLEMENTATION
   ───────────────────────────────────────────────────────────── */

/**
 * Custom hook for fetching SR form data
 * - Service categories from Category doctype
 * - Service vendors from Vendors doctype
 * - Project details from Projects doctype
 */
export function useSRFormData(projectId?: string): UseSRFormDataReturn {
    /* ─────────────────────────────────────────────────────────
       FETCH SERVICE CATEGORIES
       ───────────────────────────────────────────────────────── */
    const {
        data: categoryData,
        isLoading: categoriesLoading,
        error: categoriesError,
    } = useFrappeGetDocList<WOServiceCategory>("WO Service Category", {
        fields: ["name", "category_name"],
        orderBy: { field: "category_name", order: "asc" },
        limit: 1000,
    });

    /* ─────────────────────────────────────────────────────────
       FETCH WO SERVICE ITEMS
       ───────────────────────────────────────────────────────── */
    const {
        data: itemData,
        isLoading: itemsLoading,
    } = useFrappeGetDocList<WOServiceItem>("WO Service Item", {
        fields: ["name", "item_name", "category_link", "unit", "rate"],
        limit: 10000,
    });

    /* ─────────────────────────────────────────────────────────
       FETCH SERVICE VENDORS
       ───────────────────────────────────────────────────────── */
    const {
        data: vendorData,
        isLoading: vendorsLoading,
        error: vendorsError,
    } = useFrappeGetDocList<Vendors>("Vendors", {
        fields: ["name", "vendor_name", "vendor_city", "vendor_state", "vendor_type", "vendor_gst"],
        filters: [["vendor_type", "in", ["Service", "Material & Service"]]],
        limit: 10000,
    }, "Service Vendors");

    /* ─────────────────────────────────────────────────────────
       FETCH PROJECT DETAILS
       ───────────────────────────────────────────────────────── */
    const {
        data: project,
        isLoading: projectLoading,
        error: projectError,
    } = useFrappeGetDoc<Projects>(
        "Projects",
        projectId,
        projectId ? `Projects ${projectId}` : null
    );

    const serviceItems = useMemo<WOServiceItem[]>(() => {
        return itemData || [];
    }, [itemData]);

    /* ─────────────────────────────────────────────────────────
       TRANSFORM + SPLIT CATEGORIES
       - `categories`: have ≥1 WO Service Item — shown in main "Select Package"
       - `emptyCategories`: have 0 items — shown only in Add Custom Service dialog
       ───────────────────────────────────────────────────────── */
    const { categories, emptyCategories } = useMemo<{
        categories: CategoryOption[];
        emptyCategories: CategoryOption[];
    }>(() => {
        if (!categoryData) return { categories: [], emptyCategories: [] };
        const populated = new Set(serviceItems.map((it) => it.category_link));
        const withItems: CategoryOption[] = [];
        const empties: CategoryOption[] = [];
        for (const cat of categoryData) {
            const opt: CategoryOption = { value: cat.name, label: cat.category_name };
            (populated.has(cat.name) ? withItems : empties).push(opt);
        }
        return { categories: withItems, emptyCategories: empties };
    }, [categoryData, serviceItems]);

    /* ─────────────────────────────────────────────────────────
       TRANSFORM VENDORS TO OPTIONS
       ───────────────────────────────────────────────────────── */
    const vendors = useMemo<VendorOption[]>(() => {
        if (!vendorData) return [];
        return vendorData.map((vendor) => ({
            value: vendor.name,
            label: vendor.vendor_name,
            city: vendor.vendor_city,
            state: vendor.vendor_state,
            vendor_type: vendor.vendor_type,
            gst: vendor.vendor_gst,
        }));
    }, [vendorData]);

    /* ─────────────────────────────────────────────────────────
       EXTRACT PROJECT GST OPTIONS
       ───────────────────────────────────────────────────────── */
    const { gstOptions: projectGSTOptions } = useGstOptions();

    /* ─────────────────────────────────────────────────────────
       AUTO-SELECT GST IF SINGLE OPTION
       ───────────────────────────────────────────────────────── */
    const autoSelectedGST = useMemo<string | null>(() => {
        if (projectGSTOptions.length === 1) {
            return projectGSTOptions[0].gst;
        }
        return null;
    }, [projectGSTOptions]);

    /* ─────────────────────────────────────────────────────────
       COMBINED LOADING STATE
       ───────────────────────────────────────────────────────── */
    const isLoading = categoriesLoading || vendorsLoading || itemsLoading || (!!projectId && projectLoading);
    const hasError = !!(categoriesError || vendorsError || projectError);

    /* ─────────────────────────────────────────────────────────
       RETURN VALUES
       ───────────────────────────────────────────────────────── */
    return {
        // Categories
        categories,
        emptyCategories,
        categoriesLoading,
        categoriesError: categoriesError ?? null,

        // Items
        serviceItems,
        itemsLoading,

        // Vendors
        vendors,
        vendorsLoading,
        vendorsError: vendorsError ?? null,

        // Project
        project,
        projectLoading,
        projectError: projectError ?? null,

        // Derived
        projectGSTOptions,
        autoSelectedGST,

        // Combined
        isLoading,
        hasError,
    };
}

export default useSRFormData;
