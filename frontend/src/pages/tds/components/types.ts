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
    tds_item_id: z.string().optional(),
    tds_item_name: z.string().optional(),
    is_custom_item: z.boolean().optional(),
    item_description: z.string().optional(),
    make: z.string().min(1, "Make is required."),
}).refine(data => {
    // Either tds_item_id OR tds_item_name is required
    if (data.is_custom_item) {
        return !!data.tds_item_name && data.tds_item_name.length > 0;
    }
    return !!data.tds_item_id && data.tds_item_id.length > 0;
}, { message: "Item Name is required", path: ["tds_item_id"] });

export type TDSItemValues = z.infer<typeof tdsItemSchema>;

