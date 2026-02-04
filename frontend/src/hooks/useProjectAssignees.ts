import { useFrappeGetDocList, FrappeDoc, GetDocListArgs } from 'frappe-react-sdk';
import { useMemo } from 'react';
import { getUsersListOptions, queryKeys } from '@/config/queryKeys';

interface NirmaanUserPermissionDoc extends FrappeDoc<any> {
    user: string;
    allow: string;
    for_value: string;
}

interface NirmaanUserDoc extends FrappeDoc<any> {
    name: string;
    full_name: string;
    role_profile: string;
}

export interface ProjectAssignee {
    email: string;
    name: string;
    role: string;
}

export const useProjectAssignees = () => {
    // 1. Fetch Users
    const usersOptions = getUsersListOptions();
    const { data: usersList, isLoading: usersLoading, error: usersError } = useFrappeGetDocList<NirmaanUserDoc>(
        "Nirmaan Users",
        {
            fields: usersOptions.fields,
            limit: usersOptions.limit
        } as GetDocListArgs<FrappeDoc<NirmaanUserDoc>>,
        queryKeys.users.list(usersOptions)
    );

    // 2. Fetch Permissions
    const { data: permissions, isLoading: permissionsLoading, error: permissionsError } = useFrappeGetDocList<NirmaanUserPermissionDoc>(
        "Nirmaan User Permissions",
        {
            fields: ["user", "allow", "for_value"],
            filters: [["allow", "=", "Projects"]],
            limit: 0
        },
        "nirmaan_project_permissions_all"
    );

    // 3. Process & Map Data
    const assignmentsLookup = useMemo(() => {
        if (!usersList || !permissions) return {};

        // Create User Lookup Map
        const userLookup = usersList.reduce((acc, user) => {
            if (user.name) {
                acc[user.name] = {
                    full_name: user.full_name,
                    role_profile: user.role_profile
                };
            }
            return acc;
        }, {} as Record<string, { full_name: string; role_profile: string }>);

        const allowedRoles = [
            "Nirmaan Project Lead Profile", 
            "Nirmaan Project Manager Profile", 
            "Nirmaan Procurement Executive Profile", 
            "Nirmaan Admin Profile", 
            "Nirmaan PMO Executive Profile"
        ];

        // Create Project Assignments Map (Project Name -> Assignees[])
        return permissions.reduce((acc, perm) => {
            const project = perm.for_value;
            const userEmail = perm.user;
            const userInfo = userLookup[userEmail];

            if (userInfo && allowedRoles.includes(userInfo.role_profile)) {
                if (!acc[project]) acc[project] = [];
                // Avoid duplicates
                if (!acc[project].some(a => a.email === userEmail)) {
                    acc[project].push({
                        email: userEmail,
                        name: userInfo.full_name,
                        role: userInfo.role_profile
                    });
                }
            }
            return acc;
        }, {} as Record<string, ProjectAssignee[]>);

    }, [usersList, permissions]);

    const isLoading = usersLoading || permissionsLoading;
    const error = usersError || permissionsError;

    return {
        assignmentsLookup,
        isLoading,
        error
    };
};
