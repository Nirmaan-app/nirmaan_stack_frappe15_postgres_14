import { useMemo } from 'react';
import { useFrappeGetDoc, useFrappeGetDocList, useFrappeDocumentEventListener } from 'frappe-react-sdk';
import { ServiceRequests, ServiceItemType, ServiceCategoryType } from '@/types/NirmaanStack/ServiceRequests';
import { Vendors } from '@/types/NirmaanStack/Vendors';
import { Projects } from '@/types/NirmaanStack/Projects';
import { ProjectPayments } from '@/types/NirmaanStack/ProjectPayments';
import { toast } from '@/components/ui/use-toast';
import { getSRTotal, getTotalAmountPaid } from '@/utils/getAmounts';

// Helper to parse JSON fields safely
const parseJsonField = <T, K extends keyof T>(doc: T, fieldName: K, defaultValue: any = { list: [] }): T[K] extends { list: Array<any> } ? T[K] : { list: [] } => {
    const fieldValue = doc[fieldName];
    if (typeof fieldValue === 'string') {
        try {
            const parsed = JSON.parse(fieldValue);
            return parsed && typeof parsed === 'object' ? parsed : defaultValue;
        } catch (e) {
            console.error(`Error parsing JSON field ${String(fieldName)}:`, e);
            return defaultValue;
        }
    }
    return (fieldValue && typeof fieldValue === 'object' ? fieldValue : defaultValue) as any;
};


export interface ServiceRequestsExtended extends ServiceRequests {
    parsed_notes?: { id: string; note: string }[];
    parsed_service_order_list?: { list: ServiceItemType[] };
    parsed_service_category_list?: { list: ServiceCategoryType[] };
    parsed_invoice_data?: ServiceRequests['invoice_data'];
}


export interface ApprovedSRData {
    serviceRequest?: ServiceRequestsExtended;
    vendor?: Vendors;
    project?: Projects;
    payments?: ProjectPayments[];
    isLoading: boolean;
    error: Error | null;
    mutateSR: () => Promise<any>; // Mutate for the main SR document
    mutatePayments: () => Promise<any>; // Mutate for payments list
    totalExclusiveGST: number;
    totalInclusiveGST: number;
    amountPaid: number;
    amountPendingForRequest: number;
}

export const useApprovedSRData = (srId: string): ApprovedSRData => {
    const {
        data: srDoc,
        isLoading: srLoading,
        error: srError,
        mutate: mutateSR,
    } = useFrappeGetDoc<ServiceRequests>("Service Requests", srId, {
        // SWR config for revalidation, etc.
        revalidateOnFocus: true,
    });

    useFrappeDocumentEventListener("Service Requests", srId, (event) => {
        toast({
            title: "Service Request Updated",
            description: `SR ${event.name} was modified. Refreshing...`,
        });
        mutateSR();
    }, true);

    const { data: vendorDoc, isLoading: vendorLoading, error: vendorError } =
        useFrappeGetDoc<Vendors>("Vendors", srDoc?.vendor, { enabled: !!srDoc?.vendor });

    const { data: projectDoc, isLoading: projectLoading, error: projectError } =
        useFrappeGetDoc<Projects>("Projects", srDoc?.project, { enabled: !!srDoc?.project });

    const { data: paymentsList, isLoading: paymentsLoading, error: paymentsError, mutate: mutatePayments } =
        useFrappeGetDocList<ProjectPayments>("Project Payments", {
            fields: ["name", "amount", "status", "docstatus", "payment_date", "creation", "utr", "payment_attachment"], // Fetch only needed
            filters: [["document_name", "=", srId], ["document_type", "=", "Service Requests"]],
            limit: 0, // Get all payments for this SR
            orderBy: { field: "creation", order: "desc" }
        }, { enabled: !!srId });

    const serviceRequestWithParsedJSON = useMemo(() => {
        if (!srDoc) return undefined;
        return {
            ...srDoc,
            parsed_notes: parseJsonField(srDoc, 'notes', { list: [] }).list,
            parsed_service_order_list: parseJsonField(srDoc, 'service_order_list'),
            parsed_service_category_list: parseJsonField(srDoc, 'service_category_list'),
            parsed_invoice_data: parseJsonField(srDoc, 'invoice_data', { data: {} }), // Assuming default {data:{}}
        };
    }, [srDoc]);

    const totalExclusiveGST = useMemo(() => getSRTotal(serviceRequestWithParsedJSON), [serviceRequestWithParsedJSON]);
    const totalInclusiveGST = useMemo(() => {
        if (!serviceRequestWithParsedJSON) return 0;
        return serviceRequestWithParsedJSON.gst === "true" ? totalExclusiveGST * 1.18 : totalExclusiveGST;
    }, [totalExclusiveGST, serviceRequestWithParsedJSON?.gst]);

    const amountPaid = useMemo(() =>
        getTotalAmountPaid(paymentsList?.filter(p => p.status === "Paid" && p.docstatus === 1) || []),
    [paymentsList]);

    const amountPendingForRequest = useMemo(() =>
        getTotalAmountPaid(paymentsList?.filter(p => ["Requested", "Approved"].includes(p.status)) || []),
    [paymentsList]);


    const isLoading = srLoading || (!!srDoc?.vendor && vendorLoading) || (!!srDoc?.project && projectLoading) || paymentsLoading;
    const error = srError || vendorError || projectError || paymentsError;

    return {
        serviceRequest: serviceRequestWithParsedJSON,
        vendor: vendorDoc,
        project: projectDoc,
        payments: paymentsList,
        isLoading,
        error: error || null,
        mutateSR,
        mutatePayments,
        totalExclusiveGST,
        totalInclusiveGST,
        amountPaid,
        amountPendingForRequest,
    };
};