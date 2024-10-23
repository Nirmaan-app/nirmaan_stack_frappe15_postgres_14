async function handleNotification(db, event, add_new_notification) {
    if (event?.notificationId) {
        const newNotificationData = await db.getDoc("Nirmaan Notifications", event.notificationId);
        if (newNotificationData) {
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
                action_url: newNotificationData?.action_url,
            });
            console.log("Updated notifications state with new data", newNotificationData);
        }
    }
}

// Event listener for "pr:new"
export const handlePRNewEvent = async (db, event, add_new_notification) => {
    await handleNotification(db, event, add_new_notification);
};

// Event listener for "pr:delete"
export const handlePRDeleteEvent = (event, delete_notification) => {
    if (event?.notificationId) {
        delete_notification(event.notificationId);
    }
};

// Event listener for "pr:vendorSelected"
export const handlePRVendorSelectedEvent = async (db, event, add_new_notification) => {
    await handleNotification(db, event, add_new_notification);
};

// Event listener for "pr:resolved"
// export const handlePRResolvedEvent = async (db, event, add_new_notification) => {
//     await handleNotification(db, event, add_new_notification);
// };

// Event listener for "sb:vendorSelected"
export const handleSBVendorSelectedEvent = async (db, event, add_new_notification) => {
    await handleNotification(db, event, add_new_notification);
};

export const handlePOAmendedEvent = async (db, event, add_new_notification) => {
    await handleNotification(db, event, add_new_notification)
}