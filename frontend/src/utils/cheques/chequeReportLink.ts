/**
 * Links into the Cheque Tracker (spec #1477, #1483), its own sidebar page since it left Reports.
 *
 * The tracker's All Cheques table keeps its search and filters in the URL (`useServerDataTable`'s `urlSyncKey`
 * "cheques", the same key the old Reports › Payment › Cheque Payment report used), so a link searched by a
 * cheque number lands on that cheque's row, and an old Reports link keeps its search when it is redirected.
 *
 * Router paths: hand them to `<Link to>` / `<Navigate to>`, which add the app's basename.
 */

export const CHEQUE_TRACKER_PATH = "/cheque-tracker";

/** The URL key of the All Cheques table; every one of its URL params starts `cheques_`. */
const URL_SYNC_PREFIX = "cheques_";

/** The old report's name in `?report=`. */
const LEGACY_REPORT = "Cheque Payment";

/** The Cheque Tracker, searched by a cheque number. */
export const chequeReportPath = (chequeNo: string): string => {
    const params = new URLSearchParams({ cheques_q: chequeNo, cheques_searchBy: "cheque_no" });
    return `${CHEQUE_TRACKER_PATH}?${params.toString()}`;
};

/**
 * Where an old `/reports?report=Cheque Payment…` link goes now: the tracker, with the table's own params
 * (`cheques_*`: search, search field, filters, sort) kept. Null for any other Reports link.
 */
export const chequeTrackerPathFromLegacyReport = (search: string): string | null => {
    const params = new URLSearchParams(search);
    if (params.get("report") !== LEGACY_REPORT) return null;
    const kept = new URLSearchParams();
    params.forEach((value, key) => {
        if (key.startsWith(URL_SYNC_PREFIX)) kept.append(key, value);
    });
    const query = kept.toString();
    return query ? `${CHEQUE_TRACKER_PATH}?${query}` : CHEQUE_TRACKER_PATH;
};
