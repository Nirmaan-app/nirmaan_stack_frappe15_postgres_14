// src/components/data-table/tableHeightModel.ts
//
// PURE MODULE -- no React, no DOM. How tall a DataTable's scroll box may grow.
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
