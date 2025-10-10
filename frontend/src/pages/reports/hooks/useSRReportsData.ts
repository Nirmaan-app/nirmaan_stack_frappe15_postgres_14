// File: hooks/useSRReportsData.ts
import { useFrappeGetDocList, FrappeDoc, GetDocListArgs } from 'frappe-react-sdk';
import { useMemo } from 'react';
import { ServiceRequests } from '@/types/NirmaanStack/ServiceRequests';
import { ProjectPayments } from '@/types/NirmaanStack/ProjectPayments';
import { Projects } from '@/types/NirmaanStack/Projects';
import { Vendors } from '@/types/NirmaanStack/Vendors';
import { getSRTotal, getTotalInvoiceAmount } from '@/utils/getAmounts';
import { parseNumber } from '@/utils/parseNumber';
import {
    queryKeys,
    getSRReportListOptions,
    getPaymentReportListOptions, // Parameterized
} from '@/config/queryKeys';

export interface SRReportRowData {
    name: string;
    creation: string;
    project: string;
    projectName?: string;
    vendor: string;
    vendorName?: string;
    totalAmount: number;
    invoiceAmount: number;
    amountPaid: number;
    originalDoc: ServiceRequests;
}

interface UseSRReportsDataResult {
    reportData: SRReportRowData[] | null;
    isLoading: boolean;
    error: Error | null;
    mutateSRs: () => Promise<any>;
    mutatePayments: () => Promise<any>;
}

const getAllProjectsMinimalOptions = (): GetDocListArgs<FrappeDoc<Projects>> => ({
    fields: ["name", "project_name"],
    limit: 0,
});

const getAllVendorsMinimalOptions = (): GetDocListArgs<FrappeDoc<Vendors>> => ({
    fields: ["name", "vendor_name"],
    limit: 0,
});


export const useSRReportsData = (): UseSRReportsDataResult => {
    const srOptions = getSRReportListOptions();
    // Fetch payments only for Service Requests
    const paymentOptions = getPaymentReportListOptions(['Service Requests']);

    const srQueryKey = queryKeys.serviceRequests.list(srOptions);
    // Adjust paymentQueryKey for uniqueness
    const paymentQueryKey = queryKeys.projectPayments.list({ ...paymentOptions, docTypesFilter: ['Service Requests'] });


    const {
        data: serviceRequests,
        isLoading: srLoading,
        error: srError,
        mutate: mutateSRs,
    } = useFrappeGetDocList<ServiceRequests>(srQueryKey[0], srOptions as GetDocListArgs<FrappeDoc<ServiceRequests>>, srQueryKey);

    const {
        data: payments,
        isLoading: paymentsLoading,
        error: paymentsError,
        mutate: mutatePayments,
    } = useFrappeGetDocList<ProjectPayments>(paymentQueryKey[0], paymentOptions as GetDocListArgs<FrappeDoc<ProjectPayments>>, paymentQueryKey);

    const allProjectsOptions = getAllProjectsMinimalOptions();
    const allVendorsOptions = getAllVendorsMinimalOptions();

    const allProjectsQueryKey = queryKeys.projects.allMinimal();
    const allVendorsQueryKey = queryKeys.vendors.allMinimal();

    const { data: projects, isLoading: projectsLoading, error: projectsError } = useFrappeGetDocList<Projects>(
        allProjectsQueryKey[0], allProjectsOptions, allProjectsQueryKey
    );

    const { data: vendors, isLoading: vendorsLoading, error: vendorsError } = useFrappeGetDocList<Vendors>(
        allVendorsQueryKey[0], allVendorsOptions, allVendorsQueryKey
    );

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

    const paymentsMap = useMemo(() => {
        return payments?.reduce((acc, payment) => {
            if (payment.document_name) {
                const currentTotal = acc[payment.document_name] || 0;
                acc[payment.document_name] = currentTotal + parseNumber(payment.amount);
            }
            return acc;
        }, {} as Record<string, number>) ?? {};
    }, [payments]);

    const reportData = useMemo<SRReportRowData[] | null>(() => {
        if (srLoading || paymentsLoading || projectsLoading || vendorsLoading) {
            return null;
        }
        if (!serviceRequests) {
            return [];
        }

        const srData: SRReportRowData[] = [];

        (serviceRequests || []).forEach(sr => {
            const total = getSRTotal(sr);
            const totalWithTax = sr.gst === "true" ? total * 1.18 : total;
            if(sr.amount_paid){
srData.push({
                name: sr.name,
                creation: sr.creation,
                project: sr.project,
                projectName: projectMap[sr.project] || sr.project, // SRs might not have project_name directly
                vendor: sr.vendor,
                vendorName: vendorMap[sr.vendor] || sr.vendor, // SRs might not have vendor_name directly
                totalAmount: parseNumber(totalWithTax),
                invoiceAmount: getTotalInvoiceAmount(sr.invoice_data),
                amountPaid: paymentsMap[sr.name] || 0,
                originalDoc: sr,
            });
            }
            
        });

        srData.sort((a, b) => new Date(b.creation).getTime() - new Date(a.creation).getTime());
        return srData;

    }, [
        serviceRequests, payments, projects, vendors,
        srLoading, paymentsLoading, projectsLoading, vendorsLoading,
        projectMap, vendorMap, paymentsMap,
    ]);

    const isLoading = srLoading || paymentsLoading || projectsLoading || vendorsLoading;
    const error = srError || paymentsError || projectsError || vendorsError;

    return {
        reportData,
        isLoading,
        error: error instanceof Error ? error : null,
        mutateSRs,
        mutatePayments,
    };
};