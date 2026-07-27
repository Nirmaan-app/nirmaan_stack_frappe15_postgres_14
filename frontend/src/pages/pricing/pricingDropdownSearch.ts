// Type-to-search for the vendored Luckysheet data-validation dropdown lists (PW-DS).
//
// A pure, APP-LEVEL DOM augmentation over the vendored engine -- NO vendored change,
// no backend, no React coupling. It prepends a search <input> into the engine's
// dropdown popup and filters the option rows as the user types. Governed by the
// 2026-07-28 type-to-search RECON; every load-bearing fact below was proven against
// the live DOM in that recon (and re-verified in this slice's live matrix):
//
//   * The popup container `#luckysheet-dataVerification-dropdown-List` is PERSISTENT
//     (created once per engine instance) but its `.dropdown-List-item` CHILDREN are
//     REBUILT on every open (childList: 106 removed + 106 added), then `display` is
//     set to `block` (inline style). So we re-inject on each open; the engine's own
//     rebuild auto-wipes our injection -> the cleanup contract is minimal (self-cleaning).
//   * Selection is DELEGATED on `document` (`click` -> `#luckysheet-dataVerification-
//     dropdown-List .dropdown-List-item`), NOT bound per-item. So hiding non-matching
//     rows with `display:none` leaves the survivors fully clickable, and a synthetic
//     `.click()` on a row triggers the engine's own cell-write.
//   * The injected input MUST carry `luckysheet-mousedown-cancel` -- proven by a
//     NEGATIVE probe: without it, the engine's global mousedown handler dismisses the
//     popup and steals focus to the cell editor the instant the input is clicked.
//   * The engine has NO native dropdown keyboard navigation -- ArrowUp/Down/Enter fall
//     through to the GRID (move the cell selection, close the popup). So we own all
//     keyboard handling and stopPropagation + preventDefault the four keys.
//
// Fallbacks on record (recon Q7), should the injected-input coexistence ever break in a
// future engine version: (a) a document-level keystroke capture with no visible input,
// filtering the open list and echoing the typed buffer in a chip; or (b) a floating
// search chip positioned NEXT to the popup rather than inside it. Neither is needed today.

/** The engine's dropdown popup container id (vendored, stable). */
const LIST_ID = "luckysheet-dataVerification-dropdown-List";
/** Marks OUR injected input so we never double-augment / can clean up. */
const SEARCH_ATTR = "data-pricing-search";
/** Classes on our nodes. `luckysheet-mousedown-cancel` is LOAD-BEARING (see above). */
const SEARCH_CLASS = "pricing-dropdown-search luckysheet-mousedown-cancel";
const HL_CLASS = "pricing-dropdown-search-hl";
const NOMATCH_CLASS = "pricing-dropdown-search-nomatch";
/** The engine's per-option row class. */
const ITEM_SELECTOR = ".dropdown-List-item";

// ── Pure helpers (unit-tested) ────────────────────────────────────────────────

/**
 * Which options match `query`, PARALLEL to `texts` (never reordered): a
 * case-insensitive substring test on the TRIMMED query. An empty/whitespace query
 * matches everything. The returned boolean[] has the same length + order as `texts`,
 * so it doubles as a display mask -- filtering is hide/show, never a re-sort.
 */
export function filterOptions(texts: string[], query: string): boolean[] {
	const q = query.trim().toLowerCase();
	if (q === "") return texts.map(() => true);
	return texts.map((t) => t.toLowerCase().includes(q));
}

/**
 * The next highlight index when moving `delta` (+1 down / -1 up) over the VISIBLE
 * subset described by the `visible` mask, clamped at both ends. `current` is an index
 * into the full list (or -1 for "no highlight yet").
 *
 *   - no visible items            -> -1
 *   - current is a visible index  -> step within the visible subset, clamped
 *   - current is NOT visible / -1 -> seed to the first visible (delta>=0) or last (delta<0)
 */
export function nextVisibleIndex(current: number, delta: number, visible: boolean[]): number {
	const vis: number[] = [];
	for (let i = 0; i < visible.length; i++) if (visible[i]) vis.push(i);
	if (vis.length === 0) return -1;
	const pos = vis.indexOf(current);
	if (pos === -1) return delta >= 0 ? vis[0] : vis[vis.length - 1];
	const clamped = Math.max(0, Math.min(vis.length - 1, pos + delta));
	return vis[clamped];
}

// ── The installer (live-matrix verified) ──────────────────────────────────────

// Module-scoped idempotency guard (spec 1). A second install() while one is live
// returns the existing uninstaller rather than stacking observers.
let installed = false;
let currentUninstall: () => void = () => {};

/** Read the option rows currently in the popup (fresh each open). */
function itemsOf(list: HTMLElement): HTMLElement[] {
	return Array.from(list.querySelectorAll<HTMLElement>(ITEM_SELECTOR));
}

/** Show/hide a single muted "No matches" row (not a `.dropdown-List-item`, so
 *  the engine's delegated click handler ignores it -- it is non-clickable). */
function toggleNoMatches(list: HTMLElement, show: boolean): void {
	let row = list.querySelector<HTMLElement>(`.${NOMATCH_CLASS}`);
	if (show) {
		if (!row) {
			row = document.createElement("div");
			row.className = `${NOMATCH_CLASS} luckysheet-mousedown-cancel`;
			row.textContent = "No matches";
			list.appendChild(row);
		}
		row.style.display = "";
	} else if (row) {
		row.style.display = "none";
	}
}

/**
 * Prepend the search input into a freshly-opened popup and wire filtering + keyboard
 * navigation. Called once per open (the engine rebuilds children on the next open, so
 * this injection is transient by construction).
 */
function augment(list: HTMLElement): void {
	const items = itemsOf(list);
	if (!items.length) return; // nothing to search (degenerate 0-option dropdown)

	const texts = items.map((el) => el.textContent || "");
	let highlight = -1; // index into `items`

	const input = document.createElement("input");
	input.type = "text";
	input.setAttribute(SEARCH_ATTR, "");
	input.className = SEARCH_CLASS;
	input.placeholder = "Type to search...";
	input.autocomplete = "off";
	list.insertBefore(input, list.firstChild);
	// Focus immediately so the first keystroke lands here, not in the cell editor.
	input.focus();

	const visibleMask = (): boolean[] => items.map((el) => el.style.display !== "none");

	const setHighlight = (idx: number): void => {
		if (highlight >= 0 && items[highlight]) items[highlight].classList.remove(HL_CLASS);
		highlight = idx;
		if (idx >= 0 && items[idx]) {
			items[idx].classList.add(HL_CLASS);
			// Keep the highlighted row inside the 300px cap.
			items[idx].scrollIntoView({ block: "nearest" });
		}
	};

	const applyFilter = (): void => {
		const mask = filterOptions(texts, input.value);
		let anyVisible = false;
		for (let i = 0; i < items.length; i++) {
			items[i].style.display = mask[i] ? "" : "none";
			if (mask[i]) anyVisible = true;
		}
		toggleNoMatches(list, !anyVisible);
		// Drop a highlight that got filtered out.
		if (highlight >= 0 && !mask[highlight]) setHighlight(-1);
	};

	input.addEventListener("input", applyFilter);

	input.addEventListener("keydown", (e: KeyboardEvent) => {
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			// Own the arrows -- the engine would otherwise move the grid selection
			// and close the popup (recon Q6).
			e.preventDefault();
			e.stopPropagation();
			setHighlight(nextVisibleIndex(highlight, e.key === "ArrowDown" ? 1 : -1, visibleMask()));
		} else if (e.key === "Enter") {
			e.preventDefault();
			e.stopPropagation();
			// Prefer the explicitly-highlighted row (arrow-navigated); otherwise fall
			// back to the FIRST visible option, so Enter-straight-after-typing picks the
			// top match (a single filtered result selects with one keystroke).
			let el = highlight >= 0 && items[highlight]?.style.display !== "none" ? items[highlight] : null;
			if (!el) el = items.find((it) => it.style.display !== "none") || null;
			if (el) {
				// The engine's document-delegated click handler performs the cell write
				// and closes the popup -- we do not write the cell ourselves.
				el.click();
			}
		} else if (e.key === "Escape") {
			e.preventDefault();
			e.stopPropagation();
			// Mirror the engine's dismiss: hide the popup + return focus to the grid.
			input.remove();
			list.style.display = "none";
		}
		// Any other key (letters, Backspace, …) falls through to the input's own
		// handling; recon proved the engine does NOT hijack it into cell-edit while
		// our input is focused, so we deliberately do not touch it.
	});
}

/**
 * Install type-to-search for pricing data-validation dropdowns. Idempotent; returns an
 * uninstaller (observer.disconnect + remove any live injected nodes) for unmount.
 *
 * The open signal is a MutationObserver on `document.body` (childList + subtree): the
 * per-open child rebuild bubbles here. The callback is intentionally O(1) in the common
 * case -- a single `getElementById` + one inline-`display` read -- and only does real
 * work when the pricing dropdown is actually open and not yet augmented. Body-scoped so
 * it needs no engine-mount id and survives engine re-inits (edit / release / sandbox /
 * import all destroy + recreate the popup container).
 */
export function installDropdownSearch(): () => void {
	if (installed) return currentUninstall;
	installed = true;

	const maybeAugment = (): void => {
		const list = document.getElementById(LIST_ID) as HTMLElement | null;
		if (!list) return;
		if (list.style.display === "none" || list.style.display === "") return; // closed
		if (list.querySelector(`input[${SEARCH_ATTR}]`)) return; // already augmented
		if (!list.querySelector(ITEM_SELECTOR)) return; // no options yet
		augment(list);
	};

	const observer = new MutationObserver(maybeAugment);
	observer.observe(document.body, { childList: true, subtree: true });

	currentUninstall = () => {
		observer.disconnect();
		const list = document.getElementById(LIST_ID);
		if (list) {
			list.querySelector(`input[${SEARCH_ATTR}]`)?.remove();
			list.querySelector(`.${NOMATCH_CLASS}`)?.remove();
		}
		installed = false;
		currentUninstall = () => {};
	};
	return currentUninstall;
}
