import { SearchFieldOption } from "@/components/data-table/new-data-table";
import { AggregationConfig } from "@/hooks/useServerDataTable";
import { NonProjectInflows } from "@/types/NirmaanStack/NonProjectInflows";

export const NON_PROJECT_INFLOW_FIELDS_TO_FETCH: (keyof NonProjectInflows)[] = [
    "name", "creation", "modified", "owner",
    "inflow_type", "description", "amount", "payment_date", "utr", "inflow_attachment",
];

export const NON_PROJECT_INFLOW_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "utr", label: "Payment (UTR)", placeholder: "Search by UTR...", default: true },
    { value: "description", label: "Description", placeholder: "Search by description..." },
    { value: "name", label: "Inflow ID", placeholder: "Search by Inflow ID..." },
    { value: "amount", label: "Amount", placeholder: "Search by Amount..." },
];

export const NON_PROJECT_INFLOW_DATE_COLUMNS: string[] = ["creation", "modified", "payment_date"];

export const NON_PROJECT_INFLOW_AGGREGATES_CONFIG: AggregationConfig[] = [
    { field: "amount", function: "sum" },
];

export const NON_PROJECT_INFLOW_URL_SYNC_KEY = "non_project_inflows";
