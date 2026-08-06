// src/pages/outflow-import/config/outflowImportTable.config.ts

import { SearchFieldOption } from "@/components/data-table/new-data-table";
import { OutflowImportBatch } from "@/types/NirmaanStack/OutflowImportBatch";

export const DOCTYPE = "Outflow Import Batch";

/** Every field the list renders or exports. */
export const DEFAULT_OFI_FIELDS_TO_FETCH: (keyof OutflowImportBatch | "name" | "owner")[] = [
    "name",
    "creation",
    "owner",
    "source",
    "original_filename",
    "period_from",
    "period_to",
    "status",
    "total_rows",
    "reviewed_rows",
    "reconciled_rows",
    "settled_rows",
    "skipped_rows",
    "exception_rows",
    "error_rows",
    "gross_amount",
    "charges_amount",
    "uploaded_by",
    "overlaps_batch",
];

export const OFI_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "name", label: "Import ID", placeholder: "Search by Import ID...", default: true },
    { value: "original_filename", label: "File Name", placeholder: "Search by file name..." },
    { value: "uploaded_by", label: "Uploaded By", placeholder: "Search by user..." },
];

export const OFI_DATE_COLUMNS: string[] = ["creation", "period_from", "period_to"];
