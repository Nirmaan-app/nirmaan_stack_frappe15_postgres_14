// src/pages/outflow-import/porterProgress.ts
//
// The Porter import's progress bar (#1556, spec #1554 stories 49, 56-60), as pure data. No React, no fetch.
// `PorterProgressBar` renders the four phases at the top of the Porter dialog; Import History renders
// `historyChips` as one line per Porter row. Both read the server's per-phase summary
// (`porter_state.import_progress`), `progress` on `get_porter_status` and on `list_imports`.

/**
 * The server's per-phase summary. Each phase is a flat set of counts, so a later ticket adds one (warnings,
 * a mixed remark group needing a person) without reshaping it.
 */
export interface PorterProgress {
    upload: { orders: number; invoices: number; cancelled: number };
    check: {
        invoices: number;
        passed: number;
        in_progress: number;
        /** Error: the PDF could not be read. */
        to_retry: number;
        /** Failed: the PDF disagrees with the statement. */
        not_matching: number;
        /** A rough estimate while invoices are being checked; null once none is. */
        seconds_left: number | null;
    };
    projects: { orders: number; placed_automatically: number; placed_by_person: number; needs_person: number };
    create: {
        orders: number;
        created: number;
        waiting: number;
        failed: number;
        /** Unreconciled after Create: a run of Create writes it again. */
        reopened: number;
        /** A Create job is queued or running. */
        running: boolean;
    };
}

/**
 * Whose turn each phase is: nothing left (done), the system is working (running), a person's turn
 * (needs), stopped on something a person cannot simply act on (blocked). `current` is the Upload phase
 * before any file is uploaded; `idle` a phase that has not started.
 */
export type PhaseTone = "done" | "running" | "needs" | "blocked" | "current" | "idle";

export type PhaseKey = "upload" | "check" | "projects" | "create";

export interface PhaseView {
    key: PhaseKey;
    title: string;
    tone: PhaseTone;
    /** The phase's counts in words, under its title. */
    counts: string;
    /** The phase on one Import History chip. */
    chip: string;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

const NOT_STARTED = "Not started";
const AFTER_CHECK = "After the check";

const checkProblems = ({ passed, to_retry, not_matching }: PorterProgress["check"]): string =>
    [
        `${passed} passed`,
        to_retry > 0 ? `${to_retry} to retry` : null,
        not_matching > 0 ? `${not_matching} ${not_matching === 1 ? "doesn't" : "don't"} match` : null,
    ]
        .filter(Boolean)
        .join(" · ");

const uploadPhase = (progress: PorterProgress | null): PhaseView => {
    if (!progress) return { key: "upload", title: "Upload", tone: "current", counts: "Choose the file", chip: "Upload" };
    const { orders, cancelled } = progress.upload;
    const counts = [plural(orders, "order", "orders"), cancelled > 0 ? `${cancelled} cancelled` : null]
        .filter(Boolean)
        .join(" · ");
    return { key: "upload", title: "Upload", tone: "done", counts, chip: "Uploaded" };
};

const checkPhase = (check: PorterProgress["check"]): PhaseView => {
    const base = { key: "check" as const, title: "Check invoices" };
    if (check.in_progress > 0) {
        const minutes = Math.max(1, Math.ceil((check.seconds_left ?? 0) / 60));
        const of = `${check.invoices - check.in_progress} of ${check.invoices} checked`;
        return { ...base, tone: "running", counts: `${of} · about ${minutes} min left`, chip: `Checking · ${of}` };
    }
    if (check.not_matching > 0 || check.to_retry > 0) {
        const counts = checkProblems(check);
        return { ...base, tone: check.not_matching > 0 ? "blocked" : "needs", counts, chip: `Invoices: ${counts}` };
    }
    if (check.invoices === 0) return { ...base, tone: "blocked", counts: "No invoices", chip: "No invoices" };
    return {
        ...base,
        tone: "done",
        counts: `${check.passed} of ${check.invoices} passed`,
        chip: `${plural(check.invoices, "invoice", "invoices")} checked`,
    };
};

const checkDone = (check: PorterProgress["check"]) => check.invoices > 0 && check.passed === check.invoices;

/** Create has written something, or is running: placing projects is behind the import. */
const createStarted = ({ created, failed, reopened, running }: PorterProgress["create"]) =>
    running || created + failed + reopened > 0;

const projectsPhase = (progress: PorterProgress): PhaseView => {
    const base = { key: "projects" as const, title: "Choose projects" };
    if (!checkDone(progress.check)) return { ...base, tone: "idle", counts: AFTER_CHECK, chip: "Projects waiting" };
    const { orders, needs_person } = progress.projects;
    if (needs_person > 0 && !createStarted(progress.create)) {
        return {
            ...base,
            tone: "needs",
            counts: `${needs_person} of ${orders} need you`,
            chip: `${plural(needs_person, "order needs", "orders need")} a project`,
        };
    }
    return { ...base, tone: "done", counts: `${orders} placed`, chip: `${orders} placed` };
};

const createPhase = (progress: PorterProgress): PhaseView => {
    const base = { key: "create" as const, title: "Confirm & create" };
    if (!checkDone(progress.check)) return { ...base, tone: "idle", counts: AFTER_CHECK, chip: "Create waiting" };
    const create = progress.create;
    const of = `${create.created} of ${create.orders}`;
    if (create.running) return { ...base, tone: "running", counts: `Creating · ${of}`, chip: `Creating · ${of}` };
    if (create.created === create.orders) {
        return { ...base, tone: "done", counts: `${of} created`, chip: `${plural(create.created, "expense", "expenses")} created` };
    }
    // ⚠️ A PARTLY CREATED IMPORT WITH NO JOB RUNNING IS A PERSON'S TURN, NEVER "CREATING" (story 49):
    // what is left is created only when someone presses Create again, or re-places a failed order.
    if (createStarted(create)) {
        const left = create.orders - create.created;
        const need = `${left} ${left === 1 ? "needs" : "need"} you`;
        return { ...base, tone: "needs", counts: `${of} · ${need}`, chip: `${of} created · ${need}` };
    }
    if (progress.projects.needs_person > 0) return { ...base, tone: "idle", counts: "Waiting", chip: "Create waiting" };
    return {
        ...base,
        tone: "needs",
        counts: `${create.waiting} to create`,
        chip: `${plural(create.waiting, "expense", "expenses")} to create`,
    };
};

/** The four phases of the bar, from the server's summary; null before anything is uploaded. */
export const progressPhases = (progress: PorterProgress | null | undefined): PhaseView[] => {
    if (!progress) {
        const idle = (key: PhaseKey, title: string): PhaseView => ({ key, title, tone: "idle", counts: NOT_STARTED, chip: title });
        return [uploadPhase(null), idle("check", "Check invoices"), idle("projects", "Choose projects"), idle("create", "Confirm & create")];
    }
    return [uploadPhase(progress), checkPhase(progress.check), projectsPhase(progress), createPhase(progress)];
};

/** The word a person sees for a partly created import with no Create job running (story 49). */
export const NEEDS_YOU_STATE = "Needs you";

/**
 * The import's state as a person reads it. ⚠️ THE SERVER'S `state` READS "Creating" FOR ANY PARTLY CREATED
 * IMPORT (the Create gates key off it, so it stays); shown, "Creating" means a Create job really is queued or
 * running, and a partly created import with none is a person's turn.
 */
export const shownPorterState = ({ state, create_running }: { state: string; create_running?: boolean | null }): string =>
    state === "Creating" && !create_running ? NEEDS_YOU_STATE : state;

/** Import History's one line for a Porter import: one chip per phase, coloured as the bar is. */
export const historyChips = (progress: PorterProgress): { tone: PhaseTone; label: string }[] =>
    progressPhases(progress).map(({ tone, chip }) => ({ tone, label: chip }));
