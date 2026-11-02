import { describe, expect, it } from "vitest";

import { paymentsTabSet, resolvePaymentsTab } from "./paymentsTabSet";

// Tab VALUES, written out as literals (not read from PP_TABS) so a renamed value fails here.
const APPROVE = "Approve Payments";
const CEO = "CEO Pending";
const TO_PAY = "New Payments";
const RECON = "Reconciliation Pending";
const DONE = "Payments Done";
const PENDING = "Payments Pending";
const PO_WISE = "PO Wise";
const ALL = "All Payments";
const BY_ME = "Payment By Me";

const viewer = (role: string, userId = "someone@nirmaan.app") => ({ role, userId });

describe("paymentsTabSet: the tab strip and landing tab per viewer", () => {
    // Expected values pin the strip as the page drew it before #1473 (2026-10-16), plus All Payments
    // right after "Payment Raised By Me" for its seven audiences (#1476).
    const cases: { who: string; v: { role: string; userId: string }; tabs: string[]; defaultTab: string }[] = [
        { who: "Administrator", v: viewer("Nirmaan Admin Profile", "Administrator"), tabs: [APPROVE, TO_PAY, RECON, DONE, BY_ME, ALL], defaultTab: APPROVE },
        { who: "Admin", v: viewer("Nirmaan Admin Profile"), tabs: [APPROVE, TO_PAY, RECON, DONE, BY_ME, ALL], defaultTab: APPROVE },
        { who: "CEO", v: viewer("Nirmaan Admin Profile", "nitesh@nirmaan.app"), tabs: [APPROVE, CEO, TO_PAY, RECON, DONE, BY_ME, ALL], defaultTab: CEO },
        { who: "Accountant", v: viewer("Nirmaan Accountant Profile"), tabs: [TO_PAY, RECON, DONE, BY_ME, ALL], defaultTab: TO_PAY },
        { who: "Accountant Lead", v: viewer("Nirmaan Accountant Lead Profile"), tabs: [TO_PAY, RECON, DONE, BY_ME, ALL], defaultTab: TO_PAY },
        // PMO: only its own requests (owner, 2026-10-31).
        { who: "PMO Executive", v: viewer("Nirmaan PMO Executive Profile"), tabs: [BY_ME], defaultTab: BY_ME },
        { who: "HR Executive", v: viewer("Nirmaan HR Executive Profile"), tabs: [RECON, DONE, BY_ME, ALL], defaultTab: BY_ME },
        { who: "HR Lead", v: viewer("Nirmaan HR Lead Profile"), tabs: [RECON, DONE, BY_ME, ALL], defaultTab: BY_ME },
        { who: "Procurement Executive", v: viewer("Nirmaan Procurement Executive Profile"), tabs: [DONE, BY_ME], defaultTab: DONE },
        { who: "Procurement Lead", v: viewer("Nirmaan Procurement Lead Profile"), tabs: [DONE, BY_ME], defaultTab: DONE },
        { who: "Material Procurement Executive", v: viewer("Nirmaan Material Procurement Executive Profile"), tabs: [DONE, BY_ME], defaultTab: DONE },
        { who: "Service Procurement Executive", v: viewer("Nirmaan Service Procurement Executive Profile"), tabs: [DONE, BY_ME], defaultTab: DONE },
        { who: "Project Lead", v: viewer("Nirmaan Project Lead Profile"), tabs: [DONE, BY_ME], defaultTab: DONE },
        { who: "Project Manager", v: viewer("Nirmaan Project Manager Profile"), tabs: [DONE, BY_ME], defaultTab: DONE },
        // A role still loading matches no rule: the two everyone-tabs, landing on the hidden PO Wise.
        { who: "a role still loading", v: viewer("Loading"), tabs: [DONE, BY_ME], defaultTab: PO_WISE },
    ];

    for (const c of cases) {
        it(`${c.who}: tabs ${c.tabs.join(" | ")}; lands on ${c.defaultTab}`, () => {
            const set = paymentsTabSet(c.v);
            expect(set.tabs).toEqual(c.tabs);
            expect(set.defaultTab).toBe(c.defaultTab);
        });
    }

    it("never shows the hidden tabs (PO Wise, Payments Pending) to anyone", () => {
        for (const c of cases) {
            const { tabs } = paymentsTabSet(c.v);
            expect(tabs).not.toContain(PO_WISE);
            expect(tabs).not.toContain(PENDING);
        }
    });

    it("shows All Payments to exactly its audiences, never to PMO, Procurement, Project Lead or Project Manager", () => {
        const audience = ["Administrator", "Admin", "CEO", "Accountant", "Accountant Lead", "HR Executive", "HR Lead"];
        const seeing = cases.filter((c) => paymentsTabSet(c.v).tabs.includes(ALL)).map((c) => c.who);
        // The CEO is an Admin, so it is in the Admin audience.
        expect(seeing).toEqual(audience);
    });

    it("HR Lead gets exactly HR Executive's tabs, landing and open-limit", () => {
        expect(paymentsTabSet(viewer("Nirmaan HR Lead Profile"))).toEqual(paymentsTabSet(viewer("Nirmaan HR Executive Profile")));
    });
});

describe("resolvePaymentsTab: what a requested ?tab= opens", () => {
    const hr = paymentsTabSet(viewer("Nirmaan HR Executive Profile"));

    it("an HR Executive's hand-edited ?tab= outside its set falls back to Payment Raised By Me", () => {
        for (const outside of [APPROVE, CEO, TO_PAY, PO_WISE, "Nonsense"]) {
            expect(resolvePaymentsTab(hr, outside)).toBe(BY_ME);
        }
    });

    it("an HR Executive opens any tab inside its set, All Payments and the hidden Payments Pending included", () => {
        for (const inside of [RECON, DONE, PENDING, BY_ME, ALL]) {
            expect(resolvePaymentsTab(hr, inside)).toBe(inside);
        }
    });

    it("an HR Lead's deep link to All Payments opens it", () => {
        expect(resolvePaymentsTab(paymentsTabSet(viewer("Nirmaan HR Lead Profile")), ALL)).toBe(ALL);
    });

    it("a PMO's ?tab= outside Payment Raised By Me falls back to it, Payment Done and All Payments included", () => {
        const pmo = paymentsTabSet(viewer("Nirmaan PMO Executive Profile"));
        for (const outside of [DONE, ALL, RECON, PENDING, PO_WISE, TO_PAY, APPROVE]) {
            expect(resolvePaymentsTab(pmo, outside)).toBe(BY_ME);
        }
        expect(resolvePaymentsTab(pmo, BY_ME)).toBe(BY_ME);
    });

    it("any other viewer opens what it asked for, so deep links to hidden tabs still resolve", () => {
        const accountant = paymentsTabSet(viewer("Nirmaan Accountant Profile"));
        const pm = paymentsTabSet(viewer("Nirmaan Project Manager Profile"));
        expect(resolvePaymentsTab(accountant, ALL)).toBe(ALL);
        expect(resolvePaymentsTab(pm, PO_WISE)).toBe(PO_WISE);
        // A tab the viewer has no button for is still returned; the page's body gate refuses it.
        expect(resolvePaymentsTab(pm, TO_PAY)).toBe(TO_PAY);
    });
});
