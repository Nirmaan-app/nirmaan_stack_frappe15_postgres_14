import { useContext } from 'react'
import { Navigate, Outlet, useParams } from 'react-router-dom'
import { UserContext } from './UserProvider'
import { TailSpin } from 'react-loader-spinner'
import { useUserData } from '@/hooks/useUserData'
import { canManageTendering } from '@/pages/projects/tendering/tenderingAuth'
import { useExpenseAccess } from '@/hooks/useExpenseAccess'
import { expenseRouteState } from '@/utils/expenseAccess'

/**
 * What RoleRoute shows (S6 F4 / U3, owner ruling Q-e). Pure.
 *
 * `useUserData()` reports role "Loading" while the user's record is being read. Before S6 that
 * fell through to "Access Denied" for a moment on a direct link; now it is a loading state, and
 * "Access Denied" shows only once the role is known and not allowed.
 */
export type RoleRouteState = "allow" | "loading" | "deny";

export const ROLE_LOADING_TEXT = "Checking access…";

export function roleRouteState(
  role: string | null | undefined,
  userId: string | null | undefined,
  allowed: readonly string[],
): RoleRouteState {
  if (userId === "Administrator" || (!!role && allowed.includes(role))) return "allow";
  if (role === "Loading") return "loading";
  return "deny";
}

export const ProtectedRoute = () => {

    const { currentUser, isLoading } = useContext(UserContext)

    if (isLoading) {
        return (<div className='w-full h-screen flex items-center justify-center'>
                    <TailSpin visible={true} height="100" width="100" color="#D03B45" ariaLabel="tail-spin-loading" />
                </div>)
    }
    if (!currentUser || currentUser === 'Guest') {
        return <Navigate to="/login" />
    }
    return <Outlet />
}

export const AdminRoute = () => {
    const {role, user_id} = useUserData()

    if(role === "Nirmaan Admin Profile" || role === "Nirmaan PMO Executive Profile" || user_id === "Administrator") {
        return <Outlet />
    }
}

export const LeadRoute = () => {
    const {role, has_project} = useUserData()

    if(role === "Nirmaan Project Lead Profile" && has_project === "true") {
        return <Outlet />
    } else if(role !== "Nirmaan Project Lead Profile") {
        return <div>You do not access to this page</div>
    } else if(has_project === "false") {
        return <div>You have not assigned any project!</div>
    }
}

export const ManagerRoute = () => {
    const {role, has_project} = useUserData()

    if(role === "Nirmaan Project Manager Profile" && has_project === "true") {
        return <Outlet />
    } else if(role !== "Nirmaan Project Manager Profile") {
        return <div>You do not access to this page</div>
    } else if(has_project === "false") {
        return <div>You have not assigned any project!</div>
    }
}

export const UsersRoute = () => {
    const { role, user_id } = useUserData()

    const canAccessUsers =
        role === "Nirmaan Admin Profile" ||
        role === "Nirmaan PMO Executive Profile" ||
        role === "Nirmaan HR Executive Profile" ||
        user_id === "Administrator"

    if (canAccessUsers) {
        return <Outlet />
    }

    return (
        <div className="flex items-center justify-center h-[50vh]">
            <div className="text-center">
                <h2 className="text-xl font-semibold text-gray-800">Access Denied</h2>
                <p className="text-gray-600 mt-2">You do not have access to this page.</p>
            </div>
        </div>
    )
}

export const UserProfileRoute = () => {
    const { role, user_id } = useUserData()
    const { userId } = useParams<{ userId: string }>()

    const isAuthorizedRole =
        role === "Nirmaan Admin Profile" ||
        role === "Nirmaan PMO Executive Profile" ||
        role === "Nirmaan HR Executive Profile" ||
        user_id === "Administrator"

    // Allow if authorized role OR viewing own profile
    const isOwnProfile = user_id === userId

    if (isAuthorizedRole || isOwnProfile) {
        return <Outlet />
    }

    return (
        <div className="flex items-center justify-center h-[50vh]">
            <div className="text-center">
                <h2 className="text-xl font-semibold text-gray-800">Access Denied</h2>
                <p className="text-gray-600 mt-2">You do not have access to view this user's profile.</p>
            </div>
        </div>
    )
}

export const InflowPaymentsRoute = () => {
    const { role, user_id } = useUserData()

    // Mirrors the In-Flow Payments role array in NewSidebar.tsx. Keep the two in sync.
    // PMO Executive opens the page view-only (owner, 2026-10-28; `canAddInflow` /
    // `canActOnInflow` in constants/roles.ts keep the buttons away).
    const canAccessInflowPayments =
        role === "Nirmaan Admin Profile" ||
        role === "Nirmaan PMO Executive Profile" ||
        role === "Nirmaan Accountant Profile" ||
        role === "Nirmaan Accountant Lead Profile" ||
        role === "Nirmaan Project Lead Profile" ||
        role === "Nirmaan Sales Executive Profile" ||
        role === "Nirmaan Sales Lead Profile" ||
        user_id === "Administrator"

    if (canAccessInflowPayments) {
        return <Outlet />
    }

    return (
        <div className="flex items-center justify-center h-[50vh]">
            <div className="text-center">
                <h2 className="text-xl font-semibold text-gray-800">Access Denied</h2>
                <p className="text-gray-600 mt-2">You don't have permission to access In-Flow Payments.</p>
            </div>
        </div>
    )
}

/**
 * Guards the "New Project" flow at /projects/new-project
 * (choice screen → Won wizard → Tendering form → convert).
 *
 * Authorized users mirror the Tendering-management permission:
 * Nirmaan Admin + PMO Executive, plus the hardcoded "Administrator" user.
 * We reuse `canManageTendering` so the role set has a single source of truth.
 */
export const NewProjectRoute = () => {
    const { role, user_id } = useUserData()

    if (canManageTendering(role, user_id)) {
        return <Outlet />
    }

    return (
        <div className="flex items-center justify-center h-[50vh]">
            <div className="text-center">
                <h2 className="text-xl font-semibold text-gray-800">Access Denied</h2>
                <p className="text-gray-600 mt-2">You don't have permission to create projects.</p>
            </div>
        </div>
    )
}

/**
 * Guards the Pricing Module -- ALL of its workbook routes (/hvac-pricing,
 * /electrical-pricing, /elv-pricing; see pages/pricing/pricingWorkbooks.ts).
 * The gate is per-MODULE, not per-workbook: it carries no title or route
 * coupling, so a new registry workbook needs no change here (PW-1).
 *
 * Authorized (frontend, profile side of the PM-1 DB-verified access set):
 * the hardcoded "Administrator" user, or role_profile
 * "Nirmaan Admin Profile" / "Nirmaan Estimates Executive Profile".
 * The backend API (`_require_pricing_access`) additionally accepts the
 * "Nirmaan Estimates Executive" Role and is the real enforcement layer;
 * this guard is the UI gate only.
 */
export const PricingRoute = () => {
    const { role, user_id } = useUserData()

    if (
        user_id === "Administrator" ||
        role === "Nirmaan Admin Profile" ||
        role === "Nirmaan Estimates Executive Profile"
    ) {
        return <Outlet />
    }

    return (
        <div className="flex items-center justify-center h-[50vh]">
            <div className="text-center">
                <h2 className="text-xl font-semibold text-gray-800">Access Denied</h2>
                <p className="text-gray-600 mt-2">You don't have permission to access the Pricing Module.</p>
            </div>
        </div>
    )
}

/**
 * Guards Bulk Import Transactions (/bulk-import-transactions and its children).
 *
 * Owner ruling: Accountant, Accountant Lead, Admin. Mirrors the backend gate
 * `api/outflow_import/permissions.require_outflow_access`, which reads the SAME source
 * (`Nirmaan Users.role_profile`) and is the real enforcement layer -- this is the UI gate only.
 *
 * Modelled on PricingRoute, and deliberately NOT on AdminRoute: that guard returns `undefined`
 * for an unauthorized user, which renders a blank screen instead of telling them why.
 */
export const OutflowImportRoute = () => {
    const { role, user_id } = useUserData()

    if (
        user_id === "Administrator" ||
        role === "Nirmaan Admin Profile" ||
        role === "Nirmaan Accountant Profile" ||
        role === "Nirmaan Accountant Lead Profile"
    ) {
        return <Outlet />
    }

    return (
        <div className="flex items-center justify-center h-[50vh]">
            <div className="text-center">
                <h2 className="text-xl font-semibold text-gray-800">Access Denied</h2>
                <p className="text-gray-600 mt-2">Bulk Import Transactions is limited to Accountants and Admins.</p>
            </div>
        </div>
    )
}


/**
 * Generic role-profile gate for routes whose only protection was the sidebar.
 * Before this, `/customers`, `/upload-boq`, `/upload-boq/templates` and
 * `/project-invoices` were plain `element:` entries under ProtectedRoute --
 * logged in was the whole check, so removing a nav item hid the door and not
 * the room.
 *
 * `allowed` holds role_profile strings and MUST mirror that route's role array
 * in NewSidebar.tsx; the hardcoded "Administrator" user always passes.
 *
 * UI gate only. These endpoints carry no server-side role check -- the Frappe
 * doctype permissions still answer the API, exactly as for every other role
 * restriction in this app.
 */
export const RoleRoute = ({
    allowed,
    what,
}: {
    allowed: readonly string[]
    what: string
}) => {
    const { role, user_id } = useUserData()
    return <RouteGate state={roleRouteState(role, user_id, allowed)} what={what} />
}

/**
 * The `/expense` route (spec #1494, #1506): open to someone who can raise at least one expense type,
 * or who reviews. The server answers (`useExpenseAccess`), from the same `allowed_roles` the
 * request-creating call enforces; the sidebar item reads the same answer.
 */
export const ExpenseRoute = () => {
    const { access, failed } = useExpenseAccess()
    return <RouteGate state={expenseRouteState(access, failed)} what="Expenses" />
}

/** The page, a loading state, or "Access Denied", by `state`. */
const RouteGate = ({ state, what }: { state: RoleRouteState; what: string }) => {
    if (state === "allow") {
        return <Outlet />
    }

    // S6 (F4 / U3): while the role is still loading, a loading state -- never "Access Denied".
    if (state === "loading") {
        return (
            <div className="flex flex-col items-center justify-center gap-3 h-[50vh]">
                <TailSpin visible={true} height="48" width="48" color="#D03B45" ariaLabel="tail-spin-loading" />
                <p className="text-sm text-gray-600">{ROLE_LOADING_TEXT}</p>
            </div>
        )
    }

    return (
        <div className="flex items-center justify-center h-[50vh]">
            <div className="text-center">
                <h2 className="text-xl font-semibold text-gray-800">Access Denied</h2>
                <p className="text-gray-600 mt-2">You don't have permission to access {what}.</p>
            </div>
        </div>
    )
}
