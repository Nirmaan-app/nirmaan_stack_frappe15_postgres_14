import { useState, useEffect, useContext } from "react";
import { MainNav } from "./main-nav";
import { ModeToggle } from "./mode-toggle";
import { Notifications } from "./notifications";
import { UserNav } from "./user-nav";
import { MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons';
import {
    Building2,
    LayoutGrid,
    List,
    SendToBack,
    Shapes,
    ShoppingCart,
    SquareSquare,
} from "lucide-react";
import { Button, ConfigProvider, Menu, MenuProps } from "antd";
import { Outlet } from "react-router-dom";
import { Link, useLocation } from 'react-router-dom';
import { Sheet, SheetContent } from "../ui/sheet";
import { FrappeConfig, FrappeContext, useFrappeDocTypeEventListener, useFrappeEventListener, useFrappeGetDoc, useFrappeGetDocList, useFrappeUpdateDoc, useSWRConfig } from "frappe-react-sdk";
import Cookies from "js-cookie";
import ErrorBoundaryWithNavigationReset from "../common/ErrorBoundaryWrapper";
import ScrollToTop from "@/hooks/ScrollToTop";
import { getToken } from "firebase/messaging";
import { messaging, VAPIDKEY } from "@/firebase/firebaseConfig";
import { useNotificationStore } from "@/zustand/useNotificationStore";
import { useDocCountStore } from "@/zustand/useDocCountStore";
import { handlePRDeleteEvent, handlePRNewEvent, handlePRVendorSelectedEvent, handleSBVendorSelectedEvent, handlePOAmendedEvent, handlePRApproveNewEvent, handlePONewEvent, handleSBNewEvent } from "@/zustand/eventListeners";

export const NavBar = () => {
    const [collapsed, setCollapsed] = useState(false);
    const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
    const [isSmallScreen, setIsSmallScreen] = useState(false);
    const location = useLocation();
    const [role, setRole] = useState(null)

    const user_id = Cookies.get('user_id') ?? ''

    const { data } = useFrappeGetDoc("Nirmaan Users", user_id, user_id === "Administrator" ? null : undefined)

    const {
        pendingPRCount, approvePRCount, adminApprovePRCount, adminPendingPRCount, updatePRCounts, updateSBCounts, newSBApproveCount, 
        adminNewApproveSBCount, amendPOCount, adminAmendPOCount, updatePOCounts, adminApprovedPRCount, approvedPRCount, newPOCount, 
        adminNewPOCount, adminNewSBCounts, newSBCounts} = useDocCountStore()
    const { notifications, add_new_notification, delete_notification } = useNotificationStore();
    const { db } = useContext(FrappeContext) as FrappeConfig

    // Fetch all notifications that are unseen for the current user
    const { data: notificationsData } = useFrappeGetDocList("Nirmaan Notifications", {
        fields: ["*"],
        filters: [["recipient", "=", user_id]],
        limit: 100,
        orderBy: { field: "creation", order: "asc" }
    });

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

    const { updateDoc } = useFrappeUpdateDoc()

    const { data: projectPermissions } = useFrappeGetDocList("Nirmaan User Permissions", {
        fields: ["for_value"],
        filters: [["allow", "=", "Projects"], ["user", "=", user_id]],
        limit: 1000
    },
        user_id === "Administrator" || role === "Nirmaan Admin Profile" ? null : undefined
    )

    const permissionsList = projectPermissions?.map((i) => i?.for_value)

    const { data: poData, mutate: poDataMutate } = useFrappeGetDocList("Procurement Orders", {
        fields: ["status"],
        filters: [["project", "in", permissionsList || []]],
        limit: 1000
    },
        (user_id === "Administrator" || !permissionsList) ? null : undefined
    )

    const { data: adminPOData, mutate: adminPODataMutate } = useFrappeGetDocList("Procurement Orders", {
        fields: ["status"],
        limit: 1000
    },
        user_id === "Administrator" || role === "Nirmaan Admin Profile" ? undefined : null
    )

    const { data: prData, mutate: prDataMutate } = useFrappeGetDocList("Procurement Requests", {
        fields: ["workflow_state", "procurement_list"],
        filters: [["workflow_state", "in", ["Pending", "Vendor Selected", "Partially Approved", "Approved", "RFQ Generated", "Quote Updated"]], ["project", "in", permissionsList || []]],
        limit: 1000
    },
        (user_id === "Administrator" || !permissionsList) ? null : "prDataMutate"
    )

    const { data: adminPrData, mutate: adminPRDataMutate } = useFrappeGetDocList("Procurement Requests", {
        fields: ["workflow_state", "procurement_list"],
        filters: [["workflow_state", "in", ["Pending", "Vendor Selected", "Partially Approved", "Approved", "RFQ Generated", "Quote Updated"]]],
        limit: 1000
    },

        user_id === "Administrator" || role === "Nirmaan Admin Profile" ? "adminPRDataMutate" : null
    )

    const { data: sbData, mutate: sbDataMutate } = useFrappeGetDocList("Sent Back Category", {
        fields: ["workflow_state", "item_list", "type"],
        filters: [["workflow_state", "in", ["Vendor Selected", "Partially Approved", "Pending"]], ["project", "in", permissionsList || []]],
        limit: 1000
    },
        (user_id === "Administrator" || !permissionsList) ? null : undefined
    )

    const { data: adminSBData, mutate: adminSBDataMutate } = useFrappeGetDocList("Sent Back Category", {
        fields: ["workflow_state", "item_list", "type"],
        filters: [["workflow_state", "in", ["Vendor Selected", "Partially Approved", "Pending"]]],
        limit: 1000
    },

        user_id === "Administrator" || role === "Nirmaan Admin Profile" ? undefined : null
    )

    useEffect(() => {
        if ((user_id === "Administrator" || role === "Nirmaan Admin Profile") && adminPOData) {
            updatePOCounts(adminPOData, true)
        } else if(poData) {
            updatePOCounts(poData, false)
        }
    }, [poData, adminPOData])

    useEffect(() => {
        if ((user_id === "Administrator" || role === "Nirmaan Admin Profile") && adminSBData) {
            updateSBCounts(adminSBData, true)
        } else if(sbData) {
            updateSBCounts(sbData, false)
        }
    }, [sbData, adminSBData])

    useEffect(() => {
        if ((user_id === "Administrator" || role === "Nirmaan Admin Profile") && adminPrData) {
            updatePRCounts(adminPrData, true)
        } else if(prData) {
            updatePRCounts(prData, false)
        }
    }, [prData, adminPrData])


    //  ***** PR Events *****
    useFrappeEventListener("pr:new", async (event) => {
        await handlePRNewEvent(db, event, add_new_notification)
    });

    useFrappeEventListener("pr:delete", (event) => {
        handlePRDeleteEvent(event, delete_notification);
    });

    useFrappeEventListener("pr:vendorSelected", async (event) => {
        await handlePRVendorSelectedEvent(db, event, add_new_notification);
    });

    useFrappeEventListener("pr:approved", async (event) => {
        await handlePRApproveNewEvent(db, event, add_new_notification)
    });

    useFrappeEventListener("pr:rejected", async (event) => {
        await handlePRNewEvent(db, event, add_new_notification)
    });

    useFrappeDocTypeEventListener("Procurement Requests", async (event) => {
        if (role === "Nirmaan Admin Profile" || user_id === "Administrator") {
            await adminPRDataMutate()
        } else {
            await prDataMutate()
        }
    })


    //  ***** SB Events *****
    useFrappeEventListener("sb:vendorSelected", async (event) => {
        await handleSBVendorSelectedEvent(db, event, add_new_notification);
    });

    useFrappeEventListener("Rejected-sb:new", async (event) => {
        await handleSBNewEvent(db, event, add_new_notification)
    });

    useFrappeEventListener("Delayed-sb:new", async (event) => {
        await handleSBNewEvent(db, event, add_new_notification)
    });

    useFrappeEventListener("Cancelled-sb:new", async (event) => {
        await handleSBNewEvent(db, event, add_new_notification)
    });

    useFrappeDocTypeEventListener("Sent Back Category", async (event) => {
        if (role === "Nirmaan Admin Profile" || user_id === "Administrator") {
            await adminSBDataMutate()
        } else {
            await sbDataMutate()
        }
    })


    //  ***** PO Events *****
    useFrappeEventListener("po:amended", async (event) => {
        await handlePOAmendedEvent(db, event, add_new_notification);
    });

    useFrappeEventListener("po:new", async (event) => {
        await handlePONewEvent(db, event, add_new_notification)
    });

    useFrappeEventListener("po:delete", (event) => {
        handlePRDeleteEvent(event, delete_notification);
    });

    useFrappeDocTypeEventListener("Procurement Orders", async (event) => {
        if (role === "Nirmaan Admin Profile" || user_id === "Administrator") {
            await adminPODataMutate()
        } else {
            await poDataMutate()
        }
    })

    // useFrappeEventListener("pr:statusChanged", async (event) => { // not working
    //     await handlePRStatusChangedEvent(role, user_id);
    // });
    
    // useFrappeEventListener("pr:resolved", async (event) => {
    //     await handlePRResolvedEvent(db, event, role, user_id, add_new_notification, mutate);
    // });

    // console.log("new Notifications", notifications)

    const requestNotificationPermission = async () => {
        if (user_id && data) {
            try {
                const permission = await Notification.requestPermission();
                if (permission == 'granted') {
                    const registration = await navigator.serviceWorker.ready;
                    const token = await getToken(messaging, {
                        vapidKey: VAPIDKEY,
                        serviceWorkerRegistration: registration
                    });
                    if (data?.fcm_token !== token) {
                        console.log("running fcm token updating")
                        // Update token if it's different from the stored one
                        await updateDoc("Nirmaan Users", user_id, {
                            fcm_token: token,
                            push_notification: "true"
                        });
                        console.log('Updated FCM Token:', token);
                    } else if (data?.push_notification !== "true") {
                        await updateDoc("Nirmaan Users", user_id, {
                            push_notification: "true"
                        });
                        console.log('FCM Token already up-to-date.');
                    }
                } else {
                    if (data?.push_notification === "true") {
                        await updateDoc("Nirmaan Users", user_id, {
                            push_notification: "false"
                        })
                    }
                    console.log('Unable to get permission to notify.');
                }
            } catch (error) {
                console.error('Error getting notification permission:', error);
            }
        }
    };


    useEffect(() => {
        requestNotificationPermission();
    }, [user_id, data]);

    const toggleCollapsed = () => {
        setCollapsed(!collapsed);
    };

    useEffect(() => {
        if (data) {
            setRole(data.role_profile)
        }
    }, [data])

    const handleMobileSidebarToggle = () => {
        setIsMobileSidebarOpen(!isMobileSidebarOpen);
    };

    const updateVhVariable = () => {
        const vh = window.innerHeight * 0.01;
        document.documentElement.style.setProperty('--vh', `${vh}px`);
    };

    useEffect(() => {
        // Call the function once to set the initial value
        updateVhVariable();

        // Add event listener on resize
        window.addEventListener('resize', updateVhVariable);

        return () => {
            window.removeEventListener('resize', updateVhVariable);
        };
    }, []);

    // Media query to detect screen size changes
    useEffect(() => {
        const mediaQuery = window.matchMedia("(max-width: 640px)");

        // Function to handle media query changes
        const handleMediaQueryChange = () => {
            if (mediaQuery.matches) {
                setIsSmallScreen(true);
                setCollapsed(true); // Collapse the main sidebar on small screens
            } else {
                setIsSmallScreen(false);
                setIsMobileSidebarOpen(false); // Ensure sheet is closed when resizing to a large screen
            }
        };

        // Initial check
        handleMediaQueryChange();

        // Add the event listener
        mediaQuery.addListener(handleMediaQueryChange);

        // Clean up event listener on component unmount
        return () => {
            mediaQuery.removeListener(handleMediaQueryChange);
        };
    }, []);


    type MenuItem = Required<MenuProps>['items'][number];
    const items: MenuItem[] = [
        { key: '/', icon: <LayoutGrid className="h-4 w-4" />, label: 'Dashboard' },
        ...(user_id == "Administrator" || role == "Nirmaan Admin Profile"
            ? [
                {
                    key: 'admin-actions',
                    icon: <Shapes className="h-4 w-4" />,
                    label: 'Admin Options',
                    children: [
                        { key: '/projects', label: 'Projects' },
                        { key: '/users', label: 'Users' },
                        { key: '/items', label: 'Items' },
                        { key: '/vendors', label: 'Vendors' },
                        { key: '/customers', label: 'Customers' },
                    ],
                },
            ]
            : []),
        ...(role == 'Nirmaan Project Lead Profile' || user_id == "Administrator" || role == "Nirmaan Admin Profile"
            ? [
                {
                    key: 'pl-actions',
                    icon: <Building2 className="h-4 w-4" />,
                    label: 'Procurement Actions',
                    children: [
                        { key: '/prs&milestones', label: 'PRs & Milestones' },
                        {
                            key: '/approve-order',
                            label: (
                                <div className="flex justify-between items-center relative">
                                    Approve PR
                                    {(role === "Nirmaan Admin Profile" || user_id === "Administrator") && adminPendingPRCount && adminPendingPRCount !== 0 ? (
                                    <div className="absolute right-0 flex items-center justify-center rounded-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 w-5 h-5 shadow-md">
                                        <span className="text-white text-xs font-bold">
                                            {adminPendingPRCount}
                                        </span>
                                    </div>
                                    ) : (
                                        (pendingPRCount && pendingPRCount !== 0) ? (
                                        <div className="absolute right-0 flex items-center justify-center rounded-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 w-5 h-5 shadow-md">
                                            <span className="text-white text-xs font-bold">
                                            {pendingPRCount}
                                        </span>
                                    </div>
                                        ) : ""
                                    )}
                                </div>
                            ),
                        },
                        {
                            key: '/approve-vendor', label: (
                                <div className="flex justify-between items-center relative">
                                    Approve PO
                                    {(role === "Nirmaan Admin Profile" || user_id === "Administrator") && adminApprovePRCount && adminApprovePRCount !== 0 ? (
                                    <div className="absolute right-0 flex items-center justify-center rounded-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 w-5 h-5 shadow-md">
                                        <span className="text-white text-xs font-bold">
                                            {adminApprovePRCount}
                                        </span>
                                    </div>
                                    ) : (
                                        (approvePRCount && approvePRCount !== 0) ? (
                                        <div className="absolute right-0 flex items-center justify-center rounded-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 w-5 h-5 shadow-md">
                                            <span className="text-white text-xs font-bold">
                                            {approvePRCount}
                                        </span>
                                    </div>
                                        ) : ""
                                    )}
                                </div>
                            ),

                        },
                        {
                            key: '/approve-amended-po', label: (
                                <div className="flex justify-between items-center relative">
                                    Approve Amended PO
                                    {(role === "Nirmaan Admin Profile" || user_id === "Administrator") && adminAmendPOCount && adminAmendPOCount !== 0 ? (
                                    <div className="absolute right-0 flex items-center justify-center rounded-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 w-5 h-5 shadow-md">
                                        <span className="text-white text-xs font-bold">
                                            {adminAmendPOCount}
                                        </span>
                                    </div>
                                    ) : (
                                        (amendPOCount && amendPOCount !== 0) ? (
                                        <div className="absolute right-0 flex items-center justify-center rounded-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 w-5 h-5 shadow-md">
                                            <span className="text-white text-xs font-bold">
                                            {amendPOCount}
                                        </span>
                                    </div>
                                        ) : ""
                                    )}
                                </div>

                            ),
                        },
                        {
                            key: '/approve-sent-back', label: (
                                <div className="flex justify-between items-center relative">
                                    Approve Sent Back PO
                                    {(role === "Nirmaan Admin Profile" || user_id === "Administrator") && adminNewApproveSBCount && adminNewApproveSBCount !== 0 ? (
                                    <div className="absolute right-0 flex items-center justify-center rounded-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 w-5 h-5 shadow-md">
                                        <span className="text-white text-xs font-bold">
                                            {adminNewApproveSBCount}
                                        </span>
                                    </div>
                                    ) : (
                                        (newSBApproveCount && newSBApproveCount !== 0) ? (
                                        <div className="absolute right-0 flex items-center justify-center rounded-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 w-5 h-5 shadow-md">
                                            <span className="text-white text-xs font-bold">
                                            {newSBApproveCount}
                                        </span>
                                    </div>
                                        ) : ""
                                    )}
                                </div>
                            ),

                        },
                        { key: '/approve-service-request', label: 'Approve Service Request' },
                    ],
                }
            ]
            : []),
        ...(role == 'Nirmaan Procurement Executive Profile' || user_id == "Administrator" || role == "Nirmaan Admin Profile"
            ? [
                {
                    key: 'pe-actions',
                    icon: <List className="h-4 w-4" />,
                    label: 'Procurement Requests',
                    children: [
                        { key: '/procure-request', label: (
                            <div className="flex justify-between items-center relative">
                                New PR Request
                                {(role === "Nirmaan Admin Profile" || user_id === "Administrator") && adminApprovedPRCount && adminApprovedPRCount !== 0 ? (
                                <div className="absolute right-0 flex items-center justify-center rounded-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 w-5 h-5 shadow-md">
                                    <span className="text-white text-xs font-bold">
                                        {adminApprovedPRCount}
                                    </span>
                                </div>
                                ) : (
                                    (approvedPRCount && approvedPRCount !== 0) ? (
                                    <div className="absolute right-0 flex items-center justify-center rounded-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 w-5 h-5 shadow-md">
                                        <span className="text-white text-xs font-bold">
                                        {approvedPRCount}
                                    </span>
                                </div>
                                    ) : ""
                                )}
                            </div>

                        )},
                        { key: '/update-quote', label: 'Update Quote' },
                        { key: '/select-vendor-list', label: 'Choose Vendor' },
                        // {key: '/service-request', label: 'Service Requests'}
                    ],
                },
                {
                    key: 'pe-sr-actions',
                    icon: <SquareSquare className="h-4 w-4" />,
                    label: "Service Requests",
                    children: [
                        {key: '/service-request', label : 'View/Create SR'},
                        {key: '/select-service-vendor', label : 'Select Service Vendor'},
                        {key: '/approved-sr', label : 'Approved SR'},
                    ]
                },
                {
                    key : 'pe-po-actions',
                    icon : <ShoppingCart className="h-4 w-4" />,
                    label: 'Purchase Orders',
                    children : [
                        { key: '/release-po', label: (
                            <div className="flex justify-between items-center relative">
                                Approved PO
                                {(role === "Nirmaan Admin Profile" || user_id === "Administrator") && adminNewPOCount && adminNewPOCount !== 0 ? (
                                <div className="absolute right-0 flex items-center justify-center rounded-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 w-5 h-5 shadow-md">
                                    <span className="text-white text-xs font-bold">
                                        {adminNewPOCount}
                                    </span>
                                </div>
                                ) : (
                                    (newPOCount && newPOCount !== 0) ? (
                                    <div className="absolute right-0 flex items-center justify-center rounded-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 w-5 h-5 shadow-md">
                                        <span className="text-white text-xs font-bold">
                                        {newPOCount}
                                    </span>
                                </div>
                                    ) : ""
                                )}
                            </div>

                        ),
                            
                         },
                        { key: '/released-po', label: 'Released PO' }
                    ]
                }
            ]
            : []),
        ...(role == 'Nirmaan Procurement Executive Profile' || user_id == "Administrator" || role == "Nirmaan Admin Profile"
            ? [
                { 
                    key: 'sent-back-actions', 
                    icon: <SendToBack className="h-4 w-4" />,
                    label: 'Sent Back Requests', 
                    children: [
                        { key: '/rejected-sb', label: (
                            <div className="flex justify-between items-center relative">
                                Rejected Sent Back
                                {(role === "Nirmaan Admin Profile" || user_id === "Administrator") && adminNewSBCounts.rejected && adminNewSBCounts.rejected !== 0 ? (
                                <div className="absolute right-0 flex items-center justify-center rounded-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 w-5 h-5 shadow-md">
                                    <span className="text-white text-xs font-bold">
                                        {adminNewSBCounts.rejected}
                                    </span>
                                </div>
                                ) : (
                                    (newSBCounts.rejected && newSBCounts.rejected !== 0) ? (
                                    <div className="absolute right-0 flex items-center justify-center rounded-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 w-5 h-5 shadow-md">
                                        <span className="text-white text-xs font-bold">
                                        {newSBCounts.rejected}
                                    </span>
                                </div>
                                    ) : ""
                                )}
                            </div>

                        )},
                        { key: '/delayed-sb', label: (
                            <div className="flex justify-between items-center relative">
                                Delayed Sent Back
                                {(role === "Nirmaan Admin Profile" || user_id === "Administrator") && adminNewSBCounts.delayed && adminNewSBCounts.delayed !== 0 ? (
                                <div className="absolute right-0 flex items-center justify-center rounded-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 w-5 h-5 shadow-md">
                                    <span className="text-white text-xs font-bold">
                                        {adminNewSBCounts.delayed}
                                    </span>
                                </div>
                                ) : (
                                    (newSBCounts.delayed && newSBCounts.delayed !== 0) ? (
                                    <div className="absolute right-0 flex items-center justify-center rounded-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 w-5 h-5 shadow-md">
                                        <span className="text-white text-xs font-bold">
                                        {newSBCounts.delayed}
                                    </span>
                                </div>
                                    ) : ""
                                )}
                            </div>

                        )},
                        { key: '/cancelled-sb', label: (
                            <div className="flex justify-between items-center relative">
                                Cancelled Sent Back
                                {(role === "Nirmaan Admin Profile" || user_id === "Administrator") && adminNewSBCounts.cancelled && adminNewSBCounts.cancelled !== 0 ? (
                                <div className="absolute right-0 flex items-center justify-center rounded-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 w-5 h-5 shadow-md">
                                    <span className="text-white text-xs font-bold">
                                        {adminNewSBCounts.cancelled}
                                    </span>
                                </div>
                                ) : (
                                    (newSBCounts.cancelled && newSBCounts.cancelled !== 0) ? (
                                    <div className="absolute right-0 flex items-center justify-center rounded-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 w-5 h-5 shadow-md">
                                        <span className="text-white text-xs font-bold">
                                        {newSBCounts.cancelled}
                                    </span>
                                </div>
                                    ) : ""
                                )}
                            </div>

                        )}
                    ]
                }
            ] : []
        ),
    ];

    const allKeys = [
        "projects", "users", "items", "vendors", "customers",
        "prs&milestones", "approve-order", "approve-vendor",
        "approve-sent-back", "approve-amended-po", "procure-request", "update-quote",
        "select-vendor-list", "release-po", "released-po", "rejected-sb", "delayed-sb", "cancelled-sb",
        "service-request", "approve-service-request", "select-service-vendor", "approved-sr"
    ];

    const selectedKeys = location.pathname !== "/" ? allKeys.find((key) => location.pathname.split("/").includes(key)) : "";

    const openKey = ["prs&milestones", "approve-order", "approve-vendor",
        "approve-sent-back", "approve-amended-po", "approve-service-request"].includes(selectedKeys) ? "pl-actions" : ["service-request", "procure-request", "update-quote",
            "select-vendor-list"].includes(selectedKeys) ? "pe-actions" : ["release-po", "released-po"].includes(selectedKeys) ? "pe-po-actions" : 
            ["rejected-sb", "delayed-sb", "cancelled-sb"].includes(selectedKeys) ? "sent-back-actions" : ["service-request", "select-service-vendor", "approved-sr"].includes(selectedKeys) ? "pe-sr-actions" : ""

    if (user_id !== "Administrator" && !role) {
        return (<div>loading...</div>)
    }

    return (
        <div className="w-full flex flex-col overflow-hidden" style={{ height: 'calc(var(--vh, 1vh) * 100)' }}>
            {/* Top Navbar */}
            <div className="fixed top-0 left-0 w-full bg-white shadow-md z-50">
                <div className="flex h-16 items-center px-2 md:px-4">
                    <div className="flex items-center justify-center">
                        {(data?.has_project !== "false" || role === "Nirmaan Admin Profile") && (
                            <Button type="text" className={`border border-slate-400 px-4 ${!collapsed && "bg-gray-200"}`} onClick={isSmallScreen ? handleMobileSidebarToggle : toggleCollapsed}>
                                {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                            </Button>
                        )}
                        <MainNav className="mx-2 md:mx-6" />
                    </div>
                    <div className="ml-auto flex items-center space-x-4">
                        <ModeToggle />
                        <Notifications />
                        <UserNav />
                    </div>
                </div>
            </div>

            {/* Main Content Wrapper */}
            <div className="flex mt-16 overflow-hidden" style={{ height: 'calc(var(--vh, 1vh) * 100 - 64px)' }}>
                {/* Sidebar for large screens */}
                {!isSmallScreen && (data?.has_project !== "false" || role === "Nirmaan Admin Profile") && (
                    <div className={`bg-white h-full transition-all duration-300 ease-in-out overflow-y-auto overflow-x-hidden scrollbar-container ${collapsed ? "sm:w-16 w-0" : role === "Nirmaan Project Manager Profile" ? "sm:w-40 w-0" : "sm:w-64 w-0"}`}>
                        <ConfigProvider theme={{ components: { Menu: { itemActiveBg: "#FFD3CC", itemSelectedColor: "#D03B45", itemSelectedBg: "#FFD3CC", collapsedWidth: 70, dropdownWidth: 220 } } }}>
                            <Menu triggerSubMenuAction="hover" theme="light" mode="inline" defaultSelectedKeys={["/"]} defaultOpenKeys={["admin-actions", openKey, role === "Nirmaan Project Lead Profile" ? "pl-actions" : role === "Nirmaan Procurement Executive Profile" ? "pe-actions" : ""]} inlineCollapsed={collapsed} selectedKeys={[`/${selectedKeys}`]} items={items.map((item) => ({
                                ...item,
                                label: ["pe-actions", "pl-actions", "admin-actions", "pe-po-actions", "pe-sr-actions", "sent-back-actions"].includes(item.key) ? item.label : <Link to={item.key}>{item.label}</Link>,
                                children: item.children?.map((child) => ({
                                    ...child,
                                    label: <Link to={child.key}>{child.label}</Link>
                                })),
                            }))} />
                        </ConfigProvider>
                    </div>
                )}

                {/* Sheet for small screens */}
                {isSmallScreen && (data?.has_project !== "false" || role === "Nirmaan Admin Profile") && (
                    <Sheet open={isMobileSidebarOpen} onOpenChange={handleMobileSidebarToggle}>
                        <SheetContent side="left" className={`overflow-y-auto overflow-x-hidden scrollbar-container ${role === "Nirmaan Project Manager Profile" ? "w-64" : ""}`}>
                            <div className={`${role === "Nirmaan Project Manager Profile" ? "" : "max-w-[95%]"}`}>
                                <ConfigProvider theme={{ components: { Menu: { itemActiveBg: "#FFD3CC", itemSelectedColor: "#D03B45", itemSelectedBg: "#FFD3CC", activeBarBorderWidth: 0 } } }}>
                                    <Menu triggerSubMenuAction="hover" theme="light" mode="inline" defaultSelectedKeys={["/"]} defaultOpenKeys={["admin-actions", openKey, role === "Nirmaan Project Lead Profile" ? "pl-actions" : role === "Nirmaan Procurement Executive Profile" ? "pe-actions" : ""]} selectedKeys={[`/${selectedKeys}`]} items={items.map((item) => ({
                                        ...item,
                                        onClick: () => setIsMobileSidebarOpen(false),
                                        label: ["pe-actions", "pl-actions", "admin-actions", "pe-po-actions", "pe-sr-actions", "sent-back-actions"].includes(item.key) ? item.label : <Link to={item.key}>{item.label}</Link>,
                                        children: item.children?.map((child) => ({
                                            ...child,
                                            label: <Link to={child.key}>{child.label}</Link>
                                        })),
                                    }))} />
                                </ConfigProvider>
                            </div>
                        </SheetContent>
                    </Sheet>
                )}

                {/* Content Area */}
                <div id="scrollwindow" className="flex-1 px-4 py-2 overflow-auto transition-all duration-300 ease-in-out">
                    <ErrorBoundaryWithNavigationReset>
                        <ScrollToTop />
                        <Outlet />
                    </ErrorBoundaryWithNavigationReset>
                </div>
            </div>
        </div>
    );
};