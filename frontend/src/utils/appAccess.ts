import { PROJECT_REQUIRED_PROFILES } from "@/constants/roles";

/**
 * May this person use the app, or only the dashboard card that says what to sort out first (owner, 2026-10-22)?
 *
 * Every reason to lock the app is ONE entry in `RULES`. While any rule blocks, the sidebar shows only Dashboard,
 * every page but the few in `isPathOpen` goes back to `/`, and `/` shows the card (`AccessBlockedCard`) with one
 * section per blocker. A new reason is one more rule here and one more section on the card -- nothing else.
 *
 * Screens only (like every route guard here): the APIs are unchanged. Read it through `useAppAccess()`.
 */

/** What the rules read: the person, their role profile, whether they have a project, their asset tasks. */
export interface AccessInput {
  userId: string;
  /** `useUserData().role`: "Loading" until the person's Nirmaan Users record is read, "Error" if that failed. */
  role: string;
  /** `Nirmaan Users.has_project === "true"`. */
  hasProject: boolean;
  /** `useMyPendingAssetActions()`: counted with the same rules as the Sign and Submit audit buttons. */
  assets: {
    loading: boolean;
    declarations: number;
    audits: number;
    overdueAudits: number;
    held: ReadonlySet<string>;
  };
}

/** One reason the app is locked, with what the card needs to show it. */
export type Blocker =
  | { key: "no_project" }
  | { key: "asset_tasks"; declarations: number; audits: number; overdueAudits: number };

export interface AccessResult {
  state: "loading" | "locked" | "open";
  /** The rules blocking now, in `RULES` order (the card's order); empty unless locked. */
  blockers: Blocker[];
  /** The pages the blockers need to be cleared, besides "/" and the person's own profile. */
  openPaths: string[];
}

interface AccessRule {
  /** Who the rule is for. */
  applies: (input: AccessInput) => boolean;
  /** The blocker while the rule locks the app, else null. */
  blocker: (input: AccessInput) => Blocker | null;
  /** The pages the person needs to clear it, besides "/" and their own profile (always open while locked). */
  openPaths: (input: AccessInput) => string[];
}

// The card lists the blockers in this order: what the person can clear themselves first, then what someone else must.
const RULES: readonly AccessRule[] = [
  {
    // Every holder signs their declaration and sends the monthly audit (owner, 2026-10-21: Admin included; an
    // audit locks as soon as it opens on the 28th). Both are done on the profile's Assets tab; the pages of the
    // assets they hold stay open too (the card's asset name links there, and it has Sign Declaration).
    applies: () => true,
    blocker: ({ assets }) =>
      assets.declarations + assets.audits > 0
        ? {
            key: "asset_tasks",
            declarations: assets.declarations,
            audits: assets.audits,
            overdueAudits: assets.overdueAudits,
          }
        : null,
    openPaths: ({ assets }) => [...assets.held].map((asset) => `/asset-management/${asset}`),
  },
  {
    // The project roles can't work without a project; an Admin or HR assigns one (`has_project` follows the
    // person's project User Permissions, server-side).
    applies: (input) => PROJECT_REQUIRED_PROFILES.includes(input.role),
    blocker: (input) => (input.hasProject ? null : { key: "no_project" }),
    openPaths: () => [],
  },
];

const OPEN: AccessResult = { state: "open", blockers: [], openPaths: [] };
const LOADING: AccessResult = { state: "loading", blockers: [], openPaths: [] };

/**
 * The gate's answer. The `Administrator` login is never locked (it holds no assets and has no profile). While the
 * role or the asset tasks are still loading the answer is "loading", so a blocked page never shows first. A failed
 * read never locks: a role of "Error" is in no rule's list, and a failed asset read counts nothing.
 */
export function accessState(input: AccessInput): AccessResult {
  if (!input.userId || input.userId === "Administrator") return OPEN;
  if (input.role === "Loading" || input.assets.loading) return LOADING;
  const blockers: Blocker[] = [];
  const openPaths: string[] = [];
  for (const rule of RULES) {
    if (!rule.applies(input)) continue;
    const blocker = rule.blocker(input);
    if (!blocker) continue;
    blockers.push(blocker);
    openPaths.push(...rule.openPaths(input));
  }
  return blockers.length ? { state: "locked", blockers, openPaths } : OPEN;
}

/**
 * The answer to show while a recheck runs: once a real answer ("open" / "locked") exists, a later "loading" keeps it
 * instead of swapping the page for the spinner again (code review #1). A failed read's retry, or the role read
 * coming back as "Loading" during one, would otherwise unmount the page -- and any half-filled form -- every few
 * seconds. Only the very first answer of a session waits on the spinner.
 */
export function keepSettled(previous: AccessResult | null, next: AccessResult): AccessResult {
  return next.state === "loading" && previous ? previous : next;
}

/** The last real answer this browser saw for a person (code review #5, option A; owner 2026-10-22). */
export interface RememberedAccess {
  userId: string;
  state: "open" | "locked";
}

/** A stored `RememberedAccess`, or null for anything else (nothing stored, old or broken text). */
export function readRememberedAccess(raw: string | null | undefined): RememberedAccess | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<RememberedAccess> | null;
    if (value && typeof value.userId === "string" && value.userId && (value.state === "open" || value.state === "locked")) {
      return { userId: value.userId, state: value.state };
    }
  } catch {
    // not JSON: nothing remembered
  }
  return null;
}

/**
 * The answer to render while the check runs (code review #5, option A). A real answer from this visit always wins
 * (`keepSettled`). Before the first one, a person whose last answer in this browser was "open" gets the page at
 * once instead of the spinner; the check still runs, and if it now says locked, the page they are on finishes under
 * the notice bar (`gracePathAfter`) and the lock applies at their next page change. A remembered "locked", another
 * person's note, or none at all: wait as before.
 */
export function startingAnswer(
  previous: AccessResult | null,
  remembered: RememberedAccess | null,
  userId: string,
  current: AccessResult
): AccessResult {
  const settled = keepSettled(previous, current);
  if (settled.state === "loading" && remembered?.userId === userId && remembered.state === "open") return OPEN;
  return settled;
}

/** Where the gate stood on the previous render. */
export interface AccessSeen {
  state: AccessResult["state"];
  pathname: string;
}

/**
 * The page a person may finish although the app has just locked (code review #2), or null. When the lock starts
 * while they are on a page -- the 28th's audit opens, an asset is assigned to them, a project is taken away -- they
 * keep THAT page (the gate shows a notice bar) instead of being sent away with their unsaved work; the lock applies
 * at the next page change. A lock found on arrival (a reload, a link) gets no such grace.
 */
export function gracePathAfter(previous: AccessSeen | null, grace: string | null, next: AccessSeen): string | null {
  if (next.state !== "locked") return null;
  if (grace !== null) return grace === next.pathname ? grace : null;
  return previous?.state === "open" && previous.pathname === next.pathname ? next.pathname : null;
}

/** One line of the card's asset section: a declaration to sign or an audit to send. */
export interface AssetTaskItem {
  kind: "declaration" | "audit";
  /** "1 asset declaration to sign", "2 monthly audits to submit". */
  title: string;
  /** What it is, in one plain sentence. */
  detail: string;
  /** Audits only: "Overdue" when all are, "1 overdue" when some are; null otherwise. */
  overdueLabel: string | null;
  /** The button the person presses for it on their profile. */
  action: "Sign" | "Submit audit";
}

/**
 * The asset section's lines (owner, 2026-10-22): only what is pending -- a count of 0 is not shown -- declarations
 * first, since signing one can open that month's audit.
 */
export function assetTaskItems(blocker: Extract<Blocker, { key: "asset_tasks" }>): AssetTaskItem[] {
  const items: AssetTaskItem[] = [];
  if (blocker.declarations > 0) {
    const n = blocker.declarations;
    items.push({
      kind: "declaration",
      title: `${n} asset declaration${n === 1 ? "" : "s"} to sign`,
      detail: `Read the declaration form for the asset${n === 1 ? "" : "s"} you hold and sign it.`,
      overdueLabel: null,
      action: "Sign",
    });
  }
  if (blocker.audits > 0) {
    const n = blocker.audits;
    const overdue = Math.min(blocker.overdueAudits, n);
    items.push({
      kind: "audit",
      title: `${n} monthly audit${n === 1 ? "" : "s"} to submit`,
      detail: `Tell us whether ${n === 1 ? "the asset is" : "each asset is"} working. It takes a minute.`,
      overdueLabel: overdue === 0 ? null : overdue === n ? "Overdue" : `${overdue} overdue`,
      action: "Submit audit",
    });
  }
  return items;
}

/** "/users/a%40b.com/" -> "/users/a@b.com": decoded, without a trailing slash. */
function normalizePath(path: string): string {
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    // A malformed escape: compare it as it is.
  }
  return decoded.replace(/\/+$/, "") || "/";
}

/**
 * May `pathname` show while the app is locked? The dashboard (it shows the card) and the person's own profile (any
 * `?tab`, not `/edit`) always may; so may each blocker's `openPaths`. Everything else goes back to the dashboard.
 */
export function isPathOpen(pathname: string, userId: string, openPaths: readonly string[]): boolean {
  const path = normalizePath(pathname);
  if (path === "/") return true;
  if (userId && path === normalizePath(`/users/${userId}`)) return true;
  return openPaths.some((open) => normalizePath(open) === path);
}
