import * as z from "zod";

export interface TDSItem {
    name: string;
    work_package: string;
    category: string;
    tds_item_name: string;
    tds_item_id?: string;
    "tds_item_name.item_name"?: string; // For readable name
    description: string;
    make: string;
    tds_attachment: string;
    creation: string;
}

export const tdsItemSchema = z.object({
    work_package: z.string().min(1, "Work Package is required."),
    category: z.string().min(1, "Category is required."),
    tds_item_id: z.string().min(1, "Item Name is required."),
    item_description: z.string().min(1, "Item Description is required."),
    make: z.string().min(1, "Make is required."),
});

export type TDSItemValues = z.infer<typeof tdsItemSchema>;
