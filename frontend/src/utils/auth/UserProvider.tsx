import { AuthResponse, useFrappeAuth, useSWRConfig } from "frappe-react-sdk";
import { createContext, FC, PropsWithChildren, useEffect, useState } from "react";
import * as Sentry from "@sentry/react";
import { useUserData } from "@/hooks/useUserData";
// import { useNavigate } from 'react-router-dom'

interface UserContextProps {
  isLoading: boolean;
  currentUser: string;
  login: (username: string, password: string) => Promise<AuthResponse>;
  logout: () => Promise<void>;
  updateCurrentUser: VoidFunction;
  selectedProject: string | undefined;
  setSelectedProject: any;
  deleteDialog: boolean;
  toggleDeleteDialog: () => void;
}

export const UserContext = createContext<UserContextProps>({
  currentUser: "",
  isLoading: false,
  login: async () => {
    return {message : "loding not implemented" , user: ""}
  },
  logout: async () => {},
  updateCurrentUser: () => {},
  selectedProject: undefined,
  setSelectedProject: () => {},
  deleteDialog: false,
  toggleDeleteDialog: () => {},
});

export const UserProvider: FC<PropsWithChildren> = ({ children }) => {
  const { mutate } = useSWRConfig();
  const { login, logout, currentUser, updateCurrentUser, isLoading } =
    useFrappeAuth();
  const [authStatus, setAuthStatus] = useState<
    "idle" | "loggedOut" | "loggedIn"
  >("idle");

  const [selectedProject, setSelectedProject] = useState();

  const [deleteDialog, setDeleteDialog] = useState(false);
  const toggleDeleteDialog = () => {
    setDeleteDialog((prevState) => !prevState);
  };

  // Fetch user data for Sentry context
  // const { user_id, full_name, user_image, role, has_project } = useUserData();

  useEffect(() => {
    const savedProject = sessionStorage.getItem("selectedProject");
    setSelectedProject(savedProject ? JSON.parse(savedProject) : null);
  }, []);

  // // Set Sentry user context when user is authenticated
  // useEffect(() => {
  //   if (currentUser && currentUser !== "Guest" && user_id) {
  //     Sentry.setUser({
  //       id: user_id,
  //       username: currentUser,
  //       full_name: full_name,
  //       role: role,
  //       has_project: has_project,
  //       selected_project: selectedProject || undefined,
  //     });

  //     console.log("Sentry user context set:", { user_id, currentUser, role });
  //   } else if (!currentUser || currentUser === "Guest") {
  //     // Clear Sentry user context if not authenticated
  //     Sentry.setUser(null);
  //     console.log("Sentry user context cleared");
  //   }
  // }, [currentUser, user_id, full_name, role, has_project, selectedProject]);

  // console.log("selectedProject", selectedProject)

  // const navigate  = useNavigate();

  // useEffect(() => {
  //     if (authStatus === "loggedOut") {
  //         localStorage.removeItem("app-cache")
  //         sessionStorage.clear()
  //         mutate(() => true, undefined, false);
  //         navigate("/login")
  //     } else if (authStatus === "loggedIn") {
  //         navigate('/');
  //     }
  // }, [authStatus, navigate, mutate])

  const handleLogout = async () => {
    // Clear Sentry user context immediately on logout
    Sentry.setUser(null);
    console.log("Sentry user context cleared on logout");

    // Clear local storage early
    localStorage.removeItem("app-cache");

    try {
      await logout();
      // Clear cache on successful logout
      sessionStorage.clear();
      await mutate(() => true, undefined, false);
    } catch (error) {
      // Handle CSRF token errors or other logout failures gracefully
      // User should still be able to logout even if the API call fails
      console.error("Logout API error (likely CSRF token issue):", error);
      sessionStorage.clear();

      // Force redirect to login page to complete logout flow
      const basePath = import.meta.env.VITE_BASE_NAME || "";
      window.location.href = basePath ? `/${basePath}/login` : "/login";
    }
  };

  const handleLogin = async (
    usernameOrMobile: string,
    password: string,
  ): Promise<AuthResponse> => {
    const trimmed = usernameOrMobile.trim();
    const isMobile = /^\d{10}$/.test(trimmed);

    if (isMobile) {
      // Custom endpoint (api/phone_login.py) resolves the mobile number to a
      // User then runs the same LoginManager flow as /api/method/login. No
      // CSRF header needed: allow_guest=True endpoint called pre-session,
      // mirroring /api/method/login (see frappe/auth.py validate_csrf_token).
      const res = await fetch(
        "/api/method/nirmaan_stack.api.phone_login.login_with_mobile",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ mobile_no: trimmed, password }),
        },
      );

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({} as any));
        let message = "Login failed";
        try {
          if (errBody?._server_messages) {
            const arr = JSON.parse(errBody._server_messages);
            if (arr?.length) {
              message = JSON.parse(arr[0])?.message || message;
            }
          } else if (errBody?.message) {
            message = errBody.message;
          } else if (errBody?.exc) {
            message = "Invalid credentials";
          }
        } catch {
          /* keep default */
        }
        throw { message };
      }

      // SDK's updateCurrentUser is not exercised against custom endpoints in
      // this codebase. A full reload re-bootstraps auth from the freshly-set
      // sid cookie via useFrappeAuth — same fallback pattern as handleLogout.
      const basePath = import.meta.env.VITE_BASE_NAME || "";
      window.location.assign(basePath ? `/${basePath}/` : "/");
      return { message: "Logged In", home_page: "/" };
    }

    return login({
      username: trimmed,
      password,
    });
  };
  return (
    <UserContext.Provider
      value={{
        isLoading,
        updateCurrentUser,
        login: handleLogin,
        logout: handleLogout,
        currentUser: currentUser ?? "",
        selectedProject,
        setSelectedProject,
        deleteDialog,
        toggleDeleteDialog
      }}
    >
      {children}
    </UserContext.Provider>
  );
};
