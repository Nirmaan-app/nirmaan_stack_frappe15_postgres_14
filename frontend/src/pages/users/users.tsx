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
];

// --- Helper: UsersSummaryCard ---
interface RoleCount {
    label: string;
    value: string;
    count: number | undefined;
    isLoading: boolean;
}

const UsersSummaryCard: React.FC = () => {
    const [roleCounts, setRoleCounts] = useState<RoleCount[]>([]);
    const [totalUsers, setTotalUsers] = useState<{ count: number | undefined, isLoading: boolean }>({ count: undefined, isLoading: true });

    // Fetch total users
    const { data: totalCountData, isLoading: totalCountLoading } = useFrappeGetDocCount(USER_DOCTYPE, undefined, true, false, `${USER_DOCTYPE}_total_count`);

    // const {db, call} = useContext(FrappeContext) as FrappeConfig;
    const {call} = useFrappePostCall("frappe.client.get_count")

    useEffect(() => {
        setTotalUsers({ count: totalCountData, isLoading: totalCountLoading });
    }, [totalCountData, totalCountLoading]);

    // Fetch counts for each role
    // This will trigger multiple hooks. For a large number of roles, consider a single backend aggregate.
    useEffect(() => {
        const fetchCounts = async () => {
            const countsPromises = USER_ROLE_PROFILE_OPTIONS.map(role =>
                call({
                        doctype: USER_DOCTYPE,
                        filters: { role_profile: role.value },
                        cache: true
                        // cache: true // Consider caching on backend if Frappe supports it for get_count
                    },
                ).then(res => ({
                    ...role,
                    count: res.message,
                    isLoading: false,
                })).catch(() => ({
                    ...role,
                    count: 0, // Default to 0 on error
                    isLoading: false,
                }))
            );
            const resolvedCounts = await Promise.all(countsPromises);
            setRoleCounts(resolvedCounts as RoleCount[]);
        };
        fetchCounts();
    }, []); // Runs once

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
                            {totalUsers.isLoading ? (
                                <TailSpin visible={true} height="28" width="28" color="#D03B45" radius="1" />
                            ) : (
                                totalUsers.count ?? 'N/A'
                            )}
                        </div>
                        <p className="text-xs text-muted-foreground">Total Registered Users</p>
                    </div>
                    <div className="flex flex-col text-sm items-end">
                        {roleCounts.length > 0 ? roleCounts.map(role => (
                            <div key={role.value} className="flex justify-between w-full gap-4">
                                <span className="text-muted-foreground">{role.label}:</span>
                                <span className="font-medium">
                                    {role.isLoading ? '...' : role.count ?? 0}
                                </span>
                            </div>
                        )) : USER_ROLE_PROFILE_OPTIONS.map(role => ( // Show placeholders while loading
                            <div key={role.value} className="flex justify-between w-full gap-4">
                                <span className="text-muted-foreground">{role.label}:</span>
                                <span className="font-medium">...</span>
                            </div>
                        ))}
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
            },
            {
                accessorKey: "creation",
                header: ({ column }) => <DataTableColumnHeader column={column} title="Date Joined" />,
                cell: ({ row }) => <div className="font-medium whitespace-nowrap">{formatDate(row.getValue("creation"))}</div>,
                size: 150,
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
        <div className="flex-1 space-y-4">
            {/* <div className="flex items-center justify-between">
                <h1 className="text-2xl font-semibold">Manage Users</h1>
                <Button onClick={() => navigate("/new-user")}>
                    <CirclePlus className="mr-2 h-4 w-4" /> Add New User
                </Button>
            </div> */}

            <UsersSummaryCard />

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
    );
}