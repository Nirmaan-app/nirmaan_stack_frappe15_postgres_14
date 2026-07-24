// Local helpers for the Pricing Module page: script/CSS injection for the
// vendored Luckysheet engine, and the watermark background builder.
//
// The libs live under /assets/nirmaan_stack/pricing_libs/ (vendored in
// nirmaan_stack/public/pricing_libs/). They are injected at runtime, NOT
// bundled by Vite -- keep them out of the import graph.

const BASE = "/assets/nirmaan_stack/pricing_libs";

export const LUCKYSHEET_CSS: string[] = [
	`${BASE}/luckysheet/plugins/css/pluginsCss.css`,
	`${BASE}/luckysheet/plugins/plugins.css`,
	`${BASE}/luckysheet/css/luckysheet.css`,
	`${BASE}/luckysheet/assets/iconfont/iconfont.css`,
];

// Ordered so dependencies load first: plugin.js before luckysheet.umd.js;
// jszip before luckyexcel.
export const LUCKYSHEET_SCRIPTS: string[] = [
	`${BASE}/luckysheet/plugins/js/plugin.js`,
	`${BASE}/luckysheet/luckysheet.umd.js`,
	`${BASE}/jszip/jszip.min.js`,
	`${BASE}/luckyexcel/luckyexcel.umd.js`,
];

function injectCss(href: string): void {
	if (document.querySelector(`link[data-pricing-lib="${href}"]`)) return;
	const link = document.createElement("link");
	link.rel = "stylesheet";
	link.href = href;
	link.dataset.pricingLib = href;
	document.head.appendChild(link);
}

function injectScript(src: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const existing = document.querySelector<HTMLScriptElement>(
			`script[data-pricing-lib="${src}"]`
		);
		if (existing) {
			if (existing.dataset.loaded === "true") resolve();
			else {
				existing.addEventListener("load", () => resolve());
				existing.addEventListener("error", () =>
					reject(new Error(`Failed to load ${src}`))
				);
			}
			return;
		}
		const script = document.createElement("script");
		script.src = src;
		script.async = false; // preserve execution order
		script.dataset.pricingLib = src;
		script.addEventListener("load", () => {
			script.dataset.loaded = "true";
			resolve();
		});
		script.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)));
		document.body.appendChild(script);
	});
}

/**
 * Inject the Luckysheet CSS + scripts once. Scripts load sequentially so
 * plugin.js executes before luckysheet.umd.js and jszip before luckyexcel.
 * Resolves when window.luckysheet and window.LuckyExcel are available.
 */
export async function loadPricingLibs(): Promise<void> {
	LUCKYSHEET_CSS.forEach(injectCss);
	for (const src of LUCKYSHEET_SCRIPTS) {
		// eslint-disable-next-line no-await-in-loop -- order is required
		await injectScript(src);
	}
	if (!window.luckysheet || !window.LuckyExcel) {
		throw new Error("Pricing engine scripts loaded but globals are missing.");
	}
}

function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/**
 * Build a tiled, ~30deg-rotated watermark as a CSS background-image (data-URI
 * SVG), applied to a pointer-events:none overlay. Rendered in the Nirmaan brand
 * red (#D03B45 = rgb(208,59,69); the sidebar/loader accent, 51 uses across src)
 * at raised prominence -- larger font, denser tile, higher opacity -- while
 * keeping the sheet comfortably readable.
 */
export function watermarkBackground(fullName: string, email: string): string {
	const label = escapeXml([fullName, email].filter(Boolean).join("  ·  "));
	// Denser tile (was 340x170) + larger font (was 15) + higher opacity (was 0.07)
	// in brand red. 0.22 alpha (raised from 0.15, PM-6) reads clearly darker while
	// the sheet content stays comfortably legible over it.
	const svg =
		`<svg xmlns='http://www.w3.org/2000/svg' width='300' height='150'>` +
		`<text x='8' y='80' transform='rotate(-30 150 75)' ` +
		`fill='rgba(208,59,69,0.22)' font-size='21' font-weight='600' ` +
		`font-family='Inter, Arial, sans-serif'>${label}</text>` +
		`</svg>`;
	return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

// The HTML entities LuckyExcel emits in sheet names. Kept explicit (not a generic
// DOM-based unescape) so this stays a pure, testable string transform.
const SHEET_NAME_ENTITIES: ReadonlyArray<[RegExp, string]> = [
	[/&lt;/g, "<"],
	[/&gt;/g, ">"],
	[/&quot;/g, '"'],
	[/&#39;/g, "'"],
	[/&amp;/g, "&"], // LAST -- so "&amp;lt;" decodes to "&lt;", not "<"
];

/**
 * Decode HTML entities in every sheet NAME produced by LuckyExcel (FR-1).
 *
 * WHY: LuckyExcel escapes `&` in the sheet name (`Switches & Sockets` becomes
 * `Switches &amp; Sockets`) but leaves FORMULA text unescaped -- formulas still
 * reference `'Switches & Sockets'!$L$2`. The referenced sheet then does not exist
 * under that name, so every cross-sheet formula touching it resolves to #NAME? /
 * #VALUE! the moment it recalculates -- and a subsequent save persists those
 * errors over the good cached values (DIAG-6 Defect A; it hit 26 formulas in the
 * Electrical workbook). Decoding the NAME (rather than escaping the formulas)
 * restores the match and keeps the name identical to the source workbook.
 *
 * Mutates in place and returns the same array -- callers pass the LuckyExcel
 * output straight through to both create_workbook and the local render.
 */
export function decodeSheetNames(sheets: any[]): any[] {
	for (const sheet of sheets || []) {
		if (typeof sheet?.name !== "string") continue;
		let name = sheet.name;
		for (const [pattern, replacement] of SHEET_NAME_ENTITIES) {
			name = name.replace(pattern, replacement);
		}
		sheet.name = name;
	}
	return sheets;
}

// Operators (and separators) after which a space immediately preceding `(` is
// fatal to the engine's parser. See normalizeFormulaText.
const OP_BEFORE_PAREN = /([+\-*/^&=<>,(])\s+\(/g;

/**
 * Normalize ONE formula string. Exported for unit-sanity checks; the workbook-level
 * `normalizeFormulas` maps this over every cell.
 *
 * Three transforms, applied outside double-quoted string literals only:
 *   1. newlines (raw and the `&#10;`/`&#13;` entities LuckyExcel emits) -> a space
 *   2. `++` (Excel's tolerated double unary plus) -> `+`
 *   3. whitespace between an operator/`(`/`,` and a following `(` -> removed
 *
 * (3) is the FR-4 finding and the subtle one: the engine returns #NAME? for the
 * WHOLE cell when it meets `<operator><space>(`. It is not about functions or
 * nesting -- `=2 * (1+2)` fails while `=2*(1+2)` works, and a space BEFORE the
 * operator is harmless. It hit 7 cells across the estate, all of them formulas
 * their author had wrapped across several lines. Note transform (1) can CREATE
 * this pattern (`...*\n  (1+X)` -> `...* (1+X)`), which is exactly why (3) must
 * run after it.
 *
 * QUOTE-AWARE: string literals are passed through untouched, so a value like
 * "MS B Class" keeps its spaces and a literal "a , (b" is never rewritten.
 */
export function normalizeFormulaText(f: string): string {
	// Split on double-quoted literals, keeping them: even indexes are code, odd are literals.
	const parts = f.split(/("(?:[^"]|"")*")/);
	for (let i = 0; i < parts.length; i += 2) {
		let seg = parts[i]
			.replace(/&#10;|&#13;|\r\n|\r|\n/g, " ")
			.replace(/\+\s*\+/g, "+");
		// Repeat: one pass leaves `( ( x` half-done, and nested wrappers are common.
		let prev: string;
		do {
			prev = seg;
			seg = seg.replace(OP_BEFORE_PAREN, "$1(");
		} while (seg !== prev);
		parts[i] = seg;
	}
	return parts.join("");
}

/**
 * Normalize every formula string in the workbook so the engine can parse it
 * (FR-3, extended FR-5). Per-cell logic + rationale: `normalizeFormulaText`.
 *
 * Whitespace-only rewrite: it never changes what a formula MEANS, so values are
 * unaffected. Mutates in place and returns the same array.
 */
export function normalizeFormulas(sheets: any[]): any[] {
	for (const sheet of sheets || []) {
		for (const cell of sheet?.celldata || []) {
			const f = cell?.v?.f;
			if (typeof f !== "string") continue;
			cell.v.f = normalizeFormulaText(f);
		}
	}
	return sheets;
}

// Per-sheet keys that Luckysheet REBUILDS from `celldata` on load (the expanded
// grid) or that are pure runtime state (selection). Dropping them keeps the
// stored form compact + canonical (celldata-only) so it POSTs -- the full
// getAllSheets() (~26 MB once `data` is rebuilt for all sheets) exceeds the
// request-size limit and the save hangs (DIAG-5). Proven LOSSLESS: the PM-4
// recovery stored exactly this shape and every sheet's `data` rebuilt on reload.
const REBUILT_SHEET_KEYS: readonly string[] = [
	"data", // expanded 2D grid, rebuilt from celldata
	"visibledatarow", // cumulative row-offset cache, recomputed on load
	"visibledatacolumn", // cumulative col-offset cache, recomputed on load
	"jfgird_select_save", // runtime selection state
	"luckysheet_selection_range", // runtime selection state
];

/**
 * Compact the Luckysheet workbook for persistence: strip the rebuilt/runtime keys
 * (see REBUILT_SHEET_KEYS), keep everything else (celldata, config, calcChain,
 * name/index/order/status, display settings). THE single source for the save
 * shape -- every save-shaped path must go through this helper.
 */
export function serializeSheets(sheets: any[]): any[] {
	return (sheets || []).map((sheet) => {
		const out: Record<string, any> = {};
		for (const key of Object.keys(sheet)) {
			if (REBUILT_SHEET_KEYS.includes(key)) continue;
			out[key] = sheet[key];
		}
		// SAVE-TIME NORMALIZATION (FR-5) -- the FINAL GUARD. The operator-space bug is
		// reachable from live typing, not just import: a user entering
		// `= A1 * (B1+C1)` stores a formula the engine renders as #NAME?. Normalizing
		// here closes the hole for EVERY save-shaped path, since this helper is the
		// single serialization point (PM-5 rule).
		//
		// Normally a NO-OP: `reenterNormalizedFormulas` (FR-6) has already pushed the
		// corrected text through the engine before we get here, so both `f` and the
		// cached `v` are already right. This stays as the backstop for any cell the
		// engine refused to accept.
		//
		// COPY-ON-WRITE: `out.celldata` above is the SAME array reference as the live
		// sheet's, so rewriting in place would mutate the running grid. We clone only
		// the cells whose formula actually changes -- and, because reaching here means
		// the engine never recomputed that cell, we DROP its stale cached `v`/`m` so
		// nothing persists a value that contradicts the formula.
		const cells = out.celldata;
		if (Array.isArray(cells)) {
			let touched = false;
			const next = cells.map((cell: any) => {
				const f = cell?.v?.f;
				if (typeof f !== "string") return cell;
				const fixed = normalizeFormulaText(f);
				if (fixed === f) return cell;
				touched = true;
				const v = { ...cell.v, f: fixed };
				delete v.v; // stale cached value contradicts the corrected formula
				delete v.m;
				return { ...cell, v };
			});
			if (touched) out.celldata = next;
		}
		return out;
	});
}

/**
 * RE-ENTER-LIVE pass (FR-6): before serializing, push every formula that the
 * normalizer would change back through the ENGINE, so the engine recomputes a
 * real cached value.
 *
 * WHY this and not "clear the cached value": normalizing only the stored `f`
 * leaves the poisoned `v` (e.g. "#NAME?") persisted alongside it, and this engine
 * never evaluates formulas at load -- it renders the cached value. A
 * dependency-free formula like `= 5 * (1+1)` would then read #NAME? forever even
 * though its stored text is correct. Re-entering through `setCellValue` is the
 * FR-2-proven path that makes the engine parse AND evaluate, so the value the
 * user sees after Save is the right one immediately, and what we persist is a
 * matched (correct f, correct v) pair.
 *
 * Returns the cells it touched, for reporting. Best-effort per cell: a failure to
 * re-enter one cell must never block the save -- `serializeSheets` still applies
 * the text fix as the final guard.
 */
export function reenterNormalizedFormulas(luckysheet: any): Array<{
	sheet: string;
	r: number;
	c: number;
	from: string;
	to: string;
}> {
	const touched: Array<{ sheet: string; r: number; c: number; from: string; to: string }> = [];
	const sheets = luckysheet?.getAllSheets?.() || [];
	const activeName = luckysheet?.getSheet?.()?.name;
	for (const sheet of sheets) {
		for (const cell of sheet?.celldata || []) {
			const f = cell?.v?.f;
			if (typeof f !== "string") continue;
			const fixed = normalizeFormulaText(f);
			if (fixed === f) continue;
			touched.push({ sheet: sheet.name, r: cell.r, c: cell.c, from: f, to: fixed });
			try {
				// MUST be the plain formula STRING. The object form `{f: "..."}` is
				// accepted without error but leaves the cell empty (verified live) --
				// only the string form makes the engine parse AND evaluate.
				luckysheet.setCellValue(cell.r, cell.c, fixed, { order: sheet.order });
			} catch {
				/* best-effort: serializeSheets still fixes the stored text */
			}
		}
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
	return touched;
}

/**
 * gzip a string and return it as a Blob, for multipart upload (FR-5).
 *
 * WHY: a real workbook serializes to ~21 MB, and nesting it as a JSON *string*
 * inside a JSON request body escapes every quote (measured 1.23x -> 25.91 MB),
 * which exceeds the site's 25 MiB `max_file_size` and 413s. gzip takes the same
 * payload to a few MB, so the limit stops being the binding constraint -- and
 * multipart avoids the escaping entirely. Measured in FR-4 Part 2.
 */
export async function gzipToBlob(text: string): Promise<Blob> {
	const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
	return await new Response(stream).blob();
}

/**
 * Build the multipart body both workbook endpoints now take: the gzipped JSON as
 * the file field `workbook_json_gz`, plus whatever text fields the endpoint needs.
 * THE single request shape for create + save -- there is no non-gzip fallback.
 */
export async function buildWorkbookForm(
	sheetsJson: string,
	fields: Record<string, string>
): Promise<FormData> {
	const form = new FormData();
	const gz = await gzipToBlob(sheetsJson);
	form.append("workbook_json_gz", gz, "workbook.json.gz");
	for (const [k, v] of Object.entries(fields)) form.append(k, v);
	return form;
}
