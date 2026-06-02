import { SRFormValues, ServiceItemType, VendorRefType, ProjectRefType, createServiceItem } from "../schema";
import { ServiceRequests } from "@/types/NirmaanStack/ServiceRequests";
import { groupItemsByCategoryFlat } from "../utils";

/**
 * Vendor data structure from the Vendors doctype
 */
interface VendorData {
    name: string;
    vendor_name: string;
    vendor_city?: string;
    vendor_state?: string;
    vendor_gst?: string;
}

/**
 * Project data structure from the Projects doctype
 */
interface ProjectData {
    name: string;
    project_name: string;
    project_address?: string;
}

export function parseServiceOrderList(sr: ServiceRequests, masterItems?: any[]): ServiceItemType[] {
    const childRows = Array.isArray(sr.work_order_items) ? sr.work_order_items : [];
    return childRows.map((row): ServiceItemType => mapItem({
        id: row.name,
        category: row.category,
        description: row.item_name,
        uom: row.uom,
        quantity: row.quantity,
        rate: row.rate,
    }, masterItems));
}

function mapItem(
    item: {
        id?: string;
        category?: string;
        description?: string;
        uom?: string;
        quantity?: string | number;
        rate?: string | number;
        standard_rate?: string | number;
    },
    masterItems?: any[],
): ServiceItemType {
    const description = item.description || "";
    const category = item.category || "Unknown";
    const rate = item.rate !== undefined && item.rate !== null
        ? (typeof item.rate === "string" ? parseFloat(item.rate) || 0 : item.rate)
        : undefined;

    const savedStd = (item as any).standard_rate;
    let stdRate: number | undefined =
        savedStd === undefined || savedStd === null
            ? undefined
            : typeof savedStd === "string"
                ? parseFloat(savedStd) || undefined
                : savedStd;

    if (stdRate === undefined && masterItems && masterItems.length > 0) {
        const masterMatch = masterItems.find(
            (m) => m.item_name === description && m.category_link === category,
        );
        if (masterMatch) {
            stdRate = masterMatch.rate;
        }
    }

    return {
        id: item.id || createServiceItem(category).id,
        category,
        description,
        uom: item.uom || "",
        quantity: typeof item.quantity === "string" ? parseFloat(item.quantity) || 0 : item.quantity || 0,
        rate,
        standard_rate: stdRate,
    };
}

/**
 * Transforms a Service Request document to form values for the amendment wizard.
 *
 * Maps SR document fields to the SRFormValues structure used by React Hook Form.
 * Comments are set to null to allow fresh comments for the amendment.
 *
 * @param sr - The Service Request document to transform
 * @param project - Optional project data for richer project reference
 * @param vendor - Optional vendor data for richer vendor reference
 * @returns Form values ready for the amendment wizard
 */
export function transformSRToFormValues(
    sr: ServiceRequests,
    project?: ProjectData | null,
    vendor?: VendorData | null,
    masterItems?: any[]
): SRFormValues {
    // Parse service items from the service_order_list
    const items = parseServiceOrderList(sr, masterItems);

    // Build project reference
    const projectRef: ProjectRefType = {
        id: sr.project,
        name: project?.project_name || sr.project,
    };

    // Build vendor reference if available
    let vendorRef: VendorRefType | null = null;
    if (sr.vendor) {
        vendorRef = {
            id: sr.vendor,
            name: vendor?.vendor_name || sr.vendor,
            city: vendor?.vendor_city || null,
            state: vendor?.vendor_state || null,
            gst: vendor?.vendor_gst || null,
        };
    }

    return {
        project: projectRef,
        items,
        vendor: vendorRef,
        // Comments are null for amendments - user provides fresh justification
        comments: null,
        project_gst: sr.project_gst || null,
    };
}

/**
 * Transforms form values back to the payload format for Frappe document update.
 *
 * Converts the SRFormValues structure to the format expected by
 * useFrappeUpdateDoc or the amendment API.
 *
 * @param values - The form values from React Hook Form
 * @returns Object ready for Frappe document update
 */
export function transformFormValuesToSRPayload(values: SRFormValues): Record<string, unknown> {
    // Group items by category to preserve package-wise order in backend
    const groupedItems = groupItemsByCategoryFlat(values.items);

    // Child-table rows for work_order_items — let Frappe auto-generate row names
    const workOrderItems = groupedItems.map((item) => ({
        item_name: item.description,
        category: item.category,
        uom: item.uom,
        quantity: item.quantity || 0,
        rate: item.rate || 0,
    }));

    // Build service_category_list from unique categories in grouped order
    const uniqueCategories = Array.from(
        new Set(groupedItems.map((item) => item.category))
    );
    const serviceCategoryList = {
        list: uniqueCategories.map((name) => ({ name })),
    };

    return {
        project: values.project.id,
        vendor: values.vendor?.id || null,
        work_order_items: workOrderItems,
        service_category_list: serviceCategoryList,
        project_gst: values.project_gst || null,
    };
}

/**
 * Creates a vendor reference from vendor data
 *
 * @param vendor - Vendor document data
 * @returns VendorRefType for form values
 */
export function createVendorRef(vendor: VendorData): VendorRefType {
    return {
        id: vendor.name,
        name: vendor.vendor_name,
        city: vendor.vendor_city || null,
        state: vendor.vendor_state || null,
        gst: vendor.vendor_gst || null,
    };
}

/**
 * Creates a project reference from project data
 *
 * @param project - Project document data
 * @returns ProjectRefType for form values
 */
export function createProjectRef(project: ProjectData): ProjectRefType {
    return {
        id: project.name,
        name: project.project_name,
    };
}
