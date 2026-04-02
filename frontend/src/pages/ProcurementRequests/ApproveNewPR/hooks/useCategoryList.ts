import { FrappeDoc, GetDocListArgs, useFrappeGetDocList } from "frappe-react-sdk";
import { MasterCategory as Category } from "../types";
import { getCategoryListOptions, queryKeys } from "@/config/queryKeys";

interface UseCategoryListProps {
    workPackages?: string | string[];
}

export const useCategoryList = ({ workPackages }: UseCategoryListProps) => {
    console.log("workPackages", workPackages)
    const options = getCategoryListOptions(workPackages);
    // Generate the key based on the options used for the fetch
    const queryKey = queryKeys.categories.list(options);
    // const enabled = !!workPackage && "Tool & Equipments"; // Fetch only if workPackage is provided
    // const enabled = !!workPackage// Fetch only if workPackage is provided
    const enabled=true


    return useFrappeGetDocList<Category>(
        "Category",
        options as GetDocListArgs<FrappeDoc<Category>>,
        enabled ? JSON.stringify(queryKey) : null
        // {
        //     queryKey,
        //     enabled
        // }
    );
};