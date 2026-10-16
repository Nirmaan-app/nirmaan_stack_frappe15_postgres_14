import { describe, expect, it } from "vitest";

import { directExpenseErrorToast } from "./directExpense";
import { DuplicatePayeeError } from "./payToChoice";

describe("directExpenseErrorToast", () => {
    it("says a duplicate account is already a payee, in the duplicate's own words", () => {
        const error = new DuplicatePayeeError("This account is already Payee PYE-0412 (Ramesh Kumar Yadav).");
        expect(directExpenseErrorToast(error, "Error", "Failed to record expense.")).toEqual({
            title: "This account is already a payee",
            description: "This account is already Payee PYE-0412 (Ramesh Kumar Yadav).",
            variant: "destructive",
        });
    });

    it("gives the server's reason under the screen's title for any other failure", () => {
        const error = {
            exc_type: "ValidationError",
            _server_messages: JSON.stringify([JSON.stringify({ message: "This expense type needs a payee." })]),
        };
        expect(directExpenseErrorToast(error, "Failed!", "Failed to add expense.")).toEqual({
            title: "Failed!",
            description: "This expense type needs a payee.",
            variant: "destructive",
        });
    });
});
