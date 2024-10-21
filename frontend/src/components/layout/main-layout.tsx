import { NavBar } from '../nav/nav-bar';

export const MainLayout = () => {

    // useFrappeDocTypeEventListener("Procurement Requests", (data) => {
    //     console.log("doctype event data: procurement requests", data)
    // })

    // useFrappeDocTypeEventListener("Nirmaan Comments", (data) => {
    //     console.log("docData", data)
    // })

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