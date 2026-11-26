import { describe, expect, it } from "vitest";

import {
    billCheckText,
    cashbookDetailRows,
    cashbookOutcome,
    defaultMoveType,
    defaultTransferDetail,
    INTERNAL_TRANSFER_TARGET,
    moveTargets,
    transferChosenEnd,
    learnPhraseLabel,
    learnsPhrase,
    suggestedPhrase,
    type CashbookPlanLine,
} from "./cashbookRectify";
import { CARD_SOURCE } from "./creditCardImport";
import { lineMoveLabel, rectifyAffordance, rectifyButtonState, toolbarMoveLabel } from "./porterRectify";

const PE = "Project Expenses";
const NPE = "Non Project Expenses";

const spend: CashbookPlanLine = {
    row: "OFR-1",
    txn_id: "OBO-TEST-1",
    refusal: null,
    amount: 2380,
    ledger: NPE,
    project: null,
    project_name: null,
    expense: "NPE-1",
    date: "2026-10-05",
    kind: "Wallet Spend",
    money_in: false,
    spender: "Meera Iyer",
    counterparty: "TESTPAYEE COURIER ONE",
    remark: "Courier charges for the site",
    expense_type: "Petty Cash",
    bill: { file: "/private/files/bill.jpeg", check: "Mismatched", check_reason: "The bill says Rs 1,999." },
};

describe("the wallet spend's details (story 42)", () => {
    it("shows date, spender, who was paid, amount and Remark", () => {
        expect(cashbookDetailRows(spend)).toEqual([
            { label: "Date", value: "05-Oct-2026" },
            { label: "Spent by", value: "Meera Iyer" },
            { label: "Paid to", value: "TESTPAYEE COURIER ONE" },
            { label: "Amount", value: "₹2,380" },
            { label: "Remark", value: "Courier charges for the site" },
        ]);
    });

    it("says money coming back in its own words, as a negative amount", () => {
        const refund = { ...spend, amount: -640, money_in: true, spender: "Asha Menon", counterparty: "Testshop" };
        expect(cashbookDetailRows(refund).slice(1, 4)).toEqual([
            { label: "Back to", value: "Asha Menon" },
            { label: "From", value: "Testshop" },
            { label: "Amount", value: "-₹640" },
        ]);
    });

    it("gives the Bill check verdict with its remark, or says there is no bill", () => {
        expect(billCheckText(spend.bill)).toBe("Mismatched: The bill says Rs 1,999.");
        expect(billCheckText({ file: "/f", check: "Matched", check_reason: "" })).toBe("Matched");
        expect(billCheckText(null)).toBe("No bill");
    });
});

describe("Move in Bulk Import (stories 1, 3, 7, 9)", () => {
    const cashbook = (name: string, ledger: string, row_status = "Settled") => ({
        name,
        row_status,
        source: "Cashbook",
        suggested_doctype: ledger,
    });
    const porter = (name: string) => ({ name, row_status: "Settled", source: "Porter Statement", suggested_doctype: NPE });
    const bank = (name: string) => ({ name, row_status: "Settled", source: "Cashfree", suggested_doctype: NPE });

    it("is offered on a Settled Cashbook line to the undo roles only", () => {
        expect(rectifyAffordance(cashbook("a", NPE), true)).toBe(true);
        expect(rectifyAffordance(cashbook("a", NPE), false)).toBe(false);
        expect(rectifyAffordance(cashbook("a", NPE, "Skipped"), true)).toBe(false);
    });

    it("labels the line's button by where its expense is, a Porter line too (#1759)", () => {
        expect(lineMoveLabel(cashbook("a", NPE))).toBe("Move to a project");
        expect(lineMoveLabel(cashbook("a", PE))).toBe("Change project");
        expect(lineMoveLabel(porter("p"))).toBe("Move to a project");
        expect(lineMoveLabel({ ...porter("q"), suggested_doctype: PE })).toBe("Change project");
    });

    it("moves ticked Cashbook lines together under the label rule", () => {
        const page = [cashbook("a", NPE), cashbook("b", PE), bank("c"), porter("p")];
        expect(rectifyButtonState(page, new Set(["a", "b"]), new Map(), 1)).toEqual({
            visible: true,
            enabled: true,
            count: 2,
            note: null,
        });
        expect(toolbarMoveLabel(page, new Set(["a", "b"]))).toBe("Move 2 expenses");
        expect(toolbarMoveLabel(page, new Set(["a"]))).toBe("Move to a project");
        expect(toolbarMoveLabel(page, new Set(["p"]))).toBe("Move to a project");
    });

    it("words the toolbar over ticked Porter lines by the same rule (#1759)", () => {
        const page = [porter("p"), { ...porter("q"), suggested_doctype: PE }, { ...porter("r"), suggested_doctype: PE }];
        expect(toolbarMoveLabel(page, new Set(["q", "r"]))).toBe("Change project");
        expect(toolbarMoveLabel(page, new Set(["p", "q"]))).toBe("Move 2 expenses");
    });

    it("words a line of every wired source by the one rule: Porter, Cashbook, card, ICICI and Cashfree", () => {
        const sources = ["Porter Statement", "Cashbook", CARD_SOURCE, "ICICI Bank Statement", "Cashfree"];
        const lines = (ledger: string) =>
            sources.map((source, i) => ({
                name: `${ledger}-${i}`,
                row_status: "Settled",
                source,
                suggested_doctype: ledger,
                matches: [{ target_doctype: ledger, created_by_import: 1 as const }],
            }));
        for (const line of lines(NPE)) expect(lineMoveLabel(line)).toBe("Move to a project");
        for (const line of lines(PE)) expect(lineMoveLabel(line)).toBe("Change project");
        const page = [...lines(NPE), ...lines(PE)];
        expect(toolbarMoveLabel(page, new Set(page.map((line) => line.name)))).toBe("Move 10 expenses");
    });

    it("words the toolbar by the movable lines alone, a ticked bank line aside", () => {
        const page = [{ ...porter("p"), suggested_doctype: PE }, { ...bank("c"), suggested_doctype: "Project Payments" }];
        expect(toolbarMoveLabel(page, new Set(["p", "c"]))).toBe("Change project");
    });

    it("is off while a line of another kind is ticked with them, and says why", () => {
        const page = [cashbook("a", NPE), bank("c"), porter("p")];
        expect(rectifyButtonState(page, new Set(["a", "c"]), new Map(), 1).note).toBe(
            "Moving works on Cashbook lines only: untick the 1 other line.",
        );
        expect(rectifyButtonState(page, new Set(["a", "p"]), new Map(), 1).enabled).toBe(false);
    });
});

describe("the type offered (story 15)", () => {
    const types = { [PE]: ["Material Purchases", "Petty Cash"], [NPE]: ["Petty Cash", "Postage & Courier"] };

    it("is the lines' own type when the destination ledger takes it", () => {
        expect(defaultMoveType([spend], PE, types)).toBe("Petty Cash");
    });

    it("is blank when the destination does not take it, or the lines differ", () => {
        const courier = { ...spend, expense_type: "Postage & Courier" };
        expect(defaultMoveType([courier], PE, types)).toBe("");
        expect(defaultMoveType([spend, courier], NPE, types)).toBe("");
    });
});

describe("what a run reports (story 26)", () => {
    it("counts the expenses moved, and lists each one refused in the server's words", () => {
        const outcome = cashbookOutcome(
            {
                count: 3,
                lines: [
                    { row: "OFR-1", rectified: true },
                    { row: "OFR-2", rectified: true },
                    { row: "OFR-3", rectified: false, reason: "This expense is Approved, not Paid, so it cannot be moved." },
                ],
            },
            "Testorchid Heights",
        );
        expect(outcome.title).toBe("2 expenses moved to Testorchid Heights.");
        expect(outcome.failed).toEqual([
            { row: "OFR-3", reason: "This expense is Approved, not Paid, so it cannot be moved." },
        ]);
        expect(cashbookOutcome({ count: 1, lines: [{ row: "OFR-1", rectified: true }] }, null).title).toBe(
            "1 expense moved to Non Project.",
        );
    });
});

describe("the Internal Transfer destination (#1762, stories 13, 27-28)", () => {
    const transfer = { own_place: "Cashbook Employee Wallet", other_ends: ["ICICI Credit Card", "ICICI Current Account"] };
    const refund: CashbookPlanLine = { ...spend, row: "OFR-2", money_in: true, transfer_detail: "Meera Iyer" };

    it("is offered after the projects only when the plan offers it", () => {
        const projects = [{ value: "", label: "No project" }, { value: "PROJ-1", label: "Testorchid Heights" }];
        expect(moveTargets(projects, transfer).map((option) => option.value)).toEqual([
            "",
            "PROJ-1",
            INTERNAL_TRANSFER_TARGET,
        ]);
        expect(moveTargets(projects, null)).toEqual(projects);
    });

    it("the person chooses where a spend went, where a refund came from, and either end for a spend with its refund", () => {
        expect(transferChosenEnd([spend])).toBe("to");
        expect(transferChosenEnd([refund])).toBe("from");
        expect(transferChosenEnd([spend, refund])).toBe("either");
    });

    it("the detail starts as the lines' shared one, as Mark starts it, else blank", () => {
        expect(defaultTransferDetail([{ ...spend, transfer_detail: "Meera Iyer" }])).toBe("Meera Iyer");
        expect(defaultTransferDetail([{ ...spend, transfer_detail: "Meera Iyer" }, { ...refund, transfer_detail: "Asha Menon" }])).toBe("");
    });

    it("a run reports the lines that became transfers", () => {
        expect(
            cashbookOutcome({ count: 1, lines: [{ row: "OFR-1", rectified: true }] }, INTERNAL_TRANSFER_TARGET).title,
        ).toBe("1 expense moved to Internal Transfer.");
    });
});

describe("the phrase a Move to a project teaches (#1758, spec #1753 stories 47-52)", () => {
    it("is offered only for Cashbook lines moving to a project: never No project, Internal Transfer or another source", () => {
        expect(learnsPhrase("Cashbook", "PROJ-1")).toBe(true);
        expect(learnsPhrase("Cashbook", "")).toBe(false);
        expect(learnsPhrase("Cashbook", undefined)).toBe(false);
        expect(learnsPhrase("Cashbook", INTERNAL_TRANSFER_TARGET)).toBe(false);
        for (const source of ["Porter Statement", CARD_SOURCE, "ICICI Bank Statement", "Cashfree", undefined]) {
            expect(learnsPhrase(source, "PROJ-1")).toBe(false);
        }
    });

    const withRemark = (remark: string): CashbookPlanLine => ({ ...spend, remark });

    it("is pre-filled with the remark's words that name the destination project, as the remark writes them", () => {
        expect(suggestedPhrase([withRemark("VR Mall local purchase")], "VR Mall Food Court")).toBe("VR Mall");
        expect(suggestedPhrase([withRemark("Paid for tea, testorchid")], "Testorchid Heights")).toBe("testorchid");
    });

    it("takes the longest run of such words, the first on a tie", () => {
        expect(suggestedPhrase([withRemark("food for vr-mall staff")], "VR Mall Food Court")).toBe("vr-mall");
        expect(suggestedPhrase([withRemark("court fees mall")], "VR Mall Food Court")).toBe("court");
    });

    it("with no word of the name in any remark, takes the remark word closest in spelling to a word of the name", () => {
        expect(suggestedPhrase([withRemark("hexware tea")], "Hexaware GIFT City")).toBe("hexware");
        expect(suggestedPhrase([withRemark("Macoons site, cement")], "Maconns Noida")).toBe("Macoons");
        expect(suggestedPhrase([withRemark("tea for hexawrae")], "Hexaware GIFT City")).toBe("hexawrae");
        // The closest of two near words.
        expect(suggestedPhrase([withRemark("hexawar hexware")], "Hexaware GIFT City")).toBe("hexawar");
    });

    it("is blank when no remark word is near enough in spelling, so the person types it", () => {
        expect(suggestedPhrase([withRemark("sfk tea")], "Testorchid Heights")).toBe("");
        expect(suggestedPhrase([withRemark("")], "Hexaware GIFT City")).toBe("");
        // Short words need the exact spelling: one slip in a four-letter word is too far.
        expect(suggestedPhrase([withRemark("gilt items")], "Hexaware GIFT City")).toBe("");
        // Two slips in seven letters is too far.
        expect(suggestedPhrase([withRemark("hixwere")], "Hexaware GIFT City")).toBe("");
    });

    it("does not guess a spelling once a remark word is in the name, even in a run it skipped", () => {
        expect(suggestedPhrase([withRemark("mall hexware")], "Hexaware Mall", ["Testpearl Mall"])).toBe("");
    });

    it("does not guess a remark word another Won project's name spells as near or nearer", () => {
        expect(suggestedPhrase([withRemark("testtower124 tea")], "Testtower123 Depot", ["Testtower124 Plaza"])).toBe("");
        expect(suggestedPhrase([withRemark("testtowr123 tea")], "Testtower123 Depot", ["Testtower124 Plaza"])).toBe(
            "testtowr123",
        );
    });

    it("does not guess a word another Won project's name holds too", () => {
        expect(suggestedPhrase([withRemark("malls")], "Hexaware Mall", ["Testpearl Mall"])).toBe("");
    });

    it("comes from the first moving line whose remark names the project", () => {
        const lines = [withRemark("Pay via Razorpay"), withRemark("testlotus material")];
        expect(suggestedPhrase(lines, "Testlotus Annexe")).toBe("testlotus");
    });

    it("never pre-fills a run whose every word another Won project's name also holds", () => {
        const others = ["Testpearl Mall Annexe"];
        expect(suggestedPhrase([withRemark("mall tea")], "VR Mall Food Court", others)).toBe("");
        expect(suggestedPhrase([withRemark("mall tea, then vr mall")], "VR Mall Food Court", others)).toBe("vr mall");
        // Each word in some other name, but no one other name holds both: it names only this project.
        expect(suggestedPhrase([withRemark("vr mall")], "VR Mall Food Court", ["VR Heights", "Testpearl Mall"])).toBe(
            "vr mall",
        );
    });

    it("reads the box's sentence with the phrase in it", () => {
        expect(learnPhraseLabel("vr mall")).toBe("Next time, put spends that mention “vr mall” on this project");
        expect(learnPhraseLabel("  ")).toBe("Next time, put spends that mention [phrase] on this project");
    });

    it("says in the outcome what was learned, or why not", () => {
        const moved = { count: 1, lines: [{ row: "OFR-1", rectified: true }] };
        expect(cashbookOutcome({ ...moved, phrase: { phrase: "vr mall", saved: true } }, "VR Mall Food Court").notes)
            .toEqual(["Next time, spends that mention “vr mall” go to VR Mall Food Court."]);
        expect(cashbookOutcome({ ...moved, phrase: { phrase: "vr mall", saved: false } }, "VR Mall Food Court").notes)
            .toEqual(["“vr mall” already puts spends on VR Mall Food Court."]);
        expect(
            cashbookOutcome(
                { ...moved, phrase: { phrase: "vr mall", saved: false, reason: "'vr mall' already puts spends on X." } },
                "VR Mall Food Court",
            ).notes,
        ).toEqual(["The phrase was not saved: 'vr mall' already puts spends on X."]);
        expect(cashbookOutcome(moved, "VR Mall Food Court").notes).toEqual([]);
    });
});
