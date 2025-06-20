import { appRoutes } from "@/components/helpers/routesConfig";
import { onMessage } from "firebase/messaging";
import { FrappeProvider } from "frappe-react-sdk";
import { FC, useEffect } from "react";
import {
  RouterProvider,
  createBrowserRouter
} from "react-router-dom";
import { SidebarProvider } from "./components/ui/sidebar";
import { ThemeProvider } from "./components/ui/theme-provider";
import { messaging } from "./firebase/firebaseConfig";
import { UserProvider } from "./utils/auth/UserProvider";
import { SocketInitializer } from "./config/SocketInitializer";


// --- Router Creation ---
const router = createBrowserRouter(
  appRoutes,
  {
    basename: `/${import.meta.env.VITE_BASE_NAME}`,
  }
);

const App: FC = () => {
  useEffect(() => {
    // Firebase onMessage handler for foreground notifications
    onMessage(messaging, (payload) => {
      console.log("Message received in the foreground: ", payload);

      const notificationTitle = payload?.notification?.title || "";
      const notificationOptions = {
        body: payload?.notification?.body,
        icon: payload?.notification?.icon || "../src/assets/red-logo.png",
        data: { click_action_url: payload?.data?.click_action_url },
      };

      const notification = new Notification(
        notificationTitle,
        notificationOptions
      );

      notification.onclick = () => {
        window.open(notificationOptions.data.click_action_url || "/", "_blank");
      };
    });
  }, []);

  const getSiteName = () => {
    // @ts-ignore
    // if (window.frappe?.boot?.versions?.frappe && (window.frappe.boot.versions.frappe.startsWith('15') || window.frappe.boot.versions.frappe.startsWith('16'))) {
    // 	// @ts-ignore
    // 	return window.frappe?.boot?.sitename ?? import.meta.env.VITE_SITE_NAME
    // }
    return window.frappe?.boot?.sitename !== undefined
      ? window.frappe?.boot?.sitename
      : (import.meta.env.VITE_SITE_NAME || window.location.hostname); // Default to hostname if VITE_SITE_NAME is missing
  };

  // const queryClient = new QueryClient()

  return (
    <FrappeProvider
      url={import.meta.env.VITE_FRAPPE_PATH ?? ""}
      // socketPort={
      //   import.meta.env.VITE_SOCKET_PORT
      //     ? import.meta.env.VITE_SOCKET_PORT
      //     : undefined
      // }
      //@ts-ignore
      siteName={getSiteName()}
      // enableSocket={false}
    >
      <UserProvider>
        <SocketInitializer />
        <SidebarProvider>
          {/* <QueryClientProvider client={queryClient}> */}
          <ThemeProvider defaultTheme="light" storageKey="vite-ui-theme">
            <RouterProvider router={router} />
          </ThemeProvider>
          {/* </QueryClientProvider> */}
        </SidebarProvider>
      </UserProvider>
    </FrappeProvider>
  );
};

export default App;