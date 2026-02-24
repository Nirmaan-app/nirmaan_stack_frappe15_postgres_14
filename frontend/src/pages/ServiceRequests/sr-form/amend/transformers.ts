import { SRFormValues, ServiceItemType, VendorRefType, ProjectRefType, createServiceItem } from "../schema";
import { ServiceRequests, ServiceItemType as SRServiceItemType } from "@/types/NirmaanStack/ServiceRequests";

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

/**
 * Parses the service_order_list field from a Service Request document.
 *
 * Handles both formats:
 * - JSON string (when fetched raw from database)
 * - Object with { list: [...] } structure (when already parsed)
 *
 * @param sr - The Service Request document
 * @returns Array of ServiceItemType with proper numeric types
 */
export function parseServiceOrderList(sr: ServiceRequests): ServiceItemType[] {
    let list: SRServiceItemType[] = [];

    // 1. Handle string format (unparsed JSON)
    if (typeof sr.service_order_list === "string") {
        try {
            const parsed = JSON.parse(sr.service_order_list);
            list = Array.isArray(parsed) ? parsed : (parsed?.list || []);
        } catch (e) {
            console.error("Failed to parse service_order_list JSON string:", e);
            return [];
        }
    } 
    // 2. Handle object format
    else if (sr.service_order_list && typeof sr.service_order_list === "object") {
        // Could be { list: [...] } or just [...]
        if (Array.isArray(sr.service_order_list)) {
            list = sr.service_order_list;
        } else if (Array.isArray((sr.service_order_list as any).list)) {
            list = (sr.service_order_list as any).list;
        }
    }

    // 3. Transform to form type with safe defaults
    return list.map((item): ServiceItemType => ({
        id: item.id || createServiceItem(item.category).id,
        category: item.category || "Unknown",
        description: item.description || "",
        uom: item.uom || "",
        quantity: typeof item.quantity === "string" ? parseFloat(item.quantity) || 0 : item.quantity || 0,
        rate: item.rate !== undefined
            ? (typeof item.rate === "string" ? parseFloat(item.rate) || 0 : item.rate)
            : undefined,
    }));
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
    vendor?: VendorData | null
): SRFormValues {
    // Parse service items from the service_order_list
    const items = parseServiceOrderList(sr);

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
    // Build service_order_list structure
    const serviceOrderList = {
        list: values.items.map((item) => ({
            id: item.id,
            category: item.category,
            description: item.description,
            uom: item.uom,
            quantity: item.quantity,
            rate: item.rate || 0,
        })),
    };

    // Build service_category_list from unique categories
    const uniqueCategories = Array.from(
        new Set(values.items.map((item) => item.category))
    );
    const serviceCategoryList = {
        list: uniqueCategories.map((name) => ({ name })),
    };

    return {
        project: values.project.id,
        vendor: values.vendor?.id || null,
        service_order_list: serviceOrderList,
        service_category_list: serviceCategoryList,
        project_gst: values.project_gst || null,
        // Note: comments/notes handling depends on amendment API requirements
        // The amendment may need to store the comment in a notes field
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
