// src/pages/outflow-import/useOutflowSourceStore.ts

import { create } from "zustand";

import { urlStateManager } from "@/utils/urlStateManager";

import { SOURCE_OPTIONS } from "./outflowTableModel";

/**
 * The ONE source scope the Bulk Import Outflow screen is filtered to (slice CF/S2).
 *
 * ⚠️ A STORE, NOT PAGE STATE, FOR THE PERIOD'S REASON — read `useOutflowPeriodStore`'s docstring,
 * which this file deliberately mirrors rather than paraphrases. Four surfaces select over the same
 * population and one of them (the Skipped dialog's own `useOutflowRows` instance) is not a child of
 * the page, so a threaded prop would work for three of them and quietly not for the fourth. A chip
 * counting one scope while the dialog it opens lists another is the defect class this feature has
 * already shipped.
 *
 * ⚠️ IT NEEDS NO BACKEND WORK AT ALL, WHICH IS WHY IT IS A STORE OVER AN EXISTING FACET RATHER THAN
 * A NEW FILTER. `source` is already in `review._FACET_COLUMNS`, already in `SERVER_FACET_COLUMNS`,
 * and already denormalised onto the row — so this writes the ordinary facet the funnel writes, and
 * every sibling read (`get_outflow_summary`, `get_confirmable_rows`, `match_period`, the facet
 * values) inherits it through the one shared `_row_filters`. Adding a bespoke `source` parameter
 * would have been a second filter path past that builder, which is what keeps the page, its count,
 * the tabs and the summary from disagreeing.
 *
 * Like the period it is LINKABLE — the scope rides the URL, so a narrowed screen can be sent to
 * somebody. Unlike the period it needs no live re-resolution: a source is a word, not a window, so
 * there is no clock to track and no midnight rollover to survive.
 */

/** The URL parameter. Its own key — nothing else on this screen filters by source. */
export const SOURCE_URL_KEY = "src";

interface OutflowSourceState {
    /**
     * The ticked sources. EMPTY MEANS EVERY SOURCE, never "none chosen yet".
     *
     * ⚠️ EMPTY IS A PASS-THROUGH, and it has to be: this is the funnel's own shape, and an empty
     * facet selection means "not filtering", exactly as it does for every other funnel on the
     * table. Reading it as "show nothing" would empty the screen the moment somebody unticked their
     * last source.
     */
    sources: string[];
    setSources: (value: readonly string[] | undefined | null) => void;
}

/**
 * ⚠️ UNKNOWN VALUES ARE DROPPED, because a hand-edited URL must not be able to produce a scope no
 * control can express or clear. A `?src=Typo` that survived would filter the whole screen to a
 * source no row carries, and the dropdown — which can only render what it knows — would read "All"
 * over an empty table. That is the invisible-filter defect again, arriving through the address bar.
 */
const readInitial = (): string[] => {
    const raw = urlStateManager.getParam(SOURCE_URL_KEY) ?? "";
    return raw
        .split(",")
        .map((part) => part.trim())
        .filter((part) => SOURCE_OPTIONS.includes(part));
};

const persist = (values: string[]) => {
    urlStateManager.updateParam(SOURCE_URL_KEY, values.length ? values.join(",") : null);
};

export const useOutflowSourceStore = create<OutflowSourceState>((set) => ({
    sources: readInitial(),
    setSources: (value) => {
        // Normalised on the way IN, so every reader sees a clean list and the URL never carries a
        // blank entry or a duplicate that would make two identical scopes look different.
        const next = Array.from(
            new Set((value ?? []).map((s) => s.trim()).filter((s) => s.length > 0))
        );
        persist(next);
        set({ sources: next });
    },
}));

export interface OutflowSource {
    /** The stored selection. Both editors bind to this. */
    sources: string[];
    setSources: (value: readonly string[] | undefined | null) => void;
}

export const useOutflowSource = (): OutflowSource => {
    const sources = useOutflowSourceStore((s) => s.sources);
    const setSources = useOutflowSourceStore((s) => s.setSources);
    return { sources, setSources };
};
