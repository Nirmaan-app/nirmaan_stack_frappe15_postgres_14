import { useContext, useEffect } from "react";
import * as Sentry from "@sentry/react";

import { useUserData } from "@/hooks/useUserData";
import { UserContext } from "@/utils/auth/UserProvider";

/**
 * Tell Sentry who the signed-in user is, from the main layout so every page does it (code review #8). It used to
 * live on the dashboard only, which a locked user never opens (the app access gate shows its card on `/` instead),
 * so their errors -- in exactly the profile and Submit audit flows the lock sends them to -- had no user.
 */
export function useSentryUser() {
  const { user_id, full_name, role, has_project } = useUserData();
  const { currentUser } = useContext(UserContext);

  useEffect(() => {
    if (currentUser && currentUser !== "Guest" && user_id) {
      const savedProject = sessionStorage.getItem("selectedProject");
      Sentry.setUser({
        id: user_id,
        username: currentUser,
        full_name: full_name,
        role: role,
        has_project: has_project,
        selected_project: savedProject ? JSON.parse(savedProject) : undefined,
      });
    } else if (!currentUser || currentUser === "Guest") {
      Sentry.setUser(null);
    }
  }, [currentUser, user_id, full_name, role, has_project]);
}
