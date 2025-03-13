import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface NotificationType {
    name: string;
    creation: string;
    description: string;
    docname: string;
    document: string;
    event_id: string;
    project: string;
    recipient: string;
    recipient_role: string;
    seen: string; 
    sender: string | null;
    title: string;
    type: string;
    work_package: string;
    action_url?: string | null;
}

const updateNotificationInDB = async (db : any, name : string) => {
    await db.updateDoc("Nirmaan Notifications", name, {
        seen: "true"
    });
};

export interface NotificationStateType {
    notifications: NotificationType[];
    notificationsCount: number;
    // eventBasedNotificationCount: any;
    clear_notifications: () => void;
    add_all_notific_directly: (notifications: NotificationType[]) => void;
    add_new_notification: (notification: NotificationType) => void;
    mark_seen_notification: (db: any, notification: NotificationType) => void;
    delete_notification: (notificationId : string) => void;
}

export const useNotificationStore = create<NotificationStateType>()(
    persist(
        (set, get) => ({
            notifications: [],
            notificationsCount: 0,
            // eventBasedNotificationCount: {},

            // Add a new notification to the array
            add_new_notification: (notification: NotificationType) => {
                const existingNotifications = get().notifications;

                // Check if notification already exists
                const notificationExists = existingNotifications.some(
                    (item) => item.name === notification.name
                );

                if (!notificationExists) {
                    set((state) => {
                        // const eventNotificationCount = state.eventBasedNotificationCount[notification.event_id] || 0;
                        return {
                            notifications: [notification, ...state.notifications],
                            notificationsCount: state.notificationsCount + (notification.seen === "false" ? 1 : 0),
                            // eventBasedNotificationCount: {
                            //     ...state.eventBasedNotificationCount,
                            //     [notification.event_id]: eventNotificationCount + (notification.seen === "false" ? 1 : 0)
                            // }
                    }
                    });
                }
            },
            add_all_notific_directly: (notifications : NotificationType[]) => {
                set((state) => {
                    return {
                        notifications: [...notifications],
                        notificationsCount: notifications.filter(i => i.seen === "false").length,
                    }
                });
            },

            clear_notifications: () => {
                set((state) => ({
                    notifications: [],
                    notificationsCount: 0,
                    // eventBasedNotificationCount: {}
                }));
            },

            mark_seen_notification: async (db, notification: NotificationType) => {
                try {
                    await updateNotificationInDB(db, notification.name);

                    set((state) => {
                        // const currentEventCount = state.eventBasedNotificationCount[notification.event_id] || 0;
            
                        // const updatedEventBasedNotificationCount = { ...state.eventBasedNotificationCount };
            
                        // if (currentEventCount === 1) {
                        //     delete updatedEventBasedNotificationCount[notification.event_id];
                        // } else if (currentEventCount > 1) {
                        //     updatedEventBasedNotificationCount[notification.event_id] = currentEventCount - 1;
                        // }

                        const toUpdateNotification = state.notifications.findIndex((item) => item.name === notification.name);
                        if (toUpdateNotification !== -1) {
                            const updatedNotifications = [...state.notifications];
                            updatedNotifications[toUpdateNotification] = { ...notification, seen: "true" };
                            return {
                                notifications: updatedNotifications,
                                notificationsCount: state.notificationsCount - 1,
                                // eventBasedNotificationCount: updatedEventBasedNotificationCount
                            };
                        }

                        return {
                            notifications: state.notifications,
                            notificationsCount: state.notificationsCount - 1,
                            // eventBasedNotificationCount: updatedEventBasedNotificationCount
                        }
            
                        // return {
                        //     notifications: state.notifications.map((item) =>
                        //         item.name === notification.name ? { ...item, seen: "true" } : item
                        //     ),
                        //     notificationsCount: state.notificationsCount - 1,
                        //     // eventBasedNotificationCount: updatedEventBasedNotificationCount
                        // };
                    });
                } catch (error) {
                    console.error("Error marking notification as seen: ", error);
                }
            },
            delete_notification: (notificationId : string) => {
                set((state) => {
                    const deletedNotification = state.notifications.find((item) => item.name === notificationId);

                    return {
                    notifications: state.notifications.filter((item) => item.name !== notificationId),
                    notificationsCount: deletedNotification?.seen === "true" ? state.notificationsCount : state.notificationsCount - 1,
            }})
            }
        }),
        {
            name: 'notifications',
            storage: createJSONStorage(() => sessionStorage),
        }
    )
);
