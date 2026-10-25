import { useRef } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { TailSpin } from "react-loader-spinner";
import { Info } from "lucide-react";

import { AccessBlockedCard } from "@/components/layout/AccessBlockedCard";
import { Button } from "@/components/ui/button";
import { useAppAccess } from "@/hooks/useAppAccess";
import { useUserData } from "@/hooks/useUserData";
import { type AccessSeen, gracePathAfter, isPathOpen } from "@/utils/appAccess";
import { ROLE_LOADING_TEXT } from "@/utils/auth/ProtectedRoute";

/**
 * Every signed-in page renders through this (`main-layout.tsx`). While the app is locked (`utils/appAccess.ts`) the
 * dashboard shows the card instead of the role dashboard, the few pages the blockers need stay open, and every
 * other path -- typed, bookmarked, or a notification / push link -- goes back to the dashboard. A lock that starts
 * while the person is on a page lets them finish that page first, under a notice bar (`gracePathAfter`).
 */
export function AppAccessGate() {
  const { state, blockers, openPaths } = useAppAccess();
  const { user_id } = useUserData();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  // Worked out while rendering, not in an effect: the render that first sees the lock must already know whether
  // to keep the page, or it would redirect before an effect could stop it.
  const seen = useRef<AccessSeen | null>(null);
  const grace = useRef<string | null>(null);
  grace.current = gracePathAfter(seen.current, grace.current, { state, pathname });
  seen.current = { state, pathname };

  if (state === "loading") {
    return (
      <div className="flex h-[50vh] flex-col items-center justify-center gap-3">
        <TailSpin visible height="48" width="48" color="#D03B45" ariaLabel="tail-spin-loading" />
        <p className="text-sm text-gray-600">{ROLE_LOADING_TEXT}</p>
      </div>
    );
  }
  if (state === "open") return <Outlet />;
  if (pathname === "/") return <AccessBlockedCard blockers={blockers} />;
  if (isPathOpen(pathname, user_id, openPaths)) return <Outlet />;
  if (grace.current === pathname) {
    return (
      <>
        <div
          role="status"
          className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900"
        >
          <span className="flex items-center gap-2">
            <Info className="h-4 w-4 flex-shrink-0" aria-hidden />
            Something needs your attention. You can finish this page; the rest of Nirmaan locks when you leave it.
          </span>
          <Button size="sm" variant="outline" className="bg-white" onClick={() => navigate("/")}>
            See what's needed
          </Button>
        </div>
        <Outlet />
      </>
    );
  }
  return <Navigate to="/" replace />;
}
