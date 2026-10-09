import { describe, expect, it } from "vitest";
import { canBulkDownloadVendor } from "@/constants/roles";
import { BULK_DOC_TYPES, MENU_GROUPS, allowedBulkTypes, compareMtcs, invoiceSubTypesFor, menuGroups, scopeFacet } from "./bulkDownloadTypes";

const ADMIN = "Nirmaan Admin Profile";
const PM = "Nirmaan Project Manager Profile";
const PMO = "Nirmaan PMO Executive Profile";
const ACCOUNTANT = "Nirmaan Accountant Profile";

const project = { kind: "project" as const };
const vendor = (vendorType?: string) => ({ kind: "vendor" as const, vendorType });

describe("allowedBulkTypes — project scope (the project tab)", () => {
    it("offers every type to Admin, in card order", () => {
        expect(allowedBulkTypes(project, ADMIN)).toEqual(["PO", "WO", "Invoice", "DC", "MIR", "DN", "MTC", "ClientInvoice", "POPaymentVoucher", "WOPaymentVoucher"]);
    });

    it("keeps the existing PM rule (no vendor or client invoices) and adds both kinds of payment voucher to it", () => {
        expect(allowedBulkTypes(project, PM)).toEqual(["PO", "WO", "DC", "MIR", "DN", "MTC"]);
    });

    it("offers Material Test Certificates to every role, the PM included (no prices on a certificate)", () => {
        for (const role of [ADMIN, PM, PMO, ACCOUNTANT]) {
            expect(allowedBulkTypes(project, role), role).toContain("MTC");
        }
    });

    it("keeps the existing PMO rule: client invoices go, vendor invoices and vouchers stay", () => {
        expect(allowedBulkTypes(project, PMO)).toEqual(["PO", "WO", "Invoice", "DC", "MIR", "DN", "MTC", "POPaymentVoucher", "WOPaymentVoucher"]);
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
        expect(allowedBulkTypes(vendor("Material"), ADMIN)).toEqual(["PO", "Invoice", "DC", "MIR", "DN", "MTC", "POPaymentVoucher"]);
        expect(allowedBulkTypes(vendor("Service"), ADMIN)).toEqual(["WO", "Invoice", "WOPaymentVoucher"]);
        expect(allowedBulkTypes(vendor("Material & Service"), ADMIN)).toEqual(["PO", "WO", "Invoice", "DC", "MIR", "DN", "MTC", "POPaymentVoucher", "WOPaymentVoucher"]);
    });

    it("leaves only vendor invoices for a vendor with no type (the vendor page shows neither orders tab)", () => {
        expect(allowedBulkTypes(vendor(undefined), ADMIN)).toEqual(["Invoice"]);
        expect(allowedBulkTypes(vendor(""), ADMIN)).toEqual(["Invoice"]);
    });

    it("applies the role rules on top of the vendor type", () => {
        expect(allowedBulkTypes(vendor("Service"), PM)).toEqual(["WO"]);
        expect(allowedBulkTypes(vendor("Service"), PMO)).toEqual(["WO", "Invoice", "WOPaymentVoucher"]);
        expect(allowedBulkTypes(vendor("Material & Service"), ACCOUNTANT)).toEqual(["PO", "WO", "Invoice", "DC", "MIR", "DN", "MTC", "POPaymentVoucher", "WOPaymentVoucher"]);
    });

    it("treats the role's Loading placeholder like any non-PM role (the vendor tab itself waits it out)", () => {
        expect(allowedBulkTypes(vendor("Service"), "Loading")).toEqual(["WO", "Invoice", "WOPaymentVoucher"]);
    });
});

describe("payment vouchers: PO payments on the PO side, WO payments on the WO side", () => {
    it("offers PO payment vouchers where POs are (Material vendors) and WO ones where WOs are (Service vendors)", () => {
        for (const [vendorType, po, wo] of [["Material", true, false], ["Service", false, true], ["Material & Service", true, true], ["", false, false]] as const) {
            const types = allowedBulkTypes(vendor(vendorType), ADMIN);
            expect(types.includes("POPaymentVoucher"), `${vendorType || "no type"}: PO`).toBe(po);
            expect(types.includes("WOPaymentVoucher"), `${vendorType || "no type"}: WO`).toBe(wo);
            expect(types.includes("POPaymentVoucher"), `${vendorType}: PO card follows the PO card`).toBe(types.includes("PO"));
        }
    });

    it("gives a Project Manager neither kind, on either tab", () => {
        for (const scope of [project, vendor("Material & Service")]) {
            const types = allowedBulkTypes(scope, PM);
            expect(types).not.toContain("POPaymentVoucher");
            expect(types).not.toContain("WOPaymentVoucher");
        }
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

describe("Material Test Certificates follow the Delivery Challans rule (owner)", () => {
    const ROLES = [
        "Nirmaan Admin Profile", "Nirmaan PMO Executive Profile", "Nirmaan Project Manager Profile",
        "Nirmaan Project Lead Profile", "Nirmaan Accountant Profile", "Nirmaan Accountant Lead Profile",
        "Nirmaan Procurement Executive Profile", "Nirmaan Procurement Lead Profile", "Nirmaan Estimates Executive Profile",
        "Nirmaan Billing Executive Profile", "Loading",
    ];
    const SCOPES = [
        { kind: "project" as const },
        ...["Material", "Service", "Material & Service", "", undefined].map((vendorType) => ({ kind: "vendor" as const, vendorType })),
    ];

    it("shows the MTC card and Quick menu item exactly where the DC ones show, for every role and scope", () => {
        for (const role of ROLES) {
            for (const scope of SCOPES) {
                const types = allowedBulkTypes(scope, role);
                expect(types.includes("MTC"), `${role} / ${scope.kind} ${"vendorType" in scope ? scope.vendorType : ""}`).toBe(types.includes("DC"));
            }
        }
    });

    it("sits right after Delivery Notes in the card and menu order", () => {
        const all = allowedBulkTypes({ kind: "project" }, "Nirmaan Admin Profile");
        expect(all.indexOf("MTC")).toBe(all.indexOf("DN") + 1);
    });
});

describe("compareMtcs — the wizard lists certificates in the order the PDF holds them", () => {
    it("puts the oldest certificate date first, ties by upload time, and undated certificates last", () => {
        const rows = [
            { id: "undated-early", certificate_date: null, creation: "2026-10-07 10:00:00" },
            { id: "oct-7-late", certificate_date: "2026-10-07", creation: "2026-10-07 18:03:00" },
            { id: "oct-7-early", certificate_date: "2026-10-07", creation: "2026-10-07 17:02:00" },
            { id: "sep-1", certificate_date: "2026-09-01", creation: "2026-10-08 09:00:00" },
            { id: "undated-empty", certificate_date: "", creation: "2026-10-07 11:00:00" },
        ];
        expect([...rows].sort(compareMtcs).map((r) => r.id)).toEqual(["sep-1", "oct-7-early", "oct-7-late", "undated-early", "undated-empty"]);
    });
});

describe("menuGroups — the Quick Download menu's sections", () => {
    it("puts every type in exactly one section, so a new type cannot drop out of the menu", () => {
        const placed = MENU_GROUPS.flatMap((g) => g.types);
        expect([...placed].sort()).toEqual([...BULK_DOC_TYPES].sort());
    });

    it("Admin on a project gets all three sections", () => {
        expect(menuGroups(allowedBulkTypes(project, ADMIN))).toEqual([
            { label: "Orders", types: ["PO", "WO"] },
            { label: "Delivery & Quality", types: ["DC", "MIR", "DN", "MTC"] },
            { label: "Finance", types: ["Invoice", "ClientInvoice", "POPaymentVoucher", "WOPaymentVoucher"] },
        ]);
    });

    it("a Project Manager has no Finance section at all", () => {
        expect(menuGroups(allowedBulkTypes(project, PM)).map((g) => g.label)).toEqual(["Orders", "Delivery & Quality"]);
    });

    it("a Service vendor keeps only what a service vendor has", () => {
        expect(menuGroups(allowedBulkTypes(vendor("Service"), ADMIN))).toEqual([
            { label: "Orders", types: ["WO"] },
            { label: "Finance", types: ["Invoice", "WOPaymentVoucher"] },
        ]);
    });
});
