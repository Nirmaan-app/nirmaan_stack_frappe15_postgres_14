import svg from "@/assets/Vector.svg";
import ScrollToTop from "@/hooks/ScrollToTop";
import { Dropdown, Menu } from "antd";
import { useFrappeGetDoc } from "frappe-react-sdk";
import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import ErrorBoundaryWithNavigationReset from "../common/ErrorBoundaryWrapper";
import { RenderRightActionButton } from "../helpers/renderRightActionButton";
import { Separator } from "../ui/separator";
import {
  SidebarTrigger,
  useSidebar
} from "../ui/sidebar";
import { NewSidebar } from "./NewSidebar";

export const MainLayout = () => {
  // const {
  //   setProcurementRequestError,
  //   setProcurementRequestList,
  //   setProcurementRequestLoading,
  //   setProjects,
  //   setProjectsError,
  //   setProjectsLoading,
  // } = useFrappeDataStore();

  const [project, setProject] = useState(null);

  const navigate = useNavigate();

  const [prId, setPrId] = useState(null);
  const [poId, setPoId] = useState(null);
  const [sbId, setSbId] = useState(null);
  const [srId, setSrId] = useState(null);

  const { data: prData } = useFrappeGetDoc(
    "Procurement Requests",
    prId,
    prId ? undefined : null
  );
  const { data: poData } = useFrappeGetDoc(
    "Procurement Orders",
    poId,
    poId ? undefined : null
  );
  const { data: sbData } = useFrappeGetDoc(
    "Sent Back Category",
    sbId,
    sbId ? undefined : null
  );
  const { data: srData } = useFrappeGetDoc(
    "Service Requests",
    srId,
    srId ? undefined : null
  );

  const { data: projectData } = useFrappeGetDoc(
    "Projects",
    project ||
    prData?.project ||
    poData?.project ||
    sbData?.project ||
    srData?.project,
    project || prData || poData || sbData || srData ? undefined : null
  );

  const location = useLocation();

  const [locationsPaths, setLocationsPaths] = useState([]);
  const [currentRoute, setCurrentRoute] = useState(null);


  useEffect(() => {
    const locationsArray = location.pathname?.slice(1)?.split("/") || [];

    // Function to process the locations array
    const processLocations = (locations) => {
      // Make a copy of the array to avoid modifying the original
      let processedLocations = [...locations];

      // Find and handle "new-pr"
      const newPrIndex = processedLocations.indexOf("new-pr");
      if (newPrIndex > 0) {
        // Remove the element before "new-pr"
        processedLocations.splice(newPrIndex - 1, 1);
      }

      // Find and handle "new-sr"
      const newSrIndex = processedLocations.indexOf("new-sr");
      if (newSrIndex > 0) {
        // Remove the element before "new-sr"
        processedLocations.splice(newSrIndex - 1, 1);
      }

      const dnNameIndex = processedLocations.indexOf("dn");
      if (dnNameIndex > 0) {
        // Remove the element before "dn"
        processedLocations.splice(dnNameIndex, 1);
      }

      return processedLocations;
    };

    // Process the locations array based on the conditions
    const locations = processLocations(locationsArray);

    const menuItems = locations
      .map((item, index) => {
        const path = `/${locations.slice(0, index + 1).join("/")}`;

        return {
          label: (
            <Link to={path}>
              {item?.includes("%20")
                ? item?.replace(/%20/g, " ")?.toUpperCase()
                : item?.includes("PO&=")
                  ? item?.replace(/&=/g, "/")?.toUpperCase()
                  : item?.toUpperCase()}
            </Link>
          ),
          key: String(index),
        };
      })
      .reverse();

    if (location.pathname !== "/") {
      if (locations?.length > 1) {
        menuItems.push({ type: "divider" });
      }

      menuItems.push({ label: <Link to={"/"}>Dashboard</Link>, key: "1000" });
    }

    setLocationsPaths(menuItems?.slice(1));

    setCurrentRoute(
      (locations[locations?.length - 1]?.includes("%20")
        ? locations[locations?.length - 1]?.replace(/%20/g, " ")?.toUpperCase()
        : locations[locations?.length - 1]?.includes("PO&=") ||
          locations[locations?.length - 1]?.includes("DN&=")
          ? locations[locations?.length - 1]?.replace(/&=/g, "/")?.toUpperCase()
          : locations[locations?.length - 1]?.toUpperCase()) || "DASHBOARD"
    );

    const project = locationsArray?.find((i) => i?.includes("PROJ"));
    const prId = locations?.find((i) => i?.includes("PR-"));
    const poId = locations
      ?.find((i) => i?.includes("PO&="))
      ?.replaceAll("&=", "/");
    const dnId = locations
      ?.find((i) => i?.includes("DN&="))
      ?.replaceAll("&=", "/")
      ?.replace("DN", "PO");
    const sbId = locations?.find((i) => i?.includes("SB-"));
    const srId = locations?.find((i) => i?.includes("SR-"));
    setProject(project);
    setPrId(prId);
    setPoId(poId || dnId);
    setSbId(sbId);
    setSrId(srId);
  }, [location]);

  // const {
  //   data: procurement_request_list,
  //   isLoading: procurement_request_list_loading,
  //   error: procurement_request_list_error,
  // } = useFrappeGetDocList(
  //   "Procurement Requests",
  //   {
  //     fields: ["*"],
  //     limit: 10000,
  //   },
  //   "All Procurement Requests"
  // );
  // const {
  //   data: projects,
  //   isLoading: projects_loading,
  //   error: projects_error,
  // } = useFrappeGetDocList(
  //   "Projects",
  //   {
  //     fields: ["*"],
  //     limit: 10000,
  //   },
  //   "All Projects"
  // );

  // useEffect(() => {
  //   if (procurement_request_list) {
  //     setProcurementRequestList(procurement_request_list);
  //   }
  //   setProcurementRequestError(procurement_request_list_error);
  //   setProcurementRequestLoading(procurement_request_list_loading);
  // }, [
  //   procurement_request_list,
  //   procurement_request_list_loading,
  //   procurement_request_list_error,
  // ]);

  // useEffect(() => {
  //   if (projects) {
  //     setProjects(projects);
  //   }
  //   setProjectsError(projects_error);
  //   setProjectsLoading(projects_loading);
  // }, [projects, projects_loading, projects_error]);

  const { isMobile } = useSidebar();

  // console.log("currentRoute", currentRoute)

  const menu = <Menu items={locationsPaths} />;

  return (
    <>
      <div className="flex w-full h-dvh relative">
        {isMobile && (
          <div className="absolute top-[10px] -left-2 shadow-2xl">
            <SidebarTrigger />
          </div>
        )}
        <NewSidebar />
        <div className="w-full h-full flex flex-col flex-1 overflow-hidden transition-all duration-200 ease-linear">
          <header
            className={`flex justify-between h-12 shrink-0 items-center pt-2 gap-2`}
          >
            <div
              className={`${isMobile ? "ml-2" : ""} flex items-center gap-2 px-4`}
            >
              {location.pathname !== "/" && (
                <>
                <ArrowLeft
                onClick={() => navigate(-1)}
                className="text-primary cursor-pointer"
              />
              <Separator orientation="vertical" className="mr-1 h-4" />
                </>
              )}
              <Dropdown overlay={menu} trigger={["click"]}>
                <div className="text-sm max-sm:text-xs hover:text-gray-500">
                  {currentRoute}
                  {locationsPaths?.length !== 0 && (
                    <img className="inline-block ml-1 mb-1" src={svg} />
                  )}
                </div>
              </Dropdown>
            </div>
            {RenderRightActionButton({
                locationPath: location.pathname,
                projectData,
              })}
          </header>
          <main
            className={`flex-1 pb-4 pt-2 px-2 overflow-auto`}
          >
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