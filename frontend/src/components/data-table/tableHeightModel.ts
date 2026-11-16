// src/components/data-table/tableHeightModel.ts
//
// PURE MODULE -- no React, no DOM. How tall a DataTable's scroll box may grow, and the height recorded for each
// drawn row (`virtualRowSize`, at the end).
//
// The box takes the screen space below where it starts, leaving room for the pagination bar, so the
// column header stays put while the rows scroll and the page numbers stay on screen. When the table
// starts low on the page (a summary card and tabs above it) and too little space is left, the box
// takes one full screen instead: one page scroll brings the whole table into view.

/** Measurements of the page scroll area (the app shell's `<main>`) and the table inside it, in px. */
export interface TableHeightInput {
    /** Visible height of the scroll area. */
    viewportHeight: number;
    /** Distance from the top of the scroll area to the table's scroll box, as if the page were not scrolled. */
    boxTop: number;
    /** Space the box must leave below itself: the pagination bar plus the scroll area's bottom padding. */
    reserveBelow: number;
    /** Where a box sits once the page is scrolled to it: the scroll area's top padding. */
    topGap: number;
}

/** Below this share of a full screen, the box takes a full screen instead of the space left. */
export const FILL_THRESHOLD = 0.6;

/** The box is never capped shorter than this, however small the screen. */
export const MIN_TABLE_HEIGHT = 240;

/**
 * The max-height for a DataTable's scroll box. A table with fewer rows than this stays as short as
 * its rows, because the result is applied as a max-height, not a height.
 */
export function tableMaxHeight({ viewportHeight, boxTop, reserveBelow, topGap }: TableHeightInput): number {
    const fullScreen = viewportHeight - topGap - reserveBelow;
    const spaceLeft = viewportHeight - boxTop - reserveBelow;
    const height = spaceLeft >= fullScreen * FILL_THRESHOLD ? spaceLeft : fullScreen;
    return Math.max(MIN_TABLE_HEIGHT, Math.floor(height));
}

/**
 * The height the virtualizer records for a drawn row. It is taken from the browser's resize report, which
 * arrives after the browser has laid the page out anyway. When a row is first drawn there is no report yet:
 * the row keeps the height already known for it (or the estimate) and the report corrects it a moment later.
 * Reading the row's height at that moment instead would make the browser lay the page out on the spot for every
 * new row: measured on 16 Nov, 712 ms of a 40-step scroll at 4x CPU and 70 ms of opening Payments.
 * `readHeight` is used only for a report without box sizes (a browser too old to give them).
 */
export function virtualRowSize(
    report: Pick<ResizeObserverEntry, "borderBoxSize"> | undefined,
    knownHeight: number | undefined,
    estimate: number,
    readHeight: () => number,
): number {
    if (!report) return knownHeight ?? estimate;
    const box = report.borderBoxSize?.[0];
    return box ? Math.round(box.blockSize) : readHeight();
}
