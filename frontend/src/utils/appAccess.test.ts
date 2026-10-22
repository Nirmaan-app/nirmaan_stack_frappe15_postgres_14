import { describe, expect, it } from "vitest";

import {
  ADMIN_PROFILE,
  BILLING_EXECUTIVE_PROFILE,
  BILLING_LEAD_PROFILE,
  HR_EXECUTIVE_PROFILE,
  HR_LEAD_PROFILE,
  MATERIAL_PROCUREMENT_EXECUTIVE_PROFILE,
  PMO_EXECUTIVE_PROFILE,
  PROCUREMENT_EXECUTIVE_PROFILE,
  PROCUREMENT_LEAD_PROFILE,
  PROJECT_LEAD_PROFILE,
  PROJECT_MANAGER_PROFILE,
  SERVICE_PROCUREMENT_EXECUTIVE_PROFILE,
} from "@/constants/roles";

import {
  accessState,
  assetTaskItems,
  gracePathAfter,
  isPathOpen,
  keepSettled,
  readRememberedAccess,
  startingAnswer,
  type AccessInput,
} from "./appAccess";

const ME = "bittu@nirmaan.app";

const noAssets: AccessInput["assets"] = {
  loading: false,
  declarations: 0,
  audits: 0,
  overdueAudits: 0,
  held: new Set<string>(),
};

const input = (over: Partial<AccessInput> = {}): AccessInput => ({
  userId: ME,
  role: PROJECT_MANAGER_PROFILE,
  hasProject: true,
  assets: noAssets,
  ...over,
});

const withTasks = (declarations: number, audits: number, held: string[] = ["ASSET-MS-003"]) => ({
  ...noAssets,
  declarations,
  audits,
  held: new Set(held),
});

describe("accessState: no project", () => {
  const projectRoles = [
    PROJECT_MANAGER_PROFILE,
    PROJECT_LEAD_PROFILE,
    PROCUREMENT_EXECUTIVE_PROFILE,
    PROCUREMENT_LEAD_PROFILE,
    MATERIAL_PROCUREMENT_EXECUTIVE_PROFILE,
  ];

  it.each(projectRoles)("locks %s while no project is assigned", (role) => {
    const result = accessState(input({ role, hasProject: false }));
    expect(result.state).toBe("locked");
    expect(result.blockers).toEqual([{ key: "no_project" }]);
    expect(result.openPaths).toEqual([]);
  });

  it.each(projectRoles)("opens for %s once a project is assigned", (role) => {
    expect(accessState(input({ role, hasProject: true })).state).toBe("open");
  });

  // HR Lead and Billing Lead follow their Executives (owner, 2026-10-22); the company-wide desks never get projects.
  it.each([
    HR_LEAD_PROFILE,
    BILLING_LEAD_PROFILE,
    HR_EXECUTIVE_PROFILE,
    BILLING_EXECUTIVE_PROFILE,
    SERVICE_PROCUREMENT_EXECUTIVE_PROFILE,
    "Nirmaan Estimates Executive Profile",
    "Nirmaan Accountant Profile",
    "Nirmaan Design Lead Profile",
    "Nirmaan Sales Executive Profile",
    ADMIN_PROFILE,
    PMO_EXECUTIVE_PROFILE,
    "",
  ])("never locks %s for having no project", (role) => {
    expect(accessState(input({ role, hasProject: false })).state).toBe("open");
  });
});

describe("accessState: asset tasks", () => {
  it("locks anyone with a declaration to sign, Admin included", () => {
    const result = accessState(input({ role: ADMIN_PROFILE, assets: withTasks(1, 0) }));
    expect(result.state).toBe("locked");
    expect(result.blockers).toEqual([{ key: "asset_tasks", declarations: 1, audits: 0, overdueAudits: 0 }]);
  });

  it("locks on an audit to send and carries the overdue count for the card", () => {
    const result = accessState(input({ assets: { ...withTasks(0, 2), overdueAudits: 1 } }));
    expect(result.blockers).toEqual([{ key: "asset_tasks", declarations: 0, audits: 2, overdueAudits: 1 }]);
  });

  it("keeps the held assets' pages open while it locks", () => {
    const result = accessState(input({ assets: withTasks(1, 1, ["ASSET-MS-003", "ASSET-MS -005"]) }));
    expect(result.openPaths).toEqual(["/asset-management/ASSET-MS-003", "/asset-management/ASSET-MS -005"]);
  });

  it("is open with nothing to do", () => {
    expect(accessState(input()).state).toBe("open");
  });
});

describe("accessState: both rules, loading and the exceptions", () => {
  it("lists both blockers in the card's order: what the person can clear first, then the project", () => {
    const result = accessState(input({ hasProject: false, assets: withTasks(0, 1) }));
    expect(result.blockers.map((blocker) => blocker.key)).toEqual(["asset_tasks", "no_project"]);
    expect(result.openPaths).toEqual(["/asset-management/ASSET-MS-003"]);
  });

  it("stays locked on the project after the asset tasks are done", () => {
    expect(accessState(input({ hasProject: false })).blockers).toEqual([{ key: "no_project" }]);
  });

  it("never locks the Administrator login, whatever the data says", () => {
    expect(accessState(input({ userId: "Administrator", hasProject: false, assets: withTasks(3, 3) })).state).toBe("open");
  });

  it("waits while the role is loading, so a blocked page never shows first", () => {
    expect(accessState(input({ role: "Loading", hasProject: false })).state).toBe("loading");
  });

  it("waits while the asset tasks are loading", () => {
    expect(accessState(input({ assets: { ...noAssets, loading: true } })).state).toBe("loading");
  });

  it("doesn't lock on a failed role read; asset tasks still count", () => {
    expect(accessState(input({ role: "Error", hasProject: false })).state).toBe("open");
    expect(accessState(input({ role: "Error", assets: withTasks(1, 0) })).state).toBe("locked");
  });

  it("is open with no user (the login redirect handles that)", () => {
    expect(accessState(input({ userId: "", hasProject: false })).state).toBe("open");
  });
});

describe("isPathOpen", () => {
  const assetPaths = ["/asset-management/ASSET-MS-003", "/asset-management/ASSET-MS -005"];

  it.each([
    ["/", "the dashboard"],
    [`/users/${ME}`, "the own profile"],
    [`/users/${ME}/`, "the own profile with a trailing slash"],
    ["/users/bittu%40nirmaan.app", "the own profile with an encoded @"],
    ["/asset-management/ASSET-MS-003", "a held asset"],
    ["/asset-management/ASSET-MS%20-005", "a held asset whose name has a space"],
  ])("opens %s (%s)", (path) => {
    expect(isPathOpen(path, ME, assetPaths)).toBe(true);
  });

  it.each([
    ["/projects", "another page"],
    ["/users/someone@nirmaan.app", "another person's profile"],
    [`/users/${ME}/edit`, "editing the own profile"],
    ["/users", "the users list"],
    ["/asset-management", "the Assets list"],
    ["/asset-management/ASSET-LAP-001", "an asset not held"],
    ["/asset-management/ASSET-MS-003/edit", "below a held asset"],
    ["/notifications", "notifications"],
    ["/help-repository", "help"],
  ])("closes %s (%s)", (path) => {
    expect(isPathOpen(path, ME, assetPaths)).toBe(false);
  });

  it("opens no profile when there is no user", () => {
    expect(isPathOpen("/users/", "", [])).toBe(false);
  });

  it("survives a malformed escape", () => {
    expect(isPathOpen("/users/%E0%A4%A", ME, [])).toBe(false);
  });
});

describe("assetTaskItems: the card's asset lines", () => {
  const tasks = (declarations: number, audits: number, overdueAudits = 0) =>
    assetTaskItems({ key: "asset_tasks", declarations, audits, overdueAudits });

  it("shows nothing that is already done (owner, 2026-10-22: no 'Pending declaration 0')", () => {
    expect(tasks(0, 1).map((item) => item.kind)).toEqual(["audit"]);
    expect(tasks(1, 0).map((item) => item.kind)).toEqual(["declaration"]);
    expect(tasks(0, 0)).toEqual([]);
  });

  it("puts the declaration first: signing one can open that month's audit", () => {
    expect(tasks(1, 1).map((item) => [item.kind, item.action])).toEqual([
      ["declaration", "Sign"],
      ["audit", "Submit audit"],
    ]);
  });

  it("says how many, in words", () => {
    expect(tasks(1, 1).map((item) => item.title)).toEqual(["1 asset declaration to sign", "1 monthly audit to submit"]);
    expect(tasks(2, 3).map((item) => item.title)).toEqual(["2 asset declarations to sign", "3 monthly audits to submit"]);
  });

  it("marks overdue audits: all of them, some of them, or none", () => {
    expect(tasks(0, 1, 1)[0].overdueLabel).toBe("Overdue");
    expect(tasks(0, 3, 1)[0].overdueLabel).toBe("1 overdue");
    expect(tasks(0, 2, 0)[0].overdueLabel).toBeNull();
    expect(tasks(0, 1, 5)[0].overdueLabel).toBe("Overdue"); // never more overdue than pending
    expect(tasks(1, 0)[0].overdueLabel).toBeNull();
  });
});

describe("keepSettled: a recheck never brings the spinner back (code review #1)", () => {
  const open = accessState(input());
  const locked = accessState(input({ hasProject: false }));
  const loading = accessState(input({ role: "Loading" }));

  it("waits on the spinner only before the first answer", () => {
    expect(keepSettled(null, loading).state).toBe("loading");
  });

  it("keeps the last answer while a retry or revalidation is loading", () => {
    expect(keepSettled(open, loading)).toBe(open);
    expect(keepSettled(locked, loading)).toBe(locked);
  });

  it("takes every real answer at once, in both directions", () => {
    expect(keepSettled(open, locked)).toBe(locked);
    expect(keepSettled(locked, open)).toBe(open);
  });
});

describe("gracePathAfter: locked mid-page keeps that page until you leave it (code review #2)", () => {
  const seen = (state: "loading" | "locked" | "open", pathname: string) => ({ state, pathname });

  it("lets the page you were on when the lock started stay", () => {
    expect(gracePathAfter(seen("open", "/prs/new"), null, seen("locked", "/prs/new"))).toBe("/prs/new");
  });

  it("keeps the grace while you stay on that page", () => {
    expect(gracePathAfter(seen("locked", "/prs/new"), "/prs/new", seen("locked", "/prs/new"))).toBe("/prs/new");
  });

  it("ends it on the next page change -- the lock applies there", () => {
    expect(gracePathAfter(seen("locked", "/prs/new"), "/prs/new", seen("locked", "/projects"))).toBeNull();
    // and coming back to the same page later doesn't revive it
    expect(gracePathAfter(seen("locked", "/projects"), null, seen("locked", "/prs/new"))).toBeNull();
  });

  it("gives no grace to a lock found on arrival or after the first load", () => {
    expect(gracePathAfter(null, null, seen("locked", "/prs/new"))).toBeNull();
    expect(gracePathAfter(seen("loading", "/prs/new"), null, seen("locked", "/prs/new"))).toBeNull();
    expect(gracePathAfter(seen("open", "/projects"), null, seen("locked", "/prs/new"))).toBeNull();
  });

  it("drops it once the app opens again", () => {
    expect(gracePathAfter(seen("locked", "/prs/new"), "/prs/new", seen("open", "/prs/new"))).toBeNull();
  });
});

describe("option A: a person open last time doesn't wait for the check (code review #5)", () => {
  const open = accessState(input());
  const locked = accessState(input({ hasProject: false }));
  const loading = accessState(input({ role: "Loading" }));
  const rememberedOpen = { userId: ME, state: "open" as const };
  const rememberedLocked = { userId: ME, state: "locked" as const };

  it("shows the page at once while the first check runs, when the last answer here was open", () => {
    expect(startingAnswer(null, rememberedOpen, ME, loading).state).toBe("open");
  });

  it("waits as before when the last answer was locked, belongs to someone else, or there is none", () => {
    expect(startingAnswer(null, rememberedLocked, ME, loading).state).toBe("loading");
    expect(startingAnswer(null, { userId: "saima@nirmaan.app", state: "open" }, ME, loading).state).toBe("loading");
    expect(startingAnswer(null, null, ME, loading).state).toBe("loading");
  });

  it("lets the real answer win the moment it arrives -- a lock found behind the page applies (with the bar)", () => {
    expect(startingAnswer(null, rememberedOpen, ME, locked)).toBe(locked);
    expect(startingAnswer(null, rememberedLocked, ME, open)).toBe(open);
  });

  it("prefers this visit's real answer over the remembered one", () => {
    expect(startingAnswer(locked, rememberedOpen, ME, loading)).toBe(locked);
  });

  it("puts the page under the bar when the check then finds a lock on the same page (case 3)", () => {
    const first = { state: startingAnswer(null, rememberedOpen, ME, loading).state, pathname: "/prs/123" };
    expect(gracePathAfter(first, null, { state: "locked", pathname: "/prs/123" })).toBe("/prs/123");
  });

  it("reads only a well-formed note", () => {
    expect(readRememberedAccess(JSON.stringify(rememberedOpen))).toEqual(rememberedOpen);
    expect(readRememberedAccess(JSON.stringify(rememberedLocked))).toEqual(rememberedLocked);
    for (const raw of [null, undefined, "", "not json", "null", "[]", '{"userId":"x"}', '{"userId":"","state":"open"}',
      '{"userId":"x","state":"loading"}', '{"userId":5,"state":"open"}']) {
      expect(readRememberedAccess(raw)).toBeNull();
    }
  });
});
