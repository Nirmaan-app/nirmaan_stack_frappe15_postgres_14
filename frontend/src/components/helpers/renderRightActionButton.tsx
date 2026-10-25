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
import { PROCUREMENT_PROFILES, canManagePayees } from "@/constants/roles";
import { canCreateNonProjectInflow } from "@/pages/non-project-inflows/nonProjectInflowModel";
import { useExpenseAccess } from "@/hooks/useExpenseAccess";
import { offersNewExpense } from "@/utils/expenseAccess";

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
  // Shared through SWR with the sidebar item, so it costs no extra request.
  const { access: expenseAccess } = useExpenseAccess();
  const { toggleNewInflowDialog, toggleNewNonProjectInflowDialog, toggleNewPayeeDialog, toggleNewItemDialog, toggleNewProjectInvoiceDialog, toggleNewExpenseRequestDialog, toggleNewWODialog, setNewReminderDialog, setEditReminderScheduleName } = useDialogStore()

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
  } else if (locationPath === "/payees") {
    if (!canManagePayees(role, user_id)) return null;
    return (
      <Button onClick={toggleNewPayeeDialog} className="sm:mr-4 mr-2">
        <CirclePlus className="w-5 h-5 pr-1" />
        Add <span className="hidden md:flex pl-1">Payee</span>
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
  } else if (locationPath === "/expense/requests" || locationPath === "/project-payments") {
    // The one door for every expense (spec #1494): the same New Expense dialog on the Expenses page
    // and on Project Payment & Expense, which each mount it. Shown to someone who can raise at least
    // one type (`useExpenseAccess`, the server's `can_raise`); a reviewer who raises nothing gets the
    // page, not the button. The server refuses a type the raiser may not raise.
    if (!offersNewExpense(expenseAccess)) return null;
    return (
      <Button onClick={toggleNewExpenseRequestDialog} className="sm:mr-4 mr-2">
        <CirclePlus className="w-5 h-5 pr-1" />
        New <span className="hidden md:flex pl-1">Expense</span>
      </Button>
    );
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
