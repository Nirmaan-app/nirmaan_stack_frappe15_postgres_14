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
};

export const RenderRightActionButton = ({
  locationPath,
  projectData,
}: RenderActionButtonProps) => {

  const navigate = useNavigate();
  const {role} = useUserData()
  const { selectedProject, toggleNewItemDialog } = useContext(UserContext);

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
      <Button
        className="sm:mr-4 mr-2"
        onClick={() =>
          navigate(`/prs&milestones/procurement-requests/${selectedProject}/new-pr`)
        }
      >
        <CirclePlus className="w-5 h-5 pr-1" />
        Add <span className="hidden md:flex pl-1">New PR</span>
      </Button>
    );
  } else if (locationPath === "/service-requests" && selectedProject) {
    return (
      <Button
        className="sm:mr-4 mr-2"
        onClick={() => navigate(`/service-requests/${selectedProject}/new-sr`)}
      >
        <CirclePlus className="w-5 h-5 pr-1" />
        Add <span className="hidden md:flex pl-1">New SR</span>
      </Button>
    );
  } else if (locationPath === "/items") {
    return (
      <Button onClick={toggleNewItemDialog} className="sm:mr-4 mr-2">
        <CirclePlus className="w-5 h-5 pr-1" />
        Add <span className="hidden md:flex pl-1">New Item</span>
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
          <DropdownMenuItem onClick={() => navigate("/service-requests")}>
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
