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
	// in brand red. 0.15 alpha stays clearly legible over the grid.
	const svg =
		`<svg xmlns='http://www.w3.org/2000/svg' width='300' height='150'>` +
		`<text x='8' y='80' transform='rotate(-30 150 75)' ` +
		`fill='rgba(208,59,69,0.15)' font-size='21' font-weight='600' ` +
		`font-family='Inter, Arial, sans-serif'>${label}</text>` +
		`</svg>`;
	return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
