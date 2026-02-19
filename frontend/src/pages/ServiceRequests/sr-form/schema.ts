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
    quantity: z.coerce.number().positive({ message: "Quantity must be greater than 0" }),
    rate: z.coerce.number().optional(),
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
    rate?: number
): ServiceItemType => ({
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
    category,
    description,
    uom,
    quantity,
    rate,
});

/**
 * Validation result type
 */
export type ValidationResult = {
    success: boolean;
    error?: string;
};

/**
 * Validation helper for step 1
 */
export const validateStep1 = (values: Partial<SRFormValues>): ValidationResult => {
    const result = step1Schema.safeParse(values);
    if (!result.success) {
        return {
            success: false,
            error: result.error.errors[0]?.message || "Please complete all required fields.",
        };
    }
    return { success: true };
};

/**
 * Validation helper for step 2
 */
export const validateStep2 = (values: Partial<SRFormValues>): ValidationResult => {
    const result = step2Schema.safeParse({
        vendor: values.vendor,
        items: values.items,
    });
    if (!result.success) {
        return {
            success: false,
            error: result.error.errors[0]?.message || "Please complete all required fields.",
        };
    }

    // Manual check for total amount (moved from Zod schema to control timing/message)
    const items = values.items || [];
    const total = calculateTotal(items);
    const allRatesSet = items.every((i) => (i.rate ?? 0) !== 0);
    
    if (allRatesSet && total <= 0) {
        return {
            success: false,
            error: "Total Work Order amount must be greater than zero",
        };
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
