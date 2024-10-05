import { useState, useEffect } from "react";
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
} from "lucide-react";
import { Button, ConfigProvider, Menu, MenuProps } from "antd";
import { Outlet } from "react-router-dom";
import { Link, useLocation } from 'react-router-dom';
import { Sheet, SheetContent } from "../ui/sheet";
import { useFrappeGetDoc } from "frappe-react-sdk";
import Cookies from "js-cookie";
import { useNotificationStore } from "@/hooks/useNotificationStore";

export const NavBar = () => {
    const [collapsed, setCollapsed] = useState(false);
    const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
    const [isSmallScreen, setIsSmallScreen] = useState(false);
    const location = useLocation();
    const [role, setRole] = useState(null)

    const [notify, setNotify] = useState({
        pr_created: 0
    })

    const notifications = useNotificationStore((state) => state.notifications);
    const markSeenNotification = useNotificationStore((state) => state.mark_seen_notification);


    // const prCreatedNotificationCount = notifications.filter(
    //     (notification) => notification.type === "pr:created" && notification.unseen
    // ).length;

    const toggleCollapsed = () => {
        setCollapsed(!collapsed);
    };

    const user_id = Cookies.get('user_id') ?? ''

    const { data, isLoading, error } = useFrappeGetDoc("Nirmaan Users", user_id, user_id === "Administrator" ? null : undefined)

    useEffect(() => {
        if (data) {
            setRole(data.role_profile)
        }
    }, [data])

    useEffect(() => {
        let temp_notify: any = {}
        temp_notify.pr_created = notifications.filter((notification) => notification.type === "pr:created" && notification.unseen).length;
        setNotify(temp_notify)

    }, [notifications])

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

    const handleNotificationClick = (type: string) => {
        markSeenNotification(type); // Marks all notifications of the given type as seen
    };


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
                            label: `Approve PR ${notify.pr_created > 0 ? `(${notify.pr_created}` : ''}`,
                            onClick: () => handleNotificationClick("pr:created")
                        },
                        { key: '/approve-vendor', label: 'Approve PO' },
                        { key: '/approve-sent-back', label: 'Approve Sent Back PO' },
                    ],
                }
            ]
            : []),
        ...(role == 'Nirmaan Procurement Executive Profile' || user_id == "Administrator" || role == "Nirmaan Admin Profile"
            ? [
                {
                    key: 'pe-actions',
                    icon: <List className="h-4 w-4" />,
                    label: 'Procurements',
                    children: [
                        { key: '/procure-request', label: 'New PR Request' },
                        { key: '/update-quote', label: 'Update Quote' },
                        { key: '/select-vendor-list', label: 'Select Vendor' },
                        { key: '/release-po', label: 'Release PO' },
                    ],
                }
            ]
            : []),
        ...(role == 'Nirmaan Procurement Executive Profile' || user_id == "Administrator" || role == "Nirmaan Admin Profile"
            ? [
                { key: '/sent-back-request', label: 'New Sent Back', icon: <SendToBack className="h-4 w-4" /> }
            ] : []
        ),
    ];

    const allKeys = [
        "projects", "users", "items", "vendors", "customers",
        "prs&milestones", "approve-order", "approve-vendor",
        "approve-sent-back", "procure-request", "update-quote",
        "select-vendor-list", "release-po", "sent-back-request"
    ];

    const selectedKeys = location.pathname !== "/" ? allKeys.find((key) => location.pathname.split("/").includes(key)) : "";

    const openKey = ["prs&milestones", "approve-order", "approve-vendor",
        "approve-sent-back"].includes(selectedKeys) ? "pl-actions" : ["procure-request", "update-quote",
            "select-vendor-list", "release-po"].includes(selectedKeys) ? "pe-actions" : ""

    if (user_id !== "Administrator" && !role) {
        return (<div>loading...</div>)
    }

    return (
        <div className="w-full flex flex-col overflow-hidden" style={{ height: 'calc(var(--vh, 1vh) * 100)' }}>
            {/* Top Navbar */}
            <div className="fixed top-0 left-0 w-full bg-white shadow-md z-50">
                <div className="flex h-16 items-center px-2 md:px-4">
                    <div className="flex items-center justify-center">
                        <Button type="text" className={`border border-slate-400 px-4 ${!collapsed && "bg-gray-200"}`} onClick={isSmallScreen ? handleMobileSidebarToggle : toggleCollapsed}>
                            {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                        </Button>
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
                {!isSmallScreen && (
                    <div className={`bg-white h-full transition-all duration-300 ease-in-out overflow-y-auto overflow-x-hidden scrollbar-container ${collapsed ? "sm:w-16 w-0" : "sm:w-64 w-0"}`}>
                        <ConfigProvider theme={{ components: { Menu: { itemActiveBg: "#FFD3CC", itemSelectedColor: "#D03B45", itemSelectedBg: "#FFD3CC", collapsedWidth: 70 } } }}>
                            <Menu triggerSubMenuAction="hover" theme="light" mode="inline" defaultSelectedKeys={["/"]} defaultOpenKeys={["admin-actions", openKey, role === "Nirmaan Project Lead Profile" ? "pl-actions" : role === "Nirmaan Procurement Executive Profile" ? "pe-actions" : ""]} inlineCollapsed={collapsed} selectedKeys={[`/${selectedKeys}`]} items={items.map((item) => ({
                                ...item,
                                label: ["pe-actions", "pl-actions", "admin-actions"].includes(item.key) ? item.label : <Link to={item.key}>{item.label}</Link>,
                                children: item.children?.map((child) => ({
                                    ...child,
                                    label: <Link to={child.key}>{child.label}</Link>,
                                    onClick: child.key === '/approve-order' ? () => handleNotificationClick("pr:created") : undefined
                                })),
                            }))} />
                        </ConfigProvider>
                    </div>
                )}

                {/* Sheet for small screens */}
                {isSmallScreen && (
                    <Sheet open={isMobileSidebarOpen} onOpenChange={handleMobileSidebarToggle}>
                        <SheetContent side="left" className="overflow-y-auto overflow-x-hidden scrollbar-container">
                            <div className="max-w-[95%]">
                                <ConfigProvider theme={{ components: { Menu: { itemActiveBg: "#FFD3CC", itemSelectedColor: "#D03B45", itemSelectedBg: "#FFD3CC", activeBarBorderWidth: 0 } } }}>
                                    <Menu triggerSubMenuAction="hover" theme="light" mode="inline" defaultSelectedKeys={["/"]} defaultOpenKeys={["admin-actions", openKey, role === "Nirmaan Project Lead Profile" ? "pl-actions" : role === "Nirmaan Procurement Executive Profile" ? "pe-actions" : ""]} selectedKeys={[`/${selectedKeys}`]} items={items.map((item) => ({
                                        ...item,
                                        onClick: () => setIsMobileSidebarOpen(false),
                                        label: ["pe-actions", "pl-actions", "admin-actions"].includes(item.key) ? item.label : <Link to={item.key}>{item.label}</Link>,
                                        children: item.children?.map((child) => ({
                                            ...child,
                                            label: <Link to={child.key}>{child.label}</Link>,
                                            onClick: child.key === '/approve-order' ? () => handleNotificationClick("pr:created") : undefined
                                        })),
                                    }))} />
                                </ConfigProvider>
                            </div>
                        </SheetContent>
                    </Sheet>
                )}

                {/* Content Area */}
                <div className="flex-1 px-4 py-2 overflow-auto transition-all duration-300 ease-in-out">
                    <Outlet />
                </div>
            </div>
        </div>
    );
};
