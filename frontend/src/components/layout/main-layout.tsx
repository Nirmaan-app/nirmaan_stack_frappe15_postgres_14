import React, { useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useFrappeGetDoc } from "frappe-react-sdk";
import { ArrowLeft, ChevronDown, Home, Menu } from "lucide-react";

// Local Imports
import ScrollToTop from "@/hooks/ScrollToTop";
import ErrorBoundaryWithNavigationReset from "../common/ErrorBoundaryWrapper";
import { RenderRightActionButton } from "../helpers/renderRightActionButton";
import { useSidebar } from "../ui/sidebar";
import { NewSidebar } from "./NewSidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { ProcurementRequest } from "@/types/NirmaanStack/ProcurementRequests";
import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import { SentBackCategory } from "@/types/NirmaanStack/SentBackCategory";
import { ServiceRequests } from "@/types/NirmaanStack/ServiceRequests";
import { Project } from "@/pages/ProcurementRequests/ApproveNewPR/types";

// Breadcrumb item interface
interface BreadcrumbItem {
  label: string;
  path: string;
  isDivider?: boolean;
}

export const MainLayout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { isMobile, toggleSidebar } = useSidebar();

  // --- State Variables ---
  const [project, setProject] = useState<string | null>(null);
  const [prId, setPrId] = useState<string | null>(null);
  const [poId, setPoId] = useState<string | null>(null);
  const [sbId, setSbId] = useState<string | null>(null);
  const [srId, setSrId] = useState<string | null>(null);
  const [breadcrumbItems, setBreadcrumbItems] = useState<BreadcrumbItem[]>([]);
  const [currentRoute, setCurrentRoute] = useState<string | null>(null);

  // --- Data Fetching Hooks ---
  const { data: prData } = useFrappeGetDoc<ProcurementRequest>(
    "Procurement Requests",
    prId ?? undefined,
    !!prId ? undefined : null
  );
  const { data: poData } = useFrappeGetDoc<ProcurementOrder>(
    "Procurement Orders",
    poId ?? undefined,
    !!poId ? undefined : null
  );
  const { data: sbData } = useFrappeGetDoc<SentBackCategory>(
    "Sent Back Category",
    sbId ?? undefined,
    !!sbId ? undefined : null
  );
  const { data: srData } = useFrappeGetDoc<ServiceRequests>(
    "Service Requests",
    srId ?? undefined,
    !!srId ? undefined : null
  );

  // Determine the project ID to fetch based on available data
  const derivedProjectId = project || prData?.project || poData?.project || sbData?.project || srData?.project;

  const { data: projectData } = useFrappeGetDoc<Project>(
    "Projects",
    derivedProjectId,
    !!derivedProjectId ? undefined : null
  );

  // --- Effect for Processing Location and Setting Breadcrumbs/IDs ---
  useEffect(() => {
    const pathSegments = location.pathname?.slice(1)?.split("/") || [];

    // Helper to clean up segments (remove specific ones)
    const processPathSegments = (segments: string[]): string[] => {
      let processed = [...segments];
      const indicesToRemoveBefore = ["new-pr", "new-sr"];
      indicesToRemoveBefore.forEach(marker => {
        const index = processed.indexOf(marker);
        if (index > 0) {
          processed.splice(index - 1, 1);
        }
      });
      const dnIndex = processed.indexOf("dn");
      if (dnIndex !== -1) {
        processed.splice(dnIndex, 1);
      }
      return processed.filter(segment => segment);
    };

    const processedSegments = processPathSegments(pathSegments);

    // Generate breadcrumb items with simple structure
    const items: BreadcrumbItem[] = processedSegments
      .map((segment, index) => {
        const path = `/${processedSegments.slice(0, index + 1).join("/")}`;
        let labelText = segment;
        if (labelText.includes("%20")) labelText = labelText.replace(/%20/g, " ");
        if (labelText.includes("PO&=") || labelText.includes("DN&=")) labelText = labelText.replace(/&=/g, "/");
        labelText = labelText.toUpperCase();
        return { label: labelText, path };
      })
      .reverse();

    // Add Dashboard link if not on root
    if (location.pathname !== "/" && items.length > 0) {
      if (items.length > 1) {
        items.push({ label: "", path: "", isDivider: true });
      }
      items.push({ label: "Dashboard", path: "/" });
    }

    // Set breadcrumb items (excluding current page)
    setBreadcrumbItems(items.slice(1));
    setCurrentRoute(items[0]?.label ?? "DASHBOARD");

    // --- Extract IDs from path segments ---
    const foundProject = pathSegments.find((s) => s?.includes("PROJ")) ?? null;
    const foundPrId = processedSegments.find((s) => s?.includes("PR-")) ?? null;
    const poMatch = processedSegments.find((s) => s?.includes("PO&="));
    const dnMatch = processedSegments.find((s) => s?.includes("DN&="));
    const foundPoId = poMatch
      ? poMatch.replaceAll("&=", "/")
      : (dnMatch ? dnMatch.replaceAll("&=", "/").replace("DN", "PO") : null);
    const foundSbId = processedSegments.find((s) => s?.includes("SB-")) ?? null;
    const foundSrId = processedSegments.find((s) => s?.includes("SR-")) ?? null;

    setProject(foundProject);
    setPrId(foundPrId);
    setPoId(foundPoId);
    setSbId(foundSbId);
    setSrId(foundSrId);
  }, [location.pathname]);

  return (
    <div className="flex w-full h-dvh relative">
      {/* Sidebar Component */}
      <NewSidebar />

      {/* Main Content Area */}
      <div className="w-full h-full flex flex-col flex-1 overflow-hidden">
        {/* Modern Sticky Header */}
        <header
          className="
            sticky top-0 z-20
            flex items-center justify-between
            h-14 min-h-[56px] shrink-0
            px-4 sm:px-6
            bg-background/95 backdrop-blur-sm
            border-b border-border/40
            shadow-[0_1px_3px_0_rgb(0,0,0,0.05)]
            transition-all duration-200
          "
        >
          {/* Left Section: Navigation */}
          <div className="flex items-center gap-1 sm:gap-3 flex-1 min-w-0">
            {/* Mobile Menu Trigger - minimal half-width */}
            {isMobile && (
              <button
                onClick={toggleSidebar}
                className="flex items-center justify-center h-8 w-5 -ml-1 text-muted-foreground hover:text-foreground"
                aria-label="Open menu"
              >
                <Menu className="h-4 w-4" />
              </button>
            )}

            {/* Back Button */}
            {location.pathname !== "/" && (
              <button
                onClick={() => navigate(-1)}
                className="
                  flex items-center justify-center
                  h-9 w-9 rounded-lg
                  text-primary
                  hover:bg-primary/10
                  active:scale-95
                  transition-all duration-150
                "
                aria-label="Go back"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
            )}

            {/* Breadcrumb Navigation */}
            {breadcrumbItems.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="
                      flex items-center gap-1.5
                      px-2 py-1.5 rounded-md
                      text-sm font-medium text-foreground
                      hover:bg-accent
                      active:scale-[0.98]
                      transition-all duration-150
                      max-w-[200px] sm:max-w-[300px]
                    "
                  >
                    <span className="truncate">{currentRoute || "DASHBOARD"}</span>
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  {breadcrumbItems.map((item, index) =>
                    item.isDivider ? (
                      <DropdownMenuSeparator key={`divider-${index}`} />
                    ) : (
                      <DropdownMenuItem
                        key={item.path}
                        onClick={() => navigate(item.path)}
                        className="cursor-pointer"
                      >
                        {item.path === "/" && (
                          <Home className="h-4 w-4 mr-2 text-muted-foreground" />
                        )}
                        <span className="truncate">{item.label}</span>
                      </DropdownMenuItem>
                    )
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <span className="text-sm font-medium text-foreground px-2">
                {currentRoute || "DASHBOARD"}
              </span>
            )}
          </div>

          {/* Right Section: Actions */}
          <div className="shrink-0 flex items-center">
            {RenderRightActionButton({
              locationPath: location.pathname,
              projectData,
            })}
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 overflow-auto px-4 sm:px-6 py-4">
          <ErrorBoundaryWithNavigationReset>
            <ScrollToTop />
            <Outlet />
          </ErrorBoundaryWithNavigationReset>
        </main>
      </div>
    </div>
  );
};