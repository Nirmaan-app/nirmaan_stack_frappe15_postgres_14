import React, { useMemo, useState, useEffect, useContext } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Link, useNavigate } from "react-router-dom";
import { FrappeConfig, FrappeContext, useFrappeGetCall, useFrappeGetDocCount, useFrappePostCall } from "frappe-react-sdk";

// --- UI Components ---
import { DataTable, SearchFieldOption } from '@/components/data-table/new-data-table'; // Your new DataTable
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ArrowLeft, UsersRound, CirclePlus } from "lucide-react";
import { TailSpin } from "react-loader-spinner";

// --- Hooks & Utils ---
import { useServerDataTable } from '@/hooks/useServerDataTable';
import { formatDate } from "@/utils/FormatDate";
import { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers";

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

export const USER_ROLE_PROFILE_OPTIONS = [
    { label: "Admin", value: "Nirmaan Admin Profile" }, // Shortened for display if needed
    { label: "Project Lead", value: "Nirmaan Project Lead Profile" },
    { label: "Project Manager", value: "Nirmaan Project Manager Profile" },
    { label: "Procurement Executive", value: "Nirmaan Procurement Executive Profile" },
    { label: "Accountant", value: "Nirmaan Accountant Profile" },
    { label: "Estimates Executive", value: "Nirmaan Estimates Executive Profile" },
    { label: "Design Executive", value: "Nirmaan Design Executive Profile" },
    { label: "Design Lead", value: "Nirmaan Design Lead Profile" },
];

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
            <Card className="hover:animate-shadow-drop-center my-2 border-red-200 bg-red-50">
                <CardContent className="pt-6">
                    <p className="text-sm text-red-600">{roleError}</p>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="hover:animate-shadow-drop-center my-2">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-base font-semibold">
                    User Statistics
                </CardTitle>
                <UsersRound className="h-5 w-5 text-muted-foreground" />
            </CardHeader>
            <CardContent>
                <div className="flex justify-between items-start">
                    <div>
                        <div className="text-2xl font-bold mb-2">
                            {totalCountLoading ? (
                                <TailSpin visible={true} height="28" width="28" color="#D03B45" radius="1" />
                            ) : (
                                totalCountData ?? 'N/A'
                            )}
                        </div>
                        <p className="text-xs text-muted-foreground">Total Registered Users</p>
                    </div>
                    <div className="flex flex-col text-sm items-end">
                        {isLoadingRoles ? (
                            <div className="text-muted-foreground text-xs">Loading roles...</div>
                        ) : (
                            USER_ROLE_PROFILE_OPTIONS.map(role => (
                                <div key={role.value} className="flex justify-between w-full gap-4">
                                    <span className="text-muted-foreground">{role.label}:</span>
                                    <span className="font-medium">{roleCounts[role.value] ?? 0}</span>
                                </div>
                            ))
                        )}
                    </div>
                </div>
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
                    const roleLabel = USER_ROLE_PROFILE_OPTIONS.find(opt => opt.value === roleValue)?.label || roleValue?.replace("Nirmaan ", "").replace(" Profile", "");
                    return <Badge variant="outline">{roleLabel}</Badge>;
                },
                size: 180,
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
    } = useServerDataTable<NirmaanUsers>({
        doctype: USER_DOCTYPE,
        columns: columns,
        fetchFields: USER_LIST_FIELDS_TO_FETCH as string[],
        searchableFields: USER_SEARCHABLE_FIELDS,
        defaultSort: 'creation desc',
        urlSyncKey: 'users_list',
        enableRowSelection: false, // No row selection needed for users list generally
    });

    const facetFilterOptions = useMemo(() => ({
        role_profile: { title: "Role", options: USER_ROLE_PROFILE_OPTIONS },
    }), []);

    return (
        <div className={`flex flex-col gap-2 ${totalCount > 0 ? 'h-[calc(100vh-80px)] overflow-hidden' : ''}`}>
            {/* <div className="flex items-center justify-between">
                <h1 className="text-2xl font-semibold">Manage Users</h1>
                <Button onClick={() => navigate("/new-user")}>
                    <CirclePlus className="mr-2 h-4 w-4" /> Add New User
                </Button>
            </div> */}

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