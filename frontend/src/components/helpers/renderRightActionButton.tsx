import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useUserData } from "@/hooks/useUserData";
import { UserContext } from "@/utils/auth/UserProvider";
import { CirclePlus } from "lucide-react";
import { useContext } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "../ui/badge";
import { useDialogStore } from "@/zustand/useDialogStore";
import { canManageTendering } from "@/pages/projects/tendering/tenderingAuth";
import { PROCUREMENT_PROFILES } from "@/constants/roles";
import { PP_ACCOUNTANT_ROLES } from "@/pages/ProjectPayments/config/ppTabs.constants";
import { canCreateNonProjectInflow } from "@/pages/non-project-inflows/nonProjectInflowModel";

interface RenderActionButtonProps {
  locationPath: string;
  projectData?: any;
}

const newButtonRoutes: Record<string, { label: string; route: string }> = {
  "/projects": {
    label: "New Project",
    route: "projects/new-project",
  },
  "/users": {
    label: "New User",
    route: "users/new-user",
  },
  "/vendors": {
    label: "New Vendor",
    route: "vendors/new-vendor",
  },
  "/customers": {
    label: "New Customer",
    route: "customers/new-customer",
  },
  "/procurement-requests": {
    label: "New PR",
    route: "prs&milestones/procurement-requests",
  },
};

export const RenderRightActionButton = ({
  locationPath,
  projectData,
}: RenderActionButtonProps) => {

  const navigate = useNavigate();
  const { role, user_id } = useUserData()
  const isSales = role === "Nirmaan Sales Executive Profile" || role === "Nirmaan Sales Lead Profile";
  const { selectedProject } = useContext(UserContext);
  const { toggleNewInflowDialog, toggleNewItemDialog, toggleNewProjectInvoiceDialog, toggleNewNonProjectExpenseDialog, toggleNewProjectExpenseDialog, toggleNewExpenseRequestDialog, toggleNewWODialog, setNewReminderDialog, setEditReminderScheduleName } = useDialogStore()

  if (newButtonRoutes[locationPath]) {
    // "Add New Project" uses the shared canManageTendering gate (Admin / PMO /
    // Estimates Executive, plus the Administrator user) so it stays in sync with
    // the New-Project route + tendering management. Sales stays excluded (view-only).
    if (locationPath === "/projects") {
      if (!canManageTendering(role, user_id)) return null;
    }
    const routeInfo = newButtonRoutes[locationPath];
    return (
      <Button
        className="sm:mr-4 mr-2"
        onClick={() => navigate(routeInfo.route)}
      >
        <CirclePlus className="w-5 h-5 pr-1" />
        Add{" "}
        <span className="hidden md:flex pl-1">{routeInfo.label}</span>
      </Button>
    );
  } else if (locationPath === "/prs&milestones/procurement-requests" && selectedProject) {
    return (
      ["Nirmaan Admin Profile", "Nirmaan PMO Executive Profile", "Nirmaan Project Lead Profile", ...PROCUREMENT_PROFILES].includes(role) || user_id === "Administrator" ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="sm:mr-4 mr-2">
              <CirclePlus className="w-5 h-5 pr-1" />
              Add New PR
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="mr-16">
            <DropdownMenuItem onClick={() => navigate(`/prs&milestones/procurement-requests/${selectedProject}/new-pr`)}>
              Normal
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate(`/prs&milestones/procurement-requests/${selectedProject}/new-custom-pr`)}>
              Custom
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Button
          className="sm:mr-4 mr-2"
          onClick={() =>
            navigate(`/prs&milestones/procurement-requests/${selectedProject}/new-pr`)
          }
        >
          <CirclePlus className="w-5 h-5 pr-1" />
          Add <span className="hidden md:flex pl-1">New PR</span>
        </Button>)
    );
  } else if (locationPath === "/service-requests" && role !== "Nirmaan Estimates Executive Profile" && role !== "Nirmaan Billing Executive Profile") {
    return (
      <Button
        className="sm:mr-4 mr-2"
        onClick={toggleNewWODialog}
      >
        <CirclePlus className="w-5 h-5 pr-1" />
        Add <span className="hidden md:flex pl-1">New WO</span>
      </Button>
    );
  } else if (locationPath === "/service-requests-list" && selectedProject && role !== "Nirmaan Project Manager Profile" && role !== "Nirmaan Estimates Executive Profile" && role !== "Nirmaan Billing Executive Profile") {
    return (
      <Button
        className="sm:mr-4 mr-2"
        onClick={() => navigate(`/service-requests-list/${selectedProject}/new-sr`)}
      >
        <CirclePlus className="w-5 h-5 pr-1" />
        Add <span className="hidden md:flex pl-1">New WO</span>
      </Button>
    );
  } else if (locationPath === "/products" && role === "Nirmaan Admin Profile") {
    return (
      <Button onClick={toggleNewItemDialog} className="sm:mr-4 mr-2">
        <CirclePlus className="w-5 h-5 pr-1" />
        Add <span className="hidden md:flex pl-1">New Product</span>
      </Button>
    );
  } else if (locationPath === "/in-flow-payments") {
    // Sales users (Executive / Lead) are view-only here — no create button.
    if (isSales) return null;
    return (
      <Button onClick={toggleNewInflowDialog} className="sm:mr-4 mr-2">
        <CirclePlus className="w-5 h-5 pr-1" />
        Add <span className="hidden md:flex pl-1">New Inflow</span>
      </Button>
    );
  } else if (locationPath === "/non-project-inflows") {
    if (!canCreateNonProjectInflow(role, user_id)) return null;
    return (
      <Button onClick={toggleNewNonProjectInflowDialog} className="sm:mr-4 mr-2">
        <CirclePlus className="w-5 h-5 pr-1" />
        Add <span className="hidden md:flex pl-1">Non-Project Inflow</span>
      </Button>
    );
  } else if (locationPath === "/project-invoices") {
    // Sales users (Executive / Lead) are view-only here — no create button.
    if (isSales) return null;
    return (
      <Button onClick={toggleNewProjectInvoiceDialog} className="sm:mr-4 mr-2">
        <CirclePlus className="w-5 h-5 pr-1" />
        Add <span className="hidden md:flex pl-1">New Project Invoice</span>
      </Button>
    );
  } else if (locationPath === "/project-payments") {
    // "Expense Request" — one entry point on the unified money-out queue for raising
    // either kind of expense, so a payment-facing user does not have to go find the
    // Expense module.
    //
    // ⚠️ THE TOGGLES ONLY FLIP A ZUSTAND FLAG. Both creation dialogs are bare
    // controlled AlertDialogs that render no trigger of their own, and each is
    // mounted ONLY on its own list page. `RenderProjectPaymentsComponent` must ALSO
    // mount them or this button silently does nothing.
    //
    // A DROPDOWN, not a modal chooser: it is this file's own idiom for one button with
    // two creation targets (see "Add New PR" above), and it avoids opening a Radix
    // modal from inside another Radix modal — both creation dialogs are AlertDialogs.
    //
    // ROLE GATE (owner, 15 Sep 2026): procurement + accountant + admin + HR Executive.
    //
    // HR EXECUTIVE ONLY, NOT HR LEAD. Neither HR role carries create on Project Expenses /
    // Non Project Expenses; HR Executive saves only because its role profile also holds
    // System Manager. HR Lead's profile does not, so a button shown to HR Lead would open a
    // dialog whose save fails with a PermissionError. Widen this only with the permission.
    //
    // Deliberately NARROWER than the two expense buttons below, which are ungated. It
    // is also narrower than the /project-payments audience: Project Lead and PMO can
    // reach that page but are NOT given expense creation here. That was the live
    // question -- Project Lead has no Expense sidebar entry today, so including them
    // would have been a capability grant rather than a shortcut. Excluded on purpose.
    //
    // ⚠️ COSMETIC ONLY. Neither dialog contains a role check and neither route has a
    // guard, so this hides the entry point; the doctype permission is the real boundary.
    const canRaiseExpense =
      user_id === "Administrator" ||
      role === "Nirmaan Admin Profile" ||
      PP_ACCOUNTANT_ROLES.includes(role as string) ||
      PROCUREMENT_PROFILES.includes(role as string) ||
      role === "Nirmaan HR Executive Profile";
    if (!canRaiseExpense) return null;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button className="sm:mr-4 mr-2">
            <CirclePlus className="w-5 h-5 pr-1" />
            Expense <span className="hidden md:flex pl-1">Request</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="mr-16">
          <DropdownMenuItem onClick={toggleNewProjectExpenseDialog}>
            Project Expense
          </DropdownMenuItem>
          <DropdownMenuItem onClick={toggleNewNonProjectExpenseDialog}>
            Non-Project Expense
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  } else if (locationPath === "/expense/non-project") {
    // return (
    //   <Button onClick={toggleNewNonProjectExpenseDialog} className="sm:mr-4 mr-2">
    //     <CirclePlus className="w-5 h-5 pr-1" />
    //     Add <span className="hidden md:flex pl-1">New Expense</span>
    //   </Button>
    // );
  } else if (locationPath === "/expense/requests") {
    // No role gate: anyone who can reach the Expense module may RAISE a request. The
    // approval side is what is gated, and it is gated on the SERVER.
    return (
      <Button onClick={toggleNewExpenseRequestDialog} className="sm:mr-4 mr-2">
        <CirclePlus className="w-5 h-5 pr-1" />
        Raise <span className="hidden md:flex pl-1">Expense Request</span>
      </Button>
    );
  } else if (locationPath === "/expense/project") {
    // Same access as the Non-Project button: no role gate, shown to everyone
    // with Expense-module access.
    // return (
    //   <Button onClick={toggleNewProjectExpenseDialog} className="sm:mr-4 mr-2">
    //     <CirclePlus className="w-5 h-5 pr-1" />
    //     Add <span className="hidden md:flex pl-1">New Project Expense</span>
    //   </Button>
    // );
  } else if (locationPath === "/reminders") {
    // Reminders are Admin-only to manage (owner ruling): Add, Edit and Delete all share
    // one gate. Every other role with sidebar access sees the table read-only.
    // MUST stay in step with `canManage` in pages/Reminders/RemindersPage.tsx and with
    // the server's `_require_reminder_editor` (api/reminders/write.py).
    const canCreateReminder =
      user_id === "Administrator" || role === "Nirmaan Admin Profile";
    if (!canCreateReminder) return null;
    return (
      <Button
        onClick={() => {
          setEditReminderScheduleName(null); // ensure CREATE mode
          setNewReminderDialog(true);
        }}
        className="sm:mr-4 mr-2"
      >
        <CirclePlus className="w-5 h-5 pr-1" />
        Add <span className="hidden md:flex pl-1">Reminder</span>
      </Button>
    );
  } else {
    return (
      projectData && (
        <Badge className={`sm:mr-4 mr-2 ${projectData?.project_name?.length > 24 ? "max-sm:text-[9px]" : "max-sm:text-[11px]"}`}>
          {projectData?.project_name}
        </Badge>
      )
    );
  }
};
