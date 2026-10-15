// File: hooks/useSRReportsData.ts
import { useFrappeGetDocList, FrappeDoc, GetDocListArgs } from 'frappe-react-sdk';
import { useMemo } from 'react';
import { ServiceRequests } from '@/types/NirmaanStack/ServiceRequests';
import { Projects } from '@/types/NirmaanStack/Projects';
import { Vendors } from '@/types/NirmaanStack/Vendors';
import { parseNumber } from '@/utils/parseNumber';
import {
    queryKeys,
    getSRReportListOptions,
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
    const srQueryKey = queryKeys.serviceRequests.list(srOptions);

    const {
        data: serviceRequests,
        isLoading: srLoading,
        error: srError,
        mutate: mutateSRs,
    } = useFrappeGetDocList<ServiceRequests>(srQueryKey[0], srOptions as GetDocListArgs<FrappeDoc<ServiceRequests>>, srQueryKey);

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

    const reportData = useMemo<SRReportRowData[] | null>(() => {
        if (srLoading || projectsLoading || vendorsLoading) {
            return null;
        }
        if (!serviceRequests) {
            return [];
        }

        // Every Approved WO is a candidate, and each report's own condition on Amount Paid decides whether
        // it shows. There is no separate "has been paid" filter: one on Amount Paid dropped a WO whose
        // Amount Paid a refund took to zero before its condition was even asked (ADR-0034, #1461).
        const srData: SRReportRowData[] = serviceRequests.map(sr => ({
            name: sr.name,
            creation: sr.creation,
            project: sr.project,
            projectName: projectMap[sr.project] || sr.project,
            vendor: sr.vendor,
            vendorName: vendorMap[sr.vendor] || sr.vendor,
            // total_amount on parent is fresh on every save (validate) and
            // already includes GST when sr.gst === "true".
            totalAmount: parseNumber(sr.total_amount),
            invoiceAmount: parseNumber(sr.amount_invoiced),
            // The stored Amount Paid: Paid payments less Received refunds; TDS withheld is not part of it.
            amountPaid: parseNumber(sr.amount_paid),
            originalDoc: sr,
        }));

        srData.sort((a, b) => new Date(b.creation).getTime() - new Date(a.creation).getTime());
        return srData;

    }, [
        serviceRequests, srLoading, projectsLoading, vendorsLoading, projectMap, vendorMap,
    ]);

    const isLoading = srLoading || projectsLoading || vendorsLoading;
    const error = srError || projectsError || vendorsError;

    return {
        reportData,
        isLoading,
        error: error instanceof Error ? error : null,
        mutateSRs,
    };
};
