import { useFrappeGetDocList } from 'frappe-react-sdk';
import { NavBar } from '../nav/nav-bar';
import React, { useEffect } from 'react';
import { useFrappeDataStore } from '@/zustand/useFrappeDataStore';
import { SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from '../ui/sidebar';
import { NewSidebar } from './NewSidebar';
import ErrorBoundaryWithNavigationReset from '../common/ErrorBoundaryWrapper';
import ScrollToTop from '@/hooks/ScrollToTop';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { Separator } from '../ui/separator';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '../ui/breadcrumb';
import { UserNav } from '../nav/user-nav';
import { Notifications } from '../nav/notifications';

export const MainLayout = ({children} : {children : React.ReactNode}) => {

    const {setProcurementRequestError, setProcurementRequestList, setProcurementRequestLoading, setProjects, setProjectsError, setProjectsLoading} = useFrappeDataStore()

    const location = useLocation()
    console.log("locations", location.pathname.slice(1)?.split("/"))


    console.log("location", location)

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
        if(procurement_request_list) {
            setProcurementRequestList(procurement_request_list)
        }
        setProcurementRequestError(procurement_request_list_error)
        setProcurementRequestLoading(procurement_request_list_loading)
    }, [procurement_request_list, procurement_request_list_loading, procurement_request_list_error])

    useEffect(() => {
        if(projects) {
            setProjects(projects)
        }
        setProjectsError(projects_error)
        setProjectsLoading(projects_loading)
    }, [projects, projects_loading, projects_error])

    const {state, isMobile} = useSidebar()

    return (
        <>
            <div className='flex w-full'>
                <NewSidebar />
            <div className='flex flex-col w-full overflow-auto'>
                <header className="flex justify-between h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
                    <div className="flex items-center gap-2 px-4">
                       <SidebarTrigger className="-ml-1" />
                       <Separator orientation="vertical" className="mr-2 h-4" />
                       <Breadcrumb>
                         <BreadcrumbList>
                            {location.pathname?.slice(1)?.split("/").map((route, index) => {
                                const arr = location.pathname?.slice(1)?.split("/")
                                const len = arr?.length
                                const toNavigate = arr?.slice(0, index + 1)?.join("/")
                                console.log("toNavigate", toNavigate)
                                return (
                                    index + 1 !== len ? (
                                        <>
                                            <BreadcrumbItem>
                                                <Link  to={`/${toNavigate}`}>
                                                    <BreadcrumbLink>
                                                      {route?.toUpperCase()}
                                                    </BreadcrumbLink>
                                                </Link>
                                            </BreadcrumbItem>
                                            <BreadcrumbSeparator />
                                        </>
                                    ) : (

                                        <BreadcrumbItem>
                                            <BreadcrumbPage>{route?.toUpperCase()}</BreadcrumbPage>
                                        </BreadcrumbItem>
                                    )
                                )
                            })}
                           {/* <BreadcrumbItem className="hidden md:block">
                             <BreadcrumbLink>
                               Building Your Application
                             </BreadcrumbLink>
                           </BreadcrumbItem>
                           <BreadcrumbSeparator className="hidden md:block" />
                           <BreadcrumbItem>
                             <BreadcrumbPage>Data Fetching</BreadcrumbPage>
                           </BreadcrumbItem> */}
                         </BreadcrumbList>
                       </Breadcrumb>
                    </div>
                    {isMobile && (
                        <div className='flex items-center space-x-4 mr-4'>
                        <Notifications isMobileMain />
                        <UserNav isMobileMain />
                    </div>
                    )}
                </header>
                <main 
                    className={`flex flex-1 flex-col p-4 pt-0 transition-all duration-300 ease-in-out overflow-auto  ${state === "expanded" ? "max-h-[93.5vh]" : "max-h-[94.5vh]"}`}
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