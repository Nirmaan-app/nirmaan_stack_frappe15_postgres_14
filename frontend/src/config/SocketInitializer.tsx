import React, { useContext, useEffect, useRef } from 'react';
import { FrappeConfig, FrappeContext } from 'frappe-react-sdk';
import { useNotificationStore } from '@/zustand/useNotificationStore';
import { NotificationServiceActions, initializeSocketListeners } from '@/services/socketListeners';

export const SocketInitializer: React.FC = () => {
    const { socket, db } = useContext(FrappeContext) as FrappeConfig;

    // Get the entire store instances
    const notificationStore = useNotificationStore();

    const initialized = useRef(false);

    useEffect(() => {
        // Ensure socket and db are available and not already initialized
        if (socket && db && notificationStore && !initialized.current) {

            if (socket.connected) {
                console.log("Socket already connected on Initializer mount:", socket.id);
            }

            // Create action objects conforming to the service interfaces
            const notificationActions: NotificationServiceActions = {
                add_new_notification: notificationStore.add_new_notification,
                delete_notification: notificationStore.delete_notification,
            };

            // const refetchActions: DataRefetchServiceActions = {
            //     triggerPrRefetch: refetchStore.triggerPrRefetch,
            //     triggerSbRefetch: refetchStore.triggerSbRefetch,
            //     triggerPoRefetch: refetchStore.triggerPoRefetch,
            //     triggerSrRefetch: refetchStore.triggerSrRefetch,
            //     triggerPaymentRefetch: refetchStore.triggerPaymentRefetch,
            //     triggerNotificationRefetch: refetchStore.triggerNotificationRefetch,
            // };

            // Pass the correctly typed action objects
            const cleanupListeners = initializeSocketListeners({
                socket,
                db,
                notificationActions,
                // refetchActions,
            });

            initialized.current = true;

            return () => {
                cleanupListeners();
                initialized.current = false;
            };
        }

    // Depend on the store instances themselves. Zustand optimizes re-renders internally.
    }, [socket, db, notificationStore]);

    return null;
};