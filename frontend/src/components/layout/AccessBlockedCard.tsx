import { Fragment, type ReactNode, useContext } from "react";
import { useNavigate } from "react-router-dom";
import { useFrappeGetDoc } from "frappe-react-sdk";
import { ArrowRight, ClipboardCheck, FileSignature, FolderX, Lock, LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useUserData } from "@/hooks/useUserData";
import { cn } from "@/lib/utils";
import { UserContext } from "@/utils/auth/UserProvider";
import { type AssetTaskItem, type Blocker, assetTaskItems } from "@/utils/appAccess";

/**
 * What the dashboard shows while the app is locked (`utils/appAccess.ts`). Layout approved by the owner on
 * 2026-10-22 ("finance look", in Nirmaan red, not navy): a red summary panel -- across the top on a phone, down the
 * left on a wider screen -- then white lists: "Your to-do" (what the person can clear, with Pending / Overdue
 * labels) and "Waiting on your admin" (no project). On a phone the main button stays at the bottom of the screen.
 * The words are the ones the owner approved earlier; only pending lines show. It replaces the old inline "You are
 * not Assigned to any project" alert.
 */
export function AccessBlockedCard({ blockers }: { blockers: readonly Blocker[] }) {
  const navigate = useNavigate();
  const { user_id } = useUserData();
  const { logout } = useContext(UserContext);

  const assetTasks = blockers.find((blocker) => blocker.key === "asset_tasks");
  const items = assetTasks?.key === "asset_tasks" ? assetTaskItems(assetTasks) : [];
  const noProject = blockers.some((blocker) => blocker.key === "no_project");
  const pending = items.length + (noProject ? 1 : 0);
  // The profile opens the Project / IT sub-tab that has something pending (`assetTabToOpen`).
  const openMyAssets = () => navigate(`/users/${user_id}?tab=assets`);

  return (
    // The header is h-14 (3.5rem): the screen below it.
    <div className="flex min-h-[calc(100dvh-3.5rem)] flex-col bg-slate-50 md:items-center md:justify-center md:px-6 md:py-10">
      <div className="flex w-full flex-1 flex-col md:max-w-xl md:flex-none md:overflow-hidden md:rounded-2xl md:border md:border-slate-200 md:bg-white md:shadow-md xl:max-w-4xl xl:flex-row">
        {/* Summary: red, across the top on a phone and a tablet (an iPad mini is too narrow for two columns), down the
            left from 1280px up (the sidebar takes ~250px, so 1024px would squeeze it again). */}
        <div className="flex flex-col gap-3 bg-primary px-5 py-6 text-primary-foreground md:px-7 md:py-7 xl:w-80 xl:flex-shrink-0 xl:gap-4 xl:py-8">
          <div className="flex items-center justify-between gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15">
              <Lock className="h-5 w-5" aria-hidden />
            </span>
            <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">{pending} pending</span>
          </div>
          <h2 className="text-xl font-semibold leading-tight md:text-2xl">Finish these to continue</h2>
          <p className="text-sm text-primary-foreground/85">
            Nirmaan is locked until the steps below are done. It opens again by itself as soon as they are.
          </p>
          <button
            type="button"
            onClick={logout}
            className="mt-auto hidden items-center gap-2 pt-6 text-sm text-primary-foreground/85 hover:text-primary-foreground hover:underline xl:inline-flex"
          >
            <LogOut className="h-4 w-4" aria-hidden />
            Log out
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-4 p-4 md:p-7">
          {items.length > 0 && (
            <>
              <ListLabel>Your to-do</ListLabel>
              <List>
                {items.map((item) => (
                  <TaskRow key={item.kind} item={item} />
                ))}
              </List>
              <p className="px-0.5 text-sm text-slate-500">
                Press <b className="text-slate-800">Open my assets</b>, then{" "}
                {items.map((item, index) => (
                  <Fragment key={item.kind}>
                    {index > 0 && " and "}
                    <b className="text-slate-800">{item.action}</b>
                  </Fragment>
                ))}{" "}
                on the highlighted asset.
              </p>
              <Button size="lg" className="hidden h-12 w-full text-base md:flex" onClick={openMyAssets}>
                Open my assets
                <ArrowRight className="ml-2 h-5 w-5" aria-hidden />
              </Button>
            </>
          )}
          {noProject && (
            <>
              <ListLabel className={cn(items.length > 0 && "mt-2")}>Waiting on your admin</ListLabel>
              <List>
                <NoProjectRow />
              </List>
            </>
          )}
          <button
            type="button"
            onClick={logout}
            className="hidden items-center justify-center gap-2 py-1 text-sm text-slate-500 hover:underline md:inline-flex xl:hidden"
          >
            <LogOut className="h-4 w-4" aria-hidden />
            Log out
          </button>
        </div>
      </div>

      {/* Phone: the action stays at the bottom of the screen, within thumb reach. */}
      <div className="sticky bottom-0 flex flex-col gap-2 border-t border-slate-200 bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 md:hidden">
        {items.length > 0 ? (
          <>
            <Button size="lg" className="h-12 w-full text-base" onClick={openMyAssets}>
              Open my assets
              <ArrowRight className="ml-2 h-5 w-5" aria-hidden />
            </Button>
            <button type="button" onClick={logout} className="py-1 text-sm text-slate-500 hover:underline">
              Log out
            </button>
          </>
        ) : (
          <Button variant="outline" size="lg" className="h-12 w-full" onClick={logout}>
            <LogOut className="mr-2 h-4 w-4" aria-hidden />
            Log out
          </Button>
        )}
      </div>
    </div>
  );
}

function ListLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("px-0.5 text-xs font-bold uppercase tracking-wider text-slate-500", className)}>{children}</p>
  );
}

function List({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white">
      {children}
    </div>
  );
}

function Row({
  icon,
  title,
  detail,
  pill,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  pill: { label: string; tone: "pending" | "overdue" | "admin" };
}) {
  return (
    <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-start gap-3 p-4">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700">
        {icon}
      </span>
      <div className="min-w-0 space-y-0.5">
        <p className="text-[15px] font-semibold text-slate-900">{title}</p>
        <p className="text-sm text-slate-500">{detail}</p>
      </div>
      <span
        className={cn(
          "mt-0.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold",
          pill.tone === "pending" && "bg-amber-100 text-amber-800",
          pill.tone === "overdue" && "bg-red-100 text-red-700",
          pill.tone === "admin" && "border border-slate-200 bg-slate-50 text-slate-500"
        )}
      >
        {pill.label}
      </span>
    </div>
  );
}

function TaskRow({ item }: { item: AssetTaskItem }) {
  const Icon = item.kind === "audit" ? ClipboardCheck : FileSignature;
  return (
    <Row
      icon={<Icon className="h-5 w-5" aria-hidden />}
      title={item.title}
      detail={item.detail}
      pill={item.overdueLabel ? { label: item.overdueLabel, tone: "overdue" } : { label: "Pending", tone: "pending" }}
    />
  );
}

/** Every 30 s while "No project" shows: the gate reads `has_project` from the same record (`useUserData`). */
const NO_PROJECT_RECHECK_MS = 30_000;

/** Nothing the person can do in the app: an Admin or HR assigns the project. */
function NoProjectRow() {
  const { user_id } = useUserData();
  // The card promises the app opens by itself: re-read the person's Nirmaan Users record (the same SWR key
  // `useUserData` reads) so a project assigned meanwhile lifts the lock without a reload (code review #9).
  useFrappeGetDoc("Nirmaan Users", user_id, undefined, { refreshInterval: NO_PROJECT_RECHECK_MS });
  return (
    <Row
      icon={<FolderX className="h-5 w-5" aria-hidden />}
      title="No project assigned yet"
      detail="Ask your admin or HR to assign you a project. Nirmaan opens once you have one."
      pill={{ label: "Admin", tone: "admin" }}
    />
  );
}
