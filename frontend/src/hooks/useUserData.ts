import Cookies from 'js-cookie'
import { useFrappeGetDoc } from 'frappe-react-sdk'
import { NirmaanUsers } from '@/types/NirmaanStack/NirmaanUsers'

/**
 * Simple hook to fetch user data from cookies
 * @returns name, full_name, user_image - all strings
 */
export const useUserData = () => {
  const user_id = Cookies.get('user_id') ?? ''
  const full_name = Cookies.get('full_name') ?? ''
  const user_image = Cookies.get('user_image') ?? ''

  const {data, isLoading, error} = useFrappeGetDoc("Nirmaan Users", user_id)


  const role = data?.role_profile
  const has_project = data?.has_project


  return {
    user_id,
    full_name,
    user_image,
    role,
    has_project
  }
}