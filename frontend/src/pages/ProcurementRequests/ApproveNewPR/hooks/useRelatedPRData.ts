import { useFrappeGetDocList } from "frappe-react-sdk";
import { Quote, User, Comment, PRDocType } from "../types";
import { useItemCatalog } from "@/hooks/useItemCatalog";

interface UseRelatedPRDataProps {
    prDoc?: PRDocType;
    workPackages?: string[];
    enabled?: boolean;
}

export const useRelatedPRData = ({ prDoc }: UseRelatedPRDataProps) => {
    const prName = prDoc?.name;

    // --- Item Catalog (categories, items, makes) via shared hook ---
    const {
        itemOptions,
        chargeOptions,
        categories: categoryList,
        categoryNames,
        isLoading: catalogLoading,
        error: catalogError,
        itemMutate,
        categoryMakeListMutate,
    } = useItemCatalog();

    // --- Users ---
    const { data: usersList, isLoading: usersLoading, error: usersError } = useFrappeGetDocList<User>("Nirmaan Users", {
        fields: ["name", "full_name", "role_profile"],
        limit: 0,
    }, "Nirmaan Users");

    // --- Approved Quotations ---
    const { data: quoteData, isLoading: quotesLoading, error: quotesError } = useFrappeGetDocList<Quote>("Approved Quotations", {
        fields: ["item_id", "quote"],
        limit: 0,
    }, 'Approved Quotations');

    // --- PR Comments ---
    const { data: universalComments, isLoading: commentsLoading, error: commentsError } = useFrappeGetDocList<Comment>("Nirmaan Comments", {
        fields: ["name", "comment_type", "reference_doctype", "reference_name", "comment_by", "content", "subject", "creation"],
        filters: prName ? [["reference_name", "=", prName]] : [],
        orderBy: { field: "creation", order: "desc" },
        limit: 0,
    }, prName ? `Nirmaan Comments ${prName}` : null);

    const isLoading = catalogLoading || usersLoading || quotesLoading || commentsLoading;
    const error = catalogError || usersError || quotesError || commentsError;

    return {
        // From useItemCatalog
        itemOptions,
        chargeOptions,
        categoryList,
        categoryNames,
        itemMutate,
        categoryMakeListMutate,

        // Other data
        usersList,
        quoteData,
        universalComments,
        isLoading,
        error,
    };
};
