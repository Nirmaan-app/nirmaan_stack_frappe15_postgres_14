import { NavBar } from '../nav/nav-bar';
import {  FrappeConfig, FrappeContext, useFrappeDocTypeEventListener, useFrappeEventListener, useFrappeGetDoc, useFrappeGetDocList } from "frappe-react-sdk";
import { useContext, useEffect } from 'react';
import { useUserData } from '@/hooks/useUserData';
import { useNotificationStore } from '@/hooks/useNotificationStore';



export const MainLayout = () => {
    const { user_id } = useUserData();
    const { notifications, add_new_notification, delete_notification } = useNotificationStore();
    const {db} = useContext(FrappeContext) as FrappeConfig

    // Fetch all notifications that are unseen for the current user
    const { data: notificationsData } = useFrappeGetDocList("Nirmaan Notifications", {
        fields: ["*"],
        filters: [["recipient", "=", user_id]],
        limit: 1000,
        orderBy: {field: "creation", order: "asc"}
    });

    // useFrappeDocTypeEventListener("")

    // On initial render, segregate notifications and store in Zustand
    useEffect(() => {
        if (notificationsData) {
            notificationsData.forEach((notification: any) => {
                add_new_notification({
                    name: notification.name,
                    creation: notification.creation,
                    description: notification.description,
                    docname: notification.docname,
                    document: notification.document,
                    event_id: notification.event_id,
                    project: notification.project,
                    recipient: notification.recipient,
                    recipient_role: notification.recipient_role,
                    seen: notification.seen,
                    sender: notification?.sender,
                    title: notification.title,
                    type: notification.type,
                    work_package: notification.work_package,
                    action_url: notification?.action_url
                });
            });
        }
    }, [notificationsData, user_id]);

    // Event listener for new notifications (e.g., "pr:new")
    useFrappeEventListener("pr:new", async (event) => {
        console.log("Received new notification event", event);

        if (event?.notificationId) {
            // Fetch the new notification data based on the notification ID from the event
            // const { data: newNotificationData } = useFrappeGetDoc("Nirmaan Notifications", event.notificationId);

            const newNotificationData = await db.getDoc("Nirmaan Notifications", event.notificationId)

            if (newNotificationData) {
                // Add new notification to Zustand store
                add_new_notification({
                    name: newNotificationData.name,
                    creation: newNotificationData.creation,
                    description: newNotificationData.description,
                    docname: newNotificationData.docname,
                    document: newNotificationData.document,
                    event_id: newNotificationData.event_id,
                    project: newNotificationData.project,
                    recipient: newNotificationData.recipient,
                    recipient_role: newNotificationData.recipient_role,
                    seen: newNotificationData.seen,
                    sender: newNotificationData?.sender,
                    title: newNotificationData.title,
                    type: newNotificationData.type,
                    work_package: newNotificationData.work_package,
                    action_url: newNotificationData?.action_url
                });

                console.log("Updated notifications state with new data", newNotificationData);
            }
        }
    });

    useFrappeEventListener("pr:delete", (event) => {
        console.log("delete event", event)
        if(event?.notificationId) {
            delete_notification(event?.notificationId)
        }
    })

    useFrappeEventListener("pr:vendorSelected", async (event) => {
        console.log("vendorSelected for pr event", event)
        if(event?.notificationId) {
            const newNotificationData = await db.getDoc("Nirmaan Notifications", event.notificationId)
            if (newNotificationData) {
                // Add new notification to Zustand store
                add_new_notification({
                    name: newNotificationData.name,
                    creation: newNotificationData.creation,
                    description: newNotificationData.description,
                    docname: newNotificationData.docname,
                    document: newNotificationData.document,
                    event_id: newNotificationData.event_id,
                    project: newNotificationData.project,
                    recipient: newNotificationData.recipient,
                    recipient_role: newNotificationData.recipient_role,
                    seen: newNotificationData.seen,
                    sender: newNotificationData?.sender,
                    title: newNotificationData.title,
                    type: newNotificationData.type,
                    work_package: newNotificationData.work_package,
                    action_url: newNotificationData?.action_url
                });

                console.log("Updated notifications state with new data", newNotificationData);
            }
        }
    })

    useFrappeEventListener("sb:vendorSelected", async (event) => {
        console.log("vendorSelected for sb event", event)
        if(event?.notificationId) {
            const newNotificationData = await db.getDoc("Nirmaan Notifications", event.notificationId)
            if (newNotificationData) {
                // Add new notification to Zustand store
                add_new_notification({
                    name: newNotificationData.name,
                    creation: newNotificationData.creation,
                    description: newNotificationData.description,
                    docname: newNotificationData.docname,
                    document: newNotificationData.document,
                    event_id: newNotificationData.event_id,
                    project: newNotificationData.project,
                    recipient: newNotificationData.recipient,
                    recipient_role: newNotificationData.recipient_role,
                    seen: newNotificationData.seen,
                    sender: newNotificationData?.sender,
                    title: newNotificationData.title,
                    type: newNotificationData.type,
                    work_package: newNotificationData.work_package,
                    action_url: newNotificationData?.action_url
                });

                console.log("Updated notifications state with new data", newNotificationData);
            }
        }
    })

    console.log("new Notifications", notifications)

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