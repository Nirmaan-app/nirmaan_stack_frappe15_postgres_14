import { useFrappeGetDocList } from "frappe-react-sdk";
import { Item, Quote, User, Comment, PRDocType } from "../types"; // Use types defined above
import { useMemo } from "react";
import { CategoryMakelist } from "@/types/NirmaanStack/CategoryMakelist";
import { Makelist } from "@/types/NirmaanStack/Makelist";
import { MakeOption } from "../../NewPR/types";
import { Category } from "@/types/NirmaanStack/Category";

interface UseRelatedPRDataProps {
    prDoc?: PRDocType; // Make optional to avoid errors before PR loads
    enabled?: boolean; // Control fetching
}

export const useRelatedPRData = ({ prDoc }: UseRelatedPRDataProps) => {
    const workPackage = prDoc?.work_package;
    const prName = prDoc?.name;

    const { data: usersList, isLoading: usersLoading, error: usersError } = useFrappeGetDocList<User>("Nirmaan Users", {
        fields: ["name", "full_name", "role_profile"], // Fetch required fields
        limit: 0,
        // Consider filtering roles directly here if needed, or filter later in useMemo
        // filters: [
        //     ["role_profile", "in", ["Nirmaan Project Manager Profile", "Nirmaan Procurement Executive Profile", "Nirmaan Project Lead Profile"]],
        // ],
    }, "Nirmaan Users");

    const { data: categoryList, isLoading: categoriesLoading, error: categoriesError } = useFrappeGetDocList<Category>("Category", {
        fields: ["name", "category_name", "work_package", "tax"], // Added unit_name if default unit comes from category
        filters: workPackage ? [["work_package", "=", workPackage]] : [],
        orderBy: { field: "category_name", order: "asc" },
        limit: 0,
    }, workPackage ? `Category_${workPackage}` : null);

    const categoryNames = useMemo(() => categoryList?.map(c => c.name) ?? [], [categoryList]);

    const { data: itemList, isLoading: itemsLoading, error: itemsError, mutate: itemMutate } = useFrappeGetDocList<Item>("Items", {
        fields: ["name", "item_name", "make_name", "unit_name", "category", "creation"],
        // Fetch all items for the relevant categories once
        filters: categoryNames.length > 0 ? [["category", "in", categoryNames]] : [],
        orderBy: { field: "creation", order: "desc" },
        limit: 0,
    }, categoryNames.length ? undefined : null);

    const { data: quoteData, isLoading: quotesLoading, error: quotesError } = useFrappeGetDocList<Quote>("Approved Quotations", {
        fields: ["item_id", "quote"],
        limit: 0,
    }, 'Approved Quotations'); // Consider fetching quotes only when needed (e.g., in summary view)

    const { data: universalComments, isLoading: commentsLoading, error: commentsError } = useFrappeGetDocList<Comment>("Nirmaan Comments", {
        fields: ["name", "comment_type", "reference_doctype", "reference_name", "comment_by", "content", "subject", "creation"], // Specify fields
        filters: prName ? [["reference_name", "=", prName]] : [],
        orderBy: { field: "creation", order: "desc" },
        limit: 0,
    }, prName ? `Nirmaan Comments ${prName}` : null);


    const {data: categoryMakelist, isLoading: categoryMakeListLoading, error: categoryMakeListError, mutate: categoryMakeListMutate} = useFrappeGetDocList<CategoryMakelist>("Category Makelist", {
            fields: ["category", "make"],
            filters: [["category", "in", categoryNames]],
            orderBy: { field: "category", order: "asc" },
            limit: 0,
        },
        categoryNames.length > 0 ? undefined : null // Only fetch if categories are set
        )
    
         // --- Fetch Make List ---
         const { data: make_list, isLoading: makeLoading, error: makeError, mutate: makeListMutate } = useFrappeGetDocList<Makelist>(
            "Makelist", {
                fields: ["name", "make_name"],
                limit: 0, // Consider if this needs pagination for very large lists
            }
        );
    
        // --- Derived Make Options ---
        const allMakeOptions = useMemo<MakeOption[]>(() => {
            return make_list?.map(make => ({
                value: make.name, // Use DocType name (which might be same as make_name if not customized)
                label: make.make_name,
            })) || [];
        }, [make_list]);

    const isLoading = usersLoading || categoriesLoading || itemsLoading || quotesLoading || commentsLoading || categoryMakeListLoading || makeLoading;
    const error = usersError || categoriesError || itemsError || quotesError || commentsError || makeError || categoryMakeListError;

    return {
        usersList,
        categoryList,
        itemList,
        quoteData,
        universalComments,
        itemMutate,
        isLoading,
        error,
        make_list,
        allMakeOptions,
        categoryMakelist,
        categoryMakeListMutate,
        makeListMutate
    };
};