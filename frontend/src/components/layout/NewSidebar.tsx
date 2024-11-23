import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem, SidebarTrigger, useSidebar } from "@/components/ui/sidebar"
import { BadgeCheck, Bell, Calendar, ChevronDown, ChevronRight, ChevronsUpDown, ChevronUp, CreditCard, Home, Inbox, LogOut, Search, Settings, Sparkles, User2 } from "lucide-react"
import logo from "@/assets/logo-svg.svg"
import nLogo from "@/assets/LOGO.png"

import {
  Building2,
  LayoutGrid,
  List,
  SendToBack,
  Shapes,
  ShoppingCart,
  SquareSquare,
} from "lucide-react";
import { useContext, useEffect, useState } from "react";
import Cookies from "js-cookie";
import { FrappeConfig, FrappeContext, useFrappeDocTypeEventListener, useFrappeEventListener, useFrappeGetDoc, useFrappeGetDocList, useFrappeUpdateDoc } from "frappe-react-sdk";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { useUserData } from "@/hooks/useUserData";
import { UserContext } from "@/utils/auth/UserProvider";
import { Separator } from "../ui/separator";
import { UserNav } from "../nav/user-nav";
import { useNotificationStore } from "@/zustand/useNotificationStore";
import { useDocCountStore } from "@/zustand/useDocCountStore";
import { getToken } from "firebase/messaging";
import { messaging, VAPIDKEY } from "@/firebase/firebaseConfig";
import { handlePOAmendedEvent, handlePONewEvent, handlePRApproveNewEvent, handlePRDeleteEvent, handlePRNewEvent, handlePRVendorSelectedEvent, handleSBNewEvent, handleSBVendorSelectedEvent, handleSRApprovedEvent, handleSRVendorSelectedEvent } from "@/zustand/eventListeners";

export function NewSidebar() {

  const [role, setRole] = useState(null)
  const location = useLocation();

  const navigate = useNavigate()

  const user_id = Cookies.get('user_id') ?? ''

  const { toggleSidebar, isMobile, state } = useSidebar()

  const { data } = useFrappeGetDoc("Nirmaan Users", user_id, user_id === "Administrator" ? null : undefined)

  useEffect(() => {
    if (data) {
      setRole(data.role_profile)
    }
  }, [data])

  const {
    pendingPRCount, approvePRCount, adminApprovePRCount, adminPendingPRCount, updatePRCounts, updateSBCounts, newSBApproveCount,
    adminNewApproveSBCount, amendPOCount, adminAmendPOCount, updatePOCounts, adminApprovedPRCount, approvedPRCount, newPOCount,
    adminNewPOCount, adminNewSBCounts, newSBCounts, updateSRCounts, adminSelectedSRCount, selectedSRCount, approvedSRCount, adminApprovedSRCount } = useDocCountStore()

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


  const { data: srData, mutate: srDataMutate } = useFrappeGetDocList("Service Requests", {
    fields: ["status", "project", "vendor"],
    filters: [["project", "in", permissionsList || []]],
    limit: 1000
  },
    (user_id === "Administrator" || !permissionsList) ? null : undefined
  )

  const { data: adminSRData, mutate: adminSRDataMutate } = useFrappeGetDocList("Service Requests", {
    fields: ["status", "project", "vendor"],
    limit: 1000
  },

    user_id === "Administrator" || role === "Nirmaan Admin Profile" ? undefined : null
  )

  useEffect(() => {
    if ((user_id === "Administrator" || role === "Nirmaan Admin Profile") && adminPOData) {
      updatePOCounts(adminPOData, true)
    } else if (poData) {
      updatePOCounts(poData, false)
    }
  }, [poData, adminPOData])

  useEffect(() => {
    if ((user_id === "Administrator" || role === "Nirmaan Admin Profile") && adminSBData) {
      updateSBCounts(adminSBData, true)
    } else if (sbData) {
      updateSBCounts(sbData, false)
    }
  }, [sbData, adminSBData])

  useEffect(() => {
    if ((user_id === "Administrator" || role === "Nirmaan Admin Profile") && adminPrData) {
      updatePRCounts(adminPrData, true)
    } else if (prData) {
      updatePRCounts(prData, false)
    }
  }, [prData, adminPrData])

  useEffect(() => {
    if ((user_id === "Administrator" || role === "Nirmaan Admin Profile") && adminSRData) {
      updateSRCounts(adminSRData, true)
    } else if (srData) {
      updateSRCounts(srData, false)
    }
  }, [srData, adminSRData])


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

  //  ***** SR Events *****
  useFrappeEventListener("sr:vendorSelected", async (event) => {
    await handleSRVendorSelectedEvent(db, event, add_new_notification);
  })

  useFrappeEventListener("sr:approved", async (event) => {
    await handleSRApprovedEvent(db, event, add_new_notification);
  })

  useFrappeEventListener("sr:delete", (event) => {
    handlePRDeleteEvent(event, delete_notification);
  });

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

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="flex items-center justify-center relative">
        {!isMobile ? (
          <Link to={"/"}>
            {state === "expanded" ? (
              <img src={logo} alt="Nirmaan" width="158" height="48" />
            ) : (
              <img src={nLogo} alt="Nirmaan" />
            )}
          </Link>
        ) : (
          <Link to={"/"}>
            <img onClick={handleCloseMobile} src={logo} alt="Nirmaan" width="158" height="48" />
          </Link>

        )}
      </SidebarHeader>
      <SidebarTrigger className={`absolute ${isMobile ? "hidden" : ""} ${state === "collapsed" ? "top-3.5" : "top-4"} -right-4`} />
      <Separator />
      <SidebarContent className="scrollbar-container overflow-x-hidden">
        <SidebarGroup>
          <SidebarMenu>
            {items.map((item) => (
              <Collapsible
                key={item.key}
                defaultOpen={isDefaultOpen.includes(item.key)}
                className="group/collapsible"
                asChild
              >
                <SidebarMenuItem>
                  {item?.label === "Dashboard" ? (
                    <SidebarMenuButton className={`${!openKey ? "bg-[#FFD3CC] text-[#D03B45] hover:text-[#D03B45] hover:bg-[#FFD3CC]" : ""} tracking-tight`} onClick={() => {
                      if (isMobile) {
                        toggleSidebar()
                      }
                      navigate("/")
                    }} selectedKeys={selectedKeys} tooltip={item.label}>
                      {item.icon && <item.icon />}
                      <span className="font-medium">{item.label}</span>
                    </SidebarMenuButton>
                  ) : (
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton className={`${openKey === item?.key ? "text-[#D03B45] hover:text-[#D03B45] !important" : ""} tracking-tight`} selectedKeys={selectedKeys} tooltip={item.children}>
                        {item.icon && <item.icon />}
                        <span className="font-medium">{item.label}</span>
                        <ChevronRight className="ml-auto mr-2 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                  )}
                  <CollapsibleContent>
                    <SidebarMenuSub className="space-y-1">
                      {item?.children?.map((subitem) => (
                        <SidebarMenuSubItem className="relative" key={subitem.key}>
                          <SidebarMenuSubButton onClick={handleCloseMobile} className={`${`/${selectedKeys}` === subitem.key ? "bg-[#FFD3CC] text-[#D03B45] hover:text-[#D03B45] hover:bg-[#FFD3CC]" : ""} rounded-md ${isMobile ? "w-60" : "w-52"}`} asChild>
                            <Link to={subitem.key}>
                              <span className=" text-xs">{subitem.label}</span>
                            </Link>
                          </SidebarMenuSubButton>
                          {subitem?.count !== 0 && (
                            <span className="absolute top-2 -right-2 text-xs font-medium tabular-nums text-sidebar-foreground h-4 w-4 flex items-center justify-center text-xs">
                              {subitem.count}
                            </span>
                          )}
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

  )
}
