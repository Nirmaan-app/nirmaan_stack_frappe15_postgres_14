// Unit checks for the PW-FS pure helpers in pricingHelpers.ts:
//   - shouldExitPricingFullscreenOnEsc: the Esc-to-exit predicate (bare Esc only,
//     never on defaultPrevented, never while a text editor input is focused).
//   - pricingRootClass: the root wrapper className for the full-screen state.

import { describe, it, expect } from "vitest";
import {
	shouldExitPricingFullscreenOnEsc,
	pricingRootClass,
	PRICING_ROOT_CLASS_NORMAL,
	PRICING_ROOT_CLASS_FULLSCREEN,
} from "./pricingHelpers";

// A minimal stand-in for an active element -- only `tagName` is read, so no DOM needed.
const el = (tagName: string): Element => ({ tagName } as unknown as Element);

describe("shouldExitPricingFullscreenOnEsc", () => {
	it("exits on a bare Escape with nothing focused", () => {
		expect(shouldExitPricingFullscreenOnEsc({ key: "Escape", defaultPrevented: false }, null)).toBe(true);
	});

	it("exits on a bare Escape while a non-editor element is focused", () => {
		expect(shouldExitPricingFullscreenOnEsc({ key: "Escape", defaultPrevented: false }, el("DIV"))).toBe(true);
	});

	it("does NOT exit when the Escape was already handled (defaultPrevented)", () => {
		expect(shouldExitPricingFullscreenOnEsc({ key: "Escape", defaultPrevented: true }, null)).toBe(false);
	});

	it("does NOT exit while an <input> is focused (cell editor owns its Esc)", () => {
		expect(shouldExitPricingFullscreenOnEsc({ key: "Escape", defaultPrevented: false }, el("INPUT"))).toBe(false);
	});

	it("does NOT exit while a <textarea> is focused", () => {
		expect(shouldExitPricingFullscreenOnEsc({ key: "Escape", defaultPrevented: false }, el("TEXTAREA"))).toBe(false);
	});

	it("does NOT exit on any non-Escape key", () => {
		expect(shouldExitPricingFullscreenOnEsc({ key: "Enter", defaultPrevented: false }, null)).toBe(false);
	});
});

describe("pricingRootClass", () => {
	it("returns the normal (embedded) class when not expanded", () => {
		expect(pricingRootClass(false)).toBe(PRICING_ROOT_CLASS_NORMAL);
		expect(pricingRootClass(false)).toBe("flex flex-col h-[calc(100vh-100px)]");
	});

	it("returns the fixed-inset overlay class when expanded", () => {
		expect(pricingRootClass(true)).toBe(PRICING_ROOT_CLASS_FULLSCREEN);
		expect(pricingRootClass(true)).toBe("fixed inset-0 z-50 flex flex-col bg-background");
	});
});
