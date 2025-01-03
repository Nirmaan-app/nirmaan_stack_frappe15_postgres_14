import { useFrappeGetDocList } from 'frappe-react-sdk';
import { NavBar } from '../nav/nav-bar';
import { useEffect } from 'react';
import { useFrappeDataStore } from '@/zustand/useFrappeDataStore';

export const MainLayout = () => {

    const {setProcurementRequestError, setProcurementRequestList, setProcurementRequestLoading, setProjects, setProjectsError, setProjectsLoading} = useFrappeDataStore()

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

    return (
        <>
            <NavBar />

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
                        </div>
                </div>
            </Header>
        <Layout>
            <Sider>
            <Menu
                                defaultSelectedKeys={['1']}
                                defaultOpenKeys={['sub1', 'sub2', 'sub3']}
                                mode="inline"
                                theme="light"
                                inlineCollapsed={collapsed}
                                items={items}
                                triggerSubMenuAction="hover"
                            />
            </Sider>

            <Content>
                <Outlet />
            </Content>

            </Layout>
            </Layout> */}
        </>
    );
};