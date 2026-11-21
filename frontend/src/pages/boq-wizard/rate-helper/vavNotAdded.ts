/**
 * VAV-2b2 (ANSWER 16 / 18, owner 2026-11-21 15:56 "2a", 15:59 "a"). PURE. The 'not added' sentence of a sheet share by the separate-row
 * test that caught the row, and the count words its grammar follows. Split out of vavSheetShares.ts (residence S1, the 500-line limit);
 * vavSheetShares.ts re-exports what it used to export.
 */
export const fill = (t: string, o: Record<string, string | number>) => Object.entries(o).reduce((a, [k, v]) => a.split(`{${k}}`).join(String(v)), t);
/** VAV-2b2 (ANSWER 18, owner 15:59 "a"): the sentence's grammar follows the count of rows ("row 41 prices it" / "rows 41, 44 price it"). */
export const countWords = (rows: readonly number[]) => (new Set(rows).size > 1
  ? { is: "are", prices: "price", that_row: "those rows", does: "do" } : { is: "is", prices: "prices", that_row: "that row", does: "does" });
/** "row 48" / "rows 48, 49" / "rows 1, 2, ... 10 and 3 more" */
export const rowsNamed = (rows: readonly number[]) => {
  const rs = [...new Set(rows)].sort((a, b) => a - b);
  return `${rs.length > 1 ? "rows" : "row"} ${rs.slice(0, 10).join(", ")}${rs.length > 10 ? ` and ${rs.length - 10} more` : ""}`;
};

/** VAV-2b2 (ANSWER 16, owner 15:56): a sentence for the rows ONE separate-row test caught -- `line` always, or `priced` / `not_priced`
 *  by whether this helper prices that row (filed under a claims_filed category); `called` names what the row is, from its words. */
export type NotAddedBy = { share: string; label: string; line?: string; priced?: string; not_priced?: string; called?: Array<{ words: string; name: string }> };
/** The row a separate-row test caught: the test's label, whether this helper prices the row, the row's words. */
export type SeparateRowBy = { label: string; priced: boolean; text: string };
/** VAV-2b2 (ANSWER 16, owner 2026-11-21 15:56 "2a": the note says WHY the share is not added). PURE. The 'not added' sentences for a
 *  share's charged rows: the rows one test caught share one sentence (`not_added_by`); a row no entry covers keeps `lines.not_added`. */
export function notAddedLines(entries: readonly NotAddedBy[] | undefined, general: string, id: string, shareLabel: string,
  sep: { charged: readonly number[]; by?: Readonly<Record<number, SeparateRowBy>> }): string[] {
  const groups = new Map<string, { tmpl: string; called: string; rows: number[] }>();
  for (const r of sep.charged) {
    const b = sep.by?.[r];
    const e = b ? (entries ?? []).find((x) => x.share === id && x.label === b.label) : undefined;
    const tmpl = (e && b ? (e.line ?? (b.priced ? e.priced : e.not_priced)) : undefined) ?? "";
    const called = tmpl && e && b ? (e.called ?? []).find((c) => { try { return new RegExp(c.words, "i").test(b.text); } catch { return false; } })?.name ?? "" : "";
    const g = groups.get(`${tmpl}\u0000${called}`) ?? { tmpl, called, rows: [] };
    g.rows.push(r);
    groups.set(`${tmpl}\u0000${called}`, g);
  }
  return [...groups.values()].map(({ tmpl, called, rows: rs }) => tmpl
    ? fill(tmpl, { share: shareLabel, rows: rowsNamed(rs), called, ...countWords(rs) })
    : fill(general, { share: shareLabel, rows: rowsNamed(rs) }));
}
