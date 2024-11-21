import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem } from "@/components/ui/sidebar"
import { Calendar, ChevronDown, ChevronRight, ChevronUp, Home, Inbox, Search, Settings, User2 } from "lucide-react"
import logo from "@/assets/logo-svg.svg"
import {
    Building2,
    LayoutGrid,
    List,
    SendToBack,
    Shapes,
    ShoppingCart,
    SquareSquare,
} from "lucide-react";
import { useEffect, useState } from "react";
import Cookies from "js-cookie";
import { useFrappeGetDoc } from "frappe-react-sdk";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { Link, useLocation } from "react-router-dom";

export function NewSidebar() {

    const [role, setRole] = useState(null)
    const location = useLocation();

    const user_id = Cookies.get('user_id') ?? ''

    const { data } = useFrappeGetDoc("Nirmaan Users", user_id, user_id === "Administrator" ? null : undefined)

    useEffect(() => {
        if (data) {
            setRole(data.role_profile)
        }
    }, [data])

    const items = [
        // { key: '/', icon: <LayoutGrid className="h-4 w-4" />, label: 'Dashboard' },
        ...(user_id == "Administrator" || role == "Nirmaan Admin Profile"
            ? [
                {
                    key: 'admin-actions',
                    icon: Shapes,
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
                    icon: Building2 ,
                    label: 'Procurement Actions',
                    children: [
                        { key: '/prs&milestones', label: 'PRs & Milestones' },
                        {
                            key: '/approve-order',
                            label: "Approve PR"
                        },
                        {
                            key: '/approve-vendor', label: "Approve PO"},
                        {
                            key: '/approve-amended-po', label: "Approve Amended PO"},
                        {
                            key: '/approve-sent-back', label: "Approve Sent Back PO"},
                        { key: '/approve-service-request', label: "Approve Service Order"},
                    ],
                }
            ]
            : []),
        ...(role == 'Nirmaan Procurement Executive Profile' || user_id == "Administrator" || role == "Nirmaan Admin Profile"
            ? [
                {
                    key: 'pe-actions',
                    icon: List,
                    label: 'Procurement Requests',
                    children: [
                        { key: '/procure-request', label: "New PR Request"},
                        { key: '/update-quote', label: 'Update Quote' },
                        { key: '/select-vendor-list', label: 'Choose Vendor' },
                        // {key: '/service-request', label: 'Service Requests'}
                    ],
                },
                {
                    key: 'pe-sr-actions',
                    icon: SquareSquare,
                    label: "Service Requests",
                    children: [
                        {key: '/service-request', label : 'View/Create SR'},
                        {key: '/select-service-vendor', label : 'Select Service Vendor'},
                        {key: '/approved-sr', label: "Approved SR"},
                    ]
                },
                {
                    key : 'pe-po-actions',
                    icon : ShoppingCart,
                    label: 'Purchase Orders',
                    children : [
                        { key: '/release-po', label: "Approved PO"},
                        { key: '/released-po', label: 'Released PO' }
                    ]
                }
            ]
            : []),
        ...(role == 'Nirmaan Procurement Executive Profile' || user_id == "Administrator" || role == "Nirmaan Admin Profile"
            ? [
                { 
                    key: 'sent-back-actions', 
                    icon: SendToBack,
                    label: 'Sent Back Requests', 
                    children: [
                        { key: '/rejected-sb', label: "Rejected Sent Back"},
                        { key: '/delayed-sb', label: "Delayed Sent Back"},
                        { key: '/cancelled-sb', label: "Cancelled Sent Back"}
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


    const isDefaultOpen = ["admin-actions", openKey, role === "Nirmaan Project Lead Profile" ? "pl-actions" : role === "Nirmaan Procurement Executive Profile" ? "pe-actions" : ""]
       
    return (
        <Sidebar collapsible="icon">
        <SidebarHeader>
          <img src={logo} alt="Nirmaan" width="158" height="48" />
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarMenu>
            {items.map((item) => (
              <Collapsible key={item.key} defaultOpen={isDefaultOpen.includes(item.key)} className="group/collapsible" asChild>
                {/* <SidebarGroupLabel asChild>
                  <CollapsibleTrigger className="flex items-center gap-2">
                    {item.icon && <item.icon className="h-4 w-4" />}
                    <span>{item.label}</span>
                    <ChevronDown className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-180" />
                  </CollapsibleTrigger>
                </SidebarGroupLabel> */}
                <SidebarMenuItem>
              <CollapsibleTrigger asChild>
                <SidebarMenuButton tooltip={item.label}>
                  {item.icon && <item.icon />}
                  <span>{item.label}</span>
                  <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                </SidebarMenuButton>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <SidebarMenuSub>
                {/* {item.children && (
                  <CollapsibleContent>
                    <SidebarGroupContent>
                      <SidebarMenu>
                        <SidebarMenuSub> */}
                            {item.children.map((subitem) => (
                              <SidebarMenuSubItem key={subitem.key}>
                                <SidebarMenuSubButton asChild>
                                  <Link to={subitem.key}>
                                    <span>{subitem.label}</span>
                                  </Link>
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            ))}
                        {/* </SidebarMenuSub>
                      </SidebarMenu>
                    </SidebarGroupContent>
                  </CollapsibleContent>
                )} */}
                </SidebarMenuSub>
                </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>
            ))}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton>
                    <User2 /> Username
                    <ChevronUp className="ml-auto" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  side="top"
                  className="w-[--radix-popper-anchor-width]"
                >
                  <DropdownMenuItem>
                    <span>Account</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <span>Billing</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <span>Sign out</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
  )
}
