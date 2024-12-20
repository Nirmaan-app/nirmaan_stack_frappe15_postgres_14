import { Bell } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { useNotificationStore } from "@/zustand/useNotificationStore";
import { useContext, useState } from "react";
import { FrappeConfig, FrappeContext, useFrappeGetDocList } from "frappe-react-sdk";
import { useNavigate } from "react-router-dom";
import { format, isToday, isYesterday } from "date-fns";

export function Notifications() {
    const { db } = useContext(FrappeContext) as FrappeConfig;
    const navigate = useNavigate();

    const { notifications, notificationsCount, mark_seen_notification } = useNotificationStore();
    const [isDropdownOpen, setDropdownOpen] = useState(false);

    const {data : usersList} = useFrappeGetDocList("Nirmaan Users", {
        fields: ["full_name", "name"],
        limit: 1000
    })

    const getName = (name) => {
        if(usersList) {
            return usersList?.find((user) => user.name === name)?.full_name
        }
    }

    const handleNavigate = (url, notification) => {
        if (url) {
            if (notification.seen === "false") {
                mark_seen_notification(db, notification);
            }
            setDropdownOpen(false);
            navigate(`/${url}`);
        }
    };

    const formatNotificationDate = (creationDate) => {
        const date = new Date(creationDate);

        if (isToday(date)) {
            return `Today, ${format(date, 'HH:mm')}`;
        } else if (isYesterday(date)) {
            return `Yesterday, ${format(date, 'HH:mm')}`;
        }
    
        return format(date, 'MMM dd, yyyy, HH:mm');
    };

    return (
        <DropdownMenu open={isDropdownOpen} onOpenChange={setDropdownOpen}>
            <DropdownMenuTrigger>
                <div className="relative">
                    <Bell className="h-6 w-6" />
                    {notificationsCount !== 0 && (
                        <span className="absolute -top-1 -right-1 bg-red-600 text-white rounded-full h-4 w-4 flex items-center justify-center text-xs">
                            {notificationsCount}
                        </span>
                    )}
                </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-80 overflow-y-auto max-h-[36rem]" align="end" forceMount>
                <DropdownMenuLabel className="font-normal">
                    {notifications.length !== 0 ? (
                        <div className="space-y-4">
                            <ul className="space-y-3">
                                {notifications.map((notification) => (
                                    <li
                                        key={notification.name}
                                        className={`border-t first:border-t-0 rounded-sm transition-all ${notification.seen === "false" ? "bg-red-200 hover:bg-red-100" : "hover:bg-gray-100"}`}
                                    >
                                        <div
                                            onClick={() => handleNavigate(notification?.action_url, notification)}
                                            className="cursor-pointer py-2 px-5 relative"
                                        >
                                            {notification.seen === "false" && (
                                                <div className="w-2 h-2 bg-red-500 absolute rounded-full top-3.5 left-1" />
                                            )}
                                            <div className="flex items-start justify-between">
                                                <h4 className="font-semibold text-sm text-blue-600">
                                                    {notification.title}
                                                </h4>
                                                <div className="text-xs text-gray-500 text-right">
                                                    <p>{formatNotificationDate(notification.creation)}</p>
                                                </div>
                                            </div>
                                            <p className="text-sm text-gray-600">
                                                {notification.description}
                                            </p>
                                            <div className="text-xs text-gray-500 mt-1">
                                                <p>Project: {notification.project}</p>
                                                <p>Work Package: {notification.work_package}</p>
                                                <p>Action By: {notification?.sender ? getName(notification?.sender) : "Administrator"}</p>
                                            </div>
                                        </div>
                                        <div className="flex justify-end py-1 pr-2">
                                            {notification.seen === "true" ? (
                                                <span className="text-green-500">Seen</span>
                                            ) : (
                                                <span
                                                    onClick={() => mark_seen_notification(db, notification)}
                                                    className="underline text-primary hover:text-red-400 cursor-pointer"
                                                >
                                                    Mark as read
                                                </span>
                                            )}
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ) : (
                        <h1 className="text-center text-gray-500">NO NEW NOTIFICATIONS</h1>
                    )}
                </DropdownMenuLabel>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
