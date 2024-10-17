import { NavBar } from '../nav/nav-bar';
import ScrollToTop from '@/hooks/ScrollToTop';
import { useFrappeDocTypeEventListener, useFrappeDocumentEventListener, useFrappeEventListener } from "frappe-react-sdk";
import { useNotificationStore } from '@/hooks/useNotificationStore';



export const MainLayout = () => {

    // const [notifications, update_seen_count, update_notifications] = useNotificationStore((state) => [
    //     state.notifications,
    //     state.update_unseen_count,
    //     state.update_notification
    // ])

    // useFrappeDocTypeEventListener("Procurement Requests", (event) => {
    //     console.log("Hello from pr doctype room listener")
    // })

    // useFrappeEventListener("pr:created", (event) => {
    //     console.log('before_zustand', event)
    //     update_seen_count()
    //     update_notifications(event)
    //     console.log('all_notifications', notifications)
    // })

    const add_new_notifications = useNotificationStore((state) => state.add_new_notification);
    const notifications = useNotificationStore((state) => state.notifications); // Separate getter

    // Listen to specific event: "pr:created"
    useFrappeEventListener("notification", (event) => {
        console.log('before_zustand data', event);

        // Only update unseen count and notifications if the event data is new
        // if (event) {
        //     add_new_notifications("pr:created", event);
        // }
    });

    useFrappeEventListener("pr:new", (event) => {
        console.log('before_zustand data pr:new', event);

        // Only update unseen count and notifications if the event data is new
        // if (event) {
        //     add_new_notifications("pr:created", event);
        // }
    });

    useFrappeDocTypeEventListener("Procurement Requests", (data) => {
        console.log("docData", data)
    })

    useFrappeDocTypeEventListener("Nirmaan Comments", (data) => {
        console.log("docData", data)
    })

    // Log notifications outside of the listener to prevent infinite loops
    console.log('all_notifications', notifications);

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