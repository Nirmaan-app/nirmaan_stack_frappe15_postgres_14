// Consent-based live formula fixing (PW-2b-ii).
//
// The PW-2a advisory dialog only WARNED. This turns each warned cell into a one-click
// fix where the pipeline can rewrite it WITHOUT needing new helper columns -- because
// writing helper columns in a live edit session mutates a second sheet and is hard to
// undo if the user then Releases (PW-2b recon Q7). Helper-needing classes are deferred
// to "Replace from Excel", which runs the full pipeline on a detached tree.
//
// ELIGIBILITY IS NOT A HAND-KEPT CLASS LIST. It is derived by running the hit's formula
// through the SAME `transformFormula` entry point the import pipeline uses and asking:
// did it produce a rewrite that requested ZERO helper columns? That automatically
// covers IFS / LET / XLOOKUP / direct single-cond INDEX/MATCH / dead-Google freeze and
// automatically excludes multi-cond INDEX/MATCH (which requests a helper pair) -- if the
// transform suite ever changes which classes need helpers, this tracks it for free.

import type { FormulaScanHit } from "./pricingFormulaScan";
import { HelperAllocator, transformFormula } from "./pricingTransforms";

export type FixAssessment =
	| { fixable: true; kind: "rewrite"; rewritten: string }
	| { fixable: true; kind: "freeze" }
	| { fixable: false; reason: string };

/** Reason strings are load-bearing -- the dialog maps them to a status label. */
export const REASON_NEEDS_HELPER = "needs helper columns";
export const REASON_NO_REWRITE = "no sanctioned rewrite";

/**
 * Can this formula be fixed IN PLACE (no helper columns)?
 *
 * Pure -- no engine, no DOM. `sheetName` lets an unqualified range (`E2:E9`) resolve to
 * the cell's own sheet, exactly as the pipeline does.
 */
export function assessFix(formula: string, sheetName = ""): FixAssessment {
	// A throwaway allocator: we never keep its ledger, we only read whether a rewrite
	// WOULD have requested helper columns.
	const outcome = transformFormula(formula, new HelperAllocator({}), sheetName);
	switch (outcome.status) {
		case "rewritten":
			return outcome.helpers.length === 0
				? { fixable: true, kind: "rewrite", rewritten: outcome.formula }
				: { fixable: false, reason: REASON_NEEDS_HELPER };
		case "freeze":
			// Dead-Google: drop the formula, keep whatever the cell already shows.
			return { fixable: true, kind: "freeze" };
		case "abstain":
			// A recognised construct the suite declined (e.g. an inline array literal).
			return { fixable: false, reason: outcome.reason };
		case "unchanged":
		default:
			// Parsed fine but nothing to rewrite -- an unknown function, or a bare INDEX
			// with no MATCH. Flagged by the scan, but the suite has no rewrite for it.
			return { fixable: false, reason: REASON_NO_REWRITE };
	}
}

/** Convenience wrapper over a scan hit. */
export function assessHit(hit: FormulaScanHit): FixAssessment {
	return assessFix(hit.formula, hit.sheet);
}

export interface LiveFixResult {
	applied: boolean;
	/** The cell's computed value after the fix, for display. */
	value?: any;
	reason?: string;
}

/**
 * Apply a fix to ONE cell in the live engine and return its recomputed value.
 *
 * Mirrors `reenterNormalizedFormulas` (FR-6): `setCellValue` MUST take the plain
 * formula STRING -- the object form `{f:"..."}` is accepted without error but leaves
 * the cell EMPTY. Pass the target sheet's `order`, and restore the previously-active
 * sheet afterwards (setCellValue can move it).
 */
export function applyLiveFix(luckysheet: any, hit: FormulaScanHit): LiveFixResult {
	const assessment = assessHit(hit);
	if (!assessment.fixable) return { applied: false, reason: assessment.reason };

	const sheets = luckysheet?.getAllSheets?.() || [];
	const target = sheets.find((s: any) => s.name === hit.sheet);
	const order = target?.order;
	const activeName = luckysheet?.getSheet?.()?.name;

	try {
		if (assessment.kind === "rewrite") {
			luckysheet.setCellValue(hit.row, hit.col, assessment.rewritten, { order });
		} else {
			// freeze: keep the current displayed value, drop the formula.
			const current = luckysheet?.getcellvalue
				? luckysheet.getcellvalue(hit.row, hit.col, target?.data)
				: undefined;
			luckysheet.setCellValue(hit.row, hit.col, current ?? "", { order });
		}
	} catch (e: any) {
		return { applied: false, reason: e?.message || "the engine rejected the fix" };
	}

	// setCellValue can move the active sheet; put the user back where they were.
	if (activeName && luckysheet?.getSheet?.()?.name !== activeName) {
		const back = sheets.find((s: any) => s.name === activeName);
		if (back) {
			try {
				luckysheet.setSheetActive(back.order);
			} catch {
				/* cosmetic only */
			}
		}
	}

	let value: any;
	try {
		value = luckysheet?.getcellvalue
			? luckysheet.getcellvalue(hit.row, hit.col, target?.data)
			: undefined;
	} catch {
		/* value read is best-effort, for display only */
	}
	return { applied: true, value };
}
