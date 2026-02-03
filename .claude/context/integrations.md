# Frontend-Backend Integration

## Boot Context API

### Development Mode
```python
# File: www/nirmaan_stack.py
@frappe.whitelist(methods=["POST"], allow_guest=True)
def get_context_for_dev():
    # Returns full Frappe session boot data
    # Called by frontend: http://localhost:8000/api/method/nirmaan_stack.www.nirmaan_stack.get_context_for_dev
```

### Production Mode
- Frontend receives `window.frappe.boot` injected into `www/frontend.html`
- Contains: user session, permissions, site config, system settings

---

## REST API (frappe-react-sdk)

| Frappe Method | React Hook |
|---------------|------------|
| `frappe.client.get_list` | `useFrappeGetDocList()` |
| `frappe.client.get` | `useFrappeGetDoc()` |
| `frappe.client.insert` | `useFrappeCreateDoc()` |
| `frappe.client.set_value` | `useFrappeUpdateDoc()` |
| `frappe.client.delete` | `useFrappeDeleteDoc()` |
| Custom `@frappe.whitelist()` | `useFrappePostCall()` / `useFrappeGetCall()` |

---

## Socket.IO Real-time Updates

### Backend Event Publishing
```python
frappe.publish_realtime(
    event="pr:new",           # Custom event name
    message={...},            # Event payload
    user=user['name']         # Targeted delivery
)
```

### Event Types
**Procurement Requests:**
- `pr:new`, `pr:approved`, `pr:rejected`, `pr:vendorSelected`, `pr:delete`
- `pr:editing:started`, `pr:editing:stopped` - Editing lock status (for concurrent edit prevention)

**Purchase Orders:**
- `po:amended`, `po:new`, `po:delete`

**Service Requests:**
- `sr:vendorSelected`, `sr:approved`, `sr:delete`, `sr:amended`

**Payments:**
- `payment:new`, `payment:approved`, `payment:fulfilled`, `payment:delete`

**Sent Back:**
- `sb:vendorSelected`, `Rejected-sb:new`, `Delayed-sb:new`, `Cancelled-sb:new`

### Frontend Listener
`frontend/src/components/SocketInitializer.tsx` subscribes to these events

---

## Firebase Cloud Messaging

### Setup
`integrations/firebase/firebase_admin_setup.py`

### Flow
1. Backend stores FCM tokens in `Nirmaan Users.fcm_token`
2. Backend sends push via `PrNotification()` helper
3. Frontend service worker handles background notifications
4. Configurable per-user via `push_notification` field

---

## File Upload System

### Storage
Frappe's native file attachment system

### Tracking
`Nirmaan Attachments` doctype:
- Fields: `project`, `associated_doctype`, `associated_docname`, `attachment_type`, `attachment` (file URL)
- Used for: PRs, POs, delivery notes, BOQs, invoices, payments, milestones

### Frontend Upload
Uploads to `/api/method/upload_file`

---

## Three-Channel Notification System

1. **In-app:** `Nirmaan Notifications` doctype (persistent storage)
2. **Real-time:** Socket.IO events (instant updates)
3. **Push:** Firebase Cloud Messaging (mobile/browser notifications)
