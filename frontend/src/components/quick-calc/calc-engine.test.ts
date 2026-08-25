import { describe, expect, it } from "vitest";
import {
    CalcError,
    evaluateExpression,
    formatResult,
    normaliseExpression,
    sanitiseExpressionInput,
    toClipboardValue,
    toDisplayOperators,
    tryEvaluate,
} from "./calc-engine";

describe("percent semantics", () => {
    // These seven rows are the contract the design doc publishes. If one of them
    // changes, the documented behaviour changed with it.
    it("reads `a * b%` as b percent OF a -- GST on a line item", () => {
        expect(evaluateExpression("12500*18%")).toBe(2250);
        expect(evaluateExpression("10000*18%")).toBe(1800);
    });

    it("reads `a + b%` as a plus b percent of itself -- amount including GST", () => {
        expect(evaluateExpression("12500+18%")).toBe(14750);
    });

    it("reads `a - b%` as a less b percent of itself -- retention", () => {
        expect(evaluateExpression("12500-2.5%")).toBe(12187.5);
    });

    it("reads a bare percentage as a fraction", () => {
        expect(evaluateExpression("18%")).toBe(0.18);
    });

    it("handles brackets, plain multiplication and quantity x rate", () => {
        expect(evaluateExpression("(5000+2500)/3")).toBe(2500);
        expect(evaluateExpression("80000*1.18")).toBe(94400);
        expect(evaluateExpression("250*50")).toBe(12500);
    });

    it("divides by a percentage -- working backwards from a GST-inclusive figure", () => {
        expect(evaluateExpression("2250/18%")).toBe(12500);
    });
});

describe("how people actually type", () => {
    it("ignores spaces, commas and underscores", () => {
        expect(evaluateExpression("1000 + 2500")).toBe(3500);
        expect(evaluateExpression("12,500 + 800")).toBe(13300);
        expect(evaluateExpression("1_00_000-18500")).toBe(81500);
    });

    it("accepts x, X and the display glyphs as operators", () => {
        expect(evaluateExpression("3x4")).toBe(12);
        expect(evaluateExpression("12500×18%")).toBe(2250);
        expect(evaluateExpression("100÷4")).toBe(25);
        expect(evaluateExpression("100−40")).toBe(60);
    });

    it("multiplies implicitly before a bracket", () => {
        expect(evaluateExpression("2(3+4)")).toBe(14);
    });

    it("nests unary minus and brackets", () => {
        expect(evaluateExpression("-5+10")).toBe(5);
        expect(evaluateExpression("--5")).toBe(5);
        expect(evaluateExpression("((2+3)*4)-5")).toBe(15);
        expect(evaluateExpression("10*-2")).toBe(-20);
    });

    it("respects operator precedence", () => {
        expect(evaluateExpression("100+200/4")).toBe(150);
        expect(evaluateExpression("2+3*4")).toBe(14);
    });
});

describe("floating-point dust", () => {
    it("settles the classic cases", () => {
        expect(evaluateExpression("0.1+0.2")).toBe(0.3);
        expect(evaluateExpression("1.1*3")).toBe(3.3);
    });

    it("keeps a genuinely repeating result at full working precision", () => {
        expect(evaluateExpression("100/3")).toBeCloseTo(33.333333333333, 9);
    });
});

describe("rejections", () => {
    const cases: Array<[string, string]> = [
        ["", "Nothing to calculate yet"],
        ["1+", "The expression stops early — it needs a number"],
        ["(1+2", 'Missing a closing ")"'],
        ["1+2)", "There is extra input after the expression"],
        ["%", '"%" needs a number before it'],
        ["5/0", "Division by zero"],
        ["1..2", '"1..2" has more than one decimal point'],
        ["£50", '"£" is not something the calculator can use'],
        ["*3", '"*" needs a number before it'],
        ["1+*2", '"*" needs a number before it'],
    ];

    it.each(cases)("rejects %j with a plain-English message", (input, message) => {
        expect(() => evaluateExpression(input)).toThrow(CalcError);
        expect(() => evaluateExpression(input)).toThrow(message);
    });

    it("never throws through tryEvaluate", () => {
        expect(tryEvaluate("5/0")).toEqual({ ok: false, message: "Division by zero" });
        expect(tryEvaluate("2+2")).toEqual({ ok: true, value: 4 });
    });
});

describe("input guards", () => {
    it("strips characters the field will not hold", () => {
        expect(sanitiseExpressionInput("₹12,500 + 18%")).toBe("12,500 + 18%");
        expect(sanitiseExpressionInput("alert(1)")).toBe("(1)"); // letters gone except x/X
        expect(sanitiseExpressionInput("2**2")).toBe("2**2");
    });

    it("normalises before parsing, not while typing", () => {
        expect(normaliseExpression("12,500 × 18%")).toBe("12500*18%");
    });
});

describe("display operators", () => {
    it("shows the operators the keypad shows", () => {
        expect(toDisplayOperators("12500*18%")).toBe("12500×18%");
        expect(toDisplayOperators("89/69*6-3")).toBe("89÷69×6−3");
        expect(toDisplayOperators("(5000+2500)/3")).toBe("(5000+2500)÷3");
    });

    // Load-bearing: the caller rewrites the input's value while the user types, so a
    // length change would move the caret out from under them.
    it.each(["12500*18%", "89/69*6-3", "-5+10", "80000*1.18", "((2+3)*4)-5"])(
        "is one character for one character: %s",
        (input) => {
            expect(toDisplayOperators(input)).toHaveLength(input.length);
        }
    );

    it("round-trips: what is shown still parses to the same number", () => {
        for (const src of ["12500*18%", "89/69*6-3", "(5000+2500)/3", "-5+10", "80000*1.18"]) {
            expect(evaluateExpression(toDisplayOperators(src))).toBe(evaluateExpression(src));
        }
    });

    it("is idempotent, so re-showing a stored expression cannot drift", () => {
        const once = toDisplayOperators("89/69*6-3");
        expect(toDisplayOperators(once)).toBe(once);
    });
});

describe("display versus clipboard", () => {
    it("groups for reading the Indian way", () => {
        expect(formatResult(2250)).toBe("2,250");
        expect(formatResult(1250000)).toBe("12,50,000");
        expect(formatResult(12187.5)).toBe("12,187.5");
    });

    it("copies a bare number, because Frappe currency fields reject separators", () => {
        expect(toClipboardValue(2250)).toBe("2250");
        expect(toClipboardValue(12187.5)).toBe("12187.5");
        expect(toClipboardValue(1250000)).toBe("1250000");
    });
});
