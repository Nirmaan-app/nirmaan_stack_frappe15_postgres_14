import { useFrappeGetCall, useFrappeGetDocList, FrappeDoc, GetDocListArgs } from 'frappe-react-sdk';
import { useMemo } from 'react';
import { Projects } from '@/types/NirmaanStack/Projects';
import { Vendors } from '@/types/NirmaanStack/Vendors';
import { queryKeys } from '@/config/queryKeys';

// --- Child table item interface ---
export interface DCItem {
    name: string;
    item_id: string;
    item_name: string;
    unit: string;
    category: string;
    quantity: number;
    make?: string;
    idx: number;
}

// --- Raw response shape from backend API ---
interface RawDeliveryDoc {
    name: string;
    creation: string;
    modified_by: string;
    procurement_order: string;
    project: string;
    vendor: string;
    type: "Delivery Challan" | "Material Inspection Report";
    nirmaan_attachment?: string;
    reference_number?: string;
    dc_date?: string;
    is_signed_by_client: 0 | 1;
    client_representative_name?: string;
    dc_reference?: string;
    is_stub: 0 | 1;
    items: DCItem[];
    attachment_url?: string;
}

// --- Enriched row data for the report table ---
export interface DCMIRReportRowData {
    name: string;           // PDD-YYYY-#####
    creation: string;
    procurement_order: string;
    project: string;
    vendor?: string;
    type: "Delivery Challan" | "Material Inspection Report";
    reference_number?: string;
    dc_reference?: string;
    dc_date?: string;
    is_signed_by_client: 0 | 1;
    client_representative_name?: string;
    is_stub: 0 | 1;
    items: DCItem[];
    attachment_url?: string;
    // Enriched fields
    projectName: string;
    vendorName: string;
    itemsSummary: string;   // Pre-computed "Item1 (UOM x Qty), ..." for display/search
}

interface UseDCMIRReportsDataResult {
    reportData: DCMIRReportRowData[] | null;
    isLoading: boolean;
    error: Error | null;
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

export const useDCMIRReportsData = (): UseDCMIRReportsDataResult => {
    // --- Fetch all delivery documents (both DC and MIR) ---
    const {
        data: deliveryDocsResponse,
        isLoading: docsLoading,
        error: docsError,
    } = useFrappeGetCall<{ message: RawDeliveryDoc[] }>(
        'nirmaan_stack.api.po_delivery_documentss.get_all_delivery_documents',
        undefined,
        undefined,
        {
            revalidateOnFocus: false,
        }
    );

    // --- Fetch Projects and Vendors for name lookups ---
    const allProjectsOptions = getAllProjectsMinimalOptions();
    const allVendorsOptions = getAllVendorsMinimalOptions();
    const allProjectsQueryKey = queryKeys.projects.allMinimal();
    const allVendorsQueryKey = queryKeys.vendors.allMinimal();

    const {
        data: projects,
        isLoading: projectsLoading,
        error: projectsError,
    } = useFrappeGetDocList<Projects>(
        allProjectsQueryKey[0],
        allProjectsOptions,
        allProjectsQueryKey
    );

    const {
        data: vendors,
        isLoading: vendorsLoading,
        error: vendorsError,
    } = useFrappeGetDocList<Vendors>(
        allVendorsQueryKey[0],
        allVendorsOptions,
        allVendorsQueryKey
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

    // --- Transform and enrich data (Memoized) ---
    const reportData = useMemo<DCMIRReportRowData[] | null>(() => {
        if (docsLoading || projectsLoading || vendorsLoading) {
            return null;
        }

        const rawDocs = deliveryDocsResponse?.message;
        if (!rawDocs) {
            return null;
        }

        return rawDocs.map((doc) => {
            // Build items summary: "ItemName (UOM x Qty), ..."
            const itemsSummary = (doc.items || [])
                .map((item) => `${item.item_name} (${item.unit} x ${item.quantity})`)
                .join(', ');

            return {
                name: doc.name,
                creation: doc.creation,
                procurement_order: doc.procurement_order,
                project: doc.project,
                vendor: doc.vendor,
                type: doc.type,
                reference_number: doc.reference_number,
                dc_reference: doc.dc_reference,
                dc_date: doc.dc_date,
                is_signed_by_client: doc.is_signed_by_client,
                client_representative_name: doc.client_representative_name,
                is_stub: doc.is_stub,
                items: doc.items || [],
                attachment_url: doc.attachment_url,
                // Enriched fields
                projectName: projectMap[doc.project] || doc.project,
                vendorName: doc.vendor ? (vendorMap[doc.vendor] || doc.vendor) : '',
                itemsSummary,
            };
        });
    }, [
        deliveryDocsResponse?.message,
        docsLoading, projectsLoading, vendorsLoading,
        projectMap, vendorMap,
    ]);

    // --- Consolidated Loading and Error State ---
    const isLoading = docsLoading || projectsLoading || vendorsLoading;
    const error = docsError || projectsError || vendorsError;

    return {
        reportData,
        isLoading,
        error: error instanceof Error ? error : null,
    };
};
