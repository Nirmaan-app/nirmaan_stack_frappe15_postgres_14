import { NirmaanUsers } from '@/types/NirmaanStack/NirmaanUsers'
import { UserContext } from '@/utils/auth/UserProvider'
import { useFrappeGetDoc } from 'frappe-react-sdk'
import Cookies from 'js-cookie'
import { createContext, createElement, FC, PropsWithChildren, useContext, useEffect, useMemo } from 'react'

/** Who is logged in. `role` is "Loading" while the Nirmaan Users record is read and "Error" if it fails. */
export interface UserData {
  user_id: string
  full_name: string
  user_image: string
  role: string
  has_project: string
}

const UserDataContext = createContext<UserData | null>(null)

/**
 * Works out the logged-in user ONCE for the whole app: three cookie reads and one Nirmaan Users subscription,
 * however many components call `useUserData()`. It re-runs on login and logout (`UserContext`), so a different
 * user logging in without a reload gets their own role. Mounted inside `UserProvider` (`App.tsx`).
 */
export const UserDataProvider: FC<PropsWithChildren> = ({ children }) => {
  // Subscribing to UserContext re-runs this on login and logout, so the cookies below are read again.
  useContext(UserContext)
  const user_id = Cookies.get('user_id') ?? ''
  const full_name = Cookies.get('full_name') ?? ''
  const user_image = Cookies.get('user_image') ?? ''
  const isAdministrator = user_id === 'Administrator'

  // Administrator has no Nirmaan Users record, and a logged-out visitor has nothing to read: no fetch for either.
  const { data, isLoading, error } = useFrappeGetDoc<NirmaanUsers>(
    'Nirmaan Users',
    user_id,
    isAdministrator || !user_id || user_id === 'Guest' ? null : undefined
  )

  useEffect(() => {
    if (error) console.log('userData Hook Error', error.message)
  }, [error])

  const value = useMemo<UserData>(() => {
    if (isAdministrator) return { user_id, full_name, user_image, role: 'Nirmaan Admin Profile', has_project: 'true' }
    if (isLoading) return { user_id, full_name, user_image, role: 'Loading', has_project: 'false' }
    if (error) return { user_id, full_name, user_image, role: 'Error', has_project: 'false' }
    return {
      user_id,
      full_name,
      user_image,
      role: data?.role_profile || '',
      has_project: data?.has_project || 'false',
    }
  }, [user_id, full_name, user_image, isAdministrator, isLoading, error, data?.role_profile, data?.has_project])

  return createElement(UserDataContext.Provider, { value }, children)
}

/**
 * The logged-in user: `user_id`, `full_name`, `user_image` (cookies), `role` and `has_project` (their Nirmaan Users
 * record). Reads the one copy `UserDataProvider` works out, so a call costs nothing. A table row still takes the
 * answer from its page (`frontend/CODING_STANDARDS.md` § Role-based access).
 */
export const useUserData = (): UserData => {
  const value = useContext(UserDataContext)
  if (!value) throw new Error('useUserData() needs <UserDataProvider> above it (App.tsx)')
  return value
}
