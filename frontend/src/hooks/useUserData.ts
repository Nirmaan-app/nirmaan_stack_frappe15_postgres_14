import { NirmaanUsers } from '@/types/NirmaanStack/NirmaanUsers'
import { useFrappeGetDoc } from 'frappe-react-sdk'
import Cookies from 'js-cookie'

/**
 * Simple hook to fetch user data from cookies
 * @returns name, full_name, user_image - all strings
 */
export const useUserData = () => {
  const user_id = Cookies.get('user_id') ?? ''
  const full_name = Cookies.get('full_name') ?? ''
  const user_image = Cookies.get('user_image') ?? ''

  if(user_id==="Administrator") {
    const role = "Nirmaan Admin Profile"
    const has_project = "true"
    return {
      user_id,
      full_name,
      user_image,
      role,
      has_project
    }
  }
  const {data, isLoading, error} = useFrappeGetDoc<NirmaanUsers>("Nirmaan Users", user_id)

  const role = data?.role_profile || ""
  const has_project = data?.has_project || "false"

  if(isLoading) return {user_id, full_name, user_image, role:"Loading", has_project:"false"};
  if(error) {
    console.log("userData Hook Error", error.message);
    return {user_id, full_name, user_image, role:"Error", has_project:"false"};
  }
  return {
    user_id,
    full_name,
    user_image,
    role,
    has_project
  }
}