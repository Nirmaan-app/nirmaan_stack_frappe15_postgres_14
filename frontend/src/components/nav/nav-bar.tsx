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

export const NavBar = () => {
  const [collapsed, setCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isSmallScreen, setIsSmallScreen] = useState(false);
  const location = useLocation();

  const toggleCollapsed = () => {
    setCollapsed(!collapsed);
  };

  const handleMobileSidebarToggle = () => {
    setIsMobileSidebarOpen(!isMobileSidebarOpen);
  };

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
    {
      key: 'pl-actions',
      icon: <Building2 className="h-4 w-4" />,
      label: 'Procurement Actions',
      children: [
        { key: '/prs&milestones', label: 'PRs & Milestones' },
        { key: '/approve-order', label: 'Approve PR' },
        { key: '/approve-vendor', label: 'Approve PO' },
        { key: '/approve-sent-back', label: 'Approve Sent Back PO' },
      ],
    },
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
    },
    { key: '/sent-back-request', label: 'New Sent Back', icon: <SendToBack className="h-4 w-4" /> },
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

  return (
    <div className="w-full h-screen flex flex-col overflow-hidden">
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
      <div className="flex flex-1 pt-16 overflow-hidden">
        {/* Sidebar for large screens */}
        {!isSmallScreen && (
          <div className={`bg-white h-full transition-all duration-300 ease-in-out overflow-y-auto scrollbar-container ${collapsed ? "sm:w-16 w-0" : "sm:w-64 w-0"}`}>
            <ConfigProvider theme={{ components: { Menu: { itemActiveBg: "#FFD3CC", itemSelectedColor: "#D03B45", itemSelectedBg: "#FFD3CC" }}}}>
              <Menu triggerSubMenuAction="hover" theme="light" mode="inline" defaultSelectedKeys={["/"]} defaultOpenKeys={["admin-actions", openKey]} inlineCollapsed={collapsed} selectedKeys={[`/${selectedKeys}`]} items={items.map((item) => ({
                ...item,
                label: ["pe-actions", "pl-actions", "admin-actions"].includes(item.key) ? item.label : <Link to={item.key}>{item.label}</Link>,
                children: item.children?.map((child) => ({ ...child, label: <Link to={child.key}>{child.label}</Link> })),
              }))} />
            </ConfigProvider>
          </div>
        )}

        {/* Sheet for small screens */}
        {isSmallScreen && (
          <Sheet open={isMobileSidebarOpen} onOpenChange={handleMobileSidebarToggle}>
            <SheetContent side="left" className="overflow-y-auto scrollbar-container">
              <ConfigProvider theme={{ components: { Menu: { itemActiveBg: "#FFD3CC", itemSelectedColor: "#D03B45", itemSelectedBg: "#FFD3CC" }}}}>
                <Menu triggerSubMenuAction="hover" theme="light" mode="inline" defaultSelectedKeys={["/"]} defaultOpenKeys={["admin-actions", openKey]} selectedKeys={[`/${selectedKeys}`]} items={items.map((item) => ({
                  ...item,
                  onClick: () => setIsMobileSidebarOpen(false),
                  label: ["pe-actions", "pl-actions", "admin-actions"].includes(item.key) ? item.label : <Link to={item.key}>{item.label}</Link>,
                  children: item.children?.map((child) => ({ ...child, label: <Link to={child.key}>{child.label}</Link> })),
                }))} />
              </ConfigProvider>
            </SheetContent>
          </Sheet>
        )}

        {/* Content Area */}
        <div className="flex-1 px-2 overflow-auto transition-all duration-300 ease-in-out">
          <Outlet />
        </div>
      </div>
    </div>
  );
};
