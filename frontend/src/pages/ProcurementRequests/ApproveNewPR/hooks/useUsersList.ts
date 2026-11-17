import { FrappeDoc, GetDocListArgs, useFrappeGetDocList, useSWRConfig } from "frappe-react-sdk";
import { useCallback, useMemo } from "react";
import { useListUpdate } from "@/hooks/useListUpdate";
import { User } from "../types";
import { getUsersListOptions, queryKeys } from "@/config/queryKeys";

/** The one SWR key every `useUsersList()` caller shares. */
const usersListKey = () => JSON.stringify(queryKeys.users.list(getUsersListOptions()));

/**
 * Every Nirmaan User (`name`, `full_name`, `role_profile`), downloaded ONCE per session and shared by every caller.
 * Users are rarely added, so the list is not fetched again on window focus, reconnect or another page mounting it;
 * it is fetched again when any Nirmaan User changes (`useUsersListLiveRefresh`, live for every session) and through
 * `useRefreshUsersList()`, which every in-app write to Nirmaan Users also calls.
 *
 * `nameOf(user)` is the full name from a Map built once per download (the id itself when unknown), so a table
 * resolves a name per row without searching the list. Call the hook on the page and hand `nameOf` to the columns:
 * a table row never calls a data hook (`frontend/CODING_STANDARDS.md` § Role-based access).
 */
export const useUsersList = () => {
    const { data, isLoading, error, mutate } = useFrappeGetDocList<User>(
        "Nirmaan Users",
        getUsersListOptions() as GetDocListArgs<FrappeDoc<User>>,
        usersListKey(),
        { revalidateOnFocus: false, revalidateOnReconnect: false, revalidateIfStale: false }
    );

    const nameByUser = useMemo(() => {
        const map = new Map<string, string>();
        data?.forEach((user) => map.set(user.name, user.full_name || user.name));
        return map;
    }, [data]);

    const nameOf = useCallback(
        (user?: string | null): string => (user ? nameByUser.get(user) ?? user : ""),
        [nameByUser]
    );

    return { data, isLoading, error, mutate, nameOf };
};

/** Fetch the shared users list again; call it after any write that adds, renames or removes a Nirmaan User. */
export const useRefreshUsersList = () => {
    const { mutate } = useSWRConfig();
    return useCallback(() => mutate(usersListKey()), [mutate]);
};

/**
 * Fetch the shared users list again whenever a Nirmaan User is added, edited or deleted anywhere: another person's
 * session, Desk, a server job. Mount ONCE for the app (`SocketInitializer`). Nothing is fetched while no screen
 * uses the list.
 */
export const useUsersListLiveRefresh = () => {
    const refresh = useRefreshUsersList();
    useListUpdate("Nirmaan Users", refresh);
};
