import { describe, expect, it } from "vitest";

import { parseExistingCheque } from "./existingCheque";

describe("parseExistingCheque", () => {
    it("reads the recorded Cheque and the refusal", () => {
        const reply = {
            cheque: "CHQ-26-00007",
            cheque_no: "004521",
            bank_label: "ICICI Bank",
            status: "Issued",
            message: "Cheque 004521 (ICICI Bank) already exists.",
        };
        expect(parseExistingCheque(reply)).toEqual(reply);
    });

    it("is null when the bank + number is free", () => {
        expect(parseExistingCheque(null)).toBeNull();
        expect(parseExistingCheque(undefined)).toBeNull();
        expect(parseExistingCheque({})).toBeNull();
    });
});
