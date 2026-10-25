// src/pages/outflow-import/porterReview.ts
//
// Reviewing a Porter import's projects before Create (#1446, ADR-0032), as pure data. No React, no fetch.
// `PorterReviewPanel` renders it; `porterReview.test.ts` pins it.
//
// ⚠️ THE SERVER DECIDES WHICH GROUP AN ORDER IS IN (`porter.remark_group_key`: normalised remark and city;
// blank when the order has no remark). This module only lays the groups out and orders them.

export const PORTER_REVIEW_METHOD = "nirmaan_stack.api.outflow_import.porter_review.get_porter_review";
export const PORTER_PLACE_METHOD = "nirmaan_stack.api.outflow_import.porter_review.set_porter_placement";

const PROJECT_LEDGER = "Project Expenses";

/** One completed order as `get_porter_review` reports it. */
export interface PorterReviewLine {
    name: string;
    crn: string;
    completed_on: string | null;
    fare: number;
    remarks: string;
    city: string;
    from_address: string;
    to_address: string;
    booked_by: string;
    /** Blank: no remark, so the order is reviewed on its own. */
    group_key: string;
    ledger: string | null;
    project: string | null;
    project_name: string | null;
    reason: string | null;
    strength: string | null;
    /** Create would still write it (waiting, in Error, or reopened), so its placement can still change. */
    editable: boolean;
    /**
     * THE SERVER'S needs-a-person rule (`porter_state.placement_kinds`, #1560): a remark group with a Check
     * order, an order with no placement, or a remark group placed differently. Create is refused while any
     * line has it, and the progress bar counts the same lines.
     */
    needs_person: boolean;
}

export interface PorterReview {
    batch: string;
    lines: PorterReviewLine[];
    /** The only projects that may be chosen: Won ones. */
    projects: { name: string; project_name: string }[];
}

/** A remark group, assigned as one, or a single order with no remark. */
export interface ReviewItem {
    key: string;
    kind: "group" | "order";
    remark: string;
    city: string;
    lines: PorterReviewLine[];
    fare: number;
    /** The project every order is on; null when they are Non-Project or disagree. */
    project: string | null;
    projectName: string | null;
    /** The orders are not all placed alike. */
    mixed: boolean;
    /** A weak suggestion, or orders that disagree: look at it first. */
    needsCheck: boolean;
    /** Every distinct reason among its orders. */
    reasons: string[];
    /** The orders a choice places: those still editable. A created order is moved with Rectify. */
    toPlace: string[];
    /** Any order of it can still be placed. */
    editable: boolean;
}

const placementOf = (line: PorterReviewLine) =>
    line.ledger === PROJECT_LEDGER && line.project ? line.project : null;

const toItem = (key: string, kind: ReviewItem["kind"], lines: PorterReviewLine[]): ReviewItem => {
    const placements = new Set(lines.map(placementOf));
    const mixed = placements.size > 1;
    const project = mixed ? null : placementOf(lines[0]);
    return {
        key,
        kind,
        remark: lines[0].remarks.trim(),
        city: lines[0].city,
        lines,
        fare: lines.reduce((sum, line) => sum + line.fare, 0),
        project,
        projectName: project ? lines.find((line) => line.project === project)?.project_name ?? project : null,
        mixed,
        needsCheck: mixed || lines.some((line) => line.strength === "Check"),
        reasons: [...new Set(lines.map((line) => line.reason).filter((reason): reason is string => Boolean(reason)))],
        toPlace: lines.filter((line) => line.editable).map((line) => line.name),
        editable: lines.some((line) => line.editable),
    };
};

/**
 * 0: check it (a weak suggestion, or a group that disagrees); 1: no project was found, so it would become
 * Non-Project unless someone places it; 2: a strong suggestion, or a placement already chosen in review.
 */
const tierOf = (item: ReviewItem): number => {
    if (item.needsCheck) return 0;
    if (!item.project && item.lines.some((line) => line.reason !== "review")) return 1;
    return 2;
};

const firstCompleted = (item: ReviewItem) =>
    item.lines.reduce((first, line) => (line.completed_on && line.completed_on < first ? line.completed_on : first), "~");

/**
 * The orders as the reviewer sees them: one item per remark group, one per order with no remark; checks
 * first, then orders with no project, then the rest; within a tier, bigger groups, then the earlier order.
 */
export const reviewItems = (lines: PorterReviewLine[]): ReviewItem[] => {
    const groups = new Map<string, PorterReviewLine[]>();
    const items: ReviewItem[] = [];
    for (const line of lines) {
        if (!line.group_key) {
            items.push(toItem(`order:${line.name}`, "order", [line]));
            continue;
        }
        const members = groups.get(line.group_key);
        if (members) members.push(line);
        else groups.set(line.group_key, [line]);
    }
    for (const [key, members] of groups) items.push(toItem(`group:${key}`, "group", members));
    return items.sort(
        (a, b) =>
            tierOf(a) - tierOf(b) ||
            b.lines.length - a.lines.length ||
            firstCompleted(a).localeCompare(firstCompleted(b)) ||
            a.key.localeCompare(b.key),
    );
};

/**
 * The items in the order they were first shown, so an edit that changes an item's tier does not move it
 * under the reader's cursor. Items not shown before follow, in their own order.
 */
export const keepShownOrder = (items: ReviewItem[], shownKeys: readonly string[]): ReviewItem[] => {
    const at = new Map(shownKeys.map((key, index) => [key, index]));
    const seen = items.filter((item) => at.has(item.key)).sort((a, b) => at.get(a.key)! - at.get(b.key)!);
    return [...seen, ...items.filter((item) => !at.has(item.key))];
};

const chosenByPerson = (line: PorterReviewLine) => line.editable && line.reason === "review";

/**
 * Choose projects (#1560): only the items a person has to decide -- any order of it needs a person -- and
 * the ones a person already decided and could still change, so a choice stays on screen. A sure placement
 * is left out: it is shown on the next screen.
 */
export const choiceItems = (lines: PorterReviewLine[]): ReviewItem[] =>
    reviewItems(lines).filter((item) => item.lines.some((line) => line.needs_person || chosenByPerson(line)));

const orders = (count: number) => `${count} ${count === 1 ? "order" : "orders"}`;

/** The step's heading and the note under it. "All N placed automatically" only when nobody had to choose. */
export const choiceSummary = (lines: PorterReviewLine[]): { heading: string; note: string | null } => {
    const listed = new Set(choiceItems(lines).flatMap((item) => item.lines.map((line) => line.name)));
    if (listed.size === 0) return { heading: `All ${orders(lines.length)} placed automatically.`, note: null };
    const left = lines.filter((line) => line.needs_person).length;
    const automatic = lines.length - listed.size;
    return {
        heading: `${orders(left)} ${left === 1 ? "needs" : "need"} a project`,
        note: automatic === 0 ? null : `${orders(automatic)} ${automatic === 1 ? "was" : "were"} placed automatically. You'll see ${
            automatic === 1 ? "it" : "them"
        } on the next screen.`,
    };
};

/** The footer's Next: locked, and counting down, while any order needs a person. */
export const nextConfirmLabel = (left: number): string => (left > 0 ? `Next: confirm (${left} left)` : "Next: confirm");

/** Where the item's orders would go: its project, Non-Project, or how a disagreeing group splits. */
export const placementLabel = (item: ReviewItem): string => {
    const nameOf = (line: PorterReviewLine) => (placementOf(line) ? line.project_name ?? line.project! : "Non-Project");
    if (!item.mixed) return nameOf(item.lines[0]);
    const counts = new Map<string, number>();
    for (const line of item.lines) counts.set(nameOf(line), (counts.get(nameOf(line)) ?? 0) + 1);
    return `Mixed: ${[...counts].map(([name, count]) => `${count} ${name}`).join(", ")}`;
};

// Why a placement was made, as `Outflow Import Row.placement_reason` spells it (`porter.REASON_*`). Signals
// that agreed are joined by "+" (`porter_placement.REASONS_JOINED_BY`): "name+address".
const REASON_LABELS: Record<string, string> = {
    name: "Project name in the remark",
    typo: "Project name misspelt in the remark",
    initials: "Project initials in the remark",
    address: "Its site address",
    history: "Kept so in an earlier Porter import",
    conflict: "Name and most addresses point to different projects",
    review: "Chosen in review",
};

// How a signal reads after the first one: "…, and its site address".
const AGREEING_LABELS: Record<string, string> = { address: "its site address" };

/** The reason in words. ⚠️ A reason this screen does not know yet is shown as it is, never hidden. */
export const reasonLabel = (reason: string | null | undefined): string => {
    if (!reason) return "No project found";
    const [first, ...agreeing] = reason.split("+");
    return [REASON_LABELS[first] ?? first, ...agreeing.map((part) => AGREEING_LABELS[part] ?? part)].join(", and ");
};

/** A strong suggestion is shown plain; a weak one says "Check". */
export const strengthLabel = (strength: string | null | undefined): string | null =>
    strength === "Check" ? "Check" : null;

/**
 * Review is offered once every invoice has passed (the server refuses it otherwise too), and again while a
 * stopped Create still has orders to write: a line in Error, or one Unreconcile reopened, can be re-placed
 * before Create runs again (the server accepts exactly those lines). Not while the Create job runs.
 */
export const porterReviewOffered = (
    status: { state: string; to_create?: number; create_running?: boolean } | null | undefined,
): boolean =>
    status?.state === "Validated" ||
    (status?.state === "Creating" && !status.create_running && (status.to_create ?? 0) > 0);
