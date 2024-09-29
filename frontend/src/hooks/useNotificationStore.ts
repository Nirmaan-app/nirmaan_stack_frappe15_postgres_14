import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export interface NotificationType {
    id: string
    type: string
    message: any
    unseen: boolean
}

export interface NotificationStateType {
    notifications: NotificationType[]
    add_new_notification: (type: string, message: any) => void
    mark_seen_notification: (notification: NotificationType) => void
    delete_seen_notifications: () => void
}


const randomId = function (length = 6) {
    return Math.random().toString(36).substring(2, length + 2);
};


export const useNotificationStore = create<NotificationStateType>()(
    persist(
        (set) => ({
            notifications: [],
            add_new_notification: (type: string, message: any) => set((state) => (
                { notifications: [...state.notifications, { id: randomId(), type: type, message: message, unseen: true }] }
            )),
            mark_seen_notification: (notification: NotificationType) => set((state) => (
                { notifications: [...state.notifications.filter((item) => item.id !== notification.id), { ...notification, unseen: false }] }
            )),
            delete_seen_notifications: () => set((state) => (
                { notifications: [...state.notifications.filter((item) => item.unseen === true)] }
            ))

        }),
        {
            name: 'notifications',
            storage: createJSONStorage(() => sessionStorage),
        }
    )
)

export const useGetNotificationByType = (type: string) => {
    const notifications = useNotificationStore((state: NotificationStateType) => state.notifications)
    return notifications.filter((item) => (item.type === type && item.unseen === true))
}
