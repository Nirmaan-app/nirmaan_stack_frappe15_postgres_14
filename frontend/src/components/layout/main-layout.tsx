import { Outlet } from 'react-router-dom';
import { Sidebar } from "../sidebar-nav";
import { NavBar } from '../nav/nav-bar';
import ScrollToTop from '@/hooks/ScrollToTop';
import { useFrappeEventListener } from "frappe-react-sdk";
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
    useFrappeEventListener("pr:created", (event) => {
        console.log('before_zustand', event);

        // Only update unseen count and notifications if the event data is new
        if (event) {
            add_new_notifications("pr:created", event);
        }
    });

    // Log notifications outside of the listener to prevent infinite loops
    console.log('all_notifications', notifications);

    return (
        <div className="">
            <ScrollToTop />
            <NavBar />
            <div className="flex pt-16">
                <Sidebar className="w-64" />
                <main className="flex-1 md:ml-64">
                    <Outlet />
                </main>
            </div>
        </div>
    );
};