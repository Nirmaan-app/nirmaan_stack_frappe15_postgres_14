import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { useUserData } from "@/hooks/useUserData";
import { UserContext } from "@/utils/auth/UserProvider";
import { CirclePlus } from "lucide-react";
import { useContext } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "../ui/badge";
import { useDialogStore } from "@/zustand/useDialogStore";

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
  "/service-requests": {
    label: "New SR",
    route: "service-requests-list",
  },
};

export const RenderRightActionButton = ({
  locationPath,
  projectData,
}: RenderActionButtonProps) => {

  const navigate = useNavigate();
  const {role, user_id} = useUserData()
  const { selectedProject } = useContext(UserContext);
  const { toggleNewInflowDialog, toggleNewItemDialog } = useDialogStore()

  if (newButtonRoutes[locationPath]) {
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
      ["Nirmaan Admin Profile", "Nirmaan Project Lead Profile", "Nirmaan Procurement Executive Profile"].includes(role) || user_id === "Administrator" ? (
        <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button data-cy="add-new-pr-normal-custom-button" className="sm:mr-4 mr-2">
            <CirclePlus className="w-5 h-5 pr-1" />
            Add New PR
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="mr-16">
          <DropdownMenuItem data-cy="add-new-pr-normal" onClick={() => navigate(`/prs&milestones/procurement-requests/${selectedProject}/new-pr`)}>
            Normal
          </DropdownMenuItem>
          <DropdownMenuItem data-cy="add-new-pr-custom" onClick={() => navigate(`/prs&milestones/procurement-requests/${selectedProject}/new-custom-pr`)}>
            Custom
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      ) : (
        <Button
        data-cy="add-new-pr-button"
        className="sm:mr-4 mr-2"
        onClick={() =>
          navigate(`/prs&milestones/procurement-requests/${selectedProject}/new-pr`)
        }
      >
        <CirclePlus className="w-5 h-5 pr-1" />
        Add <span className="hidden md:flex pl-1">New PR</span>
      </Button>)
    );
  } else if (locationPath === "/service-requests-list" && selectedProject && role != "Nirmaan Project Manager Profile") {
    return (
      <Button
        className="sm:mr-4 mr-2"
        onClick={() => navigate(`/service-requests-list/${selectedProject}/new-sr`)}
      >
        <CirclePlus className="w-5 h-5 pr-1" />
        Add <span className="hidden md:flex pl-1">New SR</span>
      </Button>
    );
  } else if (locationPath === "/products") {
    return (
      <Button onClick={toggleNewItemDialog} className="sm:mr-4 mr-2">
        <CirclePlus className="w-5 h-5 pr-1" />
        Add <span className="hidden md:flex pl-1">New Product</span>
      </Button>
    );
  } else if (locationPath === "/in-flow-payments") {
    return (
      <Button onClick={toggleNewInflowDialog} className="sm:mr-4 mr-2">
        <CirclePlus className="w-5 h-5 pr-1" />
        Add <span className="hidden md:flex pl-1">New Inflow</span>
      </Button>
    );
  } else if (
    locationPath === "/" &&
    ["Nirmaan Project Lead Profile", "Nirmaan Procurement Executive Profile", "Nirmaan Admin Profile"].includes(role)
  ) {
    // For admin profiles, render a dropdown menu
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button className="sm:mr-4 mr-2">
            <CirclePlus className="w-5 h-5 pr-1" />
            Add
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="mr-16">
          {role === "Nirmaan Admin Profile" && (
            <>
              <DropdownMenuItem onClick={() => navigate("/projects/new-project")}>
                New Project
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/users/new-user")}>
                New User
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/vendors/new-vendor")}>
                New Vendor
              </DropdownMenuItem>
              <Separator />
            </>
          )}
          <DropdownMenuItem onClick={() => navigate("/prs&milestones/procurement-requests")}>
            {role === "Nirmaan Admin Profile" ? "New PR" : "Urgent PR"}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => navigate("/prs&milestones/procurement-requests")}>
            New Custom PR
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => navigate("/service-requests-list")}>
            Service Request
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
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
