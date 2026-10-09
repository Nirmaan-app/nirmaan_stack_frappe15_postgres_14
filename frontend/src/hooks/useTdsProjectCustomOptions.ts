import { useMemo } from "react";
import { useFrappeGetDocList } from "frappe-react-sdk";

/**
 * Work Package and Category options for a Project Custom TDS (Technical Data Sheet) item, shared by
 * the Request New dialog and the Admin's request edit dialog. The Work Package comes from
 * Procurement Packages (the list `TDS Items.work_package` and `Category.work_package` link to), and
 * the Category only from that package. Fetches nothing until `enabled`.
 */
export function useTdsProjectCustomOptions(enabled: boolean, workPackage: string) {
    const { data: packageList } = useFrappeGetDocList(
        "Procurement Packages",
        { fields: ["name"], orderBy: { field: "name", order: "asc" }, limit: 0 },
        enabled ? "tds_request_procurement_packages" : null
    );
    const { data: categoryList, isLoading: isLoadingCategories } = useFrappeGetDocList(
        "Category",
        {
            fields: ["name"],
            filters: [["work_package", "=", workPackage]],
            orderBy: { field: "name", order: "asc" },
            limit: 0,
        },
        enabled && workPackage ? `tds_request_categories_${workPackage}` : null
    );

    const packageOptions = useMemo(
        () => (packageList || []).map((p: { name: string }) => ({ label: p.name, value: p.name })),
        [packageList]
    );
    const categoryOptions = useMemo(
        () => (categoryList || []).map((c: { name: string }) => ({ label: c.name, value: c.name })),
        [categoryList]
    );

    return { packageOptions, categoryOptions, isLoadingCategories: !!workPackage && isLoadingCategories };
}
