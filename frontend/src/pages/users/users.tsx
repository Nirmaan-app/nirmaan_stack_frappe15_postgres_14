import React, { useMemo, useState, useEffect, useRef } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { useFrappeGetDocCount, useFrappePostCall } from "frappe-react-sdk";

// --- UI Components ---
import { DataTable, SearchFieldOption } from '@/components/data-table/new-data-table';
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Card, CardContent } from "@/components/ui/card";
import { UsersRound, ChevronDown } from "lucide-react";
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
    compact?: boolean;
}

const RoleCountPill: React.FC<RoleCountPillProps> = ({ roleValue, roleLabel, count, compact = false }) => {
    const colors = getRoleColors(roleValue);
    return (
        <div
            className={cn(
                "inline-flex items-center gap-1.5 rounded-full border transition-all hover:shadow-sm flex-shrink-0",
                compact ? "px-2 py-1" : "px-3 py-1.5",
                colors.bg,
                colors.border
            )}
        >
            <span className={cn("rounded-full flex-shrink-0", compact ? "w-1.5 h-1.5" : "w-2 h-2", colors.dot)} />
            <span className={cn("font-medium whitespace-nowrap", compact ? "text-[10px]" : "text-xs", colors.text)}>
                {roleLabel}
            </span>
            <span className={cn("font-bold tabular-nums", compact ? "text-[10px]" : "text-xs", colors.text)}>
                {count}
            </span>
        </div>
    );
};

// --- Helper: Compact Role Summary (for mobile collapsed state) ---
const CompactRoleSummary: React.FC<{ roleCounts: Record<string, number> }> = ({ roleCounts }) => {
    // Show top 3 roles by count as colored dots with numbers
    const topRoles = ROLE_OPTIONS
        .map(role => ({ ...role, count: roleCounts[role.value] ?? 0 }))
        .filter(r => r.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, 4);

    return (
        <div className="flex items-center gap-2">
            {topRoles.map(role => {
                const colors = getRoleColors(role.value);
                return (
                    <div key={role.value} className="flex items-center gap-1">
                        <span className={cn("w-2 h-2 rounded-full", colors.dot)} />
                        <span className="text-xs text-muted-foreground tabular-nums">{role.count}</span>
                    </div>
                );
            })}
            {ROLE_OPTIONS.length > 4 && (
                <span className="text-xs text-muted-foreground">...</span>
            )}
        </div>
    );
};

// --- Helper: UsersSummaryCard ---
const UsersSummaryCard: React.FC = () => {
    const [roleCounts, setRoleCounts] = useState<Record<string, number>>({});
    const [isLoadingRoles, setIsLoadingRoles] = useState(true);
    const [roleError, setRoleError] = useState<string | null>(null);
    const [isExpanded, setIsExpanded] = useState(false);
    const contentRef = useRef<HTMLDivElement>(null);

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
                <CardContent className="py-3">
                    <p className="text-sm text-red-600">{roleError}</p>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="my-2 shadow-sm overflow-hidden">
            <CardContent className="p-0">
                {/* Header - Always visible */}
                <div
                    className="flex items-center justify-between p-3 md:p-4 cursor-pointer md:cursor-default"
                    onClick={() => setIsExpanded(!isExpanded)}
                >
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="flex h-9 w-9 md:h-10 md:w-10 items-center justify-center rounded-lg bg-primary/10 flex-shrink-0">
                            <UsersRound className="h-4 w-4 md:h-5 md:w-5 text-primary" />
                        </div>
                        <div className="min-w-0">
                            <div className="flex items-baseline gap-1.5">
                                {totalCountLoading ? (
                                    <TailSpin visible={true} height="18" width="18" color="#D03B45" radius="1" />
                                ) : (
                                    <span className="text-lg md:text-xl font-semibold tabular-nums">{totalCountData ?? 0}</span>
                                )}
                                <span className="text-sm text-muted-foreground font-normal">Users</span>
                            </div>
                            {/* Mobile: Show compact role summary when collapsed */}
                            <div className="md:hidden">
                                {!isLoadingRoles && !isExpanded && (
                                    <CompactRoleSummary roleCounts={roleCounts} />
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Mobile expand/collapse button */}
                    <button
                        className="md:hidden p-1.5 rounded-md hover:bg-muted/50 transition-colors"
                        aria-label={isExpanded ? "Collapse role details" : "Expand role details"}
                    >
                        <ChevronDown
                            className={cn(
                                "h-4 w-4 text-muted-foreground transition-transform duration-200",
                                isExpanded && "rotate-180"
                            )}
                        />
                    </button>
                </div>

                {/* Role Pills Section */}
                {/* Desktop & Tablet: Always visible */}
                <div className="hidden md:block px-4 pb-4">
                    {isLoadingRoles ? (
                        <div className="flex items-center gap-2 text-muted-foreground text-sm">
                            <TailSpin visible={true} height="16" width="16" color="#6b7280" radius="1" />
                            <span>Loading roles...</span>
                        </div>
                    ) : (
                        /* Tablet: Horizontal scroll | Desktop: Wrap */
                        <div className="lg:flex lg:flex-wrap lg:gap-2 md:flex md:gap-2 md:overflow-x-auto md:pb-1 md:-mb-1 scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent">
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
                </div>

                {/* Mobile: Collapsible section */}
                <div
                    ref={contentRef}
                    className={cn(
                        "md:hidden overflow-hidden transition-all duration-200 ease-in-out",
                        isExpanded ? "max-h-48 opacity-100" : "max-h-0 opacity-0"
                    )}
                >
                    <div className="px-3 pb-3 pt-1">
                        {isLoadingRoles ? (
                            <div className="flex items-center gap-2 text-muted-foreground text-sm py-2">
                                <TailSpin visible={true} height="14" width="14" color="#6b7280" radius="1" />
                                <span>Loading...</span>
                            </div>
                        ) : (
                            <div className="flex flex-wrap gap-1.5">
                                {ROLE_OPTIONS.map(role => (
                                    <RoleCountPill
                                        key={role.value}
                                        roleValue={role.value}
                                        roleLabel={role.label}
                                        count={roleCounts[role.value] ?? 0}
                                        compact
                                    />
                                ))}
                            </div>
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