import { describe, expect, it } from "vitest";
import { canBulkDownloadVendor } from "@/constants/roles";
import { allowedBulkTypes, invoiceSubTypesFor, scopeFacet } from "./bulkDownloadTypes";

const ADMIN = "Nirmaan Admin Profile";
const PM = "Nirmaan Project Manager Profile";
const PMO = "Nirmaan PMO Executive Profile";
const ACCOUNTANT = "Nirmaan Accountant Profile";

const project = { kind: "project" as const };
const vendor = (vendorType?: string) => ({ kind: "vendor" as const, vendorType });

describe("allowedBulkTypes — project scope (the project tab)", () => {
    it("offers every type to Admin, in card order", () => {
        expect(allowedBulkTypes(project, ADMIN)).toEqual(["PO", "WO", "Invoice", "DC", "MIR", "DN", "ClientInvoice", "PaymentVoucher"]);
    });

    it("keeps the existing PM rule (no vendor or client invoices) and adds payment vouchers to it", () => {
        expect(allowedBulkTypes(project, PM)).toEqual(["PO", "WO", "DC", "MIR", "DN"]);
    });

    it("keeps the existing PMO rule: client invoices go, vendor invoices and vouchers stay", () => {
        expect(allowedBulkTypes(project, PMO)).toEqual(["PO", "WO", "Invoice", "DC", "MIR", "DN", "PaymentVoucher"]);
    });

    it("ignores a vendor type in project scope", () => {
        expect(allowedBulkTypes({ kind: "project", vendorType: "Service" }, ADMIN)).toEqual(allowedBulkTypes(project, ADMIN));
    });
});

describe("allowedBulkTypes — vendor scope (the vendor tab)", () => {
    it("never offers client invoices: Project Invoices have no vendor", () => {
        for (const t of ["Material", "Service", "Material & Service"]) {
            expect(allowedBulkTypes(vendor(t), ADMIN)).not.toContain("ClientInvoice");
        }
    });

    it("gates by vendor type the way the vendor page gates its tabs", () => {
        expect(allowedBulkTypes(vendor("Material"), ADMIN)).toEqual(["PO", "Invoice", "DC", "MIR", "DN"]);
        expect(allowedBulkTypes(vendor("Service"), ADMIN)).toEqual(["WO", "Invoice", "PaymentVoucher"]);
        expect(allowedBulkTypes(vendor("Material & Service"), ADMIN)).toEqual(["PO", "WO", "Invoice", "DC", "MIR", "DN", "PaymentVoucher"]);
    });

    it("leaves only vendor invoices for a vendor with no type (the vendor page shows neither orders tab)", () => {
        expect(allowedBulkTypes(vendor(undefined), ADMIN)).toEqual(["Invoice"]);
        expect(allowedBulkTypes(vendor(""), ADMIN)).toEqual(["Invoice"]);
    });

    it("applies the role rules on top of the vendor type", () => {
        expect(allowedBulkTypes(vendor("Service"), PM)).toEqual(["WO"]);
        expect(allowedBulkTypes(vendor("Service"), PMO)).toEqual(["WO", "Invoice", "PaymentVoucher"]);
        expect(allowedBulkTypes(vendor("Material & Service"), ACCOUNTANT)).toEqual(["PO", "WO", "Invoice", "DC", "MIR", "DN", "PaymentVoucher"]);
    });

    it("treats the role's Loading placeholder like any non-PM role (the vendor tab itself waits it out)", () => {
        expect(allowedBulkTypes(vendor("Service"), "Loading")).toEqual(["WO", "Invoice", "PaymentVoucher"]);
    });
});

describe("invoiceSubTypesFor", () => {
    it("offers all three choices on a project and on a Material & Service vendor", () => {
        expect(invoiceSubTypesFor(project)).toEqual(["All Invoices", "PO Invoices", "WO Invoices"]);
        expect(invoiceSubTypesFor(vendor("Material & Service"))).toEqual(["All Invoices", "PO Invoices", "WO Invoices"]);
    });

    it("drops the kind of invoice a single-type vendor cannot have, and always keeps the All default", () => {
        expect(invoiceSubTypesFor(vendor("Material"))).toEqual(["All Invoices", "PO Invoices"]);
        expect(invoiceSubTypesFor(vendor("Service"))).toEqual(["All Invoices", "WO Invoices"]);
    });
});

describe("scopeFacet", () => {
    it("facets a project's tables on the vendor and a vendor's on the project", () => {
        expect(scopeFacet("project")).toEqual({ id: "vendor", title: "Vendor" });
        expect(scopeFacet("vendor")).toEqual({ id: "project", title: "Project" });
    });
});

describe("canBulkDownloadVendor — who sees the vendor page's Bulk Download tab", () => {
    it("lets in Admin, PMO, Accountant (and Lead) and every procurement profile", () => {
        for (const role of [
            "Nirmaan Admin Profile",
            "Nirmaan PMO Executive Profile",
            "Nirmaan Accountant Profile",
            "Nirmaan Accountant Lead Profile",
            "Nirmaan Procurement Executive Profile",
            "Nirmaan Procurement Lead Profile",
            "Nirmaan Material Procurement Executive Profile",
            "Nirmaan Service Procurement Executive Profile",
        ]) {
            expect(canBulkDownloadVendor(role, "someone@nirmaan.app"), role).toBe(true);
        }
    });

    it("keeps out every other profile, including the ones a dashboard links to the vendor page", () => {
        for (const role of [
            "Nirmaan Project Manager Profile",
            "Nirmaan Project Lead Profile",
            "Nirmaan Estimates Executive Profile",
            "Nirmaan HR Executive Profile",
            "Nirmaan Design Executive Profile",
            "Nirmaan Billing Executive Profile",
            "Nirmaan Sales Executive Profile",
        ]) {
            expect(canBulkDownloadVendor(role, "someone@nirmaan.app"), role).toBe(false);
        }
    });

    it("refuses the role's Loading / Error placeholders and an empty role", () => {
        for (const role of ["Loading", "Error", "", null, undefined]) {
            expect(canBulkDownloadVendor(role, "someone@nirmaan.app")).toBe(false);
        }
    });

    it("always lets in the Administrator account", () => {
        expect(canBulkDownloadVendor("", "Administrator")).toBe(true);
    });
});
