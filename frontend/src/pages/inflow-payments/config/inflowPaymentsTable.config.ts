import { SearchFieldOption } from '@/components/data-table/new-data-table';
import { ProjectInflows } from '@/types/NirmaanStack/ProjectInflows';

// Fields to fetch for Inflow Payments tables
export const DEFAULT_INFLOW_FIELDS_TO_FETCH: (keyof ProjectInflows | 'name')[] = [
    "name", "creation", "modified", "owner", "project",
    "customer",
    "invoice",
    "amount", "payment_date", "utr", "inflow_attachment"
];

// Searchable fields configuration for Inflow Payments tables
export const INFLOW_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "name", label: "Inflow ID", placeholder: "Search by Inflow ID..." },
    { value: "project", label: "Project ID", placeholder: "Search by Project ID..." },
    // { value: "project_name", label: "Project Name", placeholder: "Search by Project Name..." },
    { value: "customer", label: "Customer ID", placeholder: "Search by Customer ID..." },
    // { value: "customer_name", label: "Customer Name", placeholder: "Search by Customer Name..." },
    { value: "utr", label: "Payment (UTR)", placeholder: "Search by UTR...", default: true },
    { value: "amount", label: "Amount", placeholder: "Search by Amount..." },
];

/**
 * The url-sync key an Inflow Payments table persists its search/sort/page state under.
 *
 * ⚠️ THE ONE DEFINITION, read by `InFlowPayments` itself AND by `inflowHref` below. A link that spelled
 * the key on its own would keep working only until someone changed the format here, and then land on
 * an unfiltered table with nothing on screen explaining why.
 */
export const buildInflowUrlSyncKey = (urlContext = "default", scopeId?: string): string =>
    `inflow_${urlContext}_${(scopeId || "all").replace(/[^a-zA-Z0-9]/g, "_")}`;

/**
 * A link to ONE inflow: the `/in-flow-payments` list, searched by the inflow's own id.
 *
 * The route renders `InFlowPayments` with the default context and no customer/project scope, and
 * `name` is one of `INFLOW_SEARCHABLE_FIELDS`, so this lands on the record itself. Render it through
 * React Router (it carries the app's `basename`), never a raw `<a href>`.
 */
export const inflowHref = (inflowName: string): string => {
    const key = buildInflowUrlSyncKey();
    const params = new URLSearchParams({
        [`${key}_searchBy`]: "name",
        [`${key}_q`]: inflowName,
    });
    return `/in-flow-payments?${params.toString()}`;
};

// Date columns for Inflow Payments tables
export const INFLOW_DATE_COLUMNS: string[] = ["creation", "modified", "payment_date"];

// Function to get static filters based on props like customerId or projectId
export const getInflowStaticFilters = (
    customerId?: string,
    projectId?: string,
    // projectsForCustomer?: { name: string }[] // If filtering by projects of a customer
): Array<[string, string, any]> => {
    const filters: Array<[string, string, any]> = [];
    if (projectId) {
        filters.push(["project", "=", projectId]);
    }
    if (customerId) { // If customerId is primary, it implies filtering by that customer
        filters.push(["customer", "=", customerId]);
    }
    // If you need to filter by projects belonging to a customer, that logic would be:
    // if (customerId && projectsForCustomer && projectsForCustomer.length > 0) {
    //     filters.push(["project", "in", projectsForCustomer.map(p => p.name)]);
    // } else if (customerId && projectsForCustomer && projectsForCustomer.length === 0) {
    //     filters.push(["project", "in", ["__NON_EXISTENT_PROJECT__"]]); // No results
    // }
    return filters;
};