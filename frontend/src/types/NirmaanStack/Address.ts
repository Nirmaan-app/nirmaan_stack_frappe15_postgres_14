export interface Address {
  name: string
  creation: string
  modified: string
  owner: string
  modified_by: string
  docstatus: 0 | 1 | 2
  parent?: string
  parentfield?: string
  parenttype?: string
  idx?: number
  address_title?: string | null
  address_type: string
  address_line1: string
  address_line2?: string | null
  city: string
  state?: string | null
  country: string
  pincode?: string | null
  email_id?: string | null
  phone?: string | null
}