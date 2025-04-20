import { FrappeDoc, GetDocListArgs, useFrappeGetDocList } from "frappe-react-sdk";
import { Item } from "../types";
import { getItemListOptions, queryKeys } from "@/config/queryKeys"; // Adjust path

interface UseItemListProps {
    categoryNames?: string[];
}

export const useItemList = ({ categoryNames }: UseItemListProps) => {
    const options = getItemListOptions(categoryNames);
    const queryKey = queryKeys.items.list(options);
    
    // Fetch only if categoryNames exist and have length
    const enabled = !!(categoryNames && categoryNames.length > 0);

    return useFrappeGetDocList<Item>(
        "Items",
        options as GetDocListArgs<FrappeDoc<Item>>,
        enabled ? JSON.stringify(queryKey) : null
      )
};