/**
 * Read again (#1645, GLOSSARY *Read again*): sends a Not read Expense bill back to its Bill check, where it is
 * Checking until the new result. Used by Pending Approval and All Invoices -> Cashbook / Credit Card; each passes
 * the refresh of its own list.
 */
import { useCallback, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";

import { useToast } from "@/components/ui/use-toast";
import { getFrappeError } from "@/utils/frappeErrors";

export const useReadExpenseBillAgain = (onRead: () => void) => {
    const { toast } = useToast();
    const { call } = useFrappePostCall("nirmaan_stack.api.expenses.expense_bill_approval.read_expense_bill_again");
    const [readingAgainBill, setReadingAgainBill] = useState<string | null>(null);

    const onReadAgain = useCallback(async ({ name }: { name: string }) => {
        setReadingAgainBill(name);
        try {
            await call({ bill: name });
            toast({ title: "Reading the bill again", description: `${name} is Checking; its new result shows here once read.`, variant: "success" });
            onRead();
        } catch (e) {
            toast({ title: "Could not read the bill again", description: getFrappeError(e), variant: "destructive" });
        } finally {
            setReadingAgainBill(null);
        }
    }, [call, onRead, toast]);

    return { onReadAgain, readingAgainBill };
};
