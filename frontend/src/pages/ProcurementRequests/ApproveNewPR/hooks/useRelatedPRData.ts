import { useFrappeGetDocList } from "frappe-react-sdk";
import { Category, Item, Quote, User, Comment, PRDocType } from "../types"; // Use types defined above
import { useMemo } from "react";

interface UseRelatedPRDataProps {
    prDoc?: PRDocType; // Make optional to avoid errors before PR loads
    enabled?: boolean; // Control fetching
}

export const useRelatedPRData = ({ prDoc }: UseRelatedPRDataProps) => {
    const workPackage = prDoc?.work_package;
    const prName = prDoc?.name;

    const { data: usersList, isLoading: usersLoading, error: usersError } = useFrappeGetDocList<User>("Nirmaan Users", {
        fields: ["name", "full_name", "role_profile"], // Fetch required fields
        limit: 1000,
        // Consider filtering roles directly here if needed, or filter later in useMemo
        // filters: [
        //     ["role_profile", "in", ["Nirmaan Project Manager Profile", "Nirmaan Procurement Executive Profile", "Nirmaan Project Lead Profile"]],
        // ],
    }, "Nirmaan Users");

    const { data: categoryList, isLoading: categoriesLoading, error: categoriesError } = useFrappeGetDocList<Category>("Category", {
        fields: ["name", "category_name", "work_package", "tax"], // Added unit_name if default unit comes from category
        filters: workPackage ? [["work_package", "=", workPackage]] : [],
        orderBy: { field: "category_name", order: "asc" },
        limit: 10000,
    }, workPackage ? "Category" : null);

    const categoryNames = useMemo(() => categoryList?.map(c => c.name) ?? [], [categoryList]);

    const { data: itemList, isLoading: itemsLoading, error: itemsError, mutate: itemMutate } = useFrappeGetDocList<Item>("Items", {
        fields: ["name", "item_name", "make_name", "unit_name", "category", "creation"],
        // Fetch all items for the relevant categories once
        filters: categoryNames.length > 0 ? [["category", "in", categoryNames]] : [],
        orderBy: { field: "creation", order: "desc" },
        limit: 100000,
    }, categoryNames.length ? undefined : null);

    const { data: quoteData, isLoading: quotesLoading, error: quotesError } = useFrappeGetDocList<Quote>("Approved Quotations", {
        fields: ["item_id", "quote"],
        limit: 100000,
    }, 'Approved Quotations'); // Consider fetching quotes only when needed (e.g., in summary view)

    const { data: universalComments, isLoading: commentsLoading, error: commentsError } = useFrappeGetDocList<Comment>("Nirmaan Comments", {
        fields: ["name", "comment_type", "reference_doctype", "reference_name", "comment_by", "content", "subject", "creation"], // Specify fields
        filters: prName ? [["reference_name", "=", prName]] : [],
        orderBy: { field: "creation", order: "desc" },
    }, prName ? `Nirmaan Comments ${prName}` : null);

    const isLoading = usersLoading || categoriesLoading || itemsLoading || quotesLoading || commentsLoading;
    const error = usersError || categoriesError || itemsError || quotesError || commentsError;

    return {
        usersList,
        categoryList,
        itemList,
        quoteData,
        universalComments,
        itemMutate,
        isLoading,
        error,
    };
};