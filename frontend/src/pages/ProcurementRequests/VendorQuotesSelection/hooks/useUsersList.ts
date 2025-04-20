// src/hooks/useUsersList.ts OR src/features/common/hooks/useUsersList.ts
import { FrappeDoc, GetDocListArgs, useFrappeGetDocList } from "frappe-react-sdk";
import { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers"; // Adjust path
import { queryKeys, getUsersListOptions } from "@/config/queryKeys"; // Adjust path

export const useUsersList = () => {
    const options = getUsersListOptions(); // Using the helper
    const queryKey = queryKeys.users.list(options);

    return useFrappeGetDocList<NirmaanUsers>(
        "Nirmaan Users",
        options as GetDocListArgs<FrappeDoc<NirmaanUsers>>,
        JSON.stringify(queryKey)
        // { queryKey }
    );
};