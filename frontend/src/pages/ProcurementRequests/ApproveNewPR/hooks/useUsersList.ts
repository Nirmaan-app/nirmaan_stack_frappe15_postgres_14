import { FrappeDoc, GetDocListArgs, useFrappeGetDocList } from "frappe-react-sdk";
import { User } from "../types";
import { getUsersListOptions, queryKeys } from "@/config/queryKeys";

export const useUsersList = () => {
    const options = getUsersListOptions();
    const queryKey = queryKeys.users.list(options);

    return useFrappeGetDocList<User>(
        "Nirmaan Users",
        options as GetDocListArgs<FrappeDoc<User>>,
        JSON.stringify(queryKey)
        // { queryKey } // Pass generated key object
    );
};