// import { create } from 'zustand';
// import { createJSONStorage, persist } from 'zustand/middleware';

// export interface NotificationType {
//     name: string;
//     creation: string;
//     description: string;
//     docname: string;
//     document: string;
//     event_id: string;
//     project: string;
//     recipient: string;
//     recipient_role: string;
//     seen: string; 
//     sender: string | null;
//     title: string;
//     type: string;
//     work_package: string;
//     action_url?: string | null;
// }

// const updateNotificationInDB = async (db : any, name : string) => {
//     await db.updateDoc("Nirmaan Notifications", name, {
//         seen: "true"
//     });
// };

// export interface NotificationStateType {
//     notifications: NotificationType[];
//     notificationsCount: number;
//     // eventBasedNotificationCount: any;
//     clear_notifications: () => void;
//     add_all_notific_directly: (notifications: NotificationType[]) => void;
//     add_new_notification: (notification: NotificationType) => void;
//     mark_seen_notification: (db: any, notification: NotificationType) => void;
//     delete_notification: (notificationId : string) => void;
// }

// export const useNotificationStore = create<NotificationStateType>()(
//     persist(
//         (set, get) => ({
//             notifications: [],
//             notificationsCount: 0,
//             // eventBasedNotificationCount: {},

//             // Add a new notification to the array
//             add_new_notification: (notification: NotificationType) => {
//                 const existingNotifications = get().notifications;

//                 // Check if notification already exists
//                 const notificationExists = existingNotifications.some(
//                     (item) => item.name === notification.name
//                 );

//                 if (!notificationExists) {
//                     set((state) => {
//                         // const eventNotificationCount = state.eventBasedNotificationCount[notification.event_id] || 0;
//                         return {
//                             notifications: [notification, ...state.notifications],
//                             notificationsCount: state.notificationsCount + (notification.seen === "false" ? 1 : 0),
//                             // eventBasedNotificationCount: {
//                             //     ...state.eventBasedNotificationCount,
//                             //     [notification.event_id]: eventNotificationCount + (notification.seen === "false" ? 1 : 0)
//                             // }
//                     }
//                     });
//                 }
//             },
//             add_all_notific_directly: (notifications : NotificationType[]) => {
//                 set((state) => {
//                     return {
//                         notifications: [...notifications],
//                         notificationsCount: notifications.filter(i => i.seen === "false").length,
//                     }
//                 });
//             },

//             clear_notifications: () => {
//                 set((state) => ({
//                     notifications: [],
//                     notificationsCount: 0,
//                     // eventBasedNotificationCount: {}
//                 }));
//             },

//             mark_seen_notification: async (db, notification: NotificationType) => {
//                 try {
//                     await updateNotificationInDB(db, notification.name);

//                     set((state) => {
//                         // const currentEventCount = state.eventBasedNotificationCount[notification.event_id] || 0;
            
//                         // const updatedEventBasedNotificationCount = { ...state.eventBasedNotificationCount };
            
//                         // if (currentEventCount === 1) {
//                         //     delete updatedEventBasedNotificationCount[notification.event_id];
//                         // } else if (currentEventCount > 1) {
//                         //     updatedEventBasedNotificationCount[notification.event_id] = currentEventCount - 1;
//                         // }

//                         const toUpdateNotification = state.notifications.findIndex((item) => item.name === notification.name);
//                         if (toUpdateNotification !== -1) {
//                             const updatedNotifications = [...state.notifications];
//                             updatedNotifications[toUpdateNotification] = { ...notification, seen: "true" };
//                             return {
//                                 notifications: updatedNotifications,
//                                 notificationsCount: state.notificationsCount - 1,
//                                 // eventBasedNotificationCount: updatedEventBasedNotificationCount
//                             };
//                         }

//                         return {
//                             notifications: state.notifications,
//                             notificationsCount: state.notificationsCount - 1,
//                             // eventBasedNotificationCount: updatedEventBasedNotificationCount
//                         }
            
//                         // return {
//                         //     notifications: state.notifications.map((item) =>
//                         //         item.name === notification.name ? { ...item, seen: "true" } : item
//                         //     ),
//                         //     notificationsCount: state.notificationsCount - 1,
//                         //     // eventBasedNotificationCount: updatedEventBasedNotificationCount
//                         // };
//                     });
//                 } catch (error) {
//                     console.error("Error marking notification as seen: ", error);
//                 }
//             },
//             delete_notification: (notificationId : string) => {
//                 set((state) => {
//                     const deletedNotification = state.notifications.find((item) => item.name === notificationId);

//                     return {
//                     notifications: state.notifications.filter((item) => item.name !== notificationId),
//                     notificationsCount: deletedNotification?.seen === "true" ? state.notificationsCount : state.notificationsCount - 1,
//             }})
//             }
//         }),
//         {
//             name: 'notifications',
//             storage: createJSONStorage(() => sessionStorage),
//         }
//     )
// );



// src/zustand/useNotificationStore.ts
import { create } from 'zustand';
import { FrappeDB } from "frappe-js-sdk/lib/db"; // Import FrappeDB

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
    seen: "true" | "false" | string; // Be more specific or use boolean if possible backend
    sender: string | null;
    title: string;
    type: string;
    work_package: string;
    action_url?: string | null;
}

// Give db a proper type here
const updateNotificationInDB = async (db: FrappeDB, name: string) => {
    // Consider adding try-catch here as well
    await db.updateDoc("Nirmaan Notifications", name, {
        seen: "true" // Make sure backend expects "true" as a string
    });
};

/** How many of the newest notifications the store holds; the badge and the "new" dots count within these. */
export const NOTIFICATION_STORE_LIMIT = 500;

const unreadIn = (notifications: NotificationType[]) => notifications.filter((n) => n.seen === "false").length;

/**
 * The signed-in person's newest 500 notifications, read and unread (`NewSidebar` loads them with only the 4 fields
 * the "new" dots read), and the badge: the unread among them. The bell dropdown and the Notifications page load
 * their own full lists. Kept in memory only.
 */
export interface NotificationStateType {
    notifications: NotificationType[];
    notificationsCount: number;
    clear_notifications: () => void;
    add_all_notific_directly: (notifications: NotificationType[]) => void;
    /** A live change to one notification (`list_update`): add it, or replace the copy held. */
    upsert_notification: (notification: NotificationType) => void;
    add_new_notification: (notification: NotificationType) => void;
    // Use the correct type for db here
    mark_seen_notification: (db: FrappeDB, notification: NotificationType) => Promise<void>; // Make it async void or Promise<void>
    delete_notification: (notificationId: string) => void;
}

export const useNotificationStore = create<NotificationStateType>()(
        (set, get) => ({
            notifications: [],
            notificationsCount: 0,

            add_new_notification: (notification: NotificationType) => {
                const existingNotifications = get().notifications;
                const notificationExists = existingNotifications.some(
                    (item) => item.name === notification.name
                );

                if (!notificationExists) {
                    set((state) => ({
                        notifications: [notification, ...state.notifications],
                        notificationsCount: state.notificationsCount + (notification.seen === "false" ? 1 : 0),
                    }));
                }
            },
            add_all_notific_directly: (notifications: NotificationType[]) => {
                set({
                    notifications: [...notifications],
                    notificationsCount: unreadIn(notifications),
                });
            },

            // Leaves what a full reload would: the newest 500, and the badge counted within them.
            upsert_notification: (notification: NotificationType) => {
                set((state) => {
                    const held = state.notifications.find((item) => item.name === notification.name);
                    if (held && held.seen === notification.seen && state.notifications.length <= NOTIFICATION_STORE_LIMIT) {
                        return {}; // nothing a screen shows changed
                    }
                    const notifications = (held
                        ? state.notifications.map((item) => (item.name === notification.name ? { ...item, ...notification } : item))
                        : [notification, ...state.notifications]
                    ).slice(0, NOTIFICATION_STORE_LIMIT);
                    return { notifications, notificationsCount: unreadIn(notifications) };
                });
            },

            clear_notifications: () => {
                set({
                    notifications: [],
                    notificationsCount: 0,
                });
            },

            mark_seen_notification: async (db: FrappeDB, notification: NotificationType) => {
                 if (notification.seen === "true") {
                    console.warn(`Notification ${notification.name} is already marked as seen.`);
                    return; // Avoid unnecessary DB call and state update
                }
                try {
                    // Optimistic UI update first (optional but good UX)
                    set((state) => {
                         const updatedNotifications = state.notifications.map((item) =>
                                item.name === notification.name ? { ...item, seen: "true" } : item
                            );
                         const needsCountUpdate = state.notifications.some(n => n.name === notification.name && n.seen === "false");

                         return {
                             notifications: updatedNotifications,
                             notificationsCount: needsCountUpdate ? Math.max(0, state.notificationsCount - 1) : state.notificationsCount,
                         };
                    });

                    // Then update the DB
                    await updateNotificationInDB(db, notification.name);

                } catch (error) {
                    console.error("Error marking notification as seen: ", error);
                    // Revert optimistic update on error
                    set((state) => {
                        const revertedNotifications = state.notifications.map((item) =>
                                item.name === notification.name ? { ...item, seen: "false" } : item // Revert 'seen' status
                            );
                        // Recalculate count based on reverted state
                         const revertedCount = revertedNotifications.filter(n => n.seen === "false").length;
                        return {
                            notifications: revertedNotifications,
                            notificationsCount: revertedCount,
                        };
                    });
                }
            },
            delete_notification: (notificationId: string) => {
                set((state) => {
                    const notificationToRemove = state.notifications.find((item) => item.name === notificationId);
                    if (!notificationToRemove) return {}; // No change if not found

                    const needsCountUpdate = notificationToRemove.seen === "false";

                    return {
                        notifications: state.notifications.filter((item) => item.name !== notificationId),
                        notificationsCount: needsCountUpdate ? Math.max(0, state.notificationsCount - 1) : state.notificationsCount,
                    };
                });
            }
        })
);