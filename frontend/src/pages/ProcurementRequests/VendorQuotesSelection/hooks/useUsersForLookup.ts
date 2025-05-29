import { FrappeDoc, GetDocListArgs, useFrappeGetDocList } from 'frappe-react-sdk';
import { NirmaanUsers } from '@/types/NirmaanStack/NirmaanUsers';
import { queryKeys } from '@/config/queryKeys';
import { useCallback, useMemo } from 'react';

export const useUsersForLookup = () => {
    const options = {
        fields: ["name", "full_name"], // Only what's needed for mapping ID to name
        limit: 0, // Fetch all users
    };
    const swrKey = queryKeys.users.list(options); // Define in queryKeys.ts

    const { data, isLoading, error } = useFrappeGetDocList<NirmaanUsers>(
        "Nirmaan Users",
        options as GetDocListArgs<FrappeDoc<NirmaanUsers>>,
        JSON.stringify(swrKey)
    );

    const userFullNameMap = useMemo(() => {
        const map = new Map<string, string>();
        data?.forEach(user => map.set(user.name, user.full_name || user.name));
        return map;
    }, [data]);

    const getFullName = useCallback((userId?: string): string => {
        if (!userId) return "N/A";
        return userFullNameMap.get(userId) || userId;
    }, [userFullNameMap]);

    return {
        usersList: data,
        userFullNameMap,
        getFullName,
        isLoading,
        error,
    };
};