// src/pages/outflow-import/offPageTicks.ts
//
// "Every ticked line is on this page": the check a multi-line toolbar action runs before it may open,
// and the amber note that names the other page (#1318, lifted out of `linkLinesView.linkButtonState`).
// Pure: no React, no fetch. `offPageTicks.test.ts` pins it; `linkLinesView.test.ts` pins Link's wording.

/** The note under the toolbar and the toolbar's short "2 on page 1". */
export interface OffPageTicks {
    note: string;
    offPage: string;
}

const pagesPhrase = (pages: number[]): string => {
    const shown = pages.map((p) => String(p + 1));
    if (shown.length === 1) return `page ${shown[0]}`;
    return `pages ${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
};

/**
 * The ticked lines that are NOT in `rows` (this grid page), worded for the action named by `verb`
 * ("Linking" -> "Linking works on one page at a time: ..."); `null` when every tick is on this page.
 *
 * ⚠️ ONE GRID PAGE AT A TIME. Ticks survive paging, but only this page's lines can be seen and checked
 * before money moves. `tickedOnPage` is the page each line was ticked on; a line with no entry reads
 * "another page" rather than a guessed number.
 */
export const offPageTicks = (
    rows: ReadonlyArray<{ name: string }>,
    selected: ReadonlySet<string>,
    tickedOnPage: ReadonlyMap<string, number>,
    currentPage: number,
    verb: string
): OffPageTicks | null => {
    const onPage = new Set(rows.map((r) => r.name));
    const away = [...selected].filter((name) => !onPage.has(name));
    if (!away.length) return null;

    const known = away.map((name) => tickedOnPage.get(name));
    const pages = [...new Set(known.filter((p): p is number => p !== undefined && p !== currentPage))].sort(
        (a, b) => a - b
    );
    const where = pages.length && known.every((p) => p !== undefined) ? pagesPhrase(pages) : null;
    const n = away.length;
    const lead = `${n} ticked ${n === 1 ? "line is" : "lines are"} on ${where ?? "another page"}.`;
    const back = !where ? "it" : pages.length === 1 ? where : "those pages";
    const untick = n === 1 ? "untick it" : `untick those ${n}`;
    return {
        note: `${lead} ${verb} works on one page at a time: go back to ${back}, or ${untick}.`,
        offPage: `${n} on ${where ?? "another page"}`,
    };
};
