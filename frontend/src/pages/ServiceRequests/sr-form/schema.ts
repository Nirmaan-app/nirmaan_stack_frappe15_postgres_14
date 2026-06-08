import * as z from "zod";
import { VALIDATION_MESSAGES } from "./constants";

/**
 * SR Form Schema
 *
 * Zod validation schema for the Service Request creation wizard.
 * Defines all fields, their types, and validation rules.
 */

/**
 * Service Item Schema
 * Represents a single service line item in the SR
 */
export const serviceItemSchema = z.object({
    id: z.string(),
    category: z.string().min(1, { message: "Category is required" }),
    description: z.string().min(1, { message: "Description is required" }),
    uom: z.string().min(1, { message: "Unit of measure is required" }),
    quantity: z.coerce.number().refine((val) => val !== 0, { message: "Quantity is required and cannot be zero" }),
    rate: z.coerce.number().refine((val) => val !== 0, { message: "Rate is required and cannot be zero" }),
    // Items pulled from the rate card carry `standard_rate`. Custom items leave it undefined,
    // which is how we tell them apart in the UI.
    standard_rate: z.coerce.number().optional(),
});

export type ServiceItemType = z.infer<typeof serviceItemSchema>;

/**
 * Project reference schema
 */
export const projectRefSchema = z.object({
    id: z.string().min(1, { message: "Project ID is required" }),
    name: z.string().min(1, { message: "Project name is required" }),
});

export type ProjectRefType = z.infer<typeof projectRefSchema>;

/**
 * Vendor reference schema
 */
export const vendorRefSchema = z.object({
    id: z.string().min(1, { message: "Vendor ID is required" }),
    name: z.string().min(1, { message: "Vendor name is required" }),
    city: z.string().nullable().optional(),
    state: z.string().nullable().optional(),
    gst: z.string().nullable().optional(),
});

export type VendorRefType = z.infer<typeof vendorRefSchema>;

/**
 * Main SR Form Schema
 * Full validation schema for the service request wizard
 */
export const srFormSchema = z.object({
    // Step 1: Service Items
    project: projectRefSchema,
    items: z
        .array(serviceItemSchema)
        .min(1, { message: "At least one service item is required" }),

    // Step 2: Vendor & Rates
    vendor: vendorRefSchema.nullable(),

    // Additional fields
    comments: z.string().nullable().optional(),
    project_gst: z.string().nullable().optional(),
});

export type SRFormValues = z.infer<typeof srFormSchema>;

/**
 * Partial schema for Step 1 validation (items only)
 */
export const step1Schema = srFormSchema.pick({
    project: true,
    items: true,
});

export type Step1Values = z.infer<typeof step1Schema>;

/**
 * Partial schema for Step 2 validation (vendor required)
 */
export const step2Schema = z.object({
    vendor: vendorRefSchema.nullable().refine((val) => val !== null, { message: VALIDATION_MESSAGES.vendorRequired }),
    items: z
        .array(serviceItemSchema.extend({
            rate: z.coerce.number().refine((val) => val !== 0, { message: "Rate is required for each item" }),
        }))
        .min(1, { message: "At least one service item is required" }),
});

export type Step2Values = z.infer<typeof step2Schema>;

/**
 * Default values for the SR form
 */
export const defaultSRFormValues: SRFormValues = {
    project: {
        id: "",
        name: "",
    },
    items: [],
    vendor: null,
    comments: null,
    project_gst: null,
};

/**
 * Fields to validate for each wizard step
 */
export const stepFields: Record<string, (keyof SRFormValues)[]> = {
    items: ["project", "items"],
    vendor: ["vendor", "items"], // items validated again for rates
    review: [], // No additional validation, uses full schema
};

/**
 * Category type for service categories
 */
export interface ServiceCategory {
    name: string;
    image_url?: string;
}

/**
 * Helper function to create a new service item
 */
export const createServiceItem = (
    category: string,
    description: string = "",
    uom: string = "",
    quantity: number = 0,
    rate: number = 0,
    standard_rate: number | undefined = undefined,
): ServiceItemType => ({
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
    category,
    description,
    uom,
    quantity,
    rate,
    standard_rate,
});

/**
 * Validation result type
 */
export type ValidationResult = {
    success: boolean;
    error?: string;
};

/**
 * Find the first line that violates non-negative constraints.
 * Quantity must always be > 0 (both new-SR and amend).
 * Rate may be negative only in amend (`allowNegativeRate=true`).
 */
const findInvalidNegativeLine = (
    items: ServiceItemType[],
    allowNegativeRate: boolean,
): { item: ServiceItemType; field: "quantity" | "rate" } | null => {
    for (const item of items) {
        if ((item.quantity ?? 0) < 0) return { item, field: "quantity" };
        if (!allowNegativeRate && (item.rate ?? 0) < 0) return { item, field: "rate" };
    }
    return null;
};

/**
 * Validation helper for step 1.
 * Pass `allowNegativeRate=true` (amend flow) to permit a negative rate / line amount.
 * Quantity is always required to be positive.
 */
export const validateStep1 = (values: Partial<SRFormValues>, allowNegativeRate: boolean = false): ValidationResult => {
    const result = step1Schema.safeParse(values);
    if (!result.success) {
        const error = result.error.errors[0];
        let message = error?.message || "Please complete all required fields.";

        if (error?.path[0] === "items" && typeof error.path[1] === "number") {
            const itemIndex = error.path[1];
            const item = values.items?.[itemIndex];
            if (item?.description) {
                const itemName = item.description.split('\n')[0];
                message = `${itemName}: ${message}`;
            }
        }

        return { success: false, error: message };
    }

    const neg = findInvalidNegativeLine(values.items || [], allowNegativeRate);
    if (neg) {
        const itemName = neg.item.description.split('\n')[0];
        return {
            success: false,
            error: `${itemName}: ${neg.field === "quantity" ? "Quantity" : "Rate"} cannot be negative.`,
        };
    }

    // Total > 0 is enforced at the Vendor & Rates step, not here — rates are
    // typically entered on step 2, so the total isn't meaningful yet on step 1.

    return { success: true };
};

/**
 * Validation helper for step 2.
 * Pass `allowNegativeRate=true` (amend flow) to permit a negative rate / line amount.
 */
export const validateStep2 = (values: Partial<SRFormValues>, allowNegativeRate: boolean = false): ValidationResult => {
    const result = step2Schema.safeParse({
        vendor: values.vendor,
        items: values.items,
    });
    if (!result.success) {
        const error = result.error.errors[0];
        let message = error?.message || "Please complete all required fields.";

        if (error?.path[0] === "items" && typeof error.path[1] === "number") {
            const itemIndex = error.path[1];
            const item = values.items?.[itemIndex];
            if (item?.description) {
                const itemName = item.description.split('\n')[0];
                message = `${itemName}: ${message}`;
            }
        }

        return { success: false, error: message };
    }

    const items = values.items || [];
    const neg = findInvalidNegativeLine(items, allowNegativeRate);
    if (neg) {
        const itemName = neg.item.description.split('\n')[0];
        return {
            success: false,
            error: `${itemName}: ${neg.field === "quantity" ? "Quantity" : "Rate"} cannot be negative.`,
        };
    }

    if (!allowNegativeRate) {
        const total = calculateTotal(items);
        if (total <= 0) {
            return { success: false, error: "Total Service Amount must be greater than 0." };
        }
    }

    return { success: true };
};

/**
 * Calculate total amount for all items
 */
export const calculateTotal = (items: ServiceItemType[]): number => {
    return items.reduce((total, item) => {
        const rate = item.rate ?? 0;
        return total + (item.quantity * rate);
    }, 0);
};

/**
 * Get unique categories from items
 */
export const getUniqueCategories = (items: ServiceItemType[]): string[] => {
    return Array.from(new Set(items.map(item => item.category)));
};

/**
 * Group items by category
 */
export const groupItemsByCategory = (items: ServiceItemType[]): Record<string, ServiceItemType[]> => {
    return items.reduce((groups, item) => {
        const category = item.category;
        if (!groups[category]) {
            groups[category] = [];
        }
        groups[category].push(item);
        return groups;
    }, {} as Record<string, ServiceItemType[]>);
};
