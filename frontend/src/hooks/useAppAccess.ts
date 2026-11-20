import { useEffect, useMemo, useState } from "react";

import { useMyPendingAssetActions } from "@/hooks/useUserAssignments";
import { useUserData } from "@/hooks/useUserData";
import {
  accessState,
  readRememberedAccess,
  startingAnswer,
  type AccessResult,
  type RememberedAccess,
} from "@/utils/appAccess";

/** Where this browser keeps the last real answer per person (only "open" / "locked" and the user ID). */
const REMEMBERED_ACCESS_KEY = "nirmaan:app-access:last";

function loadRememberedAccess(): RememberedAccess | null {
  try {
    return readRememberedAccess(window.localStorage.getItem(REMEMBERED_ACCESS_KEY));
  } catch {
    return null; // storage blocked (private window, settings): nothing remembered, wait as before
  }
}

function saveRememberedAccess(value: RememberedAccess) {
  try {
    window.localStorage.setItem(REMEMBERED_ACCESS_KEY, JSON.stringify(value));
  } catch {
    // storage blocked: the next visit just waits for the check
  }
}

/**
 * May the signed-in person use the app now (`utils/appAccess.ts`)? The gate in the main layout, the sidebar, the
 * user menu and the dashboard card all read this one answer. Its queries are the ones the app already makes, and
 * SWR shares them, so every caller costs nothing extra.
 *
 * The first answer of a visit doesn't keep a person who was open last time waiting (code review #5, option A):
 * `startingAnswer` lets the page show while the check runs; the real answer is remembered for next time.
 */
export function useAppAccess(): AccessResult {
  const { user_id, role, has_project } = useUserData();
  const { declarations, audits, overdueAudits, held, isLoading } = useMyPendingAssetActions();
  const current = useMemo(
    () =>
      accessState({
        userId: user_id,
        role,
        hasProject: has_project === "true",
        assets: { loading: isLoading, declarations, audits, overdueAudits, held },
      }),
    [user_id, role, has_project, isLoading, declarations, audits, overdueAudits, held]
  );

  // Read once per mount: the last real answer this browser saw.
  const [remembered, setRemembered] = useState<RememberedAccess | null>(loadRememberedAccess);

  // The last real answer of this visit, for this person: a recheck never brings the spinner back (`keepSettled`).
  // Adjusted during render (so this render already uses it), only when a new real answer arrives.
  const [settled, setSettled] = useState<{ userId: string; result: AccessResult } | null>(null);
  let latest = settled;
  if (current.state !== "loading" && (settled === null || settled.userId !== user_id || settled.result !== current)) {
    latest = { userId: user_id, result: current };
    setSettled(latest);
  }
  const previous = latest?.userId === user_id ? latest.result : null;

  // Remember each real answer for the next visit (only when it changes).
  useEffect(() => {
    if (!user_id || current.state === "loading") return;
    if (remembered?.userId === user_id && remembered.state === current.state) return;
    const next: RememberedAccess = { userId: user_id, state: current.state };
    setRemembered(next);
    saveRememberedAccess(next);
  }, [user_id, current.state, remembered]);

  return startingAnswer(previous, remembered, user_id, current);
}
