import { useFrappeGetDocList, FrappeDoc, GetDocListArgs } from 'frappe-react-sdk';
import { useMemo } from 'react';
import { ProcurementOrder } from '@/types/NirmaanStack/ProcurementOrders';
import { Projects } from '@/types/NirmaanStack/Projects';
import { Vendors } from '@/types/NirmaanStack/Vendors';
import { VendorInvoice } from '@/types/NirmaanStack/VendorInvoice';
import { parseNumber } from '@/utils/parseNumber';
import {
    queryKeys,
    getPOReportListOptions,
    getUsersListOptions,
} from '@/config/queryKeys';

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

export interface POReportRowData {
    name: string;
    creation: string;
    total_amount?: number;
    project: string;
    projectName?: string;
    vendor: string;
    vendorName?: string;
    totalAmount: number;
    invoiceAmount: number;
    amountPaid: number;
    dispatch_date?: string;
    originalDoc: ProcurementOrder;
    assignees?: { email: string; name: string; role: string }[];
}

interface UsePOReportsDataResult {
    reportData: POReportRowData[] | null;
    isLoading: boolean;
    error: Error | null;
    mutatePOs: () => Promise<any>;
}

// Simpler options for fetching all minimal project/vendor data for lookups
const getAllProjectsMinimalOptions = (): GetDocListArgs<FrappeDoc<Projects>> => ({
    fields: ["name", "project_name"],
    limit: 0,
});

const getAllVendorsMinimalOptions = (): GetDocListArgs<FrappeDoc<Vendors>> => ({
    fields: ["name", "vendor_name"],
    limit: 0,
});

export const usePOReportsData = (): UsePOReportsDataResult => {
    // --- Get Options ---
    const poOptions = getPOReportListOptions();
    // --- Generate Query Keys ---
    const poQueryKey = queryKeys.procurementOrders.list(poOptions);

    // --- Fetch Core Data ---
    const {
        data: purchaseOrders,
        isLoading: poLoading,
        error: poError,
        mutate: mutatePOs,
    } = useFrappeGetDocList<ProcurementOrder>(poQueryKey[0], poOptions as GetDocListArgs<FrappeDoc<ProcurementOrder>>, poQueryKey);

    // --- Fetch ALL Approved Vendor Invoices for POs ---
    // Note: We don't filter by document_name to avoid URL length limits with large IN clauses.
    // Instead, we fetch all approved PO invoices and filter client-side.
    const {
        data: vendorInvoices,
        isLoading: invoicesLoading,
        error: invoicesError,
    } = useFrappeGetDocList<VendorInvoice>(
        "Vendor Invoices",
        {
            filters: [
                ["document_type", "=", "Procurement Orders"],
                ["status", "=", "Approved"],
            ],
            fields: ["name", "document_name", "invoice_amount"],
            limit: 0,
        } as GetDocListArgs<FrappeDoc<VendorInvoice>>,
        "VendorInvoices-PO-Reports-All"
    );

    // Create a Set of PO names for efficient lookup
    const poNamesSet = useMemo(
        () => new Set(purchaseOrders?.map(po => po.name) || []),
        [purchaseOrders]
    );

    // --- Fetch Projects and Vendors ---
    const allProjectsOptions = getAllProjectsMinimalOptions();
    const allVendorsOptions = getAllVendorsMinimalOptions();
    const allProjectsQueryKey = queryKeys.projects.allMinimal();
    const allVendorsQueryKey = queryKeys.vendors.allMinimal();

    const { data: projects, isLoading: projectsLoading, error: projectsError } = useFrappeGetDocList<Projects>(
        allProjectsQueryKey[0],
        allProjectsOptions,
        allProjectsQueryKey
    );

    const { data: vendors, isLoading: vendorsLoading, error: vendorsError } = useFrappeGetDocList<Vendors>(
        allVendorsQueryKey[0],
        allVendorsOptions,
        allVendorsQueryKey
    );

    // --- Fetch Users and Permissions for Assignees ---
    const usersOptions = getUsersListOptions(); // limit 1000
    // Fetch Users
    const { data: usersList, isLoading: usersLoading, error: usersError } = useFrappeGetDocList<NirmaanUserDoc>(
        "Nirmaan Users",
        {
            fields: usersOptions.fields,
            limit: usersOptions.limit
        } as GetDocListArgs<FrappeDoc<NirmaanUserDoc>>,
        queryKeys.users.list(usersOptions)
    );

    // Fetch Permissions (All relevant ones)
    // We fetch all permissions where allow="Projects" to avoid large URL issues with filtering by many projects
    const { data: permissions, isLoading: permissionsLoading, error: permissionsError } = useFrappeGetDocList<NirmaanUserPermissionDoc>(
        "Nirmaan User Permissions",
        {
            fields: ["user", "allow", "for_value"],
            filters: [["allow", "=", "Projects"]],
            limit: 0
        },
        "nirmaan_project_permissions_all"
    );

    // --- Create Lookup Maps (Memoized) ---
    const projectMap = useMemo(() => {
        return projects?.reduce((acc, p) => {
            if (p.name && p.project_name) acc[p.name] = p.project_name;
            return acc;
        }, {} as Record<string, string>) ?? {};
    }, [projects]);

    const vendorMap = useMemo(() => {
        return vendors?.reduce((acc, v) => {
            if (v.name && v.vendor_name) acc[v.name] = v.vendor_name;
            return acc;
        }, {} as Record<string, string>) ?? {};
    }, [vendors]);

    // Group Vendor Invoice Totals by Document Name (only for POs in our list)
    const invoiceTotalsMap = useMemo(() => {
        return vendorInvoices?.reduce((acc, invoice) => {
            // Only include invoices for POs in our current dataset
            if (invoice.document_name && poNamesSet.has(invoice.document_name)) {
                const currentTotal = acc[invoice.document_name] || 0;
                acc[invoice.document_name] = currentTotal + parseNumber(invoice.invoice_amount);
            }
            return acc;
        }, {} as Record<string, number>) ?? {};
    }, [vendorInvoices, poNamesSet]);

    // --- Combine and Process Data (Memoized) ---
    const reportData = useMemo<POReportRowData[] | null>(() => {
        // Wait until all required data for calculation is loaded
        if (poLoading || projectsLoading || vendorsLoading || invoicesLoading) {
            return null;
        }

        if (!purchaseOrders) {
            return [];
        }

        const allowedRoles = ["Nirmaan Project Lead Profile", "Nirmaan Project Manager Profile", "Nirmaan Procurement Executive Profile", "Nirmaan Admin Profile", "Nirmaan PMO Executive Profile"];

        // Create User Lookup Map
        const userLookup = usersList?.reduce((acc, user) => {
            if (user.name) {
                acc[user.name] = {
                    full_name: user.full_name,
                    role_profile: user.role_profile
                };
            }
            return acc;
        }, {} as Record<string, { full_name: string; role_profile: string }>) ?? {};

        // Create Project Assignments Map (Project Name -> Assignees[])
        const assignmentsLookup = permissions?.reduce((acc, perm) => {
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
        }, {} as Record<string, { email: string; name: string; role: string }[]>) ?? {};

        const combinedData: POReportRowData[] = [];

        // Process Purchase Orders
        (purchaseOrders || []).forEach(po => {
            if (po) {
                const projectName = projectMap[po.project] || po.project_name || po.project;
                // Use project name (ID) for lookup as permissions use that usually, 
                // but need to verify if 'for_value' is ID or Name. Usually ID.
                // In ProjectOverviewTab: for_value: projectData?.name (which is ID: "PROJ-...")
                const assignees = assignmentsLookup[po.project] || [];

                combinedData.push({
                    name: po.name,
                    creation: po.creation,
                    project: po.project,
                    projectName: projectName,
                    vendor: po.vendor,
                    vendorName: vendorMap[po.vendor] || po.vendor_name || po.vendor,
                    totalAmount: parseNumber(po.total_amount),
                    invoiceAmount: invoiceTotalsMap[po.name] || 0, // Use Vendor Invoices lookup
                    amountPaid: parseNumber(po.amount_paid),
                    dispatch_date: po.dispatch_date || undefined,
                    originalDoc: po,
                    assignees: assignees, // Add assignees
                });
            }
        });

        // Sort by dispatch_date descending
        combinedData.sort((a, b) => {
            const dateA = a.dispatch_date ? new Date(a.dispatch_date).getTime() : 0;
            const dateB = b.dispatch_date ? new Date(b.dispatch_date).getTime() : 0;
            return dateB - dateA;
        });

        return combinedData;

    }, [
        purchaseOrders, projects, vendors, vendorInvoices, usersList, permissions,
        poLoading, projectsLoading, vendorsLoading, invoicesLoading, usersLoading, permissionsLoading,
        projectMap, vendorMap, invoiceTotalsMap,
    ]);

    // --- Consolidated Loading and Error State ---
    const isLoading = poLoading || projectsLoading || vendorsLoading || invoicesLoading || usersLoading || permissionsLoading;
    const error = poError || projectsError || vendorsError || invoicesError || usersError || permissionsError;

    return {
        reportData,
        isLoading,
        error: error instanceof Error ? error : null,
        mutatePOs,
    };
};
