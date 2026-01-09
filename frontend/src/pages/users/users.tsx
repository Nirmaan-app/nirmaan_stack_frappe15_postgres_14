import React, { useMemo, useState, useEffect } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { useFrappeGetDocCount, useFrappePostCall } from "frappe-react-sdk";

// --- UI Components ---
import { DataTable, SearchFieldOption } from '@/components/data-table/new-data-table';
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UsersRound } from "lucide-react";
import { TailSpin } from "react-loader-spinner";

// --- Hooks & Utils ---
import { useServerDataTable } from '@/hooks/useServerDataTable';
import { useFacetValues } from '@/hooks/useFacetValues';
import { formatDate } from "@/utils/FormatDate";
import { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers";
import { getRoleColors, ROLE_OPTIONS } from "@/utils/roleColors";
import { RoleBadge, UserRowActions } from "./components";
import { cn } from "@/lib/utils";

export const USER_DOCTYPE = 'Nirmaan Users';

export const USER_LIST_FIELDS_TO_FETCH: (keyof NirmaanUsers | 'name' | 'email' | 'mobile_no')[] = [
    'name', // Usually email
    'full_name',
    'creation',
    'role_profile',
    'email', // Explicitly if different from name
    'mobile_no'
];

export const USER_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "name", label: "Email", placeholder: "Search by Email...", default: true },
    { value: "full_name", label: "Full Name", placeholder: "Search by Full Name..." },
    { value: "role_profile", label: "Role", placeholder: "Search by Role..." },
    { value: "mobile_no", label: "Mobile No.", placeholder: "Search by Mobile..." },
];

export const USER_DATE_COLUMNS: string[] = ["creation", "modified"];

// Re-export for backwards compatibility
export const USER_ROLE_PROFILE_OPTIONS = ROLE_OPTIONS;

// --- Helper: RoleCountPill ---
interface RoleCountPillProps {
    roleValue: string;
    roleLabel: string;
    count: number;
}

const RoleCountPill: React.FC<RoleCountPillProps> = ({ roleValue, roleLabel, count }) => {
    const colors = getRoleColors(roleValue);
    return (
        <div
            className={cn(
                "inline-flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all hover:shadow-sm",
                colors.bg,
                colors.border
            )}
        >
            <span className={cn("w-2 h-2 rounded-full flex-shrink-0", colors.dot)} />
            <span className={cn("text-xs font-medium", colors.text)}>{roleLabel}</span>
            <span className={cn("text-xs font-bold tabular-nums", colors.text)}>{count}</span>
        </div>
    );
};

// --- Helper: UsersSummaryCard ---
const UsersSummaryCard: React.FC = () => {
    const [roleCounts, setRoleCounts] = useState<Record<string, number>>({});
    const [isLoadingRoles, setIsLoadingRoles] = useState(true);
    const [roleError, setRoleError] = useState<string | null>(null);

    // Fetch total users
    const { data: totalCountData, isLoading: totalCountLoading } = useFrappeGetDocCount(USER_DOCTYPE, undefined, true, false, `${USER_DOCTYPE}_total_count`);

    // Fetch all role counts in single API call
    const { call: getUserRoleCounts } = useFrappePostCall("nirmaan_stack.api.users.get_user_role_counts");

    useEffect(() => {
        const fetchRoleCounts = async () => {
            try {
                setIsLoadingRoles(true);
                const result = await getUserRoleCounts({});
                setRoleCounts(result.message || {});
                setRoleError(null);
            } catch (err) {
                console.error("Failed to fetch role counts:", err);
                setRoleError("Failed to load role statistics");
                setRoleCounts({});
            } finally {
                setIsLoadingRoles(false);
            }
        };

        fetchRoleCounts();
    }, []);

    if (roleError) {
        return (
            <Card className="my-2 border-red-200 bg-red-50">
                <CardContent className="pt-6">
                    <p className="text-sm text-red-600">{roleError}</p>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="my-2 shadow-sm">
            <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                            <UsersRound className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                            <CardTitle className="text-lg font-semibold">
                                {totalCountLoading ? (
                                    <TailSpin visible={true} height="20" width="20" color="#D03B45" radius="1" />
                                ) : (
                                    <span className="tabular-nums">{totalCountData ?? 0}</span>
                                )}
                                <span className="ml-2 text-muted-foreground font-normal">Users</span>
                            </CardTitle>
                            <p className="text-xs text-muted-foreground">Total registered in system</p>
                        </div>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="pt-0">
                {isLoadingRoles ? (
                    <div className="flex items-center gap-2 text-muted-foreground text-sm">
                        <TailSpin visible={true} height="16" width="16" color="#6b7280" radius="1" />
                        Loading role distribution...
                    </div>
                ) : (
                    <div className="flex flex-wrap gap-2">
                        {ROLE_OPTIONS.map(role => (
                            <RoleCountPill
                                key={role.value}
                                roleValue={role.value}
                                roleLabel={role.label}
                                count={roleCounts[role.value] ?? 0}
                            />
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
};


// --- Main Page Component ---
export default function UsersPage() {
    const columns = useMemo<ColumnDef<NirmaanUsers>[]>(
        () => [
            {
                accessorKey: "name", // Usually email
                header: ({ column }) => <DataTableColumnHeader column={column} title="Email" />,
                cell: ({ row }) => (
                    <Link className="text-blue-600 hover:underline font-medium" to={`/users/${row.original.name}`}>
                        {row.getValue("name")}
                    </Link>
                ),
                size: 250,
                meta: {
                    exportHeaderName: "Email",
                    exportValue: (row: NirmaanUsers) => {
                        return row.name;
                    }
                }
            },
            {
                accessorKey: "full_name",
                header: ({ column }) => <DataTableColumnHeader column={column} title="Full Name" />,
                cell: ({ row }) => (
                    <Link className="hover:underline font-medium" to={`/users/${row.original.name}`}>
                        {row.getValue("full_name")}
                    </Link>
                ),
                size: 200,
                meta: {
                    exportHeaderName: "Full Name",
                    exportValue: (row: NirmaanUsers) => {
                        return row.full_name;
                    }
                }
            },
            {
                accessorKey: "creation",
                header: ({ column }) => <DataTableColumnHeader column={column} title="Date Joined" />,
                cell: ({ row }) => <div className="font-medium whitespace-nowrap">{formatDate(row.getValue("creation"))}</div>,
                size: 150,
                meta: {
                    exportHeaderName: "Date Joined",
                    exportValue: (row: NirmaanUsers) => {
                        return formatDate(row.creation);
                    }
                }
            },
            {
                accessorKey: "role_profile",
                header: ({ column }) => <DataTableColumnHeader column={column} title="Role" />,
                cell: ({ row }) => {
                    const roleValue = row.getValue<string>("role_profile");
                    return <RoleBadge roleProfile={roleValue} size="sm" />;
                },
                size: 200,
                meta: {
                    exportHeaderName: "Role",
                    exportValue: (row: NirmaanUsers) => {
                        const roleValue = row.role_profile;
                        const roleLabel = USER_ROLE_PROFILE_OPTIONS.find(opt => opt.value === roleValue)?.label || roleValue?.replace("Nirmaan ", "").replace(" Profile", "");
                        return roleLabel;
                    }
                }
            },
            // {
            //     accessorKey: "enabled",
            //     header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
            //     cell: ({ row }) => (
            //         <Badge variant={row.getValue("enabled") ? "success" : "destructive"}>
            //             {row.getValue("enabled") ? "Enabled" : "Disabled"}
            //         </Badge>
            //     ),
            //     size: 100,
            // },
            {
                accessorKey: "mobile_no",
                header: ({ column }) => <DataTableColumnHeader column={column} title="Mobile No." />,
                cell: ({ row }) => <div className="font-medium">{row.getValue("mobile_no") || "--"}</div>,
                size: 150,
                meta: {
                    exportHeaderName: "Mobile No.",
                    exportValue: (row: NirmaanUsers) => {
                        return row.mobile_no;
                    }
                }
            },
            {
                id: "actions",
                header: () => <span className="text-muted-foreground">Action</span>,
                cell: ({ row }) => <UserRowActions user={row.original} />,
                size: 60,
                enableSorting: false,
                enableHiding: false,
            },
        ],
        []
    );

    const {
        table,
        totalCount,
        isLoading,
        error,
        searchTerm,
        setSearchTerm,
        selectedSearchField,
        setSelectedSearchField,
        columnFilters, // Destructure columnFilters
    } = useServerDataTable<NirmaanUsers>({
        doctype: USER_DOCTYPE,
        columns: columns,
        fetchFields: USER_LIST_FIELDS_TO_FETCH as string[],
        searchableFields: USER_SEARCHABLE_FIELDS,
        defaultSort: 'creation desc',
        urlSyncKey: 'users_list',
        enableRowSelection: false, // No row selection needed for users list generally
    });

    // --- Dynamic Facet Values ---
    const { facetOptions: roleFacetOptions, isLoading: isRoleFacetLoading } = useFacetValues({
        doctype: USER_DOCTYPE,
        field: 'role_profile',
        currentFilters: columnFilters,
        searchTerm,
        selectedSearchField,
        enabled: true
    });

    const facetFilterOptions = useMemo(() => ({
        role_profile: { title: "Role", options: roleFacetOptions, isLoading: isRoleFacetLoading },
    }), [roleFacetOptions, isRoleFacetLoading]);

    return (
        <div className={`flex flex-col gap-2 ${totalCount > 0 ? 'h-[calc(100vh-80px)] overflow-hidden' : ''}`}>
            <div className="flex-shrink-0 overflow-y-auto">
                <UsersSummaryCard />
            </div>

            <div className="flex-1 overflow-hidden">
                <DataTable<NirmaanUsers>
                    table={table}
                    columns={columns}
                    isLoading={isLoading}
                    error={error}
                    totalCount={totalCount}
                    searchFieldOptions={USER_SEARCHABLE_FIELDS}
                    selectedSearchField={selectedSearchField}
                    onSelectedSearchFieldChange={setSelectedSearchField}
                    searchTerm={searchTerm}
                    onSearchTermChange={setSearchTerm}
                    facetFilterOptions={facetFilterOptions}
                    dateFilterColumns={USER_DATE_COLUMNS}
                    showExportButton={true}
                    onExport={'default'}
                    exportFileName="nirmaan_users_list"
                    showRowSelection={false}
                // toolbarActions={<div>Custom Action Button</div>} // Example for custom actions
                />
            </div>
        </div>
    );
}