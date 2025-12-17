import logo from "@/assets/logo-svg.svg";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarTrigger,
  useSidebar
} from "@/components/ui/sidebar";
import {
  BlendIcon,
  ChevronRight,
  CircleDollarSign,
  ClipboardMinus,
  HandCoins,
  ReceiptText, FileUp,
  Banknote,
  CreditCard,
  BanknoteIcon,
  Dices,
  Landmark,PencilRuler
} from "lucide-react";

import { messaging, VAPIDKEY } from "@/firebase/firebaseConfig";
import { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers";
import { useNotificationStore } from "@/zustand/useNotificationStore";
import { getToken } from "firebase/messaging";
import {
  useFrappeDocTypeEventListener,
  useFrappeGetDoc,
  useFrappeGetDocList,
  useFrappeUpdateDoc,
  useSWRConfig,
} from "frappe-react-sdk";
import Cookies from "js-cookie";
import {
  LayoutGrid,
  List,
  Shapes,
  ShoppingCart,
  SquareSquare
} from "lucide-react";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { UserNav } from "../nav/user-nav";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import { Separator } from "../ui/separator";
import { API_PATH, useCountsBridge } from "@/hooks/useSidebarCounts";

export function NewSidebar() {
  const [role, setRole] = useState<string | null>(null);
  const location = useLocation();

  const navigate = useNavigate();

  const user_id = Cookies.get("user_id") ?? "";

  // * inside component body */
  const _ = useCountsBridge(user_id);                //  <-- one hook, done

  const [collapsedKey, setCollapsedKey] = useState<string | null>(null); // Tracks the currently open group

  const handleGroupToggle = useCallback((key: string) => {
    setCollapsedKey((prevKey) => (prevKey === key ? null : key));
  }, [collapsedKey]);

  const { toggleSidebar, isMobile, state } = useSidebar();

  const { data } = useFrappeGetDoc<NirmaanUsers>(
    "Nirmaan Users",
    user_id,
    user_id === "Administrator" ? null : undefined
  );

  useEffect(() => {
    if (data) {
      setRole(data.role_profile);
    }
  }, [data]);

  const { clear_notifications, add_all_notific_directly } =
    useNotificationStore();
  // const { db } = useContext(FrappeContext) as FrappeConfig;

  // Fetch all notifications that are unseen for the current user
  const { data: notificationsData, mutate: notificationsDataMutate } = useFrappeGetDocList(
    "Nirmaan Notifications",
    {
      fields: ["name", "creation", "description", "docname", "document", "event_id", "project", "recipient", "recipient_role", "seen", "sender", "title", "type", "work_package", "action_url"],
      filters: [["recipient", "=", user_id]],
      limit: 500,
      orderBy: { field: "creation", order: "desc" },
    }
  );

  // On initial render, segregate notifications and store in Zustand
  useEffect(() => {
    if (notificationsData) {
      clear_notifications();
      // notificationsData.forEach((notification: any) => {
      //   add_new_notification({
      //     name: notification.name,
      //     creation: notification.creation,
      //     description: notification.description,
      //     docname: notification.docname,
      //     document: notification.document,
      //     event_id: notification.event_id,
      //     project: notification.project,
      //     recipient: notification.recipient,
      //     recipient_role: notification.recipient_role,
      //     seen: notification.seen,
      //     sender: notification?.sender,
      //     title: notification.title,
      //     type: notification.type,
      //     work_package: notification.work_package,
      //     action_url: notification?.action_url,
      //   });
      // });

      add_all_notific_directly(notificationsData)
    }
  }, [notificationsData, user_id, clear_notifications, add_all_notific_directly]);

  const { updateDoc } = useFrappeUpdateDoc();

  const { mutate: globalSWRMutate } = useSWRConfig(); // SWR's global mutate

  // --- Event Listeners to trigger SWR revalidation for counts ---
  const revalidateCounts = useCallback(() => {
    if (user_id) {
      console.log("[NewSidebar] Revalidating sidebar counts via SWR mutate.");
      globalSWRMutate([API_PATH, user_id]); // Use the same key as useSidebarCounts
    }
  }, [user_id, globalSWRMutate]);

  useFrappeDocTypeEventListener("Procurement Requests", revalidateCounts);
  useFrappeDocTypeEventListener("Sent Back Category", revalidateCounts);
  useFrappeDocTypeEventListener("Procurement Orders", revalidateCounts);
  useFrappeDocTypeEventListener("Service Requests", revalidateCounts);
  useFrappeDocTypeEventListener("Project Payments", revalidateCounts);


  useFrappeDocTypeEventListener("Nirmaan Notifications", () => {
    console.log("Refetching Notification data due to socket event...");
    notificationsDataMutate?.(); // Always refetch notifications for the current user
  });

  const requestNotificationPermission = async () => {
    if (user_id && data) {
      try {
        const permission = await Notification.requestPermission();
        if (permission == "granted") {
          const registration = await navigator.serviceWorker.ready;
          const token = await getToken(messaging, {
            vapidKey: VAPIDKEY,
            serviceWorkerRegistration: registration,
          });
          if (data?.fcm_token !== token) {
            console.log("running fcm token updating");
            // Update token if it's different from the stored one
            await updateDoc("Nirmaan Users", user_id, {
              fcm_token: token,
              push_notification: "true",
            });
            console.log("Updated FCM Token:", token);
          } else if (data?.push_notification !== "true") {
            await updateDoc("Nirmaan Users", user_id, {
              push_notification: "true",
            });
            console.log("FCM Token already up-to-date.");
          }
        } else {
          if (data?.push_notification === "true") {
            await updateDoc("Nirmaan Users", user_id, {
              push_notification: "false",
            });
          }
          console.log("Unable to get permission to notify.");
        }
      } catch (error) {
        console.error("Error getting notification permission:", error);
      }
    }
  };

  useEffect(() => {
    requestNotificationPermission();
  }, [user_id, data]);

  const items = useMemo(() => [
    { key: "/", icon: LayoutGrid, label: "Dashboard" },
    ...(user_id == "Administrator" || role == "Nirmaan Admin Profile"
      ? [
        {
          key: "admin-actions",
          icon: Shapes,
          label: "Admin Options",
          children: [
            { key: "/projects", label: "Projects" },
            { key: "/users", label: "Users" },
            { key: "/products", label: "Products" },
            { key: "/vendors", label: "Vendors" },
            { key: "/customers", label: "Customers" },
            { key: "/product-packages", label: "Product Packages" },
            { key: "/milestone-packages", label: "Milestone Packages" },
            { key: "/design-packages", label: "Design Packages" },

            // { key: "/all-AQs", label: "Approved Quotations" },
            //  { key: "/vendors-aq2", label: "AQ2 Vendors" },
          ],
        },
      ]
      : []),
    ...(role == "Nirmaan Project Lead Profile"
      ? [
        {
          key: "/projects",
          icon: BlendIcon,
          label: "Projects",
        },
      ]
      : []),
    // ...(["Nirmaan Project Lead Profile", "Nirmaan Admin Profile"].includes(
    //   role
    // ) || user_id == "Administrator"
    //   ? [
    //       {
    //         key: "pl-actions",
    //         icon: Building2,
    //         label: "Procurement Actions",
    //         children: [
    //           { key: "/prs&milestones", label: "PRs & Milestones" },
    // {
    //   key: "/approve-new-pr",
    //   label: "Approve PR",
    //   count:
    //     role === "Nirmaan Admin Profile" ||
    //     user_id === "Administrator"
    //       ? adminPrCounts.pending
    //       : prCounts.pending,
    // },
    // {
    //   key: "/approve-po",
    //   label: "Approve PO",
    //   count:
    //     role === "Nirmaan Admin Profile" ||
    //     user_id === "Administrator"
    //       ? adminPrCounts.approve
    //       : prCounts.approve,
    // },
    // {
    //   key: "/approve-amended-po",
    //   label: "Approve Amended PO",
    //   count:
    //     role === "Nirmaan Admin Profile" ||
    //     user_id === "Administrator"
    //       ? adminAmendPOCount
    //       : amendPOCount,
    // },
    // {
    //   key: "/approve-sent-back",
    //   label: "Approve Sent Back PO",
    //   count:
    //     role === "Nirmaan Admin Profile" ||
    //     user_id === "Administrator"
    //       ? adminNewApproveSBCount
    //       : newSBApproveCount,
    // },
    // {
    //   key: "/approve-service-request",
    //   label: "Approve Service Order",
    //   count:
    //     role === "Nirmaan Admin Profile" ||
    //     user_id === "Administrator"
    //       ? adminSelectedSRCount
    //       : selectedSRCount,
    // },
    // {
    //   key: "/approve-amended-so",
    //   label: "Approve Amended SO",
    //   count:
    //     role === "Nirmaan Admin Profile" ||
    //     user_id === "Administrator"
    //       ? adminAmendedSRCount
    //       : amendedSRCount,
    // },
    // ...(role !== "Nirmaan Project Lead Profile" ? [
    //   {
    //     key: "/approve-payments",
    //     label: "Approve Payments",
    //     count:
    //       role === "Nirmaan Admin Profile" ||
    //       user_id === "Administrator"
    //         ? adminPaymentsCount.requested
    //         : paymentsCount.requested,
    //   },
    // ] : []),
    //       ],
    //     },
    //   ]
    // : []),

    ...(user_id == "Administrator" || ["Nirmaan Accountant Profile", "Nirmaan Admin Profile", "Nirmaan Procurement Executive Profile", "Nirmaan Estimates Executive Profile", "Nirmaan Project Manager Profile", "Nirmaan Project Lead Profile"].includes(role)
      ? [
        {
          key: '/item-price',
          icon: Dices,
          label: 'Item Price Search',
        },
      ]
      : []),
         
    ...([
      "Nirmaan Procurement Executive Profile",
      "Nirmaan Admin Profile",
      "Nirmaan Project Lead Profile"
    ].includes(role) || user_id == "Administrator"
      ? [
        {
          key: "/procurement-requests",
          icon: List,
          label: "Procurement Requests",
          // count: role === "Nirmaan Admin Profile" ||
          //         user_id === "Administrator"
          //         ? adminPrCounts.approved
          //         : prCounts.approved,
        },
        // {
        //   key: "/service-requests",
        //   icon: SquareSquare,
        //   label: "Work Orders",
        //   // count: role === "Nirmaan Admin Profile" ||
        //   //         user_id === "Administrator"
        //   //         ? (adminPendingSRCount || 0) + (adminApprovedSRCount || 0)
        //   //         : (pendingSRCount || 0) + (approvedSRCount || 0),
        // },
        {
          key: "/purchase-orders",
          icon: ShoppingCart,
          label: "Purchase Orders",
          // count:
          //      role === "Nirmaan Admin Profile" ||
          //      user_id === "Administrator"
          //        ? adminNewPOCount
          //        : newPOCount,
        },
      ]
      : []),
        ...(user_id == "Administrator" || ["Nirmaan Accountant Profile", "Nirmaan Admin Profile", "Nirmaan Procurement Executive Profile", "Nirmaan Project Lead Profile"].includes(role)
      ? [
        
         {
          key: "/service-requests",
          icon: SquareSquare,
          label: "Work Orders",
          // count: role === "Nirmaan Admin Profile" ||
          //         user_id === "Administrator"
          //         ? (adminPendingSRCount || 0) + (adminApprovedSRCount || 0)
          //         : (pendingSRCount || 0) + (approvedSRCount || 0),
        },

      ]
      : []),

    // ...(role == "Nirmaan Procurement Executive Profile" ||
    // user_id == "Administrator" ||
    // role == "Nirmaan Admin Profile"
    //   ? [
    //       {
    //         key: "/sent-back-requests",
    //         icon: SendToBack,
    //         label: "Sent Back Requests",
    //         count:
    //              role === "Nirmaan Admin Profile" ||
    //              user_id === "Administrator"
    //                ? (adminNewSBCounts.rejected || 0) + (adminNewSBCounts.cancelled || 0) + (adminNewSBCounts.delayed || 0)
    //                : (newSBCounts.rejected || 0) + (newSBCounts.cancelled || 0) + (newSBCounts.delayed || 0),
    //       },
    //     ]
    //   : []),
    ...(user_id == "Administrator" || ["Nirmaan Accountant Profile", "Nirmaan Admin Profile", "Nirmaan Project Lead Profile", "Nirmaan Procurement Executive Profile"].includes(role)
      ? [
        {
          key: '/project-payments',
          icon: CircleDollarSign,
          label: 'Project Payments',
        },
      ]
      : []),
    ...(user_id == "Administrator" || ["Nirmaan Accountant Profile", "Nirmaan Admin Profile", "Nirmaan Procurement Executive Profile", "Nirmaan Project Lead Profile"].includes(role)
      ? [
        {
          key: '/credits',
          icon: CreditCard,
          label: 'Credit Payments',
        },

      ]
      : []),

    ...(user_id == "Administrator" || ["Nirmaan Accountant Profile", "Nirmaan Admin Profile"].includes(role)
      ? [
        {
          key: '/in-flow-payments',
          icon: HandCoins,
          label: 'In-Flow Payments',
        },
      ]
      : []),
    ...(user_id == "Administrator" || ["Nirmaan Accountant Profile", "Nirmaan Admin Profile", "Nirmaan Procurement Executive Profile"].includes(role)
      ? [
        {
          key: '/invoice-reconciliation',
          icon: ReceiptText,
          label: 'Invoice Recon',
        },
      ]
      : []),
    ...(user_id == "Administrator" || ["Nirmaan Accountant Profile", "Nirmaan Admin Profile"].includes(role)
      ? [
        {
          key: '/project-invoices',
          icon: FileUp,
          label: 'Project Invoices',
        },
      ]
      : []),
    ...(user_id == "Administrator" || ["Nirmaan Accountant Profile", "Nirmaan Admin Profile"].includes(role)
      ? [
        {
          key: '/project-expenses',
          icon: Landmark,
          label: 'Misc. Project Expenses',
        },
      ]
      : []),
    ...(user_id == "Administrator" || ["Nirmaan Accountant Profile", "Nirmaan Admin Profile"].includes(role)
      ? [
        {
          key: '/non-project',
          icon: Banknote,
          label: 'Non Project Expenses',
        },
      ]
      : []),
    ...(user_id == "Administrator" || ["Nirmaan Accountant Profile", "Nirmaan Admin Profile", "Nirmaan Procurement Executive Profile", "Nirmaan Project Manager Profile", "Nirmaan Project Lead Profile"].includes(role)
      ? [
        {
          key: '/reports',
          icon: ClipboardMinus,
          label: 'Reports',
        },
      ]
      : []),
      ...(user_id == "Administrator" || ["Nirmaan Design Lead Profile", "Nirmaan Admin Profile", "Nirmaan Design Executive Profile","Nirmaan Project Lead Profile"].includes(role)
      ? [
        {
          key: '/design-tracker',
          icon: PencilRuler,
          label: 'Design Tracker',
        },
      ]
      : [])


  ], [user_id, role]);

  const allKeys = useMemo(() => new Set([
    "projects",
    "users",
    "products",
    "vendors",
    "customers",
    "product-packages",
    "milestone-packages",
    "design-packages",
    "all-AQs",
    "item-price",
    // 'vendors-aq2', new tab ui-fix
    "prs&milestones",
    // "approve-new-pr",
    // "approve-po",
    // "approve-sent-back",
    // "approve-amended-po",
    // "approve-payments",
    "procurement-requests",
    "purchase-orders",
    "sent-back-requests",
    "service-requests",
    "service-requests-list",
    // "approve-service-request",
    // "approve-amended-so",
    // "choose-service-vendor",
    // "approved-sr",
    "notifications",
    "project-payments",
    "credits",
    "in-flow-payments",
    'invoice-reconciliation',
    'project-invoices',
    'project-expenses',
    'non-project',
    'reports',
    'design-tracker'

  ]), [])

  const selectedKeys = useMemo(() => {
    const pathKey = location.pathname.slice(1).split("/")[0];
    return allKeys.has(pathKey) ? pathKey : "";
  }, [location.pathname]);


  const groupMappings = useMemo(() => ({
    "admin-actions": ["users", "products", "vendors", "customers", "product-packages","milestone-packages","design-packages", "all-AQs"],
    // "admin-actions": ["users", "products", "vendors", "customers", "product-packages", "approved-quotes","vendors-aq2"],
    // "pl-actions": [
    //   "prs&milestones", "approve-po", "approve-sent-back",
    //   "approve-amended-po", "approve-payments"
    // ],
    // "/approved-quotes": ["approved-quotes"],
    "/item-price": ["item-price"],

    "/procurement-requests": ["procurement-requests", "prs&milestones", "sent-back-requests"],
    "/service-requests": ["service-requests", "service-requests-list"],
    "/purchase-orders": ["purchase-orders"],
    // "/sent-back-requests": ["sent-back-requests"],
    "/project-payments": ["project-payments"],
    "/credits": ["credits"],
    "/in-flow-payments": ["in-flow-payments"],
    "/invoice-reconciliation": ["invoice-reconciliation"],
    "/project-invoices": ["project-invoices"],
    "/project-expenses": ["project-expenses"],
    "/non-project": ["non-project"],
    "/reports": ["reports"],
    '/design-tracker': ['design-tracker']
  }), []);

  const openKey = useMemo(() => {
    for (const [group, keys] of Object.entries(groupMappings)) {
      if (keys.includes(selectedKeys)) return group;
    }
    return selectedKeys === "projects"
      ? role === "Nirmaan Project Lead Profile"
        ? "/projects"
        : "admin-actions"
      : "";
  }, [selectedKeys, role, groupMappings]);


  // const defaultOpenKeys = useMemo(() => {
  //   return new Set(["admin-actions"]);
  // }, [openKey]);

  const handleCloseMobile = useCallback(() => {
    if (isMobile) {
      toggleSidebar();
    }
  }, [isMobile, toggleSidebar]);

  useEffect(() => {
    if (["admin-actions"].includes(openKey)) {
      setCollapsedKey(openKey)
    }
  }, [])

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="flex flex-row items-center justify-center">
        {!isMobile ? (
          state === "expanded" && (
            <Link to={"/"}>
              <img src={logo} alt="Nirmaan" width="140" height="40" />
            </Link>
          )
        ) : (
          <Link to={"/"}>
            <img
              onClick={handleCloseMobile}
              src={logo}
              alt="Nirmaan"
              width="140"
              height="40"
            />
          </Link>
        )}
        <SidebarTrigger
          className={`${state === "expanded" && "bg-gray-100"}`}
        />
      </SidebarHeader>
      <Separator />
      <SidebarContent className="scrollbar-container overflow-x-hidden">
        <SidebarGroup>
          <SidebarMenu>
            {items.map((item) => (
              <Collapsible
                key={item.key}
                open={collapsedKey === item?.key}
                // defaultOpen={defaultOpenKeys.has(item.key)}
                className="group/collapsible"
                asChild
              >
                <SidebarMenuItem>

                  {new Set(["Dashboard", "Item Price Search", "Procurement Requests", "Purchase Orders", "Project Payments", "Credit Payments", "Sent Back Requests", "Projects", "Work Orders", "In-Flow Payments", "Invoice Recon", "Reports",
                  "Design Tracker","Project Invoices", "Misc. Project Expenses", "Non Project Expenses"]).has(item?.label) ? (
                    <SidebarMenuButton
                      className={`${((!openKey && selectedKeys !== "notifications" && item?.label === "Dashboard") || item?.key === openKey)
                        ? "bg-[#FFD3CC] text-[#D03B45] hover:text-[#D03B45] hover:bg-[#FFD3CC]"
                        : ""
                        } tracking-tight relative`}
                      onClick={() => {
                        if (isMobile) {
                          toggleSidebar();
                        }
                        navigate(item?.label === "Dashboard" ? "/" : item?.key);
                      }}
                      selectedKeys={selectedKeys}
                      tooltip={item.label}
                    >
                      {item.icon && <item.icon />}
                      <span className="font-medium">{item.label}</span>
                      {item?.count !== 0 && state === "expanded" && (
                        <span className="absolute top-2 right-4 text-xs font-medium tabular-nums text-sidebar-foreground h-4 w-4 flex items-center justify-center">
                          {item.count}
                        </span>
                      )}
                    </SidebarMenuButton>
                  ) : (
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton
                        className={`${openKey === item?.key
                          ? `text-[#D03B45]  hover:text-[#D03B45] !important ${state === "collapsed" &&
                          !isMobile &&
                          "bg-[#FFD3CC]"
                          }`
                          : ""
                          } tracking-tight`}
                        onClick={() => handleGroupToggle(item.key)}
                        selectedKeys={selectedKeys}
                        tooltip={item.children}
                      >
                        {item.icon && <item.icon />}
                        <span className="font-medium">{item.label}</span>
                        <ChevronRight className="ml-auto mr-2 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                  )}
                  <CollapsibleContent
                    className={`${collapsedKey === item?.key ? "animate-collapse-down" : "animate-collapse-up"}`}
                  >
                    <SidebarMenuSub className="space-y-1">
                      {item?.children?.map((subitem) => (
                        <SidebarMenuSubItem
                          className="relative"
                          key={subitem.key}
                        >
                          <SidebarMenuSubButton
                            onClick={handleCloseMobile}
                            className={`${`/${selectedKeys}` === subitem.key
                              ? "bg-[#FFD3CC] text-[#D03B45] hover:text-[#D03B45] hover:bg-[#FFD3CC]"
                              : ""
                              } rounded-md ${isMobile ? "w-60" : "w-52"}`}
                            asChild
                          >
                            <Link to={subitem.key}>
                              <span className="text-xs">{subitem.label}</span>
                            </Link>
                          </SidebarMenuSubButton>
                          {/* {subitem?.count !== 0 && (
                            <span className="absolute top-2 -right-2 text-xs font-medium tabular-nums text-sidebar-foreground h-4 w-4 flex items-center justify-center">
                              {subitem.count}
                            </span>
                          )} */}
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="overflow-y-auto overflow-x-hidden">
        <Separator />
        <UserNav />
      </SidebarFooter>
    </Sidebar>
  );
}