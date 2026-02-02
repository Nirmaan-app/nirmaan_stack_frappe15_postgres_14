import { useMemo } from "react";
import { useFrappeGetDoc } from "frappe-react-sdk";
import { ServiceRequests } from "@/types/NirmaanStack/ServiceRequests";
import { Projects } from "@/types/NirmaanStack/Projects";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { SRFormValues } from "../schema";
import { useSRFormData, VendorOption, CategoryOption } from "./useSRFormData";
import { transformSRToFormValues } from "../amend/transformers";

/* ─────────────────────────────────────────────────────────────
   INTERFACE DEFINITIONS
   ───────────────────────────────────────────────────────────── */

export interface UseSRAmendDataReturn {
    /** The original SR document being amended */
    srDoc: ServiceRequests | undefined;
    /** Form values transformed from the SR document */
    initialFormValues: SRFormValues | undefined;
    /** Service categories for dropdown */
    categories: CategoryOption[];
    /** Service vendors for dropdown */
    vendors: VendorOption[];
    /** Project document */
    project: Projects | undefined;
    /** Vendor document */
    vendor: Vendors | undefined;
    /** Combined loading state */
    isLoading: boolean;
    /** Whether any fetch had an error */
    hasError: boolean;
    /** Function to refetch the SR document */
    mutateSR: () => void;
}

/* ─────────────────────────────────────────────────────────────
   HOOK IMPLEMENTATION
   ───────────────────────────────────────────────────────────── */

/**
 * Custom hook for fetching and combining data needed for SR amendment.
 *
 * Fetches:
 * - SR document via useFrappeGetDoc
 * - Vendor document (from SR's vendor field)
 * - Project document (from SR's project field)
 * - Categories and vendors via useSRFormData
 *
 * Returns combined data with computed initialFormValues for the form.
 *
 * @param srId - The Service Request ID to fetch for amendment
 * @returns Combined data for SR amendment workflow
 */
export function useSRAmendData(srId: string | undefined): UseSRAmendDataReturn {
    /* ─────────────────────────────────────────────────────────
       FETCH SR DOCUMENT
       ───────────────────────────────────────────────────────── */
    const {
        data: srDoc,
        isLoading: srLoading,
        error: srError,
        mutate: mutateSR,
    } = useFrappeGetDoc<ServiceRequests>(
        "Service Requests",
        srId,
        srId ? `Service Requests ${srId}` : null
    );

    /* ─────────────────────────────────────────────────────────
       EXTRACT IDS FOR DEPENDENT FETCHES
       ───────────────────────────────────────────────────────── */
    const projectId = srDoc?.project;
    const vendorId = srDoc?.vendor;

    /* ─────────────────────────────────────────────────────────
       FETCH VENDOR DOCUMENT
       ───────────────────────────────────────────────────────── */
    const {
        data: vendor,
        isLoading: vendorLoading,
        error: vendorError,
    } = useFrappeGetDoc<Vendors>(
        "Vendors",
        vendorId,
        vendorId ? `Vendors ${vendorId}` : null
    );

    /* ─────────────────────────────────────────────────────────
       FETCH FORM DATA (CATEGORIES, VENDORS, PROJECT)
       ───────────────────────────────────────────────────────── */
    const {
        categories,
        vendors,
        project,
        isLoading: formDataLoading,
        hasError: formDataError,
    } = useSRFormData(projectId);

    /* ─────────────────────────────────────────────────────────
       COMPUTE INITIAL FORM VALUES
       ───────────────────────────────────────────────────────── */
    const initialFormValues = useMemo<SRFormValues | undefined>(() => {
        // Only compute when all required data is loaded
        if (!srDoc) {
            return undefined;
        }

        // Transform SR document to form values
        // Pass project and vendor for richer references
        return transformSRToFormValues(
            srDoc,
            project || null,
            vendor || null
        );
    }, [srDoc, project, vendor]);

    /* ─────────────────────────────────────────────────────────
       COMBINED LOADING STATE
       ───────────────────────────────────────────────────────── */
    const isLoading =
        (!!srId && srLoading) ||
        (!!vendorId && vendorLoading) ||
        formDataLoading;

    /* ─────────────────────────────────────────────────────────
       COMBINED ERROR STATE
       ───────────────────────────────────────────────────────── */
    const hasError = !!(srError || vendorError || formDataError);

    /* ─────────────────────────────────────────────────────────
       RETURN VALUES
       ───────────────────────────────────────────────────────── */
    return {
        srDoc,
        initialFormValues,
        categories,
        vendors,
        project,
        vendor,
        isLoading,
        hasError,
        mutateSR,
    };
}

export default useSRAmendData;
