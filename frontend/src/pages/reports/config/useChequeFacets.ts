/**
 * The Cheque Payments report's facet filters (#1417): type (#1478), status, bank, Vendor, project and PO/WO.
 *
 * Not the self-fetching facets: those read one doctype's own fields, and the project and PO/WO
 * values live on the Cheque's lines. `get_cheque_facets` groups over the same WHERE as the rows,
 * so a project facet lists every project any filtered Cheque has a line in.
 *
 * Same rules as `pages/ProjectPayments/config/useApprovalFacets.ts`: each option carries its count;
 * a facet's OWN selection is left out of its query (or ticking one value would hide its siblings);
 * a ticked value that other filters empty stays listed at 0 so it can be unticked; nothing is
 * fetched until a facet's popover first opens.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ColumnFiltersState } from "@tanstack/react-table";
import { useFrappeGetCall } from "frappe-react-sdk";

import { convertTanstackFiltersToFrappe } from "@/lib/frappeTypeUtils";

import { CHEQUE_FACET_FIELDS, CHEQUE_FACETS_API, type ChequeFacetField } from "./chequePaymentTable.config";

interface FacetValue {
    value: string;
    label: string;
    count: number;
}

interface FacetResponse {
    message: { field: string; values: FacetValue[] };
}

export type ChequeFacetOptions = Record<
    string,
    { title: string; options: { label: string; value: string }[]; isLoading?: boolean }
>;

const NO_VALUES: FacetValue[] = [];
/** Matches the table's own search debounce, so the counts do not refetch per keystroke. */
const SEARCH_DEBOUNCE_MS = 400;

function useChequeFacet(
    field: ChequeFacetField,
    enabled: boolean,
    columnFilters: ColumnFiltersState,
    searchTerm: string,
    selectedSearchField: string,
) {
    const params = useMemo(() => {
        const others = columnFilters.filter((f) => f.id !== field);
        return {
            field,
            filters: JSON.stringify(convertTanstackFiltersToFrappe(others)),
            search_term: searchTerm || undefined,
            current_search_fields: searchTerm && selectedSearchField ? JSON.stringify([selectedSearchField]) : undefined,
        };
    }, [field, columnFilters, searchTerm, selectedSearchField]);

    const { data, isLoading } = useFrappeGetCall<FacetResponse>(
        CHEQUE_FACETS_API,
        params,
        enabled ? `cheque-facet-${JSON.stringify(params)}` : null,
        { keepPreviousData: true },
    );
    return useMemo(
        () => ({ values: data?.message?.values ?? NO_VALUES, isLoading: enabled && isLoading }),
        [data, enabled, isLoading],
    );
}

export function useChequeFacets({
    columnFilters,
    searchTerm,
    selectedSearchField,
}: {
    columnFilters: ColumnFiltersState;
    searchTerm: string;
    selectedSearchField: string;
}) {
    const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
    const onFacetOpen = useCallback((columnId: string) => {
        setOpened((prev) => (prev.has(columnId) ? prev : new Set(prev).add(columnId)));
    }, []);

    const [debouncedSearch, setDebouncedSearch] = useState(searchTerm);
    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(searchTerm), SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(t);
    }, [searchTerm]);

    const common = [columnFilters, debouncedSearch, selectedSearchField] as const;
    const chequeType = useChequeFacet("cheque_type", opened.has("cheque_type"), ...common);
    const status = useChequeFacet("status", opened.has("status"), ...common);
    const bank = useChequeFacet("bank_label", opened.has("bank_label"), ...common);
    const vendor = useChequeFacet("vendor", opened.has("vendor"), ...common);
    const project = useChequeFacet("project", opened.has("project"), ...common);
    const record = useChequeFacet("record_name", opened.has("record_name"), ...common);

    const facetOptions = useMemo(() => {
        const facets: Record<ChequeFacetField, { values: FacetValue[]; isLoading: boolean }> = {
            cheque_type: chequeType,
            status,
            bank_label: bank,
            vendor,
            project,
            record_name: record,
        };
        const map: ChequeFacetOptions = {};
        for (const [field, title] of Object.entries(CHEQUE_FACET_FIELDS) as [ChequeFacetField, string][]) {
            const { values, isLoading } = facets[field];
            const options = values.map((v) => ({ label: `${v.label} (${v.count})`, value: v.value }));
            const selected = columnFilters.find((f) => f.id === field)?.value;
            if (Array.isArray(selected)) {
                const listed = new Set(options.map((o) => o.value));
                for (const v of selected as string[]) {
                    if (!listed.has(v)) options.push({ label: `${v} (0)`, value: v });
                }
            }
            map[field] = { title, isLoading, options };
        }
        return map;
    }, [chequeType, status, bank, vendor, project, record, columnFilters]);

    return { facetOptions, onFacetOpen };
}
