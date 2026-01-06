
import { useFrappePostCall } from "frappe-react-sdk";
import { useEffect, useMemo, useState } from "react";
import { parseNumber } from "@/utils/parseNumber";

export const useProjectAllCredits = (projectId: string | undefined) => {
    const { call: fetchCreditTerms, loading: creditsLoading, error } = useFrappePostCall<{ message: { keys: string[], values: any[][] } }>(
        "frappe.desk.reportview.get"
    );

    const [creditTerms, setCreditTerms] = useState<any[]>([]);

    useEffect(() => {
        const filters: any[] = [
            ["PO Payment Terms", "payment_type", "=", "Credit"],
            ["status", "not in", ["Merged", "Inactive", "PO Amendment"]]
        ];

        if (projectId) {
            filters.push(["project", "=", projectId]);
        }

        fetchCreditTerms({
            doctype: "Procurement Orders",
            fields: [
                "name", 
                "project", 
                "modified",
                "`tabPO Payment Terms`.amount", 
                "`tabPO Payment Terms`.term_status",
                "`tabPO Payment Terms`.due_date"
            ],
            filters: filters,
            page_length: 5000,
            start: 0
        }).then((res) => {
            if (res?.message) {
                const { keys, values } = res.message;
                // Map values to objects
                const mappedData = values.map((row) => {
                    const obj: any = {};
                    keys.forEach((key, index) => {
                        // Clean up key names if they contain backticks or tab names for easier access
                        // e.g., `tabPO Payment Terms`.amount -> amount
                        let cleanKey = key;
                        if (key.includes("`tabPO Payment Terms`.")) {
                            cleanKey = key.split(".")[1];
                        }
                        obj[cleanKey] = row[index];
                        // Also keep original key just in case
                        obj[key] = row[index];
                    });
                    return obj;
                });
                setCreditTerms(mappedData);
            }
        }).catch(e => {
            console.error("Failed to fetch credit terms:", e);
            setCreditTerms([]);
        });
    }, [projectId]);

    const totals = useMemo(() => {
        const totalPurchase = creditTerms.reduce((sum, term) => sum + parseNumber(term.amount), 0);
        const due = creditTerms
            .filter(cr => cr.term_status == "Scheduled")
            .reduce((sum, term) => sum + parseNumber(term.amount), 0);
        const paid = creditTerms
            .filter(cr => cr.term_status === "Paid")
            .reduce((sum, term) => sum + parseNumber(term.amount), 0);
            
        return {
            totalPurchase,
            due,
            paid,
            count: creditTerms.length
        };
    }, [creditTerms]);

    return {
        creditTerms,
        totals,
        loading: creditsLoading,
        error
    };
};
