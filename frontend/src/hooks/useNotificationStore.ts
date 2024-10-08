import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export interface NotificationType {
    id: string
    type: string
    message: {
        name: string
    }
    unseen: boolean
    clicked: boolean
}

export interface NotificationStateType {
    notifications: NotificationType[]
    add_new_notification: (type: string, message: any) => void
    mark_seen_notification: (type: string) => void
    mark_clicked_notification: (id: string) => void
    delete_seen_notifications: () => void
}

const randomId = function (length = 6) {
    return Math.random().toString(36).substring(2, length + 2);
};

export const useNotificationStore = create<NotificationStateType>()(
    persist(
        (set) => ({
            notifications: [],

            add_new_notification: (type: string, message: any) => set((state) => ({
                notifications: [
                    ...state.notifications.filter((item) => ((item.unseen === true && item.clicked === false) || item.message.name !== message.name)),
                    { id: randomId(), type, message, unseen: true, clicked: false }
                ]
            })),

            mark_seen_notification: (type: string) => set((state) => ({
                notifications: state.notifications.map((item) =>
                    item.type === type ? { ...item, unseen: false } : item
                )
            })),

            // Updated to mark a notification clicked by the PR name from the message object
            mark_clicked_notification: (id: string) => set((state) => ({
                notifications: state.notifications.map((item) =>
                    item.id === id ? { ...item, clicked: true } : item
                )
            })),

            delete_seen_notifications: () => set((state) => ({
                notifications: state.notifications.filter((item) => item.unseen === true)
            }))

        }),
        {
            name: 'notifications',
            storage: createJSONStorage(() => sessionStorage),
        }
    )
)