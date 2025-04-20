import { FrappeDoc, GetDocListArgs, useFrappeGetDocList } from "frappe-react-sdk";
import { Category } from "../types";
import { getCategoryListOptions, queryKeys } from "@/config/queryKeys";

interface UseCategoryListProps {
    workPackage?: string;
}

export const useCategoryList = ({ workPackage }: UseCategoryListProps) => {
    const options = getCategoryListOptions(workPackage);
    // Generate the key based on the options used for the fetch
    const queryKey = queryKeys.categories.list(options);
    const enabled = !!workPackage; // Fetch only if workPackage is provided

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