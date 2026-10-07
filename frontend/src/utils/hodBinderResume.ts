// Where a RUNNING handover-binder job is remembered, so the screen can pick it back up.
//
// A build outlives the screen: it runs on the server and its status is cached there for an hour
// (`api/hod/binder.STATUS_TTL_SECONDS`). But the Handover Documents tab unmounts whenever the project
// page changes tab, so without a resume point the hook came back with no job: nothing polled, the
// `hod_binder_ready` event reached a null job id and was dropped, and the finished PDF never
// downloaded -- while the server's per-user lock went on refusing a new build for fifteen minutes.
//
// It lives HERE, not in the hook, because the hook is a page module and this is the one place a stored
// shape is parsed (ADR-0010 F2/F4: pages stay thin over pure logic, and a shape is parsed at one typed
// accessor).
//
// sessionStorage, not localStorage, ON PURPOSE: it is per browser tab, so the PDF is delivered to the
// tab that asked for it and a second tab can never steal it.

const KEY = "hod-binder-job";
/** Past this the server's cached status is gone, so a resumed job could only hang until it stalls. */
const MAX_AGE_MS = 60 * 60 * 1000;

export interface HodBinderResume {
  jobId: string;
  /** The system whose binder is building. */
  hodSystem: string;
  /** One document's content, or null for the whole binder. */
  document: string | null;
  title: string;
  startedAt: number;
}

export function readBinderResume(): HodBinderResume | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (typeof v?.jobId !== "string" || typeof v?.hodSystem !== "string") return null;
    if (typeof v.startedAt !== "number" || Date.now() - v.startedAt > MAX_AGE_MS) return null;
    return {
      jobId: v.jobId,
      hodSystem: v.hodSystem,
      document: v.document ?? null,
      title: v.title ?? "",
      startedAt: v.startedAt,
    };
  } catch {
    // Blocked or private-mode storage: resuming is a convenience, never a requirement.
    return null;
  }
}

export function writeBinderResume(v: HodBinderResume | null): void {
  try {
    if (v) sessionStorage.setItem(KEY, JSON.stringify(v));
    else sessionStorage.removeItem(KEY);
  } catch {
    // Same: a build that cannot be remembered still runs, it just cannot be picked up again.
  }
}
