/**
 * ChildrenList -- the Row-detail panel's READ view of a row's DIRECT children.
 *
 * Lists only rows whose effective_parent_index === this row. A child that has its own children
 * shows a "▸ N" marker; clicking a child drill-navigates there (onNavigate). Long lists scroll
 * within a capped height. Descriptions are hard-capped at 35 characters; text scale matches the
 * surrounding detail panel (text-[10px] section label / text-xs rows).
 *
 * PURE: no fetch, no state. Reads the pre-built childrenByParent map (inverse of
 * effective_parent_index, computed once in ReviewTree's rows memo).
 */
import { ClassificationPill } from "./reviewRender";
import type { ReviewRow } from "./boqTypes";

const MAX_DESC = 35;
const capDesc = (s: string | null): string => {
  const t = s ?? "—";
  return t.length > MAX_DESC ? `${t.slice(0, MAX_DESC)}…` : t;
};

export function ChildrenList({
  row,
  childrenByParent,
  onNavigate,
}: {
  row: ReviewRow;
  childrenByParent: Map<number, ReviewRow[]>;
  onNavigate: (rowIndex: number) => void;
}) {
  const children = childrenByParent.get(row.row_index) ?? [];

  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
        Children{children.length > 0 && <span className="text-foreground"> ({children.length})</span>}
      </p>
      {children.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No children.</p>
      ) : (
        <ul className="space-y-0.5 max-h-48 overflow-auto pr-1">
          {children.map((c) => {
            const grandCount = childrenByParent.get(c.row_index)?.length ?? 0;
            return (
              <li key={c.row_index}>
                <button
                  type="button"
                  onClick={() => onNavigate(c.row_index)}
                  title={`Go to Excel row ${c.source_row_number}`}
                  className="group flex w-full items-center gap-1.5 text-left text-xs min-w-0 hover:text-primary transition-colors"
                >
                  <span className="font-medium tabular-nums shrink-0">r{c.source_row_number}</span>
                  <ClassificationPill cls={c.effective_classification} />
                  <span className="whitespace-nowrap text-foreground group-hover:underline">{capDesc(c.description)}</span>
                  {grandCount > 0 && (
                    <span
                      className="ml-auto shrink-0 text-[10px] text-muted-foreground tabular-nums"
                      title={`${grandCount} of its own ${grandCount === 1 ? "child" : "children"}`}
                    >
                      ▸ {grandCount}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default ChildrenList;
