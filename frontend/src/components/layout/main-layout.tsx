import React, { useEffect, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Dropdown, MenuProps } from "antd"; // Import MenuProps
import { useFrappeGetDoc } from "frappe-react-sdk";
import { ArrowLeft } from "lucide-react";

// Local Imports (adjust paths as needed)
import svg from "@/assets/Vector.svg";
import ScrollToTop from "@/hooks/ScrollToTop";
import ErrorBoundaryWithNavigationReset from "../common/ErrorBoundaryWrapper";
import { RenderRightActionButton } from "../helpers/renderRightActionButton";
import { Separator } from "../ui/separator";
import { SidebarTrigger, useSidebar } from "../ui/sidebar";
import { NewSidebar } from "./NewSidebar";
import { ProcurementRequest } from "@/types/NirmaanStack/ProcurementRequests";
import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import { SentBackCategory } from "@/types/NirmaanStack/SentBackCategory";
import { ServiceRequests } from "@/types/NirmaanStack/ServiceRequests";
import { Project } from "@/pages/ProcurementRequests/ApproveNewPR/types";

// Define type for menu items explicitly matching Ant Design's structure
type MenuItem = Required<MenuProps>['items'][number];

export const MainLayout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { isMobile } = useSidebar();

  // --- State Variables ---
  // Initialize state with correct types (string | null for IDs/routes)
  const [project, setProject] = useState<string | null>(null);
  const [prId, setPrId] = useState<string | null>(null);
  const [poId, setPoId] = useState<string | null>(null);
  const [sbId, setSbId] = useState<string | null>(null);
  const [srId, setSrId] = useState<string | null>(null);
  // Initialize with correctly typed empty array for menu items
  const [locationsPaths, setLocationsPaths] = useState<MenuItem[]>([]);
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
          processed.splice(index - 1, 1); // Remove item before marker
        }
      });
      // Remove 'dn' segment itself if present
      const dnIndex = processed.indexOf("dn");
      if (dnIndex !== -1) {
        processed.splice(dnIndex, 1);
      }
      return processed.filter(segment => segment); // Remove empty segments
    };

    const processedSegments = processPathSegments(pathSegments);

    // Generate breadcrumb menu items
    const breadcrumbItems: MenuItem[] = processedSegments
      .map((segment, index) => {
        const path = `/${processedSegments.slice(0, index + 1).join("/")}`;
        // Decode and format segment names for display
        let labelText = segment;
        if (labelText.includes("%20")) labelText = labelText.replace(/%20/g, " ");
        if (labelText.includes("PO&=") || labelText.includes("DN&=")) labelText = labelText.replace(/&=/g, "/");
        labelText = labelText.toUpperCase();

        return {
          label: <Link to={path}>{labelText}</Link>,
          key: path, // Use path as a more stable key
        };
      })
      .reverse(); // Show current level first

    // Add Dashboard link if not on the root path and there are breadcrumbs
    if (location.pathname !== "/" && breadcrumbItems.length > 0) {
      if (breadcrumbItems.length > 1) { // Add divider only if there's more than one parent
           breadcrumbItems.push({ type: "divider", key: "divider" }); // Added key for divider
      }
      breadcrumbItems.push({ label: <Link to={"/"}>Dashboard</Link>, key: "/" });
    }

    // Dropdown items exclude the current page's link
    setLocationsPaths(breadcrumbItems.slice(1));

    // Set the current route display name from the first breadcrumb item (or default)
    // Type assertion needed because label can be ReactNode
    const currentLabel = breadcrumbItems[0]?.label as React.ReactElement | undefined;
    setCurrentRoute(currentLabel?.props?.children as string ?? "DASHBOARD");

    // --- Extract IDs from original path segments ---
    const foundProject = pathSegments.find((s) => s?.includes("PROJ")) ?? null;
    const foundPrId = processedSegments.find((s) => s?.includes("PR-")) ?? null;
    const poMatch = processedSegments.find((s) => s?.includes("PO&="));
    const dnMatch = processedSegments.find((s) => s?.includes("DN&="));
    // Ensure replaceAll is called only on actual strings
    const foundPoId = poMatch
      ? poMatch.replaceAll("&=", "/")
      : (dnMatch ? dnMatch.replaceAll("&=", "/").replace("DN", "PO") : null);
    const foundSbId = processedSegments.find((s) => s?.includes("SB-")) ?? null;
    const foundSrId = processedSegments.find((s) => s?.includes("SR-")) ?? null;

    // Set state ensuring types match (string | null)
    setProject(foundProject);
    setPrId(foundPrId);
    setPoId(foundPoId);
    setSbId(foundSbId);
    setSrId(foundSrId);

  }, [location.pathname]); // Depend only on pathname

  // Commented out data store logic - kept for reference
  // ...

  return (
    <>
      <div className="flex w-full h-dvh relative">
        {/* Sidebar Trigger for Mobile */}
        {isMobile && (
          <div className="absolute top-[10px] -left-2 shadow-2xl z-20"> {/* Ensure trigger is clickable */}
            <SidebarTrigger />
          </div>
        )}
        {/* Sidebar Component */}
        <NewSidebar />

        {/* Main Content Area */}
        <div className="w-full h-full flex flex-col flex-1 overflow-hidden transition-all duration-200 ease-linear">
          {/* Header */}
          <header className="flex justify-between h-[53px] shrink-0 items-center pt-2 gap-2"> {/* Added border */}
            {/* Breadcrumb / Navigation Area */}
            <div className={`${isMobile ? "ml-4" : ""} flex items-center gap-2 px-4 flex-1`}> {/* Adjusted margin */}
              {/* Back Button */}
              {location.pathname !== "/" && (
                <>
                  <button
                    data-cy="go-back-button"
                    onClick={() => navigate(-1)}
                    className="p-1 rounded hover:bg-accent" // Make it a button for semantics
                    aria-label="Go back"
                  >
                    <ArrowLeft className="text-primary h-5 w-5" />
                  </button>
                  <Separator orientation="vertical" className="h-4" />
                </>
              )}
              {/* Breadcrumb Dropdown */}
              <Dropdown
                menu={{ items: locationsPaths }} // Use the 'menu' prop
                trigger={["click"]}
                disabled={locationsPaths.length === 0} // Disable if no parent paths
              >
                <div
                  data-cy="po-number-from-purchase-orders"
                  className={`text-sm max-sm:text-xs font-medium truncate ${
                    locationsPaths.length > 0
                      ? 'hover:text-gray-600 cursor-pointer'
                      : 'text-gray-800 cursor-default' // Different style if not clickable
                  }`}
                >
                  {currentRoute || "DASHBOARD"} {/* Ensure display */}
                  {locationsPaths.length > 0 && (
                    <img
                      className="inline-block ml-1.5 mb-0.5 h-2 w-2 align-middle"
                      src={svg}
                      alt="Show path history"
                    />
                  )}
                </div>
              </Dropdown>
            </div>

            {/* Right Action Button Area */}
            <div className="shrink-0"> {/* Prevent shrinking */}
              {RenderRightActionButton({
                locationPath: location.pathname,
                projectData,
              })}
            </div>
          </header>

          {/* Main Outlet Area */}
          <main className="flex-1 pb-4 pt-2 px-4 overflow-auto"> {/* Adjusted padding */}
            <ErrorBoundaryWithNavigationReset>
              <ScrollToTop />
              <Outlet />
            </ErrorBoundaryWithNavigationReset>
          </main>
        </div>
      </div>
    </>
  );
};

// Export the component if it's not the default export elsewhere
// export default MainLayout;