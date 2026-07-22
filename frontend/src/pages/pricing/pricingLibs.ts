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
		return out;
	});
}
