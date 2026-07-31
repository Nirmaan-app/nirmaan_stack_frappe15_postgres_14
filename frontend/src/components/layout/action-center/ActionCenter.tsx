/**
 * ActionCenter — a reusable dashboard panel that composes role/dashboard-scoped SECTIONS
 * behind one header + LIVE badge. It is generic: it appears on many kinds of dashboards
 * (PM, Accountant, ...) and shows only the sections that apply.
 *
 * Sections today:
 *   - "reminders" → <RemindersSection/>  (role-profile compliance: GSTR / TDS / PF …)
 *   - "actions"   → <ActionTabs/>        (pending Project Action Items: DN / DC / DPR)
 *
 * Which sections show is resolved from the user's Role Profile by default
 * (`sectionsForRole`), OR passed explicitly via the `sections` prop so any dashboard can
 * compose its own mix. Adding a new section = a new component + one entry here.
 *
 * Layout: designed to be the LAST child of a `flex flex-col xl:flex-row` dashboard shell —
 * a right rail on laptop+ and, BELOW the laptop breakpoint, it hoists to the TOP
 * (`order-first xl:order-none`) so it is the first thing seen on smaller screens.
 */
import { useMemo } from "react";
import { useUserData } from "@/hooks/useUserData";
import { cn } from "@/lib/utils";
import { RemindersSection } from "./RemindersSection";
import { ActionTabs, ActionTab } from "./ActionTabs";
import { FinanceActionTabs } from "./FinanceActionTabs";

export type ActionCenterSection = "reminders" | "proj-manager" | "finance";

export interface ActionCenterProps {
  /** Extra classes merged onto the panel container — override width / placement per dashboard. */
  className?: string;
  /** Panel heading. Defaults to "Action Center". */
  title?: string;
  /**
   * Sections to render, in order. Omit to resolve from the user's Role Profile
   * (`sectionsForRole`); pass explicitly to let a dashboard compose its own mix.
   */
  sections?: ActionCenterSection[];
  /** Initial tab for the "actions" section. Defaults to "all". */
  defaultTab?: ActionTab;
}

// Role Profile → default sections. Accountants (finance) get compliance reminders + the
// finance queue (expenses / payments / invoices), NOT project delivery obligations; everyone
// else gets reminders + the DN/DC/DPR actions. Override via the `sections` prop.
const FINANCE_ROLES = [
  "Nirmaan Accountant Profile",
  "Nirmaan Accountant Lead Profile",
];

const ADMIN_ROLES = [
  "Administrator",
  "Nirmaan Admin Profile",
];

const PM_ROLES = [
  "Nirmaan Project Manager Profile"
];

function sectionsForRole(role: string): ActionCenterSection[] {
  if (FINANCE_ROLES.includes(role)) return ["reminders", "finance"];
  if (ADMIN_ROLES.includes(role)) return ["reminders"];
  if (PM_ROLES.includes(role)) return ["reminders", "proj-manager"];
  return ["reminders"];
}

export function ActionCenter({
  className,
  title = "Action Center",
  sections,
  defaultTab = "all",
}: ActionCenterProps = {}) {
  const { role } = useUserData();
  const resolved = useMemo(
    () => sections ?? sectionsForRole(role),
    [sections, role]
  );
  const showReminders = resolved.includes("reminders");
  const showActions = resolved.includes("proj-manager");
  const showFinance = resolved.includes("finance");

  return (
    <aside
      className={cn(
        // Right rail on laptop+; hoists to the TOP (first) below the laptop breakpoint.
        "order-first w-full shrink-0 border-b border-gray-200 bg-white p-6 xl:order-none xl:w-[420px] xl:min-w-[420px] xl:max-w-[420px] xl:border-b-0 xl:border-l",
        // On laptop+ the panel is a SELF-SCROLLING sticky rail (viewport-bounded, no fixed
        // inner scrollbox) — reminders + tabs + list scroll together within the panel, and it
        // stays in view as the main content scrolls. `<main>` (the scroll parent) sits below
        // the 56px header, so bound to the viewport minus header + padding.
        "xl:sticky xl:top-0 xl:min-h-[calc(100dvh-3.5rem)] xl:max-h-[calc(100dvh-3.5rem)] xl:self-start xl:overflow-y-auto",
        className
      )}
    >
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-800">{title}</h2>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-600">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          LIVE
        </span>
      </div>

      {showReminders && (
        <RemindersSection
          className={
            showActions || showFinance
              ? "mt-0 border-t-0 pt-0 mb-5 border-b border-gray-200 pb-5"
              : "mt-0 border-t-0 pt-0"
          }
        />
      )}

      {showActions && <ActionTabs defaultTab={defaultTab} />}
      {showFinance && <FinanceActionTabs />}
    </aside>
  );
}

export default ActionCenter;
