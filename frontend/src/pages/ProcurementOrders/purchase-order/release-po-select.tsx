import { DataTable, SearchFieldOption } from '@/components/data-table/new-data-table';
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { ItemsHoverCard } from "@/components/helpers/ItemsHoverCard";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { useUserData } from "@/hooks/useUserData";
import { ProcurementOrder as ProcurementOrdersType } from "@/types/NirmaanStack/ProcurementOrders";
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
import { Projects } from "@/types/NirmaanStack/Projects";
import { formatDate } from "@/utils/FormatDate";
import { formatForReport, formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { getPOTotal, getTotalInvoiceAmount } from "@/utils/getAmounts";
import { parseNumber } from "@/utils/parseNumber";
import { useDocCountStore } from "@/zustand/useDocCountStore";
import { ColumnDef } from "@tanstack/react-table";
import { Radio } from "antd";
import { FrappeDoc, useFrappeGetDocList, GetDocListArgs } from "frappe-react-sdk";
import memoize from 'lodash/memoize';
import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../../../components/ui/badge";
import { TableSkeleton } from "../../../components/ui/skeleton";
import { PaymentsDataDialog } from "../../ProjectPayments/PaymentsDataDialog";
import { InvoiceDataDialog } from "./components/InvoiceDataDialog";
import { getUrlStringParam, useServerDataTable } from "@/hooks/useServerDataTable";
import { useFacetValues } from "@/hooks/useFacetValues";
import { urlStateManager } from "@/utils/urlStateManager";
import { useUsersList } from '../../ProcurementRequests/ApproveNewPR/hooks/useUsersList';
import { useVendorsList } from '../../ProcurementRequests/VendorQuotesSelection/hooks/useVendorsList';
import { getProjectListOptions, queryKeys } from '@/config/queryKeys';
import { DEFAULT_PO_FIELDS_TO_FETCH, getReleasePOSelectStaticFilters, PO_DATE_COLUMNS, PO_SEARCHABLE_FIELDS, PO_STATUS_OPTIONS } from './config/purchaseOrdersTable.config';
import { AlertDestructive } from '@/components/layout/alert-banner/error-alert';

const ApproveSelectVendor = React.lazy(() => import("../../ProcurementRequests/ApproveVendorQuotes/approve-select-vendor"));
const ApproveSelectSentBack = React.lazy(() => import("../../Sent Back Requests/approve-select-sent-back"));
const ApproveSelectAmendPO = React.lazy(() => import("../amend-po/approve-select-amend-po"));

const DOCTYPE = 'Procurement Orders';
const URL_SYNC_KEY = 'po'; // Unique key for URL state for this table instance


const PODataTableWrapper: React.FC<{
    tab: string;
    columns: any;
    fieldsToFetch: string[];
    poSearchableFieldsOptions: SearchFieldOption[];
    staticFiltersForTab: any[];
    facetFilterOptions: any;
    dateColumns: any;
}> = ({
    tab,
    columns,
    fieldsToFetch,
    poSearchableFieldsOptions,
    staticFiltersForTab,
    facetFilterOptions,
    dateColumns
}) => {
        // Generate urlSyncKey inside the wrapper
        const dynamicUrlSyncKey = `${URL_SYNC_KEY}_${tab.toLowerCase().replace(/\s+/g, '_')}`;

        // Instantiate hook here
        const serverDataTable = useServerDataTable<ProcurementOrdersType>({
            doctype: DOCTYPE,
            columns: columns,
            fetchFields: fieldsToFetch,
            searchableFields: poSearchableFieldsOptions,
            urlSyncKey: dynamicUrlSyncKey,
            defaultSort: 'modified desc',
            additionalFilters: staticFiltersForTab,
        });

        const { columnFilters, searchTerm, selectedSearchField } = serverDataTable;

        // --- Dynamic Facet Values ---
        const { facetOptions: projectFacetOptions, isLoading: isProjectFacetLoading } = useFacetValues({
            doctype: DOCTYPE,
            field: 'project',
            currentFilters: columnFilters,
            searchTerm,
            selectedSearchField,
            additionalFilters: staticFiltersForTab,
            enabled: true
        });

        const { facetOptions: vendorFacetOptions, isLoading: isVendorFacetLoading } = useFacetValues({
            doctype: DOCTYPE,
            field: 'vendor',
            currentFilters: columnFilters,
            searchTerm,
            selectedSearchField,
            additionalFilters: staticFiltersForTab,
            enabled: true
        });

        const dynamicFacetFilterOptions = React.useMemo(() => ({
            ...facetFilterOptions,
            project: { ...facetFilterOptions.project, options: projectFacetOptions, isLoading: isProjectFacetLoading },
            vendor: { ...facetFilterOptions.vendor, options: vendorFacetOptions, isLoading: isVendorFacetLoading },
        }), [facetFilterOptions, projectFacetOptions, isProjectFacetLoading, vendorFacetOptions, isVendorFacetLoading]);

        return (
            <DataTable<ProcurementOrdersType>
                table={serverDataTable.table}
                columns={columns}
                isLoading={serverDataTable.isLoading}
                error={serverDataTable.error}
                totalCount={serverDataTable.totalCount}
                searchFieldOptions={poSearchableFieldsOptions}
                selectedSearchField={serverDataTable.selectedSearchField}
                onSelectedSearchFieldChange={serverDataTable.setSelectedSearchField}
                searchTerm={serverDataTable.searchTerm}
                onSearchTermChange={serverDataTable.setSearchTerm}
                facetFilterOptions={dynamicFacetFilterOptions}
                dateFilterColumns={dateColumns}
                showExportButton={true}
                onExport={'default'}
            />
        );
    };


export const ReleasePOSelect: React.FC = () => {

    const { role } = useUserData()

    // --- State for Dialogs ---
    const [selectedInvoicePO, setSelectedInvoicePO] = useState<ProcurementOrdersType | undefined>();
    const [selectedPaymentPO, setSelectedPaymentPO] = useState<ProcurementOrdersType | undefined>();


    // --- Tab State Management ---
    const initialTab = useMemo(() => {
        // Determine initial tab based on role, default to "Approved PO" if not admin/lead
        const defaultTab = ["Nirmaan Admin Profile", "Nirmaan Project Lead Profile"].includes(role) ? "Approve PO" :
            role === "Nirmaan Estimates Executive Profile" ? "All POs" : "Approved PO";
        return getUrlStringParam("tab", defaultTab);
    }, [role]); // Calculate only once based on role

    const [tab, setTab] = useState<string>(initialTab);

    // Effect to sync tab state TO URL
    useEffect(() => {
        // Only update URL if the state `tab` is different from the URL's current 'tab' param
        if (urlStateManager.getParam("tab") !== tab) {
            urlStateManager.updateParam("tab", tab);
        }
    }, [tab]);

    // Effect to sync URL state TO tab state (for popstate/direct URL load)
    useEffect(() => {
        const unsubscribe = urlStateManager.subscribe("tab", (_, value) => {
            // Update state only if the new URL value is different from current state
            const newTab = value || initialTab; // Fallback to initial if param removed
            if (tab !== newTab) {
                setTab(newTab);
            }
        });
        return unsubscribe; // Cleanup subscription
    }, [initialTab]); // Depend on `tab` to avoid stale closures

    const { data: projectPayments, isLoading: projectPaymentsLoading, error: projectPaymentsError } = useFrappeGetDocList<ProjectPayments>("Project Payments", {
        fields: ["name", "document_name", "status", "amount", "payment_date", "creation", "utr", "payment_attachment", "tds"],
        limit: 0
    })

    const { data: poData } = useFrappeGetDocList<ProcurementOrdersType>("Procurement Orders", {
        fields: ["name", "status", "merged"],
        limit: 0
    }, "All_POs_For_Merged")

    const posMap = useMemo(() => {
        const map = new Map<string, ProcurementOrdersType>();
        poData?.forEach(po => map.set(po.name, po));
        return memoize((id: string) => map.get(id) || null);
    }, [poData])

    // useFrappeDocTypeEventListener("Procurement Orders", async (event) => {
    //     await mutate()
    // })

    const projectsFetchOptions = getProjectListOptions();

    // --- Generate Query Keys ---
    const projectQueryKey = queryKeys.projects.list(projectsFetchOptions);

    // --- Supporting Data & Hooks ---
    const { data: projects, isLoading: projectsLoading, error: projectsError } = useFrappeGetDocList<Projects>(
        "Projects", projectsFetchOptions as GetDocListArgs<FrappeDoc<Projects>>, projectQueryKey
    );

    const { data: vendorsList, isLoading: vendorsListLoading, error: vendorsError } = useVendorsList()

    const { data: userList, isLoading: userListLoading, error: userError } = useUsersList()

    const vendorOptions = useMemo(() => vendorsList?.map((ven) => ({ label: ven.vendor_name, value: ven.name })) || [], [vendorsList])

    const projectOptions = useMemo(() => projects?.map((item) => ({ label: `${item.project_name}`, value: `${item.name}` })) || [], [projects])

    const getAmountPaid = useMemo(() => memoize((id: string) => {
        const payments = projectPayments?.filter((payment) => payment?.document_name === id && payment?.status === "Paid") || [];
        const total = payments.reduce((acc, payment) => acc + parseNumber(payment?.amount), 0);
        // console.log("getAmountPaid", id, payments, total)
        return total;
    }, (id: string) => id), [projectPayments])

    // --- Memoized Calculation Functions ---
    // Define these outside the main component body or ensure dependencies are stable
    // Using useMemo ensures they are stable if dependencies don't change.
    // const getAmountPaid = useMemo(() => {
    //     if (!projectPayments) return () => 0; // Return a function that returns 0 if data not ready
    //     // Create a map for faster lookups
    //     const paymentsMap = new Map<string, number>();
    //     projectPayments.forEach(p => {
    //         if (p.document_name && p.status === "Paid") {
    //             const currentTotal = paymentsMap.get(p.document_name) || 0;
    //             paymentsMap.set(p.document_name, currentTotal + parseNumber(p.amount));
    //         }
    //     });
    //     // Return the memoized lookup function
    //     return memoize((id: string) => paymentsMap.get(id) || 0);
    // }, [projectPayments]); // Recalculate only when projectPayments changes

    const { counts } = useDocCountStore()

    const staticFiltersForTab = useMemo(
        () => getReleasePOSelectStaticFilters(tab, role),
        [tab, role]
    );

    const fieldsToFetch = useMemo<string[]>(() => [
        ...DEFAULT_PO_FIELDS_TO_FETCH,     // spread keeps array flat
        "creation",
        "modified",
        "amount",
        // "loading_charges",
        // "freight_charges",
        "invoice_data",
        ...(tab === "Merged POs" ? ["merged", "modified_by"] : [])
    ], [tab]);

    const poSearchableFieldsOptions = useMemo(() => PO_SEARCHABLE_FIELDS.concat([{ value: "owner", label: "Approved By", placeholder: "Search by Approved By..." },
    ...(tab === "All POs" ? [
        { value: "status", label: "Status", placeholder: "Search by Status..." },
    ] : []),
    ...(tab === "Merged POs" ? [
        { value: "merged", label: "Master PO", placeholder: "Search by Master PO..." },
    ] : [])

    ]), [tab]);

    const dateColumns = PO_DATE_COLUMNS;

    const adminTabs = useMemo(() => [
        ...(["Nirmaan Project Lead Profile", "Nirmaan Admin Profile"].includes(
            role
        ) ? [
            {
                label: (
                    <div className="flex items-center">
                        <span>Approve PO</span>
                        <span className="ml-2 text-xs font-bold">
                            {counts.pr.approve}
                        </span>
                    </div>
                ),
                value: "Approve PO",
            },
            {
                label: (
                    <div className="flex items-center">
                        <span>Approve Amended PO</span>
                        <span className="ml-2 text-xs font-bold">
                            {counts.po['PO Amendment']}
                        </span>
                    </div>
                ),
                value: "Approve Amended PO",
            },
            {
                label: (
                    <div className="flex items-center">
                        <span>Approve Sent Back PO</span>
                        <span className="ml-2 text-xs font-bold">
                            {counts.sb.approve}
                        </span>
                    </div>
                ),
                value: "Approve Sent Back PO",
            },
        ] : []),
    ], [role, counts])

    const items = useMemo(() => [
        ...(role !== "Nirmaan Estimates Executive Profile" ? [
            {
                label: (
                    <div className="flex items-center">
                        <span>Approved PO</span>
                        <span className="ml-2 text-xs font-bold">
                            {counts.po['PO Approved']}
                        </span>
                    </div>
                ),
                value: "Approved PO",
            },
            {
                label: (
                    <div className="flex items-center">
                        <span>Dispatched PO</span>
                        <span className="ml-2 rounded text-xs font-bold">
                            {counts.po['Dispatched']}
                        </span>
                    </div>
                ),
                value: "Dispatched PO",
            },
            { // Use the new state variable here
                label: (
                    <div className="flex items-center">
                        <span>Partially Delivered PO</span>
                        <span className="ml-2 rounded text-xs font-bold">
                            {counts.po['Partially Delivered']}
                        </span>
                    </div>
                ),
                value: "Partially Delivered PO",
            },
            { // Use the renamed state variable here
                label: (
                    <div className="flex items-center">
                        <span>Delivered PO</span>
                        <span className="ml-2 rounded text-xs font-bold">
                            {counts.po['Delivered']}
                        </span>
                    </div>
                ),
                value: "Delivered PO",
            },
        ] : [])], [role, counts])

    const allTab = useMemo(() =>
        [
            // { label: (<div className="flex  items-center"><span>All POs</span><span className="ml-2 text-xs font-bold">{counts.po.all}</span></div>), value: "All POs" },
            {
                label: (
                    // Use a single container with text-center.
                    // The 'block' and 'md:inline' classes control the layout.
                    <div className="text-center">
                        <span className="block md:inline">All POs</span>
                        <span className="block text-xs font-bold md:inline md:ml-2">
                            {counts.po.all}
                        </span>
                    </div>
                ),
                value: "All POs"
            },
        ]
        , [counts])


    // const mergedPOsTab = useMemo(() =>
    //     [
    //         { label: (<div className="flex items-center"><span>Merged POs</span><span className="ml-2 text-xs font-bold">{counts.po.Merged}</span></div>), value: "Merged POs" },
    //     ]
    //     , [counts])

    // --- Define columns using TanStack's ColumnDef ---
    const columns = useMemo<ColumnDef<ProcurementOrdersType>[]>(() => [
        {
            accessorKey: 'name',
            header: ({ column }) => <DataTableColumnHeader column={column} title="#PO" />,
            cell: ({ row }) => (
                <>
                    <div className="flex gap-1 items-center">
                        {(tab !== "Merged POs" && row.original.status !== "Merged") ? (
                            <Link
                                className="font-medium underline hover:underline-offset-2 whitespace-nowrap"
                                // Adjust the route path as needed
                                to={`/purchase-orders/${row.original.name?.replaceAll("/", "&=")}?tab=${row.original.status}`}
                            >
                                {row.original.name}
                            </Link>
                        ) : (
                            <p>{row.original.name}</p>
                        )}
                        <ItemsHoverCard parentDocId={row.original} parentDoctype={"Procurement Orders"} childTableName="items" />
                    </div>
                    {row.original?.custom === "true" && (
                        <Badge className="w-[100px] flex items-center justify-center">Custom</Badge>
                    )}
                </>
            ),
            size: 200,
            meta: {
                exportHeaderName: "PO ID",
                exportValue: (row) => {
                    return row.name;
                }
            }
        },
        ...(tab === "Merged POs" ? [
            {
                accessorKey: "merged",
                header: ({ column }) => <DataTableColumnHeader column={column} title="Master PO" />,
                cell: ({ row }) => {
                    const data = row.original
                    const masterPO = posMap(data.merged!);
                    return (
                        !["PO Amendment", "Merged"].includes(masterPO?.status!) ?
                            <Link
                                className="font-medium underline hover:underline-offset-2 whitespace-nowrap"
                                to={`/purchase-orders/${masterPO?.name?.replaceAll("/", "&=")}?tab=${masterPO?.status}`}
                            >
                                {masterPO?.name}
                            </Link> : <p>{masterPO?.name}</p>
                    );
                },
                size: 180,
            } as ColumnDef<ProcurementOrdersType>
        ] : []),
        {
            accessorKey: 'creation',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Created On" />,
            cell: ({ row }) => (
                <div className="font-medium whitespace-nowrap">
                    {formatDate(row.getValue<string>('creation'))}
                </div>
            ),
            enableColumnFilter: false,
            size: 150,
            meta: {
                exportHeaderName: "Created On",
                exportValue: (row) => {
                    return formatDate(row.creation);
                }
            }
        },
        {
            accessorKey: 'project',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />,
            cell: ({ row }) => (
                <div className="font-medium">{row.original.project_name}</div>
            ),
            enableColumnFilter: true, // Enable faceted filter for project
            size: 250,
            meta: {
                exportValue: (row) => {
                    return row.project_name;
                },
                enableFacet: true,
                facetTitle: "Project"
            }
        },
        {
            accessorKey: 'vendor',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Vendor" />,
            cell: ({ row }) => (
                <div className="font-medium">{row.original.vendor_name}</div>
            ),
            enableColumnFilter: true, // Enable faceted filter for vendor
            size: 250,
            meta: {
                exportValue: (row) => {
                    return row.vendor_name;
                },
                enableFacet: true,
                facetTitle: "Vendor"
            }
        },

        {
            accessorKey: "owner",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Approved By" />,
            cell: ({ row }) => {
                const data = row.original
                const ownerUser = userList?.find((entry) => data?.owner === entry.name)
                return (
                    <div className="font-medium">
                        {ownerUser?.full_name || data?.owner || "--"}
                    </div>
                );
            },
            size: 180,
            meta: {
                exportHeaderName: "Approved By",
                exportValue: (row) => {
                    const data = row
                    const ownerUser = userList?.find((entry) => data?.owner === entry.name)
                    return ownerUser?.full_name || data?.owner || "--";
                }
            }
        },
        ...(tab === "Merged POs" ? [
            {
                accessorKey: "modified_by",
                header: ({ column }) => <DataTableColumnHeader column={column} title="Merged By" />,
                cell: ({ row }) => {
                    const data = row.original
                    const mergedBy = userList?.find((entry) => data?.modified_by === entry.name)
                    return (
                        <div className="font-medium">
                            {mergedBy?.full_name || data?.modified_by || "--"}
                        </div>
                    );
                },
                size: 180,
                meta: {
                    exportHeaderName: "Merged By",
                    exportValue: (row) => {
                        const data = row
                        const mergedBy = userList?.find((entry) => data?.modified_by === entry.name)
                        return mergedBy?.full_name || data?.modified_by || "--";
                    }
                }
            } as ColumnDef<ProcurementOrdersType>
        ] : []),
        {
            accessorKey: "total_amount",
            header: ({ column }) => {
                return (
                    <DataTableColumnHeader column={column} title="PO Amt" />
                )
            },
            cell: ({ row }) => {

                return (<div className="font-medium pr-2">{formatToRoundedIndianRupee(row.original?.total_amount)}</div>);

            },
            size: 200,
            // sortingFn: (a, b) => parseFloat(a) - parseFloat(b),
            meta: {
                exportHeaderName: "PO Amount",
                exportValue: (row) => {

                    return formatForReport(row.original?.total_amount);
                }
            }
        },
        ...(["Dispatched PO", "Partially Delivered PO", "Delivered PO"].includes(tab) ? [
            {
                id: "invoice_amount",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Inv Amt" />
                    )
                },
                cell: ({ row }) => {
                    const invoiceAmount = getTotalInvoiceAmount(row.original?.invoice_data);
                    return (
                        <div className={`font-medium pr-2 ${invoiceAmount ? "underline cursor-pointer text-blue-600 hover:text-blue-800" : ""}`} onClick={() => invoiceAmount && setSelectedInvoicePO(row.original)} >
                            {formatToRoundedIndianRupee(invoiceAmount || 0)} {/* Show 0 if no amount */}
                        </div>
                    )
                },
                size: 200,
                sortingFn: (a, b) => {

                    const invoiceAmountA = getTotalInvoiceAmount(a?.original?.invoice_data);
                    const invoiceAmountB = getTotalInvoiceAmount(b?.original?.invoice_data);
                    console.log("invoiceAmountA", invoiceAmountA)
                    console.log("invoiceAmountB", invoiceAmountB)

                    if (invoiceAmountA && invoiceAmountB) {
                        return invoiceAmountA - invoiceAmountB;
                    }
                    return 0;
                    // return parseFloat(a) - parseFloat(b);
                },
                enableSorting: false,
                meta: {
                    exportHeaderName: "Invoice Amount",
                    exportValue: (row) => {
                        const invoiceAmount = getTotalInvoiceAmount(row.invoice_data);
                        return formatForReport(invoiceAmount || 0);
                    }
                }
            } as ColumnDef<ProcurementOrdersType>,
        ] : []),
        {
            accessorKey: "amount_paid",
            header: ({ column }) => {
                return (
                    <DataTableColumnHeader column={column} title="Amount Paid" />
                )
            },
            cell: ({ row }) => {

                return (<div className={`font-medium pr-2 ${row.original?.amount_paid !== 0 ? "cursor-pointer underline text-blue-600 hover:text-blue-800" : ""}`} onClick={() => row.original?.amount_paid !== 0 && setSelectedPaymentPO(row.original)} >
                    {formatToRoundedIndianRupee(row.original?.amount_paid)}
                </div>
                );

            },
            size: 200,
            // sortingFn: (a, b) => parseFloat(a) - parseFloat(b),
            meta: {
                exportHeaderName: "Amount Paid",
                exportValue: (row) => {

                    return formatForReport(row.original?.amount_paid);
                }
            }
        },
        // ...(tab !== "Merged POs" ? [
        //     {
        //         id: "Amount_paid",
        //         header: "Amt Paid",
        //         cell: ({ row }) => {
        //             const amountPaid = getAmountPaid(row.original?.name);
        //             return (
        //                 <div className={`font-medium pr-2 ${amountPaid ? "cursor-pointer underline text-blue-600 hover:text-blue-800" : ""}`} onClick={() => amountPaid && setSelectedPaymentPO(row.original)} >
        //                     {formatToRoundedIndianRupee(amountPaid || 0)}
        //                 </div>
        //             );

        //         },
        //         size: 200,
        //         // sortingFn: (a, b) => parseFloat(a) - parseFloat(b),
        //         enableSorting: false,
        //         meta: {
        //             exportHeaderName: "Amount Paid",
        //             exportValue: (row) => {
        //                 const amountPaid = getAmountPaid(row.original?.name);
        //                 return formatForReport(amountPaid || 0);
        //             }
        //         }
        //     } as ColumnDef<ProcurementOrdersType>
        // ] : []),
        ...(["All POs"].includes(tab) ? [
            {
                accessorKey: 'status',
                header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
                cell: ({ row }) => {
                    const status = row.getValue<string>("status");
                    const variant = status === "PO Approved" ? "gray" : status === "Dispatched" ? "blue" : ["Partially Delivered", "Delivered"].includes(status) ? "green" : "destructive";
                    return (
                        <Badge variant={variant} className="text-xs">{status}</Badge>
                    );
                },
                size: 180,
                enableColumnFilter: true
            } as ColumnDef<ProcurementOrdersType>
        ] : []),
    ], [tab, userList, getAmountPaid, vendorsList, projects, getTotalInvoiceAmount, getPOTotal, posMap]);

    const facetFilterOptions = useMemo(() => ({
        // Use the 'accessorKey' or 'id' of the column
        project: { title: "Project", options: projectOptions }, // Or use 'project' if filtering by ID
        vendor: { title: "Vendor", options: vendorOptions }, // Or use 'vendor' if filtering by ID
        status: { title: "Status", options: PO_STATUS_OPTIONS },
    }), [projectOptions, vendorOptions]);


    // --- useServerDataTable Hook Instantiation ---
    // Only instantiate if the current tab is supposed to show a data table
    const shouldShowTable = useMemo(() =>
        ["Approved PO", "Dispatched PO", "Partially Delivered PO", "Delivered PO", "All POs", "Merged POs"].includes(tab),
        [tab]);

    // --- Tab Change Handler ---
    const handleTabClick = useCallback((value: string) => {
        if (tab !== value) {
            setTab(value);
            // Reset pagination/search/filters when changing tabs? Optional.
            // If urlSyncKey is used, the hook will re-initialize state based on URL
            // If you want a full reset, you might need to manually clear URL params
            // or call specific setters from the hook. For now, relying on URL state.
        }
    }, [tab]);


    // --- Determine which view to render based on tab ---
    const renderTabView = () => {
        if (tab === "Approve PO") return <ApproveSelectVendor />;
        if (tab === "Approve Amended PO") return <ApproveSelectAmendPO />;
        if (tab === "Approve Sent Back PO") return <ApproveSelectSentBack />;

        if (shouldShowTable) {
            if (projectsLoading || vendorsListLoading || userListLoading || projectPaymentsLoading) {
                return <TableSkeleton />;
            }
            if (!projects || !vendorsList || !userList) {
                return <div className="text-red-600 text-center p-4">Error loading supporting data for table view.</div>;
            }

            // Use wrapper component with key to force complete remount
            return (
                <PODataTableWrapper
                    key={tab} // Key on wrapper ensures complete remount
                    tab={tab}
                    columns={columns}
                    fieldsToFetch={fieldsToFetch}
                    poSearchableFieldsOptions={poSearchableFieldsOptions}
                    staticFiltersForTab={staticFiltersForTab}
                    facetFilterOptions={facetFilterOptions}
                    dateColumns={dateColumns}
                />
            );
        }

        return <div>Invalid Tab Selected</div>;

    };
    // --- End Render View Logic ---

    const combinedErrorOverall = projectsError || vendorsError || projectPaymentsError || userError;

    if (combinedErrorOverall) { // Show prominent error if main list fails
        return <AlertDestructive error={combinedErrorOverall} />
    }

    return (
        <div className="flex-1 space-y-4">
            {/* <div className="flex items-center max-md:items-start gap-4 max-md:flex-col">  */}
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">

                {
                    adminTabs && (
                        <Radio.Group
                            options={adminTabs}
                            optionType="button"
                            buttonStyle="solid"
                            value={tab}
                            onChange={(e) => handleTabClick(e.target.value)}
                        />
                    )
                }
                {
                    items && (
                        <Radio.Group
                            options={items}
                            // defaultValue="Approved PO"
                            optionType="button"
                            buttonStyle="solid"
                            value={tab}
                            onChange={(e) => handleTabClick(e.target.value)}
                        />
                    )
                }

                {/* {
                            mergedPOsTab && (
                                <Radio.Group
                                    options={mergedPOsTab}
                                    optionType="button"
                                    buttonStyle="solid"
                                    value={tab}
                                    onChange={(e) => handleTabClick(e.target.value)}
                                />
                            )
                        } */}

                {
                    allTab && (
                        <Radio.Group
                            options={allTab}
                            optionType="button"
                            buttonStyle="solid"
                            value={tab}
                            onChange={(e) => handleTabClick(e.target.value)}
                        />
                    )
                }

            </div>

            <Suspense fallback={<LoadingFallback />}>
                {renderTabView()}
            </Suspense>

            <InvoiceDataDialog
                open={!!selectedInvoicePO}
                onOpenChange={(open) => !open && setSelectedInvoicePO(undefined)}
                invoiceData={selectedInvoicePO?.invoice_data}
                project={selectedInvoicePO?.project_name}
                poNumber={selectedInvoicePO?.name}
                vendor={selectedInvoicePO?.vendor_name}
            />

            <PaymentsDataDialog
                open={!!selectedPaymentPO}
                onOpenChange={(open) => !open && setSelectedPaymentPO(undefined)}
                payments={projectPayments}
                data={selectedPaymentPO}
                projects={projects}
                vendors={vendorsList}
                isPO
            />
        </div>
    )
}

