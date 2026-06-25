/**
 * ParentChain -- the Row-detail panel's READ view of a row's ancestor chain.
 *
 * Renders the real ancestors (root-most first) as a vertical indented tree, then the current row
 * as a non-clickable terminal. Each ANCESTOR is a clickable crumb (Excel row + classification pill
 * + description) that drill-navigates via onNavigate. The ROOT is indicated by tagging the actual
 * top-level ancestor "top level" -- there is NO synthetic "Root" node (a top-level row has no
 * parent, so showing a fake "Root" above it was misleading).
 *
 * PURE: no fetch, no state. Walks effective_parent_index -> byIdx (the SAME walk as
 * ReviewTree.revealAndScrollToRow, hop-capped + self/cycle-guarded). Text scale matches the
 * surrounding detail panel (text-[10px] section label / text-xs rows).
 */
import { ClassificationPill } from "./reviewRender";
import type { ReviewRow } from "./boqTypes";

const HOP_CAP = 60;
const INDENT_PX = 14;

export function ParentChain({
  row,
  byIdx,
  onNavigate,
}: {
  row: ReviewRow;
  byIdx: Map<number, ReviewRow>;
  onNavigate: (rowIndex: number) => void;
}) {
  // Walk up to root. null/-1 = root; cur === row.row_index or a repeat = cycle guard.
  const ancestors: ReviewRow[] = [];
  const seen = new Set<number>();
  let cur: number | null | undefined = row.effective_parent_index;
  let hops = 0;
  while (cur !== null && cur !== undefined && cur >= 0 && hops < HOP_CAP) {
    if (cur === row.row_index || seen.has(cur)) break;
    seen.add(cur);
    const anc = byIdx.get(cur);
    if (!anc) break;
    ancestors.push(anc);
    cur = anc.effective_parent_index ?? null;
    hops++;
  }
  ancestors.reverse(); // root-most first

  // The root-most ancestor IS the top-level row ONLY when its own parent is root (null/-1) --
  // i.e. we stopped walking because there was no further parent (not a cycle / hop-cap / break).
  const rootMost = ancestors[0];
  const rootMostIsTopLevel =
    rootMost !== undefined &&
    (rootMost.effective_parent_index === null ||
      rootMost.effective_parent_index === undefined ||
      rootMost.effective_parent_index < 0);

  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
        Parent chain
      </p>
      {ancestors.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">This row is at the top level — no parent.</p>
      ) : (
        <ol className="space-y-0.5">
          {ancestors.map((a, i) => (
            <li key={a.row_index} style={{ paddingLeft: i * INDENT_PX }}>
              <button
                type="button"
                onClick={() => onNavigate(a.row_index)}
                title={`Go to Excel row ${a.source_row_number}`}
                className="group flex w-full items-center gap-1.5 text-left text-xs min-w-0 hover:text-primary transition-colors"
              >
                {i > 0 && <span className="text-muted-foreground shrink-0">└</span>}
                <span className="font-medium tabular-nums shrink-0">r{a.source_row_number}</span>
                <ClassificationPill cls={a.effective_classification} />
                <span className="truncate text-foreground group-hover:underline">{a.description ?? "—"}</span>
                {i === 0 && rootMostIsTopLevel && (
                  <span className="ml-auto shrink-0 text-[10px] text-muted-foreground italic">top level</span>
                )}
              </button>
            </li>
          ))}
          <li
            style={{ paddingLeft: ancestors.length * INDENT_PX }}
            className="flex items-center gap-1.5 text-xs"
          >
            <span className="text-muted-foreground shrink-0">└</span>
            <span className="font-medium tabular-nums shrink-0">r{row.source_row_number}</span>
            <span className="text-muted-foreground italic">(this row)</span>
          </li>
        </ol>
      )}
    </div>
  );
}

export default ParentChain;
