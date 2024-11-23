import { useFrappeGetDoc, useFrappeGetDocList } from 'frappe-react-sdk';
import { NavBar } from '../nav/nav-bar';
import React, { useContext, useEffect, useState } from 'react';
import { useFrappeDataStore } from '@/zustand/useFrappeDataStore';
import { SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from '../ui/sidebar';
import { NewSidebar } from './NewSidebar';
import ErrorBoundaryWithNavigationReset from '../common/ErrorBoundaryWrapper';
import ScrollToTop from '@/hooks/ScrollToTop';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Separator } from '../ui/separator';
import { Breadcrumb, BreadcrumbEllipsis, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '../ui/breadcrumb';
import { UserNav } from '../nav/user-nav';
import { Notifications } from '../nav/notifications';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { Badge } from '../ui/badge';
import nLogoBlack from "@/assets/icons.svg"
import { ArrowLeft, CirclePlus } from 'lucide-react';
import { DownOutlined } from '@ant-design/icons';
import { ConfigProvider, Dropdown, Menu, Space } from 'antd';
import svg from "@/assets/Vector.svg"
import { Button } from '../ui/button';
import { UserContext } from '@/utils/auth/UserProvider';

export const MainLayout = ({ children }: { children: React.ReactNode }) => {

  const { setProcurementRequestError, setProcurementRequestList, setProcurementRequestLoading, setProjects, setProjectsError, setProjectsLoading } = useFrappeDataStore()

  const [project, setProject] = useState(null)


  const { selectedProject } = useContext(UserContext)
  const navigate = useNavigate()

  // console.log("project", project)

  // console.log("selectedProject", selectedProject)

  const [prId, setPrId] = useState(null)
  const [poId, setPoId] = useState(null)
  const [sbId, setSbId] = useState(null)
  const [srId, setSrId] = useState(null)

  const { data: prData } = useFrappeGetDoc("Procurement Requests", prId, prId ? undefined : null)
  const { data: poData } = useFrappeGetDoc("Procurement Orders", poId, poId ? undefined : null)
  const { data: sbData } = useFrappeGetDoc("Sent Back Category", sbId, sbId ? undefined : null)
  const { data: srData } = useFrappeGetDoc("Service Requests", srId, srId ? undefined : null)

  const { data: projectData } = useFrappeGetDoc("Projects", (project || prData?.project || poData?.project || sbData?.project || srData?.project), (project || prData || poData || sbData || srData) ? undefined : null)

  const location = useLocation()

  const [locationsPaths, setLocationsPaths] = useState([])
  const [currentRoute, setCurrentRoute] = useState(null);

  // console.log('selectedProject', selectedProject)

  const newButtonRoutes = {
    "/projects": {
      label: "New Project",
      route: "projects/new-project"
    },
    "/users": {
      label: "New User",
      route: "users/new-user"
    },
    "/vendors": {
      label: "New Vendor",
      route: "vendors/new-vendor"
    },
    "/customers": {
      label: "New Customer",
      route: "customers/new-customer"
    }
  }

  useEffect(() => {
    const locations = location.pathname?.slice(1)?.split("/") || [];

    const menuItems = locations.map((item, index) => {
      const path = `/${locations.slice(0, index + 1).join("/")}`;

      return {
        label: (
          <Link to={path}>{item?.includes("%20") ? item?.replace(/%20/g, " ")?.toUpperCase() : item?.includes("PO&=") ? item?.replace(/&=/g, "/")?.toUpperCase() : item?.toUpperCase()}</Link>
        ),
        key: String(index),
      };
    }).reverse();

    if (location.pathname !== "/") {
      if (locations?.length > 1) {
        menuItems.push({ type: "divider" })
      }

      menuItems.push({
        label: (
          <Link to={"/"}>Dashboard</Link>
        ),
        key: "1000"
      })
    }

    setLocationsPaths(menuItems?.slice(1));
    setCurrentRoute((locations[locations?.length - 1]?.includes("%20") ? locations[locations?.length - 1]?.replace(/%20/g, " ")?.toUpperCase() : locations[locations?.length - 1]?.includes("PO&=") ? locations[locations?.length - 1]?.replace(/&=/g, "/")?.toUpperCase() : locations[locations?.length - 1]?.toUpperCase()) || "");

    const project = locations?.find((i) => i?.includes("PROJ"))
    const prId = locations?.find((i) => i?.includes("PR-"))
    const poId = locations?.find((i) => i?.includes("PO&="))?.replaceAll("&=", "/")
    const sbId = locations?.find((i) => i?.includes("SB-"))
    const srId = locations?.find((i) => i?.includes("SR-"))
    setProject(project)
    setPrId(prId)
    setPoId(poId)
    setSbId(sbId)
    setSrId(srId)

  }, [location])


  const { data: procurement_request_list, isLoading: procurement_request_list_loading, error: procurement_request_list_error } = useFrappeGetDocList("Procurement Requests",
    {
      fields: ["*"],
      limit: 1000,
    },
    "All Procurement Requests"
  );
  const { data: projects, isLoading: projects_loading, error: projects_error } = useFrappeGetDocList("Projects",
    {
      fields: ["*"],
      limit: 1000
    },
    "All Projects"
  )

  useEffect(() => {
    if (procurement_request_list) {
      setProcurementRequestList(procurement_request_list)
    }
    setProcurementRequestError(procurement_request_list_error)
    setProcurementRequestLoading(procurement_request_list_loading)
  }, [procurement_request_list, procurement_request_list_loading, procurement_request_list_error])

  useEffect(() => {
    if (projects) {
      setProjects(projects)
    }
    setProjectsError(projects_error)
    setProjectsLoading(projects_loading)
  }, [projects, projects_loading, projects_error])

  const { state, isMobile } = useSidebar()

  return (
        <>
      <div className='flex w-full relative h-auto'>
        {isMobile && (
          <div className='absolute top-[17px] -left-2 shadow-2xl'>
            <SidebarTrigger />
          </div>
        )}
        <NewSidebar />
        <div className='w-full h-auto'>
          <header className={`${(!isMobile && state === "collapsed") ? "mt-1" : ""} flex justify-between h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12`}>
            <div className={`${isMobile ? "ml-2" : ""} flex items-center gap-2 px-4`}>
              {isMobile && (
                <>
                  <Link to={`/`}>
                    <img src={nLogoBlack} alt="Nirmaan" width="24" height="25" />
                  </Link>
                  <Separator orientation="vertical" className="mr-1 h-4" />
                </>
              )}
              <ArrowLeft onClick={() => navigate(-1)} className='text-primary cursor-pointer' />
              <Separator orientation="vertical" className="mr-1 h-4" />
              <Breadcrumb>
                <BreadcrumbList>
                  {locationsPaths?.length > (isMobile ? 1 : 2) ? (
                    <>
                      {/* First Item */}
                      {!isMobile && (
                        <>
                          <BreadcrumbItem>
                            <Link to={`/${locationsPaths[0]}`}>
                              <BreadcrumbLink>{locationsPaths[0]?.toUpperCase()}</BreadcrumbLink>
                            </Link>
                          </BreadcrumbItem>
                          <BreadcrumbSeparator />
                        </>
                      )}

                      {/* Ellipsis Dropdown */}
                      <BreadcrumbItem>
                        <DropdownMenu>
                          <DropdownMenuTrigger className="flex items-center gap-1">
                            <BreadcrumbEllipsis className="h-4 w-4" />
                            <span className="sr-only">Toggle menu</span>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start">
                            {locationsPaths.slice((isMobile ? 0 : 1), -1).map((route, index) => (
                              <DropdownMenuItem key={index}>
                                <Link to={`/${locationsPaths.slice(0, index + (isMobile ? 1 : 2)).join('/')}`}>
                                  {route.toUpperCase()}
                                </Link>
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </BreadcrumbItem>
                      <BreadcrumbSeparator />

                      return (
                      <>
                        {/* <NavBar /> */}
                        {/* <SidebarProvider> */}
                        <NewSidebar />
                        <SidebarInset>
                          <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
                            <div className="flex items-center gap-2 px-4">
                              <SidebarTrigger className="-ml-1" />
                              <Separator orientation="vertical" className="mr-2 h-4" />
                              <Breadcrumb>
                                <BreadcrumbList>
                                  <BreadcrumbItem className="hidden md:block">
                                    <BreadcrumbLink>
                                      Building Your Application
                                    </BreadcrumbLink>
                                  </BreadcrumbItem>
                                  <BreadcrumbSeparator className="hidden md:block" />
                                  <BreadcrumbItem>
                                    <BreadcrumbPage>Data Fetching</BreadcrumbPage>
                                  </BreadcrumbItem>
                                </BreadcrumbList>
                              </Breadcrumb>
                            </div>
                          </header>
                          <main
                            className="flex flex-1 flex-col p-4 pt-0 transition-all duration-300 ease-in-out overflow-auto"
                            style={{ maxHeight: "100vh", maxWidth: "100vw" }}
                          >
                            <ErrorBoundaryWithNavigationReset>
                              <ScrollToTop />
                              <Outlet />
                            </ErrorBoundaryWithNavigationReset>
                          </main>
                        </SidebarInset>
                        {/* </SidebarProvider> */}

                        {/* <Layout>

            <Header>
                <div className="border-b w-full">
                        <div className="flex h-16 items-center px-2 md:px-4">
                          <div className="flex items-center justify-center">
                            <Button onClick={toggleCollapsed} >
                                {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                            </Button>
                            <MainNav className="mx-2 md:mx-6"/>
                          </div>
                            <div className="ml-auto flex items-center space-x-4">
                                <ModeToggle />
                                <Notifications />
                                <UserNav />
                            </div>
                      </Dropdown> 
                     </div>
                     {/*
                    {isMobile ? (
                    <div className='flex items-center space-x-4 mr-4'>
                        <Notifications isMobileMain />
                        <UserNav isMobileMain />
                    </div>
                    ) : (
                        projectData && <Badge className='mr-4'>{projectData?.project_name}</Badge>
                    )} */}
                        {Object.keys(newButtonRoutes)?.includes(location.pathname) ? (
                          <Button className='sm:mr-4 mr-2' onClick={() => navigate(newButtonRoutes[location.pathname]?.route)}>
                            <CirclePlus className="w-5 h-5 pr-1 " />Add <span className="hidden md:flex pl-1">{newButtonRoutes[location.pathname]?.label}</span>
                          </Button>
                        ) : (
                          location.pathname === "/prs&milestones/procurement-requests" ? (
                            selectedProject && (<Button className='sm:mr-4 mr-2' onClick={() => navigate(`/prs&milestones/procurement-requests/${selectedProject}/new-pr`)}>
                              <CirclePlus className="w-5 h-5 pr-1 " />Add <span className="hidden md:flex pl-1">New PR</span>
                            </Button>)
                          ) : (
                            location.pathname === "/service-requests" ? (
                              selectedProject && (<Button className='sm:mr-4 mr-2' onClick={() => navigate(`/service-requests/${selectedProject}/new-sr`)}>
                                <CirclePlus className="w-5 h-5 pr-1 " />Add <span className="hidden md:flex pl-1">New SR</span>
                              </Button>)
                            ) : (
                              projectData && <Badge className='sm:mr-4 mr-2 max-sm:text-[11px]'>{projectData?.project_name}</Badge>
                            )
                          )
                        )}
                      </header >
                      <main
                        className={`flex flex-1 flex-col py-4 px-2 pt-0 transition-all duration-300 ease-in-out overflow-auto  ${state === "expanded" ? "max-h-[93.5vh]" : "max-h-[94.5vh]"}`}
                      >
                        <ErrorBoundaryWithNavigationReset>
                          <ScrollToTop />
                          <Outlet />
                        </ErrorBoundaryWithNavigationReset>
                      </main>
                    </div >
                </div >
              </>
              );
};