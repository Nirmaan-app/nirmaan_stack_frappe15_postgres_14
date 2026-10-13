import { describe, expect, it } from "vitest";

import { EMPTY_CHEQUE_FORM, type ChequeFormInput } from "./chequeForm";
import { isFromPhoto, parseChequePhotoReply, payeeMismatch, photoFill } from "./chequePhoto";

/** What `extract_payment_fields(mode="cheque")` sends for a clear ICICI cheque. */
const ICICI_REPLY = {
    bank: "ICICI Bank",
    bank_name: "",
    cheque_no: "004521",
    cheque_date: "2026-10-12",
    amount: 100000,
    payee_name: "Sharma Steel Traders",
    processor_id: "canned-model",
};

const form = (overrides: Partial<ChequeFormInput> = {}): ChequeFormInput => ({ ...EMPTY_CHEQUE_FORM, ...overrides });

describe("parseChequePhotoReply", () => {
    it("keeps only the fields the photo could read", () => {
        const photo = parseChequePhotoReply({ ...ICICI_REPLY, cheque_no: "", amount: null });
        expect(photo).toEqual({
            bank: "ICICI Bank",
            cheque_date: "2026-10-12",
            payee_name: "Sharma Steel Traders",
        });
    });

    it("reads an Others bank with its printed name", () => {
        const photo = parseChequePhotoReply({ ...ICICI_REPLY, bank: "Others", bank_name: "HDFC Bank" });
        expect(photo.bank).toBe("Others");
        expect(photo.bank_name).toBe("HDFC Bank");
    });

    it("reads nothing from a reply that is not an object", () => {
        expect(parseChequePhotoReply(undefined)).toEqual({});
    });
});

describe("photoFill", () => {
    it("fills bank, number, date, amount and payee from the photo", () => {
        const fill = photoFill(form(), null, parseChequePhotoReply(ICICI_REPLY));
        expect(fill).toEqual({
            bank: "ICICI Bank",
            bank_name: "",
            cheque_no: "004521",
            cheque_date: "2026-10-12",
            amount: 100000,
            payee_name: "Sharma Steel Traders",
        });
    });

    it("leaves a field the photo is unsure of as the user has it", () => {
        const fill = photoFill(form({ cheque_no: "778899" }), null, parseChequePhotoReply({ ...ICICI_REPLY, cheque_no: "" }));
        expect(fill).not.toHaveProperty("cheque_no");
    });

    it("on a replaced photo, clears what only the old photo said and fills what the new one says", () => {
        const oldPhoto = parseChequePhotoReply(ICICI_REPLY);
        const current = form({ ...photoFill(form(), null, oldPhoto), cheque_date: "2026-10-20" });
        const newPhoto = parseChequePhotoReply({ ...ICICI_REPLY, cheque_no: "", cheque_date: "", amount: 90000 });

        const fill = photoFill(current, oldPhoto, newPhoto);

        expect(fill.cheque_no).toBe(""); // the old photo's number is not the new cheque's
        expect(fill).not.toHaveProperty("cheque_date"); // typed by the user: kept
        expect(fill.amount).toBe(90000);
    });
});

describe("payeeMismatch", () => {
    const reply = (match: boolean | null) => ({
        expected_name: "Sharma Steel Traders",
        expected_account_name: "",
        extracted: "Tata Power",
        match,
        by: null,
    });

    it("warns only when the payee clearly is not the Vendor", () => {
        expect(payeeMismatch(reply(false))).toEqual({ payee: "Tata Power", vendorName: "Sharma Steel Traders" });
    });

    it("stays quiet on a match or when it cannot tell", () => {
        expect(payeeMismatch(reply(true))).toBeNull();
        expect(payeeMismatch(reply(null))).toBeNull();
        expect(payeeMismatch(undefined)).toBeNull();
    });
});

describe("isFromPhoto", () => {
    const photo = parseChequePhotoReply({ ...ICICI_REPLY, bank: "Others", bank_name: "HDFC Bank" });
    const filled = form({ ...photoFill(form(), null, photo) });

    it("tags each field while it still holds what the photo said", () => {
        expect(isFromPhoto("bank", filled, photo)).toBe(true);
        expect(isFromPhoto("cheque_no", filled, photo)).toBe(true);
        expect(isFromPhoto("cheque_date", filled, photo)).toBe(true);
        expect(isFromPhoto("amount", filled, photo)).toBe(true);
        expect(isFromPhoto("payee_name", filled, photo)).toBe(true);
    });

    it("drops the tag once the user changes the field", () => {
        expect(isFromPhoto("cheque_no", { ...filled, cheque_no: "004522" }, photo)).toBe(false);
        expect(isFromPhoto("bank", { ...filled, bank_name: "Axis Bank" }, photo)).toBe(false);
    });

    it("keeps the tag on an amount the input holds as text", () => {
        expect(isFromPhoto("amount", { ...filled, amount: "100000" as unknown as number }, photo)).toBe(true);
    });

    it("tags nothing before a photo is read", () => {
        expect(isFromPhoto("cheque_no", filled, null)).toBe(false);
    });
});
